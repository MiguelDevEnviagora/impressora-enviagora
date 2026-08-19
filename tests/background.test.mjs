/* O BACKGROUND DE VERDADE, RODANDO NO NODE — teste de integracao do handler cropPdf.
 *
 * Nasceu do estresse de 19/08/2026, que derrubou a primeira chave de deduplicacao
 * (v16.36.5): 20 PDFs diferentes, 18 tratados como repeticao. Colisao aqui nao e
 * desperdicio — e a etiqueta de UM cliente saindo na encomenda de OUTRO. Estes testes
 * mantem aquele estresse vivo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES } from './ajuda/carregar-extensao.mjs';
import { carregarBackgroundReal, mandar } from './ajuda/chrome-falso.mjs';

const chrome = carregarBackgroundReal();
const flush = () => new Promise((r) => setTimeout(r, 60));
const b64 = (rel) => fs.readFileSync(path.join(FIXTURES, rel)).toString('base64');

test('dois pedidos identicos ao mesmo tempo dividem UM processamento', async () => {
  // E o que o WMS faz de verdade: hook.js e content.js pedem o ajuste do MESMO blob
  // por caminhos diferentes, com ~90 ms de diferenca.
  const b = b64('amazon/6a70e1132967a.pdf');
  const [r1, r2] = await Promise.all([
    mandar(chrome, { action: 'cropPdf', base64: b }, {}),
    mandar(chrome, { action: 'cropPdf', base64: b }, {})
  ]);
  assert.equal(r1.croppedBase64, r2.croppedBase64, 'os dois pedidos tem que receber a MESMA saida');
  await flush();
  const eventos = chrome._local.diagnostico || [];
  const entradas = eventos.filter((e) => e.tipo === 'crop-entrou').length;
  assert.equal(entradas, 1, 'era para processar UMA vez — processou ' + entradas);
});

test('PDFs DIFERENTES nunca dividem trabalho (a colisao da v16.36.5)', async () => {
  /* CICATRIZ: a chave era tamanho + primeiros/ultimos 64 chars do base64. PDFs do mesmo
   * gerador com o MESMO tamanho colidiam — e colisao e etiqueta trocada na parede. */
  const feitos = [];
  for (let i = 0; i < 12; i++) {
    const d = await globalThis.PDFLib.PDFDocument.create();
    const p = d.addPage([595.28, 841.89]);
    p.drawText('etiqueta ' + String(i).padStart(2, '0'), { x: 40, y: 800, size: 20 });
    feitos.push(Buffer.from(await d.save()).toString('base64'));
  }
  const respostas = await Promise.all(
    feitos.map((b) => mandar(chrome, { action: 'cropPdf', base64: b }, {}))
  );
  const unicas = new Set(respostas.map((r) => r.croppedBase64)).size;
  assert.equal(unicas, 12,
    'PDFs diferentes sairam com a MESMA etiqueta — a chave de dedupe voltou a colidir');
});

test('a propria saida voltando como entrada sai na hora, sem reprocessar', async () => {
  // O 3o cropPdf do log de producao: o content.js roda dentro do iframe ja trocado e
  // pede o ajuste da etiqueta que nos mesmos geramos.
  const r1 = await mandar(chrome, { action: 'cropPdf', base64: b64('amazon/6a70e12cb13ef.pdf') }, {});
  assert.ok(r1.croppedBase64, 'o ajuste normal parou de funcionar');
  const r2 = await mandar(chrome, { action: 'cropPdf', base64: r1.croppedBase64 }, {});
  assert.equal(r2.croppedBase64, null, 'a saida ja ajustada tinha que voltar sem ajuste');
  await flush();
  const eventos = chrome._local.diagnostico || [];
  assert.ok(eventos.some((e) => e.via === 'ja ajustado'),
    'o atalho ja-ajustado nao disparou — o PDF pronto foi reprocessado');
});

test('entrada hostil NUNCA derruba o handler: responde null e a vida segue', async () => {
  const pdfBom = fs.readFileSync(path.join(FIXTURES, 'amazon/6a70e1132967a.pdf'));
  const casos = [
    ['vazio', ''],
    ['nao-base64', '!!!###'],
    ['lixo em base64', Buffer.from('nao e um pdf').toString('base64')],
    ['pdf truncado', pdfBom.subarray(0, 900).toString('base64')],
    ['header pdf + lixo', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4000, 65)]).toString('base64')],
    ['undefined', undefined],
    ['null', null],
    ['numero', 42]
  ];
  for (const [nome, base64] of casos) {
    const r = await mandar(chrome, { action: 'cropPdf', base64 }, {});
    assert.ok(r && 'croppedBase64' in r, nome + ': o handler nao respondeu');
    assert.equal(r.croppedBase64, null, nome + ': lixo tem que voltar como "sem ajuste"');
  }
});

test('operadores diferentes com o mesmo PDF NAO dividem a saida', async () => {
  // O nome do operador e impresso na etiqueta: dividir aqui trocaria o carimbo.
  const b = b64('amazon/6a70e13c645b6.pdf');
  const [a, bb] = await Promise.all([
    mandar(chrome, { action: 'cropPdf', base64: b, operatorName: 'Ana' }, {}),
    mandar(chrome, { action: 'cropPdf', base64: b, operatorName: 'Beto' }, {})
  ]);
  assert.notEqual(a.croppedBase64, bb.croppedBase64,
    'saidas iguais para operadores diferentes — o carimbo de um sairia na etiqueta do outro');
});
