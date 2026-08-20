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
  assert.match(src, /retrato\.palpite && cfg\.conferirA4NoMotor !== false/,
    'o palpite voltou a virar recorte direto, sem conferencia');
  assert.match(src, /TETO_MOTOR_PALPITE_MS = 2000/,
    'o teto da conferencia sumiu ou mudou — sem teto curto, motor lento vira etiqueta atrasada');
  // a queda tem que ser para o recorte de hoje, e nao para "sem ajuste"
  const trecho = src.slice(src.indexOf('retrato.palpite && cfg.conferirA4NoMotor'));
  const depois = trecho.slice(0, trecho.indexOf('// Nenhuma regra bateu'));
  assert.match(depois, /processarBasico\(msg\.base64, operador\)/,
    'motor mudo tem que cair no recorte de hoje — nunca em "sem ajuste"');
});
