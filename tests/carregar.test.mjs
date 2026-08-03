/* MIGRACAO DO STORAGE E LEITURA DAS CONFIGURACOES.
 *
 * Estas duas funcoes mexem no chrome.storage.sync de ~60 maquinas em producao. Errar na
 * migracao apaga o ajuste manual de alguem sem ninguem perceber — a etiqueta so comeca a
 * sair diferente e ninguem liga uma coisa a outra. Por isso ela e uma funcao pura, e por
 * isso os casos abaixo sao especificos e chatos.
 *
 * O chrome nao existe no Node, entao aqui ele e simulado. So o suficiente: get/set/remove
 * de sync e local, que e tudo que o carregar() toca.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { carregarExtensao } from './ajuda/carregar-extensao.mjs';

carregarExtensao();
const CFG = globalThis.EnviagoraConfig;

/** Simula chrome.storage. `sync` e `local` sao objetos comuns. */
function fingirChrome({ sync = {}, local = {} } = {}) {
  const area = (dados) => ({
    get(pedido, cb) {
      if (pedido === null || pedido === undefined) return cb({ ...dados });
      const saida = {};
      for (const [k, padrao] of Object.entries(pedido)) {
        saida[k] = Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : padrao;
      }
      cb(saida);
    },
    set(novos, cb) { Object.assign(dados, novos); if (cb) cb(); },
    remove(chaves, cb) { for (const k of [].concat(chaves)) delete dados[k]; if (cb) cb(); }
  });
  globalThis.chrome = { storage: { sync: area(sync), local: area(local) } };
  return { sync, local };
}

// ── carregar() ──────────────────────────────────────────────────────────────

test('storage vazio: carregar() devolve exatamente o padrao embutido', async () => {
  fingirChrome();
  const { s, killSwitch } = await CFG.carregar();
  for (const campo of CFG.CAMPOS) assert.equal(s[campo], CFG.PADRAO[campo], campo);
  assert.equal(killSwitch, false);
});

test('com cache remoto e sem ajuste local, o remoto vale', async () => {
  fingirChrome({ local: { configRemoto: { campos: { marginMm: 5, headerText: 'DA MATRIZ' }, configVersion: 7 } } });
  const { s } = await CFG.carregar();
  assert.equal(s.marginMm, 5);
  assert.equal(s.headerText, 'DA MATRIZ');
  assert.equal(s.safeScale, 100, 'campo nao definido pelo remoto segue o embutido');
});

test('o ajuste manual do operador ganha do remoto', async () => {
  fingirChrome({
    sync: { marginMm: 7 },
    local: { configRemoto: { campos: { marginMm: 5, headerText: 'DA MATRIZ' } } }
  });
  const { s } = await CFG.carregar();
  assert.equal(s.marginMm, 7, 'o delta local tem que ganhar');
  assert.equal(s.headerText, 'DA MATRIZ', 'campo sem delta segue o remoto');
});

test('o remoto NAO consegue desligar a extensao nem a trava', async () => {
  // enabled e lockEnabled sao remoto:false. Mesmo que alguem consiga colocar esses campos
  // no cache, o efetivo tem que ignora-los — senao o config remoto vira uma porta dos
  // fundos na trava por senha.
  fingirChrome({ local: { configRemoto: { campos: { enabled: false, lockEnabled: false } } } });
  const { s } = await CFG.carregar();
  assert.equal(s.enabled, true);
  assert.equal(s.lockEnabled, true);
});

test('killSwitch do cache chega em s.killSwitch', async () => {
  fingirChrome({ local: { configRemoto: { campos: {}, killSwitch: true } } });
  const { s, killSwitch } = await CFG.carregar();
  assert.equal(killSwitch, true);
  assert.equal(s.killSwitch, true, 'o labeler le s.killSwitch, entao ele precisa estar dentro de s');
});

test('cache corrompido nao derruba nada — vale o embutido', async () => {
  for (const lixo of [null, 'texto', 42, {}, { campos: null }, { campos: 'nao e objeto' }]) {
    fingirChrome({ local: { configRemoto: lixo } });
    const { s } = await CFG.carregar();
    assert.equal(s.marginMm, CFG.PADRAO.marginMm);
    assert.equal(s.correiosMarginMm, CFG.PADRAO.correiosMarginMm);
  }
});

test('carregar() nao lanca nem se o chrome sumir no meio', async () => {
  globalThis.chrome = { storage: { sync: { get() { throw new Error('sem storage'); } }, local: { get() { throw new Error('sem storage'); } } } };
  const { s } = await CFG.carregar();
  assert.equal(s.outputWidthMm, 100, 'sem storage, a extensao ainda tem que imprimir com o padrao');
});

// ── migrarSync() ────────────────────────────────────────────────────────────

