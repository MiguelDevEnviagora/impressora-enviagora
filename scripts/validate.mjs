#!/usr/bin/env node
/* Confere manifest, defaults.json e o estado do repositorio ANTES de empacotar.
 *
 * A ideia e simples: falhar aqui, na maquina de quem publica, custa segundos. Falhar
 * depois — com o CRX ja no Release e as 60 maquinas baixando — custa a operacao parada.
 *
 *   node scripts/validate.mjs
 */
import {
  fs, path, RAIZ, SRC, CONFIG, ARQ_CHAVE_PUBLICA,
  pacote, lerJson, urlBase, cor
} from './lib/comum.mjs';

const erros = [];
const avisos = [];

const falha = (m) => erros.push(m);
const avisa = (m) => avisos.push(m);

// ── package.json x manifest ─────────────────────────────────────────────────
const pkg = pacote();
const manifest = lerJson(path.join(SRC, 'manifest.json'));

if (manifest.manifest_version !== 3) falha('manifest_version precisa ser 3');
if (manifest.version !== pkg.version) {
  falha('versao divergente: package.json diz ' + pkg.version + ', manifest diz ' + manifest.version +
        ' — rode `npm run bump`');
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  falha('versao "' + manifest.version + '" nao serve para o Chrome (ate 4 numeros separados por ponto)');
}
for (const parte of manifest.version.split('.')) {
  if (Number(parte) > 65535) falha('cada parte da versao vai no maximo ate 65535 (achei ' + parte + ')');
}

// ── Permissoes ──────────────────────────────────────────────────────────────
// alarms e o que faz o refresh de 1 h existir. Sem a permissao a API nao existe e o
// refresh falha EM SILENCIO — o pior modo de falha possivel aqui.
for (const p of ['storage', 'alarms', 'scripting', 'webNavigation', 'tabs']) {
  if (!manifest.permissions?.includes(p)) falha('falta a permissao "' + p + '" no manifest');
}
// Permissao a mais e o que mais reprova extensao na revisao da Web Store, que e o plano B.
const PERMISSOES_JUSTIFICADAS = ['storage', 'alarms', 'scripting', 'webNavigation', 'tabs', 'identity'];
for (const p of manifest.permissions || []) {
  if (!PERMISSOES_JUSTIFICADAS.includes(p)) {
    falha('permissao "' + p + '" nao esta justificada em docs/ARQUITETURA.md — ' +
          'toda permissao nova precisa de justificativa antes de entrar');
  }
}
if (manifest.update_url) falha('src/manifest.json nao deve ter update_url fixo — o build injeta');
if (manifest.key) falha('src/manifest.json nao deve ter key fixo — o build injeta');

// ── Arquivos referenciados existem mesmo ────────────────────────────────────
const referenciados = new Set();
const anota = (v) => { if (typeof v === 'string' && /\.(js|html|png|json)$/.test(v)) referenciados.add(v); };

anota(manifest.background?.service_worker);
anota(manifest.action?.default_popup);
for (const cs of manifest.content_scripts || []) (cs.js || []).forEach(anota);
for (const war of manifest.web_accessible_resources || []) (war.resources || []).forEach(anota);
for (const icone of Object.values(manifest.icons || {})) anota(icone);
for (const icone of Object.values(manifest.action?.default_icon || {})) anota(icone);

// O Chrome NAO aceita SVG em icone de extensao — precisa ser raster. Um SVG aqui carrega
// normalmente no manifest e o icone simplesmente nao aparece, sem erro em lugar nenhum.
for (const [tamanho, arquivo] of Object.entries(manifest.icons || {})) {
  if (!/\.png$/i.test(arquivo)) falha('o icone ' + tamanho + ' precisa ser PNG (o Chrome nao aceita SVG)');
}
for (const esperado of ['16', '32', '48', '128']) {
  if (!manifest.icons?.[esperado]) avisa('sem icone de ' + esperado + 'px — o Chrome vai reescalar outro tamanho');
}

for (const arquivo of referenciados) {
  if (!fs.existsSync(path.join(SRC, arquivo))) {
    falha('o manifest referencia "' + arquivo + '", que nao existe em src/');
  }
}

// Scripts carregados pelas paginas HTML da extensao
for (const html of ['popup.html', 'viewer.html']) {
  const caminho = path.join(SRC, html);
  if (!fs.existsSync(caminho)) { falha('falta src/' + html); continue; }
  const conteudo = fs.readFileSync(caminho, 'utf8');
  for (const m of conteudo.matchAll(/<script src="([^"]+)"/g)) {
    if (!fs.existsSync(path.join(SRC, m[1]))) falha(html + ' carrega "' + m[1] + '", que nao existe em src/');
  }
}

