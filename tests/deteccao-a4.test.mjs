/* O PALPITE "A4 RETRATO DE 1 PAGINA = SHOPEE".
 *
 * Duas etiquetas dos Correios de producao (20/08/2026) sairam recortadas em 10x15 com a
 * etiqueta pequena no meio do papel — 64 mm e 61 mm de largura numa etiqueta de 100 mm.
 * Elas sao A4 de 1 pagina, entao a regra de tamanho dizia "Shopee" e o caminho rapido
 * recortava um retangulo FIXO, ampliando o retangulo em vez da etiqueta.
 *
 * Estes testes travam os tres fatos que sustentam o conserto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { carregarExtensao, lerSrc, FIXTURES } from './ajuda/carregar-extensao.mjs';

carregarExtensao();
const A4 = path.join(FIXTURES, 'correios-a4');
const ARQUIVOS = ['sedex-bigboom.pdf', 'pac-rejuv.pdf'];

async function primeira(arq) {
  const doc = await globalThis.PDFLib.PDFDocument.load(fs.readFileSync(path.join(A4, arq)),
    { ignoreEncryption: true });
  const pgs = doc.getPages();
  return { doc, pagina: pgs[0], total: pgs.length, tam: pgs[0].getSize() };
}

test('sao mesmo A4 retrato de 1 pagina — o formato que dispara o palpite', async () => {
  for (const arq of ARQUIVOS) {
    const { pagina, total, tam } = await primeira(arq);
    assert.equal(total, 1, arq + ' deixou de ter 1 pagina');
    assert.ok(tam.width > 550 && tam.width < 640 && tam.height > 800,
      arq + ' deixou de ser A4 retrato (' + tam.width.toFixed(0) + 'x' + tam.height.toFixed(0) + ')');
    // o detector geometrico nao pode disparar: nao sao Amazon
    assert.equal(globalThis.EnviagoraCrop.detectarEtiqueta(pagina), null,
      arq + ': o detector geometrico passou a disparar — o palpite nem seria consultado');
  }
});

test('o texto delas identifica Correios sem ambiguidade', async () => {
  /* E este o sinal que o motor usa para derrubar o palpite. Sem ele o conserto nao tem
   * em que se apoiar. As duas trazem codigo de rastreio AA999999999BR; uma com espacos
   * ("AD 818 785 819 BR") e outra sem ("AD815030495BR") — as duas formas contam. */
  const RE_RASTREIO = /\b[A-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\s?BR\b/;
  const amostras = {
    'sedex-bigboom.pdf': 'Contrato: 9912707333 SEDEX AD 818 785 819 BR',
    'pac-rejuv.pdf': 'AD815030495BR Destinatario - 19/08/2026'
  };
  for (const [arq, texto] of Object.entries(amostras)) {
    assert.ok(RE_RASTREIO.test(texto), arq + ': o codigo de rastreio deixou de casar');
  }
  // a regra vive no labeler.js; se ela mudar, este teste tem que ser revisto junto
  assert.match(lerSrc('labeler.js'), /RE_RASTREIO\s*=\s*\/\\b\[A-Z\]\{2\}/,
    'a regra do codigo de rastreio mudou de forma no labeler.js');
});

test('a regra do A4 vem MARCADA como palpite, e as outras nao', () => {
  /* CICATRIZ: as outras regras da lista se apoiam em alguma prova — o detector achou um
   * retangulo 4x6, a Amazon tem mais de uma pagina, o Mercado Livre e paisagem. "A4
   * retrato de 1 pagina" e so "sobrou A4", e e a unica que precisa de conferencia. */
  const src = lerSrc('background.js');
  const linhas = src.split('\n').filter((l) => l.includes("return { name: '"));
  const shopee = linhas.filter((l) => l.includes("'Shopee'"));
  assert.equal(shopee.length, 1, 'a regra da Shopee sumiu ou duplicou no background.js');
  assert.match(shopee[0], /palpite: true/, 'a regra do A4 perdeu a marca de palpite');
  for (const l of linhas.filter((l) => !l.includes("'Shopee'"))) {
    assert.doesNotMatch(l, /palpite: true/,
      'uma regra com prova por tras foi marcada como palpite: ' + l.trim());
  }
});

