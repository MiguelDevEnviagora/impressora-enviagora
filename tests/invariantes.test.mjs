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
import { carregarExtensao } from './ajuda/carregar-extensao.mjs';

carregarExtensao();
const CFG_ESQUEMA = () => globalThis.EnviagoraConfig.ESQUEMA;

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

test('so o release.yml exige o CRX; o ci.yml roda o build sem a chave de proposito', () => {
  // Este acoplamento ja quebrou uma vez: a trava do build.mjs olhava process.env.CI, que
  // vale nos DOIS workflows, e o ci.yml — que roda sem a chave de proposito — ficava
  // vermelho para sempre. Agora a trava e explicita, e estes tres assertos garantem que
  // ela continua ligada onde importa e desligada onde nao importa.
  const build = fs.readFileSync(path.join(RAIZ, 'scripts', 'build.mjs'), 'utf8');
  assert.match(build, /process\.env\.EXIGIR_CRX === '1'/,
    'a trava do CRX voltou a depender de outra coisa que nao EXIGIR_CRX');
  assert.doesNotMatch(build, /!temCrx && process\.env\.CI/,
    'a trava voltou a olhar process.env.CI, que vale nos dois workflows');

  const release = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'release.yml'), 'utf8');
  const ci = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(release, /EXIGIR_CRX:\s*'1'/,
    'release.yml parou de exigir o CRX — um Release sem CRX nao atualiza maquina nenhuma');
  assert.doesNotMatch(ci, /EXIGIR_CRX/,
    'ci.yml passou a exigir o CRX, mas ele nao tem acesso ao secret');
});

test('a senha e unica e nao ha mais como troca-la pelo popup', () => {
  // v16.35, a pedido da operacao: trocar senha maquina a maquina era mais um passo manual
  // no rollout de 60, e senha diferente em cada uma vira chamado quando ninguem lembra.
  const bg = lerSrc('background.js');
  const popupJs = lerSrc('popup.js');
  const popupHtml = lerSrc('popup.html');

  const constante = bg.match(/const SENHA_PADRAO = '([^']+)'/);
  assert.ok(constante, 'nao achei SENHA_PADRAO em background.js');
  assert.equal(constante[1], 'impressora-enviagora');

  // O caminho de troca sumiu dos tres arquivos — sobrar metade dele e pior que nada:
  // um botao que chama um handler inexistente falha em silencio na frente do operador.
  for (const [nome, src] of [['background.js', bg], ['popup.js', popupJs], ['popup.html', popupHtml]]) {
    assert.doesNotMatch(src, /trocarSenha/, nome + ' ainda tem o caminho de trocar senha');
  }
  for (const orfao of ['senhaAtual', 'senhaNova', 'statusSenha']) {
    assert.doesNotMatch(popupHtml, new RegExp('id="' + orfao + '"'), 'popup.html tem o campo orfao ' + orfao);
    assert.doesNotMatch(popupJs, new RegExp("'" + orfao + "'"), 'popup.js ainda usa ' + orfao);
  }

  // O popup precisa mostrar a senha certa: se a constante mudar e o texto nao, o operador
  // fica olhando para a senha errada na tela enquanto tenta desligar.
  assert.match(popupHtml, /<b>impressora-enviagora<\/b>/,
    'popup.html nao mostra a senha vigente, ou mostra outra');

  // E o desbloqueio em si continua de pe.
  assert.match(bg, /function senhaConfere\(senha\)/);
  assert.match(bg, /action === 'destravar'/);
  assert.match(bg, /desligamento sem senha — revertendo/);
});

test('os icones da marca existem nos quatro tamanhos, em PNG', () => {
  const manifest = JSON.parse(lerSrc('manifest.json'));
  for (const tamanho of ['16', '32', '48', '128']) {
    const rel = manifest.icons?.[tamanho];
    assert.ok(rel, 'falta o icone de ' + tamanho + 'px no manifest');
    assert.match(rel, /\.png$/, 'o Chrome nao aceita SVG como icone de extensao');

    const arquivo = path.join(SRC, rel);
    assert.ok(fs.existsSync(arquivo), 'o manifest aponta para ' + rel + ', que nao existe');

    // Confere no cabecalho do PNG que a imagem tem MESMO o tamanho que o manifest promete.
    // Um icone de 16 gravado em 128 carrega sem erro e sai borrado na barra do Chrome.
    const cab = fs.readFileSync(arquivo).subarray(0, 26);
    assert.deepEqual([...cab.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], rel + ' nao e PNG');
    assert.equal(cab.readUInt32BE(16), Number(tamanho), rel + ' tem largura diferente de ' + tamanho);
    assert.equal(cab.readUInt32BE(20), Number(tamanho), rel + ' tem altura diferente de ' + tamanho);
  }
  assert.equal(fs.existsSync(path.join(SRC, 'icon.png')), false,
    'o icone antigo voltou; os icones da marca vivem em src/icones/');
});

