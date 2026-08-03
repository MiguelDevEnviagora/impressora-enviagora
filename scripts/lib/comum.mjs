/* Caminhos e utilidades compartilhadas pelos scripts de build. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = path.join(RAIZ, 'src');
export const DIST = path.join(RAIZ, 'dist');
export const SITE = path.join(RAIZ, 'site');
export const CONFIG = path.join(RAIZ, 'config');

export const ARQ_CHAVE_PUBLICA = path.join(CONFIG, 'chave-publica.txt');
export const ARQ_CHAVE_PRIVADA = path.join(RAIZ, 'chave-privada.pem');

export function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

export function pacote() {
  return lerJson(path.join(RAIZ, 'package.json'));
}

/** Todos os arquivos de src/, com caminho relativo em barra normal (formato do ZIP). */
export function arquivosDaExtensao() {
  const saida = [];
  const varrer = (dir, prefixo) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (item.name.startsWith('.')) continue;
      const completo = path.join(dir, item.name);
      const relativo = prefixo ? prefixo + '/' + item.name : item.name;
      if (item.isDirectory()) varrer(completo, relativo);
      else saida.push({ nome: relativo, dados: fs.readFileSync(completo) });
    }
  };
  varrer(SRC, '');
  return saida;
}

/** URL base do GitHub Pages, deduzida do package.json (fonte unica do endereco). */
export function urlBase() {
  const url = pacote().homepage;
  if (!url || !url.startsWith('https://')) {
    throw new Error('package.json precisa de "homepage" com a URL do GitHub Pages');
  }
  return url.endsWith('/') ? url : url + '/';
}

/** "Enviagora/impressora-enviagora" a partir do repository.url do package.json. */
export function repositorio() {
  const url = pacote().repository?.url || '';
  const m = url.match(/github\.com\/([^/]+\/[^/.]+)/);
  if (!m) throw new Error('package.json precisa de "repository.url" apontando para o GitHub');
  return m[1];
}

export const cor = {
  ok: (t) => '\x1b[32m' + t + '\x1b[0m',
  erro: (t) => '\x1b[31m' + t + '\x1b[0m',
  aviso: (t) => '\x1b[33m' + t + '\x1b[0m',
  fraco: (t) => '\x1b[90m' + t + '\x1b[0m'
};

export { fs, path };