test('o palpite passa pelo motor antes de virar recorte, com teto curto e queda limpa', () => {
  const src = lerSrc('background.js');
  /* v16.36.8: a conferencia passou a exigir tambem correiosFit. Ela existe por UM
     motivo — pegar etiqueta dos Correios escondida atras do palpite "Shopee". Com o
     tratamento dos Correios desligado nao ha o que pegar, e o motor devolveria o MESMO
     recorte do caminho rapido: ida e volta paga a toa. Amarrar as duas chaves faz o
     interruptor do popup ligar e desligar o recurso INTEIRO, e nao metade dele. */
  assert.match(src, /retrato\.palpite && cfg\.correiosFit && cfg\.conferirA4NoMotor !== false/,
    'o palpite voltou a virar recorte direto, ou a conferencia se soltou do correiosFit');
  assert.match(src, /TETO_MOTOR_PALPITE_MS = 2000/,
    'o teto da conferencia sumiu ou mudou — sem teto curto, motor lento vira etiqueta atrasada');
  // a queda tem que ser para o recorte de hoje, e nao para "sem ajuste"
  const trecho = src.slice(src.indexOf('retrato.palpite && cfg.correiosFit'));
  const depois = trecho.slice(0, trecho.indexOf('// Nenhuma regra bateu'));
  assert.match(depois, /processarBasico\(msg\.base64, operador\)/,
    'motor mudo tem que cair no recorte de hoje — nunca em "sem ajuste"');
});

/* O INTERRUPTOR DO POPUP, EXERCITADO NO BACKGROUND DE VERDADE.
 *
 * A partir da v16.36.8 o tratamento dos Correios nasce DESLIGADO e quem precisa liga no
 * item 5 do popup. O popup grava o ajuste no storage de sincronizacao, que ganha do
 * padrao da empresa. Estes dois testes conferem as duas pontas: desligado nao chama o
 * motor (que e o tempo que a operacao quis de volta), e ligado chama.
 *
 * O sinal observavel e o evento `a4-motor-mudo`: no Node o motor nunca responde, entao
 * ele so aparece se a conferencia chegou a ser TENTADA. */
import { carregarBackgroundReal, mandar } from './ajuda/chrome-falso.mjs';

const chromeBg = carregarBackgroundReal();
const respirar = () => new Promise((r) => setTimeout(r, 80));

async function imprimirA4(sync) {
  Object.keys(chromeBg._sync).forEach((k) => delete chromeBg._sync[k]);
  Object.assign(chromeBg._sync, sync);
  delete chromeBg._local.diagnostico;

  const doc = await globalThis.PDFLib.PDFDocument.create();
  const pag = doc.addPage([595.28, 841.89]);            // A4 retrato, 1 pagina -> palpite "Shopee"
  pag.drawText('CONTRATO 9912733639 PAC ' + JSON.stringify(sync), { x: 40, y: 800, size: 12 });
  const base64 = Buffer.from(await doc.save()).toString('base64');

  await mandar(chromeBg, { action: 'cropPdf', base64 }, { tab: { id: 7 } });
  await respirar();
  return (chromeBg._local.diagnostico || []).map((e) => e.tipo);
}

test('desligado (padrao da empresa): a etiqueta A4 nao paga a ida ao motor', async () => {
  const eventos = await imprimirA4({});
  assert.ok(!eventos.includes('a4-motor-mudo'),
    'a conferencia foi tentada mesmo com o tratamento dos Correios desligado — ' +
    'e exatamente o tempo por etiqueta que a operacao pediu de volta');
});

test('ligado no popup daquela maquina: a conferencia volta a acontecer', async () => {
  // E o que o popup grava quando o operador marca o item 5.
  const eventos = await imprimirA4({ correiosFit: true });
  assert.ok(eventos.includes('a4-motor-mudo'),
    'o interruptor do popup nao religou a conferencia — ligar viraria meia funcionalidade');
});