test('MIGRACAO instalacao nova: nao grava nada alem da versao do esquema', () => {
  const r = CFG.migrarSync({});
  assert.deepEqual(r.gravar, { settingsSchemaVersion: CFG.SCHEMA_VERSION });
  assert.deepEqual(r.remover, []);
  assert.deepEqual(r.preservados, []);
});

test('MIGRACAO maquina que nunca foi mexida: tudo sai do sync e passa a seguir a matriz', () => {
  // Este e o caso da esmagadora maioria das 60 maquinas: o onInstalled da 1633 gravou os
  // 34 campos com o valor de fabrica e ninguem nunca abriu o popup.
  const salvo = { settingsSchemaVersion: 1633 };
  for (const [k, v] of Object.entries(CFG.PADRAO)) {
    if (k !== 'settingsSchemaVersion') salvo[k] = v;
  }
  const r = CFG.migrarSync(salvo);

  assert.deepEqual(r.preservados, [], 'nada foi tocado, entao nada pode ser preservado como ajuste');
  assert.equal(r.remover.length, Object.keys(CFG.PADRAO).length - 1);

  // E a garantia que sustenta a migracao inteira: o valor EFETIVO nao muda para ninguem.
  // O que sai do sync volta identico pelo PADRAO embutido.
  // (settingsSchemaVersion fica de fora: ele SOBE de 1633 para 1634, e essa e a unica
  //  mudanca de valor que a migracao pode causar.)
  const antes = CFG.efetivo(null, salvo);
  const depois = CFG.efetivo(null, r.gravar);
  for (const campo of CFG.CAMPOS) {
    if (campo === 'settingsSchemaVersion') continue;
    assert.equal(depois[campo], antes[campo], campo + ' mudou de valor na migracao');
  }
  assert.equal(depois.settingsSchemaVersion, CFG.SCHEMA_VERSION);
});

test('MIGRACAO ajuste real do operador e preservado intacto', () => {
  const r = CFG.migrarSync({
    settingsSchemaVersion: 1633,
    marginMm: 4,                        // mexido
    safeScale: 98,                      // mexido
    outputWidthMm: 100,                 // igual ao padrao
    headerText: CFG.PADRAO.headerText   // igual ao padrao
  });

  assert.equal(r.gravar.marginMm, 4);
  assert.equal(r.gravar.safeScale, 98);
  assert.deepEqual(r.preservados.sort(), ['marginMm', 'safeScale']);
  assert.deepEqual(r.remover.sort(), ['headerText', 'outputWidthMm']);
});

test('MIGRACAO o desligamento local sobrevive', () => {
  // Se a maquina estava desligada de proposito, a atualizacao nao pode religar sozinha.
  const r = CFG.migrarSync({ settingsSchemaVersion: 1633, enabled: false, lockEnabled: false });
  assert.equal(r.gravar.enabled, false);
  assert.equal(r.gravar.lockEnabled, false);
});

test('MIGRACAO os tres campos mortos saem do storage', () => {
  const r = CFG.migrarSync({
    settingsSchemaVersion: 1633,
    autoPrint: true, debugBorder: false, corrigirCodigoBarras: true,
    marginMm: 6
  });
  for (const morto of ['autoPrint', 'debugBorder', 'corrigirCodigoBarras']) {
    assert.ok(r.remover.includes(morto), morto + ' continuou no storage');
    assert.equal(r.gravar[morto], undefined);
  }
  assert.equal(r.gravar.marginMm, 6, 'o ajuste real ao lado nao pode ser afetado');
});

test('MIGRACAO quem veio da 16.32 tem a margem de seguranca zerada', () => {
  // A 16.32 saiu com printSafeMarginMm = 3, o que encolheu a etiqueta dos Correios e fez
  // o leitor deles parar de bipar. Sem esta correcao dirigida, o valor 3 seria lido como
  // "ajuste deliberado do operador" e preservado para sempre.
  const r = CFG.migrarSync({ settingsSchemaVersion: 1632, printSafeMarginMm: 3 });
  assert.equal(r.veioDa1632, true);
  assert.ok(r.remover.includes('printSafeMarginMm'), 'o 3 da 16.32 tinha que sair');
  assert.equal(r.gravar.printSafeMarginMm, undefined);
  assert.equal(CFG.efetivo(null, r.gravar).printSafeMarginMm, 0);
});

test('MIGRACAO rodar duas vezes da o mesmo resultado', () => {
  // O onInstalled dispara em toda atualizacao. A segunda passada nao pode desfazer nada.
  const original = { settingsSchemaVersion: 1633, marginMm: 4, autoPrint: true };
  const primeira = CFG.migrarSync(original);
  const segunda = CFG.migrarSync(primeira.gravar);
  assert.deepEqual(segunda.gravar, primeira.gravar);
  assert.deepEqual(segunda.remover, []);
});
