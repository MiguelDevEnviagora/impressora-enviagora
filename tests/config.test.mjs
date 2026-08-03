/* CONFIG REMOTO — validacao, precedencia e o contrato dos valores.
 *
 * O config remoto e um JSON baixado da internet que manda no comportamento de ~60
 * maquinas. Este arquivo e o que torna isso seguro: nada entra sem passar pelo ESQUEMA,
 * e a REGRA DE OURO — falhou, vale o embutido — e testada explicitamente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { carregarExtensao, lerSrc, RAIZ } from './ajuda/carregar-extensao.mjs';

carregarExtensao();
const CFG = globalThis.EnviagoraConfig;

/* Tabela congelada da v16.33. A unificacao dos padroes NAO podia mudar nenhum valor —
   e este teste e a prova. Se voce mudar um padrao de proposito, mude aqui tambem e
   explique no commit por que a operacao aguenta. */
const PADRAO_v16_33 = {
  enabled: true,
  lockEnabled: true,
  printScaling: 'none',
  pickTrayByPdfSize: true,
  printSafeMarginMm: 0,
  outputWidthMm: 100,
  outputHeightMm: 150,
  marginMm: 2,
  safeScale: 100,
  centerContent: true,
  addTimestamp: true,
  timestampPosition: 'bottom',
  timestampText: 'DDI:',
  timestampFontSize: 9,
  addHeaderText: true,
  headerText: 'PEDIDO PROCESSADO E EMBALADO POR ENVIAGORA',
  headerFontSize: 8,
  addOperatorName: true,
  operatorNameFontSize: 9,
  batchMode: false,
  correiosFit: true,
  correiosScope: 'correios',
  correiosPadMm: 0.5,
  correiosMarginMm: 1,
  correiosFillFirst: true,
  interceptHttpPdfs: true,
  autoPrintStandalone: true,
  processUnknownPdfs: true,
  offsetXMm: 0,
  offsetYMm: 0
};

test('os padroes unificados batem campo a campo com a v16.33', () => {
  for (const [campo, valor] of Object.entries(PADRAO_v16_33)) {
    assert.equal(CFG.PADRAO[campo], valor,
      campo + ' mudou de valor na unificacao — era ' + JSON.stringify(valor) +
      ', virou ' + JSON.stringify(CFG.PADRAO[campo]));
  }
});

test('nao sobrou nenhum campo a mais nem a menos', () => {
  const atuais = Object.keys(CFG.PADRAO).filter((k) => k !== 'settingsSchemaVersion').sort();
  assert.deepEqual(atuais, Object.keys(PADRAO_v16_33).sort());
});

test('as tres configuracoes mortas nao voltaram', () => {
  // autoPrint, debugBorder e corrigirCodigoBarras existiam no storage e no popup, mas
  // nenhum codigo lia o valor de nenhum dos tres. Sairam na v16.34.
  for (const morta of ['autoPrint', 'debugBorder', 'corrigirCodigoBarras']) {
    assert.equal(CFG.PADRAO[morta], undefined, morta + ' voltou ao PADRAO');
    assert.equal(CFG.ESQUEMA[morta], undefined, morta + ' voltou ao ESQUEMA');
  }
});

test('todo campo do PADRAO tem entrada no ESQUEMA, e vice-versa', () => {
  assert.deepEqual(Object.keys(CFG.PADRAO).sort(), Object.keys(CFG.ESQUEMA).sort());
});

test('o proprio PADRAO passa na validacao que ele define', () => {
  for (const campo of CFG.CAMPOS) {
    const r = CFG.validarCampo(campo, CFG.PADRAO[campo]);
    assert.ok(r.ok, campo + ' = ' + JSON.stringify(CFG.PADRAO[campo]) + ' e recusado pelo proprio esquema: ' + r.motivo);
  }
});

test('enabled e lockEnabled NUNCA sao configuraveis remotamente', () => {
  // Um "enabled: false" vindo do servidor seria uma porta dos fundos na trava por senha.
  // A parada de emergencia central e o killSwitch, que e outra coisa.
  assert.equal(CFG.ESQUEMA.enabled.remoto, false);
  assert.equal(CFG.ESQUEMA.lockEnabled.remoto, false);

  const v = CFG.validarRemoto({ configVersion: 9, enabled: false, lockEnabled: false });
  assert.equal(v.campos.enabled, undefined, 'o remoto conseguiu desligar a extensao');
  assert.equal(v.campos.lockEnabled, undefined, 'o remoto conseguiu desligar a trava');
});

