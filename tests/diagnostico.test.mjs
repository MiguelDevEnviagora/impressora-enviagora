/* A CAIXA-PRETA — as duas regras que nao podem ser quebradas.
 *
 * 1. NUNCA guardar conteudo de etiqueta. Etiqueta tem nome, endereco e CPF de cliente.
 *    O diagnostico sai da maquina (o operador manda o arquivo por e-mail ou WhatsApp),
 *    entao vazar aqui e vazar de verdade.
 * 2. NUNCA atrapalhar a impressao. Diagnostico que derruba producao e pior que
 *    diagnostico nenhum.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { carregarExtensao, lerSrc } from './ajuda/carregar-extensao.mjs';

carregarExtensao();
const DIAG = globalThis.EnviagoraDiag;

/** chrome.storage.local simulado, so o suficiente para a caixa-preta. */
function fingirStorage(inicial = {}) {
  const dados = { ...inicial };
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(pedido, cb) {
          const saida = {};
          for (const [k, padrao] of Object.entries(pedido)) {
            saida[k] = Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : padrao;
          }
          cb(saida);
        },
        set(novos, cb) { Object.assign(dados, novos); if (cb) cb(); }
      }
    }
  };
  return dados;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('NUNCA guarda conteudo de etiqueta', async () => {
  fingirStorage();
  await DIAG.limparTudo();

  DIAG.registrar('teste', {
    ms: 120,                                   // metadado: fica
    via: 'motor',                              // metadado: fica
    base64: 'JVBERi0xLjQKJcfs...',             // o PDF inteiro: SAI
    b64: 'JVBERi0x',                           // idem: SAI
    texto: 'Contrato 9912 SEDEX Joao da Silva',// texto extraido da etiqueta: SAI
    conteudo: 'qualquer coisa',                // SAI
    endereco: 'Rua X, 123',                    // SAI
    destinatario: 'Maria',                     // SAI
    nome: 'Maria Souza',                       // SAI
    cpf: '000.000.000-00',                     // SAI
    bytes: 12345                               // ate numero com esse nome: SAI
  });

  const eventos = await DIAG.ler();
  const e = eventos[eventos.length - 1];

  assert.equal(e.ms, 120, 'metadado legitimo foi descartado');
  assert.equal(e.via, 'motor');
  for (const proibido of ['base64', 'b64', 'texto', 'conteudo', 'endereco',
                          'destinatario', 'nome', 'cpf', 'bytes']) {
    assert.equal(e[proibido], undefined, 'VAZOU o campo ' + proibido);
  }

  // e nada do conteudo aparece no relatorio final, que e o que sai da maquina
  const relatorio = await DIAG.relatorio();
  for (const trecho of ['JVBERi0x', 'Joao da Silva', 'Maria', 'Rua X', '000.000.000-00']) {
    assert.ok(!relatorio.includes(trecho), 'o relatorio contem "' + trecho + '"');
  }
});

test('corta texto gigante em vez de encher o storage', async () => {
  fingirStorage();
  await DIAG.limparTudo();
  DIAG.registrar('teste', { erro: 'x'.repeat(5000) });
  const eventos = await DIAG.ler();
  assert.ok(eventos[eventos.length - 1].erro.length < 400,
    'mensagem gigante nao foi cortada — o storage enche e o Chrome comeca a recusar gravacao');
});

test('a fila e circular: nao cresce para sempre', async () => {
  fingirStorage();
  await DIAG.limparTudo();
  for (let i = 0; i < DIAG.MAX_EVENTOS + 120; i++) DIAG.registrar('teste', { i });
  const eventos = await DIAG.ler();
  assert.ok(eventos.length <= DIAG.MAX_EVENTOS,
    'guardou ' + eventos.length + ' eventos; o teto e ' + DIAG.MAX_EVENTOS);
  // e o que sobra e o mais RECENTE, que e o que interessa depois de um erro
  assert.equal(eventos[eventos.length - 1].i, DIAG.MAX_EVENTOS + 119);
});

test('storage quebrado nao derruba nada — a impressao continua', async () => {
  globalThis.chrome = {
    storage: { local: {
      get() { throw new Error('storage fora do ar'); },
      set() { throw new Error('storage fora do ar'); }
    } }
  };
  assert.doesNotThrow(() => DIAG.registrar('teste', { ms: 1 }),
    'registrar lancou — isso subiria pelo caminho da impressao');
  await assert.doesNotReject(DIAG.ler());
  await assert.doesNotReject(DIAG.relatorio());
  await assert.doesNotReject(DIAG.limparTudo());
});

test('registrar nao devolve promessa: ninguem consegue esperar por ela', () => {
  // Se registrar() virasse async, alguem acabaria colocando um await nela dentro do
  // caminho de impressao — e ai o diagnostico passaria a atrasar a etiqueta.
  fingirStorage();
  assert.equal(DIAG.registrar('teste', {}), undefined);
});

test('nenhum caminho de impressao espera pelo diagnostico', () => {
  // Nem com await, nem com .then encadeado no fluxo.
  for (const arquivo of ['hook.js', 'background.js', 'content.js']) {
    const src = lerSrc(arquivo);
    assert.doesNotMatch(src, /await\s+(self\.)?Enviagora(Diag|)\.?registrar/,
      arquivo + ' espera pelo diagnostico no meio do fluxo');
    assert.doesNotMatch(src, /await\s+logar\(/, arquivo + ' espera pelo log');
  }
});

test('o hook manda os eventos por postMessage, e o content repassa', () => {
  // hook.js roda no MUNDO MAIN: sem essa ponte, os eventos do caminho de impressao —
  // justamente os que interessam — nunca chegariam a lugar nenhum.
  assert.match(lerSrc('hook.js'), /__enviagora: 'log', tipo, dados/,
    'o hook parou de mandar os eventos');
  assert.match(lerSrc('content.js'), /d\.__enviagora !== 'log'/,
    'o content.js parou de repassar os eventos do hook');
  assert.match(lerSrc('background.js'), /msg\.action === 'log'/,
    'o background parou de gravar os eventos que chegam');
});

test('o popup deixa tirar o diagnostico da maquina', () => {
  const html = lerSrc('popup.html');
  for (const botao of ['baixarDiag', 'copiarDiag', 'limparDiag']) {
    assert.match(html, new RegExp('id="' + botao + '"'), 'popup.html perdeu o botao ' + botao);
  }
  assert.match(lerSrc('popup.js'), /action: 'diagnostico'/,
    'popup.js parou de pedir o relatorio ao background');
});
