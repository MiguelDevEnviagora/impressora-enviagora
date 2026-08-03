/* TAREFA 1 — A REDE DE SEGURANCA.
 *
 * Este e o teste que bloqueia release. Ele roda o detector geometrico
 * (src/crop-etiqueta.js) sobre as 12 etiquetas reais de tests/fixtures/ e compara com
 * tests/fixtures/esperado.json, com tolerancia de 1 pt.
 *
 * OS DOIS LADOS SAO OBRIGATORIOS, e isso nao e detalhe:
 *   - as 5 da pasta amazon/  TEM que devolver o retangulo esperado;
 *   - as 7 da pasta correios/ TEM que devolver null.
 *
 * Um teste que so verificasse a Amazon estaria pela metade — foi exatamente assim que os
 * Correios quebraram na v16.32. A tolerancia de 6% sobre 288x432 pt (4x6 pol) tambem
 * alcanca 283x425 pt, que e 100x150 mm: o tamanho exato da etiqueta dos Correios. Sem a
 * guarda de area (fracao > 0.70 -> null), o detector devolvia "Amazon" numa etiqueta dos
 * Correios e o fluxo PULAVA o recorte dos Correios.
 *
 * Roda em Node puro: sem navegador, sem Chrome, sem canvas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { carregarExtensao, primeiraPagina, FIXTURES } from './ajuda/carregar-extensao.mjs';

const TOLERANCIA_PT = 1;
const CANTOS = ['left', 'bottom', 'width', 'height'];

carregarExtensao();

const esperado = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'esperado.json'), 'utf8'));

test('as 12 fixtures de referencia estao todas no repositorio', () => {
  assert.equal(esperado.casos.length, 12, 'esperado.json deveria descrever 12 etiquetas');
  for (const caso of esperado.casos) {
    assert.ok(fs.existsSync(path.join(FIXTURES, caso.arquivo)), 'faltando: ' + caso.arquivo);
  }

  const amazon = esperado.casos.filter((c) => c.esperado !== null);
  const correios = esperado.casos.filter((c) => c.esperado === null);
  assert.equal(amazon.length, 5, 'deveriam ser 5 etiquetas da Amazon');
  assert.equal(correios.length, 7, 'deveriam ser 7 etiquetas dos Correios');
});

test('AMAZON — o detector geometrico acha o bloco 4x6 nas 5 variantes', async (t) => {
  const casos = esperado.casos.filter((c) => c.esperado !== null);

  for (const caso of casos) {
    await t.test(caso.arquivo, async () => {
      const { pagina, totalPaginas } = await primeiraPagina(caso.arquivo);
      const achado = globalThis.EnviagoraCrop.detectarEtiqueta(pagina);

      assert.ok(achado, 'nao achou o bloco 4x6 — esta etiqueta cairia no ramo do Shopee ' +
                        'e seria recortada na metade de cima da folha, que na Amazon esta em branco');
      assert.equal(achado.name, 'Amazon');
      assert.equal(achado.geo, true,
        'o palpite geometrico precisa vir marcado com geo:true, senao o teste de texto ' +
        'dos Correios nao consegue derruba-lo em labeler.js');
      assert.equal(totalPaginas, caso.paginas, 'contagem de paginas mudou na fixture');

      for (const canto of CANTOS) {
        const diff = Math.abs(achado[canto] - caso.esperado[canto]);
        assert.ok(diff <= TOLERANCIA_PT,
          canto + ': esperava ' + caso.esperado[canto] + ', veio ' + achado[canto].toFixed(2) +
          ' (diferenca de ' + diff.toFixed(2) + ' pt, tolerancia ' + TOLERANCIA_PT + ' pt)');
      }
    });
  }
});

test('CORREIOS — o detector geometrico NAO pode disparar em nenhuma das 7', async (t) => {
  const casos = esperado.casos.filter((c) => c.esperado === null);

  for (const caso of casos) {
    await t.test(caso.arquivo, async () => {
      const { pagina } = await primeiraPagina(caso.arquivo);
      const achado = globalThis.EnviagoraCrop.detectarEtiqueta(pagina);

      assert.equal(achado, null,
        'o detector devolveu ' + JSON.stringify(achado) + ' numa etiqueta dos CORREIOS. ' +
        'Isso faz o fluxo pular o recorte dos Correios e a etiqueta sai errada — foi o ' +
        'bug da v16.32. Se voce mexeu na guarda de area (fracao > 0.70) ou na tolerancia ' +
        'de 6%, e aqui que aparece.');
    });
  }
});

test('a guarda de area continua de pe: bloco ocupando quase a folha inteira devolve null', async () => {
  // A fixture 6a70e6adf3afc.pdf tem pagina de 283x425 pt = 100x150 mm, que cai DENTRO da
  // tolerancia de 6% sobre 288x432. Sem a guarda, o "bloco 4x6" achado seria a pagina
  // inteira. Este teste existe para o caso de alguem afrouxar a guarda sem perceber.
  const { pagina } = await primeiraPagina('correios/6a70e6adf3afc.pdf');
  const tam = pagina.getSize();

  assert.ok(Math.abs(tam.width - 283.46) < 1 && Math.abs(tam.height - 425.2) < 1,
    'a fixture-armadilha mudou de tamanho; ela precisa ser ~283x425 pt para valer como teste');
  assert.equal(globalThis.EnviagoraCrop.detectarEtiqueta(pagina), null);
});

test('o detector nunca lanca, mesmo recebendo lixo', () => {
  // Contrato do detector: em qualquer erro devolve null e o chamador segue nas regras
  // antigas. Se ele passar a lancar, background.js e labeler.js caem no catch e perdem
  // a deteccao geometrica inteira, em silencio.
  for (const lixo of [null, undefined, {}, { node: null }, { getSize: () => ({}) }]) {
    assert.doesNotThrow(() => globalThis.EnviagoraCrop.detectarEtiqueta(lixo));
    assert.equal(globalThis.EnviagoraCrop.detectarEtiqueta(lixo), null);
  }
});