test('os icones usam as cores oficiais da marca', () => {
  // Fundo Verde Profundo #16302A, seta Verde Neon #C5FF56 — regra do manual para fundo
  // escuro. Se alguem regenerar com outra paleta, isto avisa.
  const gerador = fs.readFileSync(path.join(RAIZ, 'scripts', 'gerar-icones.mjs'), 'utf8');
  assert.match(gerador, /VERDE_PROFUNDO = \[0x16, 0x30, 0x2A\]/);
  assert.match(gerador, /VERDE_NEON = \[0xC5, 0xFF, 0x56\]/);
});

test('o comando da pagina aponta para um script que existe mesmo no repositorio', () => {
  // A pagina manda o operador colar uma URL crua do GitHub no PowerShell. Se alguem
  // renomear ou mover o instalar.ps1, a URL passa a dar 404 e a instalacao quebra nas 60
  // maquinas — sem nenhum teste falhando e sem ninguem ligar uma coisa a outra.
  const pagina = fs.readFileSync(path.join(RAIZ, 'site', 'index.html'), 'utf8');
  const repo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))
    .repository.url.match(/github\.com\/([^/]+\/[^/.]+)/)[1];

  const url = pagina.match(/https:\/\/raw\.githubusercontent\.com\/\S+?\.ps1/);
  assert.ok(url, 'a pagina nao tem mais o comando de preparo da maquina');

  const esperado = 'https://raw.githubusercontent.com/' + repo + '/main/scripts/instalar.ps1';
  assert.equal(url[0], esperado, 'a URL do comando nao bate com este repositorio');
  assert.ok(fs.existsSync(path.join(RAIZ, 'scripts', 'instalar.ps1')),
    'a pagina aponta para scripts/instalar.ps1, que nao existe');

  // A primeira linha precisa vir junto: sem o Set-ExecutionPolicy o Windows recusa o
  // script, e sem o TLS 1.2 o PowerShell 5.1 nao fala com o GitHub.
  const bloco = pagina.match(/<pre id="cmd-preparo">([\s\S]*?)<\/pre>/)[1];
  assert.match(bloco, /Set-ExecutionPolicy -Scope Process Bypass -Force/);
  assert.match(bloco, /SecurityProtocol = \[Net\.SecurityProtocolType\]::Tls12/);
  assert.match(bloco, /-OutFile/, 'baixar para arquivo e mais depuravel que canalizar para iex');
});

