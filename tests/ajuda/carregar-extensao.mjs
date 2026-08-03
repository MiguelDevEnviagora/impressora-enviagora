/* Carrega arquivos da extensao dentro do Node, sem navegador e sem Chrome.
 *
 * Como funciona: pdf-lib e crop-etiqueta.js sao scripts classicos que se penduram num
 * global (`self`). No Node esse global nao existe, entao apontamos `self` para o
 * globalThis e avaliamos os arquivos com eval indireto — que roda em escopo global.
 * E o mesmo truque usado para rodar o detector fora do navegador desde a v16.32.
 *
 * O que este helper NAO faz: simular a API `chrome`. As funcoes que dependem dela
 * (carregar, atualizarRemoto) so tocam nela quando chamadas, entao o modulo carrega
 * limpo e os testes exercitam apenas a parte pura — validacao e precedencia.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = path.join(RAIZ, 'src');
export const FIXTURES = path.join(RAIZ, 'tests', 'fixtures');

export function lerSrc(nomeArquivo) {
  return fs.readFileSync(path.join(SRC, nomeArquivo), 'utf8');
}

let carregado = false;

/** Deixa PDFLib, EnviagoraCrop e EnviagoraConfig disponiveis em globalThis. */
export function carregarExtensao() {
  if (carregado) return globalThis;

  globalThis.self = globalThis;
  const avaliar = (codigo) => (0, eval)(codigo);

  avaliar(lerSrc('pdf-lib.min.js'));
  if (!globalThis.PDFLib) throw new Error('pdf-lib nao registrou PDFLib no global');

  avaliar(lerSrc('crop-etiqueta.js'));
  if (!globalThis.EnviagoraCrop) throw new Error('crop-etiqueta.js nao registrou EnviagoraCrop');

  avaliar(lerSrc('config-padrao.js'));
  if (!globalThis.EnviagoraConfig) throw new Error('config-padrao.js nao registrou EnviagoraConfig');

  carregado = true;
  return globalThis;
}

/** Abre um PDF das fixtures e devolve a primeira pagina, do jeito que o detector espera. */
export async function primeiraPagina(caminhoRelativo) {
  const bytes = fs.readFileSync(path.join(FIXTURES, caminhoRelativo));
  const doc = await globalThis.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const paginas = doc.getPages();
  if (!paginas.length) throw new Error(caminhoRelativo + ' nao tem paginas');
  return { pagina: paginas[0], totalPaginas: paginas.length };
}
