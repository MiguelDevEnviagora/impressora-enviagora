#!/usr/bin/env node
/* Monta a pasta _site/ que o GitHub Pages publica.
 *
 * O Pages serve TRES coisas, e cada uma tem um consumidor diferente:
 *   index.html               -> o pessoal da operacao, para instalar
 *   updates.xml              -> o Chrome de cada maquina, para saber se ha versao nova
 *   config/defaults.json     -> a extensao de cada maquina, de hora em hora
 *
 * Este script NAO precisa da chave privada. E de proposito: publicar um ajuste de
 * configuracao (mudar uma margem, ligar o kill switch) nao pode depender do segredo que
 * assina release. Sao dois caminhos independentes.
 *
 *   node scripts/gerar-site.mjs [versao]
 *
 * Sem argumento usa a versao do package.json.
 */
import { fs, path, RAIZ, SITE, CONFIG, ARQ_CHAVE_PUBLICA, pacote, urlBase, repositorio, cor } from './lib/comum.mjs';
import { idDaExtensao } from './lib/crx.mjs';

const versao = (process.argv[2] || pacote().version).replace(/^v/, '');
const base = urlBase();
const repo = repositorio();
const saida = path.join(RAIZ, '_site');

if (!fs.existsSync(ARQ_CHAVE_PUBLICA)) {
  console.error(cor.erro('\n  Falta config/chave-publica.txt — o updates.xml precisa do ID da extensao.\n'));
  process.exit(1);
}
const id = idDaExtensao(Buffer.from(fs.readFileSync(ARQ_CHAVE_PUBLICA, 'utf8').trim(), 'base64'));

fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(path.join(saida, 'config'), { recursive: true });

// ── config/defaults.json ────────────────────────────────────────────────────
// A fonte unica e config/defaults.json na raiz; aqui ele so e copiado. Assim quem ajusta
// um parametro mexe num arquivo so e nao precisa saber que existe uma pasta _site.
fs.copyFileSync(path.join(CONFIG, 'defaults.json'), path.join(saida, 'config', 'defaults.json'));

// ── updates.xml ─────────────────────────────────────────────────────────────
const urlCrx = 'https://github.com/' + repo + '/releases/download/v' + versao +
               '/impressora-enviagora-' + versao + '.crx';

fs.writeFileSync(path.join(saida, 'updates.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<!-- Gerado por scripts/gerar-site.mjs. Nao edite a mao. -->
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${id}">
    <updatecheck codebase="${urlCrx}" version="${versao}" />
  </app>
</gupdate>
`, 'utf8');

// ── index.html ──────────────────────────────────────────────────────────────
const data = new Date().toLocaleDateString('pt-BR', {
  day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'
});

const valores = {
  VERSAO: versao,
  ID: id,
  DATA: data,
  URL_REPO: 'https://github.com/' + repo,
  URL_ZIP: 'https://github.com/' + repo + '/releases/download/v' + versao +
           '/impressora-enviagora-' + versao + '.zip',
  URL_CRX: urlCrx
};

let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
for (const [chave, valor] of Object.entries(valores)) {
  html = html.replaceAll('{{' + chave + '}}', valor);
}

const sobrou = html.match(/\{\{[A-Z_]+\}\}/g);
if (sobrou) {
  console.error(cor.erro('\n  Sobrou placeholder sem valor no index.html: ' + [...new Set(sobrou)].join(', ') + '\n'));
  process.exit(1);
}
fs.writeFileSync(path.join(saida, 'index.html'), html, 'utf8');

// O Pages roda Jekyll por padrao e ignora arquivos comecados por _ ou . — o .nojekyll
// desliga isso. Sem ele, um dia alguem adiciona um arquivo assim e some sem explicacao.
fs.writeFileSync(path.join(saida, '.nojekyll'), '', 'utf8');

console.log('\n  _site/ montado para a v' + versao);
console.log('  ' + base);
console.log('  ' + base + 'updates.xml     (Chrome)');
console.log('  ' + base + 'config/defaults.json  (extensao, de hora em hora)');
console.log('  ID: ' + id + '\n');