test('a pagina nao oferece o ZIP como se fosse equivalente ao CRX', () => {
  // Os dois lado a lado, sem explicacao, foi o que confundiu na v16.34: o ZIP NAO se
  // atualiza sozinho, e instalar por ele mantem exatamente o problema que este projeto
  // existe para resolver. Ele continua alcancavel, mas dobrado e com a desvantagem escrita.
  const pagina = fs.readFileSync(path.join(RAIZ, 'site', 'index.html'), 'utf8');
  const principais = [...pagina.matchAll(/class="btn btn-principal"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(principais.length, 1, 'a pagina precisa ter exatamente um caminho em destaque');
  assert.doesNotMatch(principais[0], /URL_ZIP/, 'o ZIP virou o caminho principal da pagina');

  assert.match(pagina, /<details[\s\S]*URL_ZIP[\s\S]*<\/details>/,
    'o ZIP precisa continuar dobrado atras do <details>, e nao em destaque');
  assert.match(pagina, /não se atualiza sozinho/,
    'a pagina parou de avisar que o ZIP nao se atualiza sozinho');
});

test('os scripts PowerShell sao ASCII puro', () => {
  // ISTO JA QUEBROU DE VERDADE, e o modo de falha e traicoeiro.
  //
  // O PowerShell 5.1 le um .ps1 SEM BOM como Windows-1252, nao como UTF-8. Um em-dash
  // "-" (U+2014 = E2 80 94) vira tres caracteres, e o byte 0x94 em CP1252 e a ASPA CURVA
  // DE FECHAMENTO — que o PowerShell aceita como delimitador de string. Dentro de uma
  // string de aspas duplas, ela FECHA a string ali: o resto da linha vira codigo, a
  // proxima aspa abre outra string, e o parser engole as chaves.
  //
  // O erro que aparece na tela nao tem nenhuma relacao com a causa: aponta um
  // "MissingEndCurlyBrace" dezenas de linhas antes. Ninguem acha isso olhando o codigo,
  // porque no editor o arquivo esta perfeito.
  //
  // ASCII puro fecha a porta inteira: nao depende de BOM sobreviver ao download, nem da
  // versao do PowerShell, nem do idioma do Windows.
  for (const arquivo of fs.readdirSync(path.join(RAIZ, 'scripts')).filter((f) => f.endsWith('.ps1'))) {
    const texto = fs.readFileSync(path.join(RAIZ, 'scripts', arquivo), 'utf8');
    const ruins = [];
    texto.split('\n').forEach((linha, i) => {
      for (const ch of linha) {
        if (ch.codePointAt(0) > 127) {
          ruins.push('linha ' + (i + 1) + ': ' + JSON.stringify(ch) +
                     ' (U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ')');
          break;
        }
      }
    });
    assert.deepEqual(ruins, [],
      arquivo + ' tem caractere nao-ASCII. Troque por ASCII: acentos pela letra base, ' +
      '"-" por "-", "..." por "...". Ver o comentario acima para o porque.');
  }
});

test('o comando de instalacao usa Invoke-WebRequest para baixar o script', () => {
  // Invoke-RestMethod interpreta a resposta (JSON/XML) antes de gravar; para baixar um
  // arquivo, quem grava os bytes crus e o Invoke-WebRequest. Com o script em ASCII a
  // diferenca fica academica, mas usar a ferramenta certa custa nada.
  for (const doc of ['site/index.html', 'docs/ROLLOUT.md', 'docs/PILOTO.md']) {
    const texto = fs.readFileSync(path.join(RAIZ, doc), 'utf8');
    if (!texto.includes('instalar.ps1')) continue;
    assert.doesNotMatch(texto, /Invoke-RestMethod\s+https:\/\/raw\.githubusercontent/,
      doc + ' ainda baixa o script com Invoke-RestMethod');
    assert.match(texto, /Invoke-WebRequest -UseBasicParsing https:\/\/raw\.githubusercontent/,
      doc + ' precisa baixar o script com Invoke-WebRequest -UseBasicParsing');
  }
});

test('o print() espera o visualizador de PDF assentar, nos DOIS caminhos', () => {
  // O BUG: "Falha ao imprimir - Ocorreu um erro durante a impressao", intermitente, e que
  // sumia ao desligar a extensao. O evento `load` do iframe avisa que o DOCUMENTO
  // carregou, nao que o PDFium ja consegue imprimir. O hook.js chamava print() no instante
  // do load; o viewer.js esperava 300 ms — e era justamente o viewer que nunca falhava.
  const hook = lerSrc('hook.js');
  const viewer = lerSrc('viewer.js');

  assert.match(hook, /await dormir\(assentamentoMs\)/,
    'hook.js voltou a imprimir sem esperar o visualizador de PDF assentar');
  assert.match(viewer, /\}, assentamentoMs\)/,
    'viewer.js voltou a usar uma espera fixa em vez do valor configuravel');

  // e o valor precisa ser ajustavel remotamente: se uma maquina lenta continuar falhando,
  // subir isso tem que valer em 1 hora, sem publicar versao nova.
  assert.ok(CFG_ESQUEMA().printSettleMs, 'printSettleMs saiu do esquema');
  assert.equal(CFG_ESQUEMA().printSettleMs.remoto, true,
    'printSettleMs precisa ser configuravel remotamente — e o botao de socorro deste bug');
});

