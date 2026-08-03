#!/usr/bin/env node
/* Sobe a versao num lugar so.
 *
 * A versao mora no package.json. Este script escreve a mesma no src/manifest.json, para
 * que os dois nunca divirjam — divergencia entre eles ja e motivo de o release.yml
 * reprovar o build.
 *
 *   npm run bump              -> 16.34.0  ->  16.34.1
 *   npm run bump -- minor     -> 16.34.1  ->  16.35.0
 *   npm run bump -- major     -> 16.35.0  ->  17.0.0
 *   npm run bump -- 16.40.0   -> versao exata
 */
import { fs, path, RAIZ, SRC, lerJson, cor } from './lib/comum.mjs';

const arg = (process.argv[2] || 'patch').trim();

const caminhoPkg = path.join(RAIZ, 'package.json');
const caminhoManifest = path.join(SRC, 'manifest.json');

const pkg = lerJson(caminhoPkg);
const atual = pkg.version;
const partes = atual.split('.').map(Number);
if (partes.length !== 3 || partes.some((n) => !Number.isInteger(n))) {
  console.error(cor.erro('\n  package.json tem versao "' + atual + '", que nao e X.Y.Z.\n'));
  process.exit(1);
}

let nova;
if (arg === 'patch') nova = [partes[0], partes[1], partes[2] + 1].join('.');
else if (arg === 'minor') nova = [partes[0], partes[1] + 1, 0].join('.');
else if (arg === 'major') nova = [partes[0] + 1, 0, 0].join('.');
else if (/^\d+(\.\d+){0,3}$/.test(arg)) nova = arg;
else {
  console.error(cor.erro('\n  Nao entendi "' + arg + '". Use patch, minor, major ou uma versao X.Y.Z.\n'));
  process.exit(1);
}

// O Chrome so instala versao MAIOR. Publicar uma versao menor ou igual nao atualiza
// maquina nenhuma, e nao da erro em lugar nenhum — some, simplesmente.
const comparar = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
};
if (comparar(nova, atual) <= 0) {
  console.error(cor.erro('\n  ' + nova + ' nao e maior que a versao atual (' + atual + ').'));
  console.error('  O Chrome so instala versao maior: as maquinas ignorariam este release em silencio.\n');
  process.exit(1);
}

pkg.version = nova;
fs.writeFileSync(caminhoPkg, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

const manifestTexto = fs.readFileSync(caminhoManifest, 'utf8');
const manifest = JSON.parse(manifestTexto);
manifest.version = nova;
fs.writeFileSync(caminhoManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('\n  ' + atual + '  ->  ' + cor.ok(nova) + '\n');
console.log('  package.json e src/manifest.json atualizados.\n');
console.log('  Para publicar:');
console.log('    git commit -am "v' + nova + ': <o que muda para a operacao>"');
console.log('    git tag v' + nova);
console.log('    git push origin main --tags\n');
console.log(cor.fraco('  A tag dispara o release.yml: testes, build, Release com ZIP e CRX, e Pages.\n'));