// Arquivos que o background injeta como content script sob demanda
const bg = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
const listaMotor = bg.match(/MOTOR_ARQUIVOS = \[([^\]]+)\]/);
if (!listaMotor) falha('nao achei MOTOR_ARQUIVOS em background.js');
else {
  for (const m of listaMotor[1].matchAll(/'([^']+)'/g)) {
    if (!fs.existsSync(path.join(SRC, m[1]))) falha('MOTOR_ARQUIVOS aponta para "' + m[1] + '", que nao existe');
    const war = (manifest.web_accessible_resources?.[0]?.resources) || [];
    if (!war.includes(m[1])) {
      falha('"' + m[1] + '" e injetado pelo motor mas nao esta em web_accessible_resources');
    }
  }
}

// ── config/defaults.json ────────────────────────────────────────────────────
globalThis.self = globalThis;
(0, eval)(fs.readFileSync(path.join(SRC, 'config-padrao.js'), 'utf8'));
const CFG = globalThis.EnviagoraConfig;

const caminhoDefaults = path.join(CONFIG, 'defaults.json');
if (!fs.existsSync(caminhoDefaults)) falha('falta config/defaults.json');
else {
  let bruto;
  try { bruto = lerJson(caminhoDefaults); } catch (e) { falha('config/defaults.json nao e JSON valido: ' + e.message); }
  if (bruto) {
    const v = CFG.validarRemoto(bruto);
    if (!v.aplicavel) falha('config/defaults.json seria IGNORADO pelas maquinas: ' + v.erros.join(' | '));
    for (const e of v.erros) falha('config/defaults.json — ' + e);
    if (typeof bruto.killSwitch !== 'boolean') falha('killSwitch precisa ser true ou false');
    if (v.killSwitch) {
      avisa('KILL SWITCH LIGADO em config/defaults.json. Publicando assim, as ~60 maquinas ' +
            'PARAM de ajustar etiqueta em ate 1 hora e passam a imprimir o PDF original. ' +
            'Se for de proposito, siga. Se nao for, este e o momento de perceber.');
    }
    const mudados = Object.entries(v.campos).filter(([c, val]) => val !== CFG.PADRAO[c]);
    if (mudados.length) {
      avisa(mudados.length + ' valor(es) diferentes do embutido, valendo em ate 1 h nas maquinas: ' +
            mudados.map(([c, val]) => c + ' = ' + JSON.stringify(val)).join(', '));
    }
  }
}

// ── URL do config bate com o Pages ──────────────────────────────────────────
try {
  if (CFG.URL_CONFIG !== urlBase() + 'config/defaults.json') {
    falha('URL_CONFIG em src/config-padrao.js (' + CFG.URL_CONFIG + ') nao bate com o ' +
          'homepage do package.json (' + urlBase() + ')');
  }
} catch (e) { falha(e.message); }

// ── Chave ───────────────────────────────────────────────────────────────────
if (!fs.existsSync(ARQ_CHAVE_PUBLICA)) {
  falha('falta config/chave-publica.txt — rode `npm run chave` uma vez');
}

// A chave privada nunca pode estar versionada. O repositorio e publico.
const MARCADOR = '-----BEGIN ' + 'PRIVATE' + ' KEY-----';
const varrer = (dir) => {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(item.name)) continue;
    const completo = path.join(dir, item.name);
    if (item.isDirectory()) { varrer(completo); continue; }
    if (/\.pem$|\.key$/i.test(item.name)) {
      // esperado apenas na raiz e ignorado pelo git; em qualquer outro lugar e problema
      const relativo = path.relative(RAIZ, completo);
      if (relativo !== 'chave-privada.pem') falha('arquivo de chave versionavel: ' + relativo);
    }
  }
};
varrer(RAIZ);

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('');
for (const a of avisos) console.log(cor.aviso('  AVISO  ') + a + '\n');
for (const e of erros) console.log(cor.erro('  ERRO   ') + e);

if (erros.length) {
  console.log(cor.erro('\n  ' + erros.length + ' problema(s). Nada foi empacotado.\n'));
  process.exit(1);
}
console.log(cor.ok('  Validacao OK') + cor.fraco('  (' + avisos.length + ' aviso(s))') + '\n');
