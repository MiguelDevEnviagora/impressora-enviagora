/* INVARIANTES DA LOGICA DE IMPRESSAO.
 *
 * Estes testes olham o CODIGO-FONTE, nao o comportamento. Isso e proposital e vale a
 * explicacao: as regras abaixo vivem em labeler.js e background.js, que dependem de
 * canvas, pdf.js e da API chrome — reproduzir esse ambiente no Node custaria mais do que
 * protege. O que da para garantir sem navegador e que a REGRA continue escrita ali.
 *
 * Cada uma destas linhas e cicatriz de um bug que foi para producao. Se um teste daqui
 * quebrar, nao mude o teste: leia o porque no comentario e confirme que a mudanca e
 * mesmo intencional.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { spawnSync } from 'node:child_process';

import { lerSrc, SRC, RAIZ } from './ajuda/carregar-extensao.mjs';
import { idDaExtensao } from '../scripts/lib/crx.mjs';

test('os Correios NUNCA recebem a margem de seguranca de impressao', () => {
  // v16.32 aplicou um piso de 3 mm em todo mundo. A etiqueta dos Correios ganhou borda
  // branca lateral e o leitor deles parou de bipar. A correcao da v16.33.1 foi zerar o
  // piso no caminho "preencher a largura". Quem manda ali e correiosMarginMm (1 mm).
  const labeler = lerSrc('labeler.js');
  assert.match(labeler, /const piso = fillFirst \? 0 :/,
    'o piso de printSafeMarginMm voltou a alcancar o caminho fillFirst dos Correios');
  assert.match(labeler, /Number\(fillFirst \? s\.correiosMarginMm : s\.marginMm\)/,
    'o caminho dos Correios parou de usar correiosMarginMm');
});

test('o palpite geometrico continua derrubavel pelo texto dos Correios', () => {
  // Texto ("Contrato:", "SEDEX", codigo AA999999999BR) e sinal muito mais especifico do
  // que "existe um bloco 4x6 nesta folha". Sem o geo:true, um Correios em folha A4 com um
  // bloco 4x6 dentro sairia como Amazon.
  const crop = lerSrc('crop-etiqueta.js');
  const labeler = lerSrc('labeler.js');

  assert.match(crop, /geo:\s*true/, 'crop-etiqueta.js parou de marcar o resultado com geo:true');
  assert.match(labeler, /detectada\?\.geo === true \|\| detectada\?\.name !== 'Amazon'/,
    'labeler.js parou de deixar o teste dos Correios derrubar o palpite geometrico');
});

test('a guarda de area (70%) continua no detector', () => {
  // A tolerancia de 6% sobre 288x432 pt tambem alcanca 283x425 pt = 100x150 mm, o tamanho
  // exato da etiqueta dos Correios. Sem esta guarda o detector devolvia "Amazon" para uma
  // folha que E a etiqueta inteira, e o recorte dos Correios era pulado.
  const crop = lerSrc('crop-etiqueta.js');
  assert.match(crop, /if \(fracao > 0\.70\) return null;/,
    'a guarda de area sumiu — os Correios voltam a ser confundidos com Amazon');
  assert.match(crop, /const ALVO_W = 288;/);
  assert.match(crop, /const ALVO_H = 432;/);
  assert.match(crop, /const TOL = 0\.06;/);
});

test('as regras antigas de Shopee e Mercado Livre seguem intactas', () => {
  // A deteccao geometrica e ADITIVA: se ela nao achar nada, cai exatamente nas regras da
  // v16.31. Shopee e Mercado Livre nunca dependeram dela e nao podem ser afetados.
  for (const arquivo of ['background.js', 'labeler.js']) {
    const src = lerSrc(arquivo);
    assert.match(src, /'Shopee',\s*left: 0, bottom: 398, width: 300, height: 444/,
      arquivo + ': a regra do Shopee mudou');
    assert.match(src, /'Mercado Livre', left: 0, bottom: 154, width: 300, height: 410/,
      arquivo + ': a regra do Mercado Livre mudou');
  }
});

test('os padroes existem em UM lugar so', () => {
  // Antes da v16.34 este bloco estava copiado em cinco arquivos, e tres das copias ja
  // estavam desatualizadas (sem printSafeMarginMm, printScaling e pickTrayByPdfSize).
  for (const arquivo of ['motor.js', 'viewer.js', 'popup.js', 'background.js']) {
    const src = lerSrc(arquivo);
    assert.doesNotMatch(src, /^\s*(const|let)\s+PADRAO\s*=\s*\{/m,
      arquivo + ' voltou a declarar o proprio PADRAO — os padroes sao de config-padrao.js');
    assert.doesNotMatch(src, /^\s*const DEFAULT_SETTINGS = \{/m,
      arquivo + ' voltou a declarar o proprio DEFAULT_SETTINGS');
  }
  assert.match(lerSrc('config-padrao.js'), /const PADRAO = \{/);
});

test('todos os contextos carregam config-padrao.js', () => {
  // O arquivo roda em tres lugares diferentes e cada um carrega de um jeito. Faltando um,
  // aquele contexto quebra com "EnviagoraConfig is not defined" — mas so em producao.
  assert.match(lerSrc('background.js'), /importScripts\('config-padrao\.js'\)/,
    'service worker');
  assert.match(lerSrc('background.js'), /MOTOR_ARQUIVOS = \[[^\]]*'config-padrao\.js'/,
    'motor injetado como content script');
  assert.match(lerSrc('viewer.html'), /<script src="config-padrao\.js"><\/script>/, 'viewer');
  assert.match(lerSrc('popup.html'), /<script src="config-padrao\.js"><\/script>/, 'popup');

  const manifest = JSON.parse(lerSrc('manifest.json'));
  const war = manifest.web_accessible_resources[0].resources;
  assert.ok(war.includes('config-padrao.js'),
    'config-padrao.js precisa estar em web_accessible_resources para o motor injeta-lo');
});

test('o kill switch corta os quatro caminhos de interceptacao', () => {
  const bg = lerSrc('background.js');
  const labeler = lerSrc('labeler.js');

  assert.match(bg, /if \(cfg\.killSwitch\) \{ clearTimeout\(guarda\); return responder\(null, 'kill switch'\); \}/,
    'cropPdf (o caminho do WMS) nao respeita o kill switch');
  assert.match(bg, /if \(s\.killSwitch\) return;/,
    'a troca da aba pelo ajustador nao respeita o kill switch');
  assert.match(bg, /if \(!s\.enabled \|\| s\.killSwitch\) return null;/,
    'processarBasico nao respeita o kill switch');
  assert.match(labeler, /if \(s\.killSwitch\) return \{ bytes: null, info:/,
    'o motor (Correios) nao respeita o kill switch');
});

test('os arquivos mortos nao voltaram', () => {
  // worker.html/worker.js eram o motor em iframe, substituido pelo content script na
  // v16.30. barcode-fix.js e lib/jsQR.js so eram carregados pelo worker.html, e a
  // reconstrucao do codigo de barras da J&T saiu do produto. Juntos, ~500 KB de peso
  // morto no ZIP — e superficie a mais na revisao da Web Store, que e o plano B.
  for (const morto of ['worker.html', 'worker.js', 'barcode-fix.js', 'lib/jsQR.js']) {
    assert.equal(fs.existsSync(path.join(SRC, morto)), false, morto + ' voltou para src/');
  }
  const manifest = JSON.parse(lerSrc('manifest.json'));
  assert.equal(manifest.web_accessible_resources[0].resources.includes('worker.html'), false);
});

test('a chave privada do CRX nao esta versionada nem no historico', (t) => {
  // Perder essa chave = perder a capacidade de atualizar as 60 maquinas.
  // Vazar essa chave = qualquer um consegue assinar um CRX que o Chrome aceita como
  // atualizacao legitima desta extensao. E o repositorio e PUBLICO por necessidade.
  //
  // O teste pergunta ao GIT, e nao ao disco: ter um chave-privada.pem na pasta de quem
  // builda e o fluxo NORMAL — e de la que o build tira a assinatura. O que nao pode e
  // ele estar rastreado, agora ou em qualquer commit passado.

  // O marcador e montado em pedacos de proposito: escrito inteiro, este arquivo se
  // acusaria sozinho na varredura e o teste nunca passaria.
  const MARCADOR = '-----BEGIN ' + 'PRIVATE' + ' KEY-----';
  const MARCADOR_RSA = '-----BEGIN RSA ' + 'PRIVATE' + ' KEY-----';
  const nomeSuspeito = (n) => /\.pem$|\.key$|chave-privada/i.test(n);

  const git = (args) => {
    const r = spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
    if (r.status !== 0) return null;
    return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  };

  const rastreados = git(['ls-files']);
  if (rastreados === null) { t.skip('git indisponivel neste ambiente'); return; }

  // 1) nada com cara de chave esta rastreado agora
  assert.deepEqual(rastreados.filter(nomeSuspeito), [],
    'ha arquivo de chave rastreado pelo git');

  // 2) nem em nenhum commit do historico. Remover do HEAD nao basta: o objeto continua
  //    recuperavel por quem clonar. Se este teste pegar algo, trate como chave vazada.
  const jaAdicionados = git(['log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A']) || [];
  assert.deepEqual([...new Set(jaAdicionados.filter(nomeSuspeito))], [],
    'um arquivo de chave ja foi commitado em algum ponto do historico — gere outra chave ' +
    'e reescreva o historico antes de tornar o repositorio publico');

  // 3) e nenhum arquivo rastreado carrega um PEM colado no meio do conteudo
  const comPem = rastreados.filter((rel) => {
    if (!/\.(js|mjs|json|md|txt|ps1|yml|yaml|html)$/i.test(rel)) return false;
    const conteudo = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    return conteudo.includes(MARCADOR) || conteudo.includes(MARCADOR_RSA);
  });
  assert.deepEqual(comPem, [], 'ha PEM de chave privada dentro de arquivo versionado');
});

test('.gitignore protege a chave e o dist', () => {
  const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
  for (const alvo of ['*.pem', 'dist/']) {
    assert.ok(gi.split('\n').some((l) => l.trim() === alvo), '.gitignore nao ignora ' + alvo);
  }
});

test('a versao do manifest e a do package.json sao a mesma', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const manifest = JSON.parse(lerSrc('manifest.json'));
  assert.equal(manifest.version, pkg.version,
    'rode `npm run bump` — a versao mora no package.json e e escrita no manifest pelo build');
});

test('o manifest nao carrega codigo remoto (MV3 proibe)', () => {
  // So dados/config vem de fora. pdf-lib, pdf.js e o detector continuam embutidos.
  const manifest = JSON.parse(lerSrc('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  const texto = JSON.stringify(manifest);
  assert.doesNotMatch(texto, /"content_security_policy"[^}]*unsafe-eval/,
    'unsafe-eval no CSP reprova na revisao da Web Store');
  for (const script of ['background.js', 'hook.js', 'content.js']) {
    assert.ok(fs.existsSync(path.join(SRC, script)), script + ' sumiu do src/');
  }
});

test('o ID escrito no instalar.ps1 e nos docs bate com a chave publica versionada', () => {
  // O instalar.ps1 libera UM id especifico no registro do Windows. Se ele divergir da
  // chave, a politica libera uma extensao que nao existe e o Chrome recusa a instalacao
  // em todas as 60 maquinas — com uma mensagem generica que nao aponta para aqui.
  const chave = fs.readFileSync(path.join(RAIZ, 'config', 'chave-publica.txt'), 'utf8').trim();
  const id = idDaExtensao(Buffer.from(chave, 'base64'));

  const ps1 = fs.readFileSync(path.join(RAIZ, 'scripts', 'instalar.ps1'), 'utf8');
  const noScript = ps1.match(/\$ID_EXTENSAO\s*=\s*'([a-p]{32})'/);
  assert.ok(noScript, 'nao achei $ID_EXTENSAO em scripts/instalar.ps1');
  assert.equal(noScript[1], id,
    'instalar.ps1 libera o id ' + noScript[1] + ' mas a chave versionada gera ' + id);

  for (const doc of ['README.md', 'docs/ARQUITETURA.md']) {
    const texto = fs.readFileSync(path.join(RAIZ, doc), 'utf8');
    const citados = [...texto.matchAll(/\b([a-p]{32})\b/g)].map((m) => m[1]);
    for (const citado of citados) {
      assert.equal(citado, id, doc + ' cita o id ' + citado + ', mas o correto e ' + id);
    }
  }
});
