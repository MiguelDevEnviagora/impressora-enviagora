/* chrome.* falso, o minimo para o background.js REAL rodar dentro do Node.
 *
 * POR QUE ISTO EXISTE
 * O teste de estresse de 19/08/2026 rodou o background de verdade contra 20 PDFs
 * diferentes e pegou a chave de deduplicacao colidindo — 18 etiquetas "reaproveitadas"
 * de outra. Esse tipo de bug nao aparece em teste de funcao pura: aparece quando o
 * HANDLER inteiro roda, com storage, mensagens e concorrencia. Este stub simula as
 * INTERFACES do Chrome (nao o timing) para manter esse teste rodando para sempre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SRC } from './carregar-extensao.mjs';

export function criarChromeFalso() {
  const listeners = { onMessage: [] };
  const local = {}, sync = {};
  const leia = (base) => (pedido, cb) => {
    const saida = {};
    if (pedido === null) { Object.assign(saida, base); queueMicrotask(() => cb(saida)); return; }
    for (const [k, padrao] of Object.entries(pedido)) {
      saida[k] = Object.prototype.hasOwnProperty.call(base, k) ? base[k] : padrao;
    }
    queueMicrotask(() => cb(saida));   // callback assincrono, como no Chrome de verdade
  };
  const grave = (base) => (novos, cb) => { Object.assign(base, novos); if (cb) queueMicrotask(cb); };

  const chrome = {
    _local: local, _sync: sync, _listeners: listeners,
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '0.0.0-teste' }),
      getURL: (p) => 'chrome-extension://teste/' + p,
      onMessage: { addListener: (f) => listeners.onMessage.push(f) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onUpdateAvailable: { addListener: () => {} },
      requestUpdateCheck: (cb) => queueMicrotask(() => cb('throttled')),
      reload: () => {},
      sendMessage: () => {}
    },
    alarms: { get: (n, cb) => queueMicrotask(() => cb(undefined)), create: () => {}, onAlarm: { addListener: () => {} } },
    storage: {
      local: { get: leia(local), set: grave(local), remove: (ks, cb) => { [].concat(ks).forEach(k => delete local[k]); if (cb) cb(); } },
      sync:  { get: leia(sync),  set: grave(sync),  remove: (ks, cb) => { [].concat(ks).forEach(k => delete sync[k]);  if (cb) cb(); } },
      onChanged: { addListener: () => {} }
    },
    webNavigation: { onCommitted: { addListener: () => {} }, onCompleted: { addListener: () => {} } },
    tabs: {
      // motor "mudo": e o pior caso do caminho do WMS — o background tem que se virar sozinho
      sendMessage: (tabId, msg, opts, cb) => {
        chrome.runtime.lastError = { message: 'no receiving end' };
        queueMicrotask(() => { cb && cb(undefined); chrome.runtime.lastError = null; });
      },
      update: () => {}, onRemoved: { addListener: () => {} }
    },
    scripting: { executeScript: async () => { throw new Error('sem pagina no Node'); } }
  };
  return chrome;
}

/** Carrega o background.js real por cima do chrome falso. Sempre um mundo novo por chamada
 *  nao da (eval global); quem precisar de estado limpo usa PDFs diferentes. */
let carregado = null;
export function carregarBackgroundReal() {
  if (carregado) return carregado;
  const chrome = criarChromeFalso();
  globalThis.chrome = chrome;
  globalThis.self = globalThis;
  globalThis.importScripts = (...arqs) => {
    for (const a of arqs) (0, eval)(fs.readFileSync(path.join(SRC, a), 'utf8'));
  };
  (0, eval)(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8'));
  carregado = chrome;
  return chrome;
}

/** Entrega uma mensagem ao handler como o Chrome faria; resolve com a resposta. */
export function mandar(chrome, msg, sender = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('handler nao respondeu em 15s: ' + (msg && msg.action))), 15000);
    let algumTrue = false;
    for (const f of chrome._listeners.onMessage) {
      const r = f(msg, sender, (resp) => { clearTimeout(t); resolve(resp); });
      if (r === true) algumTrue = true;
    }
    if (!algumTrue) { clearTimeout(t); resolve(undefined); }
  });
}