test('correiosMarginMm tem teto de 3 mm e recusa acima disso', () => {
  // Acima de ~3 mm a etiqueta dos Correios ganha borda branca lateral e o leitor deles
  // nao bipa. E o bug da v16.32, agora com trava na entrada.
  assert.equal(CFG.ESQUEMA.correiosMarginMm.max, 3);
  assert.ok(CFG.validarCampo('correiosMarginMm', 1).ok);
  assert.ok(CFG.validarCampo('correiosMarginMm', 3).ok);
  assert.equal(CFG.validarCampo('correiosMarginMm', 5).ok, false);

  const v = CFG.validarRemoto({ settings: { correiosMarginMm: 8 } });
  assert.equal(v.campos.correiosMarginMm, undefined);
  assert.ok(v.erros.some((e) => e.includes('correiosMarginMm')));
});

test('campo invalido e descartado sozinho, sem derrubar os validos ao lado', () => {
  const v = CFG.validarRemoto({
    configVersion: 3,
    settings: {
      marginMm: 4,                 // valido
      safeScale: 999,              // fora da faixa
      headerText: 'NOVO TEXTO',    // valido
      timestampPosition: 'meio',   // enum invalido
      campoQueNaoExiste: 1         // ignorado em silencio
    }
  });
  assert.equal(v.campos.marginMm, 4);
  assert.equal(v.campos.headerText, 'NOVO TEXTO');
  assert.equal(v.campos.safeScale, undefined);
  assert.equal(v.campos.timestampPosition, undefined);
  assert.equal(v.campos.campoQueNaoExiste, undefined);
  assert.equal(v.erros.length, 2);
  assert.equal(v.aplicavel, true);
});

test('JSON quebrado nao aplica nada — vale o embutido', () => {
  for (const lixo of [null, undefined, 'texto', 42, []]) {
    const v = CFG.validarRemoto(lixo);
    assert.deepEqual(v.campos, {});
    assert.equal(v.killSwitch, false);
  }
  // e o efetivo com config vazio devolve exatamente o padrao embutido
  const s = CFG.efetivo({}, {});
  for (const campo of Object.keys(PADRAO_v16_33)) assert.equal(s[campo], CFG.PADRAO[campo]);
});

test('minSchemaVersion maior que a extensao ignora o config inteiro', () => {
  const v = CFG.validarRemoto({
    minSchemaVersion: CFG.SCHEMA_VERSION + 1,
    settings: { marginMm: 9 }
  });
  assert.equal(v.aplicavel, false);
  assert.deepEqual(v.campos, {});
});

test('killSwitch so liga com true booleano', () => {
  assert.equal(CFG.validarRemoto({ killSwitch: true }).killSwitch, true);
  for (const quase of ['true', 1, 'sim', {}, null, undefined]) {
    assert.equal(CFG.validarRemoto({ killSwitch: quase }).killSwitch, false,
      'killSwitch ligou com ' + JSON.stringify(quase) + ' — so pode ligar com true booleano');
  }
});

test('as faixas impedem, por aritmetica, que a margem coma a etiqueta inteira', () => {
  // Nao existe checagem cruzada "marginMm cabe em outputWidthMm" no validarRemoto porque
  // ela seria inalcancavel: a pior combinacao possivel dentro das faixas ainda sobra arte.
  // Este teste guarda essa aritmetica — se alguem alargar marginMm ou estreitar
  // outputWidthMm, ele quebra e avisa que agora a guarda cruzada passou a fazer falta.
  const piorMargem = CFG.ESQUEMA.marginMm.max;
  const menorLargura = CFG.ESQUEMA.outputWidthMm.min;
  assert.ok(piorMargem * 2 < menorLargura,
    'margem maxima (' + piorMargem + ' mm dos dois lados) nao cabe mais na etiqueta mais ' +
    'estreita permitida (' + menorLargura + ' mm) — agora o validarRemoto PRECISA de uma ' +
    'checagem cruzada, que foi removida de proposito por ser codigo morto');

  // e a margem fora da faixa continua sendo recusada normalmente
  const v = CFG.validarRemoto({ settings: { marginMm: 60 } });
  assert.equal(v.campos.marginMm, undefined);
  assert.ok(v.erros.some((e) => e.includes('marginMm') && e.includes('fora da faixa')));
});