test('a impressao e serializada: uma etiqueta por vez', () => {
  // O WMS solta etiqueta e declaracao praticamente juntas. Sem fila, a segunda trocava o
  // src do MESMO iframe enquanto o preview da primeira abria, e o preview morria sem
  // documento — a mesma tela de "Falha ao imprimir". O motor.js ja serializava o
  // processamento; faltava serializar a impressao.
  const hook = lerSrc('hook.js');
  assert.match(hook, /let fila = Promise\.resolve\(\)/, 'a fila de impressao sumiu do hook.js');
  assert.match(hook, /fila = fila\.then\(\(\) => imprimirAgora\(/,
    'imprimirAjustado parou de enfileirar');
});

test('o hook recebe o printSettleMs do content.js', () => {
  // hook.js roda no MUNDO MAIN e nao enxerga chrome.storage. Sem esta ponte ele fica
  // preso no padrao embutido, e ajustar o valor remotamente nao teria efeito nenhum
  // no caminho do WMS — que e exatamente onde o bug aparece.
  const content = lerSrc('content.js');
  assert.match(content, /__enviagora: 'config'/, 'content.js parou de falar com o hook');
  for (const campo of ['printSettleMs', 'afterprintSintetico', 'bloquearPrintDaTela']) {
    assert.match(content, new RegExp(campo + ':'), 'content.js nao entrega ' + campo + ' ao hook');
  }
  assert.match(lerSrc('hook.js'), /d\.__enviagora === 'config'/,
    'hook.js parou de escutar a configuracao vinda do content.js');
});

test('a extensao pede atualizacao de hora em hora, e nao so quando o Chrome resolve', () => {
  // O Chrome consulta a update_url por conta propria mais ou menos a cada 5 h, e nao ha
  // como empurrar nada para as maquinas. requestUpdateCheck pede que ele olhe agora;
  // pendurado no alarme de 1 hora que ja existia para o config, o ciclo cai de ~5 h
  // para ~1 h sem infraestrutura nenhuma.
  const bg = lerSrc('background.js');
  assert.match(bg, /chrome\.runtime\.requestUpdateCheck\(/,
    'background.js parou de pedir a procura de atualizacao');
  assert.match(bg, /if \(a && a\.name !== ALARME_CONFIG\) return;[\s\S]{0,200}procurarAtualizacao\(\)/,
    'a procura de atualizacao saiu do alarme de 1 hora');
  assert.match(bg, /action === 'procurarAtualizacao'/,
    'sumiu o gatilho manual usado pelo botao do popup');
  assert.match(lerSrc('popup.html'), /id="procurarAtualizacao"/,
    'o popup perdeu o botao de procurar atualizacao');
});

test('a atualizacao nunca e aplicada no meio de uma etiqueta', () => {
  // O Chrome baixa a versao nova e SEGURA a troca enquanto a extensao esta em uso.
  // chrome.runtime.reload() aplica na hora — mas recarregar o service worker no meio de
  // um cropPdf mata aquela etiqueta: o WMS espera uma resposta que nunca chega e o
  // operador ve a impressao falhar. Dai o contador de trabalhos em andamento.
  const bg = lerSrc('background.js');
  assert.match(bg, /chrome\.runtime\.onUpdateAvailable\.addListener/,
    'a extensao parou de aplicar a atualizacao assim que ela fica pronta');
  assert.match(bg, /if \(trabalhosEmAndamento > 0\) return;/,
    'o reload voltou a poder acontecer com etiqueta em andamento');
  assert.match(bg, /trabalhosEmAndamento\+\+/, 'ninguem mais incrementa o contador');
  assert.match(bg, /trabalhosEmAndamento = Math\.max\(0, trabalhosEmAndamento - 1\)/,
    'o contador nao e mais decrementado — a extensao nunca mais se atualizaria');
});

test('a extensao nao deixa a TELA do WMS ir para a impressora', () => {
  // O BUG: saia uma folha inteira PRETA junto com a etiqueta. Era a tela do WMS: um
  // window.print() numa pagina que nao e PDF manda a PAGINA para a impressora, e uma
  // interface escura vira um retangulo preto. O gatilho era nosso proprio afterprint
  // sintetico voltando como um pedido de impressao.
  const hook = lerSrc('hook.js');
  assert.match(hook, /ultimoAfterprintSintetico = Date\.now\(\)/,
    'o hook parou de marcar quando disparou o afterprint sintetico');
  assert.match(hook, /bloquearPrintDaTela && desdeOEco < JANELA_ECO_MS/,
    'o hook voltou a deixar passar o print() da pagina disparado pelo nosso afterprint');

  // E o cinto de seguranca: mesmo que ALGO imprima o viewer, ele nao sai preto.
  const viewer = lerSrc('viewer.html');
  assert.match(viewer, /@media print\{[\s\S]*background:#fff !important/,
    'viewer.html perdeu a regra de impressao — o fundo #525659 voltaria a sair como um bloco preto');
});

test('um segundo print() logo apos o anterior, sem ajuste, nao cai em cima do preview', () => {
  // ACHADO NO DIAGNOSTICO DE PRODUCAO (16:21:37, maquina do Rafael):
  //   print-chamado  assentamento=400 ms=2   <- imprime a etiqueta ajustada
  //   print-pedido   temAjuste=false         <- 15 ms depois, outro print
  //   print-chamado  ms=1                    <- imprime NA HORA, sem assentamento
  // Dois previews ao mesmo tempo o Chrome nao faz: o segundo morre com "Falha ao imprimir".
  //
  // A fila que ja existia NAO protegia disto: ela espera a funcao terminar, e a funcao
  // termina assim que print() retorna — que os dados mostraram ser instantaneo.
  const hook = lerSrc('hook.js');
  assert.match(hook, /let ultimoPrint = 0;/, 'sumiu a marca do ultimo print');
  assert.match(hook, /ultimoPrint = Date\.now\(\);/,
    'o hook parou de marcar quando chamou print()');
  assert.match(hook, /!reg && bloquearEcoDePrint && desdeUltimoPrint < JANELA_ECO_PRINT_MS/,
    'a guarda de eco de impressao sumiu');

  // A condicao precisa continuar ESTREITA: so pega pedido sem ajuste proprio. Um segundo
  // documento de verdade cria o proprio blob, chega com temAjuste true, e nao pode ser
  // engolido — senao a extensao passa a comer etiqueta legitima.
  assert.match(hook, /if \(!reg && bloquearEcoDePrint/,
    'a guarda passou a valer tambem para pedido COM ajuste — isso engole etiqueta legitima');
});

test('o diagnostico grava na hora: nada de setTimeout em service worker', () => {
  // A v16.36.0 juntava eventos em memoria e gravava 800 ms depois. Em MV3 o service
  // worker e encerrado quando fica ocioso e um setTimeout puro NAO o mantem vivo: o
  // worker morria antes do prazo e levava a fila junto. O sintoma foi imprimir com
  // sucesso e baixar um diagnostico VAZIO.
  const diag = lerSrc('diagnostico.js');
  assert.doesNotMatch(diag, /setTimeout\(gravar/,
    'a gravacao voltou a ser agendada por setTimeout — em MV3 isso perde eventos');
  assert.match(diag, /cadeia = cadeia\.then\(\(\) => gravarUm\(evento\)\)/,
    'a gravacao serializada sumiu — volta a corrida do le-altera-grava');
});

test('o caminho do file:// tambem registra', () => {
  // viewer.js nasceu sem diagnostico. Quem testasse abrindo um PDF do disco baixava um
  // arquivo vazio e concluia, com razao, que a caixa-preta nao funcionava.
  const viewer = lerSrc('viewer.js');
  for (const evento of ['viewer-inicio', 'viewer-print', 'viewer-erro']) {
    assert.match(viewer, new RegExp(evento), 'viewer.js parou de registrar ' + evento);
  }
});

test('toda partida deixa uma prova de vida no diagnostico', () => {
  // Sem isto, um arquivo vazio nao distingue "nao aconteceu nada" de "o registro esta
  // quebrado" — foi exatamente a duvida que a v16.36.0 gerou.
  assert.match(lerSrc('background.js'), /registrar\('extensao-ligou'/,
    'sumiu a prova de vida: um diagnostico vazio volta a ser ambiguo');
});

test('quando o Chrome limita a busca, o popup diz o que FAZER', () => {
  // A primeira versao respondia "nao precisa fazer nada" ao 'throttled' — inutil para
  // quem clicou justamente porque precisa da versao nova agora. O botao "Atualizar" do
  // chrome://extensions e uma busca iniciada pelo usuario e nao passa pelo mesmo limite.
  const popup = lerSrc('popup.js');
  assert.doesNotMatch(popup, /throttled[\s\S]{0,300}não precisa fazer nada/,
    'a mensagem de throttled voltou a mandar o operador nao fazer nada');
  assert.match(popup, /r\.status === 'throttled'/, 'sumiu o tratamento do throttled');
  assert.match(popup, /chrome\.tabs\.create\(\{ url: 'chrome:\/\/extensions' \}\)/,
    'sumiu o atalho para o caminho que realmente forca a atualizacao');
});

test('nenhum rotulo do popup traz "(recomendado)" escrito na mao', () => {
  // O seletor de escala dizia "Tamanho real (recomendado)". No dia em que a matriz trocou
  // o padrao pelo config remoto — sem publicar versao — o rotulo passou a mentir para o
  // operador. Agora quem marca o padrao vigente e o codigo, lendo o config em vigor.
  const html = lerSrc('popup.html');
  assert.doesNotMatch(html, /\(recomendado\)/,
    'voltou um "(recomendado)" fixo no HTML; ele desatualiza sozinho quando o config remoto muda');
  assert.match(lerSrc('popup.js'), /padrão da empresa/,
    'sumiu a marcacao dinamica do padrao vigente no seletor');
});

test('o log da rota do motor nao afirma transportadora', () => {
  /* CICATRIZ: uma etiqueta da J&T de 76x130 mm caiu no motor e o log dizia
   *   crop-ok  via=motor (Correios/codigo de barras)
   * A extensao nao havia identificado Correios coisa nenhuma — nenhuma regra bateu, e o
   * motor e simplesmente a rota de quem sobrou. O rotulo fez perder tempo procurando um
   * bug de deteccao que nao existia. Rotulo de ROTA nunca deve parecer veredito. */
  const src = lerSrc('background.js');
  // As rotas aparecem como responder(b64, 'rota') e como { b64, via: 'rota' }.
  const rotas = [
    ...[...src.matchAll(/responder\([^,]+,\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/via:\s*'([^']+)'/g)].map((m) => m[1])
  ];
  const doMotor = rotas.filter((r) => r.startsWith('motor'));
  assert.ok(doMotor.length, 'sumiu a rota do motor do background.js');
  for (const r of doMotor) {
    assert.doesNotMatch(r, /correios|shopee|amazon|mercado|j&t|jt/i,
      'a rota "' + r + '" nomeia transportadora — quem cai no motor e justamente ' +
      'a etiqueta que a deteccao NAO reconheceu');
  }
});

test('o log registra o que a deteccao respondeu, e nao so a rota', () => {
  // Sem isto, "foi pro motor" e tudo o que se sabe. Com o tamanho e o veredito no log,
  // da para responder "por que foi pro motor?" sem pedir o PDF de volta ao operador.
  const src = lerSrc('background.js');
  assert.match(src, /registrar\('crop-entrou'/, 'o background parou de registrar a entrada');
  assert.match(src, /detectada:/, 'o log da entrada perdeu o veredito da deteccao');
  assert.match(src, /mm:/, 'o log da entrada perdeu o tamanho da pagina');
});

test('a prova de vida nao registra a cada acordada do service worker', () => {
  /* CICATRIZ: em Manifest V3 o service worker acorda e morre o tempo todo. Um log de 10
   * minutos veio com quatro "extensao-ligou", que parecem quatro reinicios e nao sao.
   * Ruido empurra para fora do buffer o evento raro que interessa. */
  const src = lerSrc('background.js');
  assert.match(src, /INTERVALO_LIGOU_MS/, 'a prova de vida voltou a registrar sem estrangular');
  assert.match(src, /mudouVersao/,
    'a prova de vida precisa registrar SEMPRE que a versao mudar — e a prova de que a ' +
    'atualizacao chegou naquela maquina');
});

test('todo caminho que manda imprimir deixa rastro', () => {
  /* CICATRIZ: uma falha real veio com crop-ok e ZERO eventos de impressao, porque os
   * caminhos da secao 3 do hook (o documento ELE MESMO e o PDF) nao logavam nada. */
  const src = lerSrc('hook.js');
  for (const evento of ['print-pedido', 'print-chamado', 'print-doc-pedido',
                        'print-pagina', 'print-beforeprint']) {
    assert.match(src, new RegExp("logar\\('" + evento + "'"),
      'hook.js parou de registrar ' + evento + ' — uma impressao volta a sair sem rastro');
  }
});

test('a mesma etiqueta nao e processada duas vezes ao mesmo tempo', () => {
  /* CICATRIZ: cada etiqueta do WMS entrava TRES vezes no cropPdf — duas com o PDF
   * original (hook.js e content.js pedem por caminhos diferentes e nesta operacao os dois
   * chegam) e uma com a nossa propria saida. As repeticoes rodavam o motor (pdf.js +
   * canvas) no processo da pagina no momento em que a previa de impressao abre. */
  const src = lerSrc('background.js');
  assert.match(src, /const emVoo = new Map\(\)/, 'sumiu a deduplicacao de pedidos iguais');
  assert.match(src, /cfg\.deduplicarCrop !== false && emVoo\.has\(chave\)/,
    'a deduplicacao parou de ser desligavel pelo config remoto');
  assert.match(src, /cfg\.pularJaAjustado !== false/,
    'o atalho do PDF ja ajustado parou de ser desligavel pelo config remoto');
});

test('o PDF ja ajustado sai antes do motor, e nao depois', () => {
  // A ordem E o conserto. A marca ja era conferida antes — dentro de processarBasico, que
  // so roda DEPOIS de o motor ter gasto ~400 ms com um PDF que nao precisava de nada.
  const src = lerSrc('background.js');
  const atalho = src.indexOf('retrato.jaAjustado && cfg.pularJaAjustado');
  const motor  = src.indexOf('await pedirAoMotor(tabId');
  assert.ok(atalho > 0, 'sumiu o atalho do PDF ja ajustado');
  assert.ok(motor > 0, 'sumiu a chamada do motor');
  assert.ok(atalho < motor,
    'o atalho do PDF ja ajustado voltou a ficar DEPOIS do motor — que e o bug que ele veio corrigir');
});

test('a chave de deduplicacao nao guarda o PDF inteiro', () => {
  // Guardar o base64 completo como chave manteria uma copia da etiqueta — dado de cliente —
  // viva na memoria do service worker, e o diagnostico inteiro foi escrito para nao fazer isso.
  const src = lerSrc('background.js');
  const fn = src.slice(src.indexOf('function hashFnv'), src.indexOf('async function calcular'));
  assert.ok(fn.length, 'sumiu chaveDoPedido/hashFnv');
  /* CICATRIZ: a primeira chave era tamanho + primeiros/ultimos 64 chars. O estresse
   * derrubou: 20 PDFs DIFERENTES do mesmo gerador, 18 tratados como repeticao — e
   * colisao aqui e etiqueta de UM cliente saindo na encomenda de OUTRO. A chave tem
   * que cobrir o conteudo INTEIRO (hash), sem guardar o conteudo. */
  assert.match(fn, /hashFnv\(b\)/, 'a chave parou de cobrir o conteudo inteiro do PDF');
  assert.doesNotMatch(fn, /b\.slice\(0, ?64\)/, 'a chave voltou ao pedaco de 64 chars que colide');
  assert.match(fn, /operador/, 'a chave ignora o operador — dois operadores dividiriam a mesma etiqueta');
});

test('o endereco de atualizacao e um so, fora do nome da organizacao no GitHub', () => {
  // A v16.36.8 gravou nas maquinas enviagora.github.io; o repo mudou de organizacao, o Pages
  // nao redireciona e as 60 pararam de atualizar. O endereco gravado agora e o do Firebase
  // (menu-enviagora.web.app), que redireciona para o Pages. Ele tem que ser o MESMO no
  // update_url (homepage), na busca do config e no instalar.ps1 - e nunca github.io.
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const base = pkg.homepage.endsWith('/') ? pkg.homepage : pkg.homepage + '/';
  assert.doesNotMatch(base, /github\.io/, 'o homepage voltou a depender do nome da organizacao no GitHub');

  assert.ok(lerSrc('config-padrao.js').includes("'" + base + "config/defaults.json'"),
    'a busca do defaults.json nao usa o mesmo endereco do homepage');

  const ps = fs.readFileSync(path.join(RAIZ, 'scripts', 'instalar.ps1'), 'utf8');
  assert.ok(ps.includes("$PAGINA      = '" + base + "'"), 'o instalar.ps1 aponta para outra pagina');
  const repo = pkg.repository.url.match(/github\.com\/([^/]+\/[^/.]+)/)[1];
  assert.ok(ps.includes("$REPO        = '" + repo + "'"), 'o instalar.ps1 baixa de outro repo');
  for (const fonte of [new URL(base).origin + '/*', 'https://github.com/*', 'https://release-assets.githubusercontent.com/*']) {
    assert.ok(ps.includes("'" + fonte + "'"), 'o instalar.ps1 nao libera ' + fonte + ' e a instalacao do CRX falha');
  }
});