test('texto com caractere que a Helvetica nao imprime e recusado', () => {
  // Se passasse, o pdf-lib LANCA na hora de desenhar e a etiqueta simplesmente nao sai.
  assert.equal(CFG.validarCampo('headerText', 'ENVIAGORA — EXPEDICAO \u{1F4E6}').ok, false);
  assert.ok(CFG.validarCampo('headerText', 'PEDIDO PROCESSADO POR ENVIAGORA').ok);
  assert.ok(CFG.validarCampo('headerText', 'EXPEDICAO CONFERIDA - ACAO RAPIDA').ok);
});

test('PRECEDENCIA: embutido < remoto < ajuste do operador', () => {
  const remoto = { marginMm: 5, headerText: 'DA MATRIZ' };
  const delta = { marginMm: 7 };
  const s = CFG.efetivo(remoto, delta);

  assert.equal(s.marginMm, 7, 'o ajuste do operador tem que ganhar do remoto');
  assert.equal(s.headerText, 'DA MATRIZ', 'campo sem ajuste local segue o remoto');
  assert.equal(s.safeScale, 100, 'campo sem remoto nem ajuste segue o embutido');
});

test('delta corrompido no storage cai no padrao em vez de vazar', () => {
  const s = CFG.efetivo(null, { safeScale: 9999, marginMm: NaN, outputWidthMm: 120 });
  assert.equal(s.safeScale, CFG.PADRAO.safeScale);
  assert.equal(s.marginMm, CFG.PADRAO.marginMm);
  assert.equal(s.outputWidthMm, 120, 'o valor bom no meio dos ruins tem que sobreviver');
});

test('config/defaults.json seria aceito pelas maquinas', () => {
  const bruto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'defaults.json'), 'utf8'));
  const v = CFG.validarRemoto(bruto);

  assert.equal(v.aplicavel, true, 'o defaults.json publicado seria ignorado pelas maquinas');
  assert.deepEqual(v.erros, [], 'o defaults.json publicado tem campo invalido: ' + v.erros.join(' | '));
  assert.ok(v.configVersion >= 1, 'configVersion precisa existir e ser >= 1');
  assert.equal(typeof bruto.killSwitch, 'boolean', 'killSwitch precisa ser true ou false');

  // De proposito NAO existe aqui um "killSwitch tem que ser false". O kill switch e
  // acionado numa emergencia, com a operacao parada: um teste que reprovasse o commit
  // impediria o Pages de publicar exatamente o arquivo que resolve a emergencia. O CI
  // avisa em letras garrafais (scripts/validate.mjs) e deixa passar.
});

test('mudou um valor no defaults.json? entao a configVersion tem que subir', () => {
  // Sem isso e facil ajustar a margem, dar merge, e passar uma hora sem entender por que
  // nada mudou. A configVersion e o que aparece no item 9 do popup de cada maquina: e
  // como o suporte confere, a distancia, se aquela maquina ja pegou o ajuste.
  const bruto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'defaults.json'), 'utf8'));
  const v = CFG.validarRemoto(bruto);

  const diferentes = Object.entries(v.campos)
    .filter(([campo, valor]) => valor !== CFG.PADRAO[campo])
    .map(([campo, valor]) => campo + ': ' + JSON.stringify(CFG.PADRAO[campo]) + ' -> ' + JSON.stringify(valor));

  if (diferentes.length) {
    assert.ok(v.configVersion > 1,
      'config/defaults.json muda ' + diferentes.length + ' valor(es) em relacao ao embutido (' +
      diferentes.join('; ') + ') mas a configVersion ainda e ' + v.configVersion +
      '. Suba a configVersion no mesmo commit.');
  }
});

test('a URL do config aponta para o Pages deste repositorio', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(CFG.URL_CONFIG, pkg.homepage + 'config/defaults.json');
  assert.ok(CFG.URL_CONFIG.startsWith('https://'), 'config remoto tem que vir por HTTPS');
});

test('o manifest pede a permissao alarms — sem ela o refresh de 1 h falha calado', () => {
  const manifest = JSON.parse(lerSrc('manifest.json'));
  assert.ok(manifest.permissions.includes('alarms'),
    'chrome.alarms nao existe sem a permissao "alarms" e o config remoto para de atualizar sozinho');
  assert.ok(manifest.permissions.includes('storage'));
});
