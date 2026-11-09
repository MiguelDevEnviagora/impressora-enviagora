/* Painel de Operação — menu da operação (cópia do shared.js da extensão Menu da Operação, repo
 * enviagora-dev/menu-enviagora, spec 01). Menu central no Firestore: a impressora lê de lá; só admin logado
 * com Google grava, e quem confere isso são as regras do Firestore, no servidor. Logos com caminho absoluto
 * (/menu/logos/...) porque o popup.html fica na raiz e a tela de edição em menu/.
 */
import { PROJETO, API_KEY, OAUTH_CLIENT_ID, DOMINIO } from './config.js';

// Versão da impressora (é ela que roda o menu), para a tela de edição mostrar a versão certa.
export const APP_VERSION = globalThis.chrome?.runtime?.getManifest?.().version ?? 'dev';

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents`;
const CACHE_KEY = 'ea_menu_cache';
const SESSAO_KEY = 'ea_menu_sessao';

export const DEFAULT_CONFIG = {
  titulo: 'MENU DA OPERAÇÃO',
  grupos: [
    {
      nome: 'SISTEMAS DA OPERAÇÃO',
      links: [
        { titulo: 'WMS', url: 'https://enviagora.stokki.com.br/pt-br/login', nota: 'Estoque, posições, PS/OE e expedição' },
        { titulo: 'BI - Planejamento', url: 'https://enviagora-dash.bolt.host/', nota: 'Indicadores e planejamento da operação' },
        {
          titulo: 'HUB - Instruções Operacionais',
          url: 'https://script.google.com/a/macros/enviagora.com.br/s/AKfycbxAtDfo3s4rOTF-qz02XsbcAdDpciK6l9pbl9NMDamZztsq-txuooVHjTpgtPyUB3A/exec',
          nota: 'POPs e instruções de trabalho'
        }
      ]
    }
  ]
};

export const LIMITES = { grupos: 20, links: 30, titulo: 60, nota: 120, url: 2000 };

/* ------------------------------ util ------------------------------ */

export function dataBR(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Mesma lista que firestore.rules recusa (spec 01, D-07). */
const CREDENCIAL = /([?&#;](token|key|apikey|api_key|access_token|senha|password|pass|secret)=)|^https:\/\/[^/]*@/i;

export function temCredencial(url) {
  return CREDENCIAL.test(String(url || '').trim());
}

export function urlValida(url) {
  const u = String(url || '').trim();
  return /^https:\/\/[^\s]+$/i.test(u) && !temCredencial(u);
}

export function normalizarConfig(bruta) {
  const base = bruta && typeof bruta === 'object' ? bruta : {};
  const corta = (v, n) => String(v || '').trim().slice(0, n);
  return {
    titulo: corta(base.titulo, LIMITES.titulo) || DEFAULT_CONFIG.titulo,
    grupos: (Array.isArray(base.grupos) ? base.grupos : [])
      .filter((g) => g && typeof g === 'object')
      .slice(0, LIMITES.grupos)
      .map((g) => ({
        nome: corta(g.nome, LIMITES.titulo) || 'SEM NOME',
        links: (Array.isArray(g.links) ? g.links : [])
          .filter((l) => l && typeof l === 'object')
          .map((l) => ({ titulo: corta(l.titulo, LIMITES.titulo), url: corta(l.url, LIMITES.url), nota: corta(l.nota, LIMITES.nota) }))
          .filter((l) => l.titulo)
          .slice(0, LIMITES.links)
      }))
  };
}

/** Erros que impedem publicar. Vazio = pode publicar. */
export function errosDoMenu(config) {
  const erros = [];
  for (const g of config.grupos) {
    for (const l of g.links) {
      if (!String(l.titulo || '').trim()) erros.push('Existe link sem nome. Preencha ou exclua antes de publicar.');
      if (temCredencial(l.url)) erros.push('Este endereço tem senha ou token. Use o link sem credencial.');
    }
  }
  return [...new Set(erros)];
}

/* ------------------------- logo de cada sistema ------------------------- */

// Logo embutido na extensão (funciona offline e não chama terceiro). Host sem logo = sigla.
const LOGOS = [
  [/(^|\.)stokki\.com\.br$/, '/menu/logos/stokki.png'],
  [/^enviagora-dash\.bolt\.host$/, '/menu/logos/cockpit.svg'],
  [/^script\.google\.com$/, '/menu/logos/apps-script.png']
];

export function logoDoSistema(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const achado = LOGOS.find(([re]) => re.test(host));
    return achado ? achado[1] : null;
  } catch (e) {
    return null;
  }
}

export function sigla(titulo) {
  const partes = String(titulo || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/** Tile do sistema: logo real se conhecido, senão a sigla. */
export function criarTile(link) {
  const tile = document.createElement('div');
  tile.className = 'sigla';
  const logo = logoDoSistema(link.url);
  if (logo) {
    const img = document.createElement('img');
    img.src = logo;
    img.alt = '';
    tile.appendChild(img);
  } else {
    tile.textContent = sigla(link.titulo);
  }
  return tile;
}

/* --------------------------- leitura --------------------------- */

async function lerGerenciada() {
  try {
    const { menuConfig } = await chrome.storage.managed.get('menuConfig');
    if (menuConfig && Array.isArray(menuConfig.grupos) && menuConfig.grupos.length) return normalizarConfig(menuConfig);
  } catch (e) {
    /* sem política */
  }
  return null;
}

export async function lerCache() {
  const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
  return c && c.config ? c : null;
}

/** Converte o doc `menu/atual` do Firestore em { config, versao, atualizadoEm, atualizadoPor }. */
export function docParaMenu(doc) {
  const f = (doc && doc.fields) || {};
  return {
    config: normalizarConfig(JSON.parse(f.conteudo.stringValue)),
    versao: Number(f.versao.integerValue),
    atualizadoEm: f.atualizadoEm ? f.atualizadoEm.timestampValue : null,
    atualizadoPor: f.atualizadoPor ? f.atualizadoPor.stringValue : null
  };
}

export async function buscarRemoto(fetchFn = fetch) {
  const r = await fetchFn(`${BASE}/menu/atual`, { cache: 'no-store' });
  if (r.status === 404) return null; // nada publicado ainda
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return docParaMenu(await r.json());
}

/**
 * Precedência (spec 01 §2): política > Firestore > cache > padrão.
 * Falha de rede ou doc inválido nunca apaga o cache.
 * Retorna { config, origem: 'politica'|'remoto'|'cache'|'padrao', versao, atualizadoEm, offline }.
 */
export async function carregarMenu(fetchFn = fetch) {
  const gerenciada = await lerGerenciada();
  if (gerenciada) return { config: gerenciada, origem: 'politica', versao: null, atualizadoEm: null, offline: false };

  const cache = await lerCache();
  try {
    const remoto = await buscarRemoto(fetchFn);
    if (!remoto) return { config: normalizarConfig(DEFAULT_CONFIG), origem: 'padrao', versao: 0, atualizadoEm: null, offline: false };
    if (!cache || remoto.versao !== cache.versao) await chrome.storage.local.set({ [CACHE_KEY]: remoto });
    return { ...remoto, origem: 'remoto', offline: false };
  } catch (e) {
    if (cache) return { ...cache, origem: 'cache', offline: true };
    return { config: normalizarConfig(DEFAULT_CONFIG), origem: 'padrao', versao: null, atualizadoEm: null, offline: true };
  }
}

/* ------------------------------ login ------------------------------ */

function aleatorio() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Login Google (Workspace, com MFA) → token do Firebase, guardado só na sessão do Chrome. */
export async function entrarComGoogle() {
  const nonce = aleatorio();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: 'id_token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: 'openid email',
    hd: DOMINIO,
    prompt: 'select_account',
    nonce
  });
  const volta = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  const idToken = new URLSearchParams(new URL(volta).hash.slice(1)).get('id_token');
  if (!idToken) throw new Error('Login cancelado.');

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${idToken}&providerId=google.com`,
      requestUri: chrome.identity.getRedirectURL(),
      returnSecureToken: true
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Não foi possível entrar.');
  if (!String(d.email || '').toLowerCase().endsWith(`@${DOMINIO}`)) throw new Error('Use a sua conta @enviagora.com.br.');

  const sessao = { idToken: d.idToken, email: d.email.toLowerCase(), expiraEm: Date.now() + Number(d.expiresIn) * 1000 };
  await chrome.storage.session.set({ [SESSAO_KEY]: sessao });
  return sessao;
}

export async function sessaoAtual() {
  const { [SESSAO_KEY]: s } = await chrome.storage.session.get(SESSAO_KEY);
  return s && s.expiraEm > Date.now() + 30000 ? s : null;
}

export async function sair() {
  await chrome.storage.session.remove(SESSAO_KEY);
}

/* ------------------------- gravação (admin) ------------------------- */

const s = (v) => ({ stringValue: String(v) });
const i = (v) => ({ integerValue: String(v) });
const agoraServidor = (campo) => ({ fieldPath: campo, setToServerValue: 'REQUEST_TIME' });

async function chamar(sessao, caminho, corpo, metodo = 'POST') {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${sessao.idToken}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (r.status === 401) throw new Error('Sua sessão expirou. Entre de novo para publicar.');
  if (r.status === 403) throw new Error('Sua conta não tem permissão para editar o menu.');
  const d = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error(d.error && d.error.message ? d.error.message : `HTTP ${r.status}`);
  return d;
}

const nomeDoc = (rel) => `projects/${PROJETO}/databases/(default)/documents/${rel}`;

/** Monta as gravações de uma publicação: menu/atual (versao+1) + historico/menu-v<versao>, juntas. */
export function gravacoesPublicar(config, versaoAtual, email) {
  const versao = versaoAtual + 1;
  const conteudo = JSON.stringify(normalizarConfig(config));
  return [
    {
      update: {
        name: nomeDoc('menu/atual'),
        fields: { conteudo: s(conteudo), versao: i(versao), atualizadoPor: s(email) }
      },
      ...(versaoAtual === 0 ? { currentDocument: { exists: false } } : {}),
      updateTransforms: [agoraServidor('atualizadoEm')]
    },
    {
      update: {
        name: nomeDoc(`historico/menu-v${versao}`),
        fields: { tipo: s('menu'), versao: i(versao), conteudo: s(conteudo), autor: s(email), detalhe: s(resumo(config)) }
      },
      currentDocument: { exists: false },
      updateTransforms: [agoraServidor('em')]
    }
  ];
}

function resumo(config) {
  const links = config.grupos.reduce((t, g) => t + g.links.length, 0);
  return `${config.grupos.length} grupo(s), ${links} link(s)`;
}

export async function publicar(sessao, config, versaoAtual) {
  const erros = errosDoMenu(config);
  if (erros.length) throw new Error(erros[0]);
  try {
    await chamar(sessao, ':commit', { writes: gravacoesPublicar(config, versaoAtual, sessao.email) });
  } catch (e) {
    if (/ALREADY_EXISTS|FAILED_PRECONDITION|already exists/i.test(e.message)) {
      throw new Error('Outra pessoa publicou uma versão mais nova. Recarregue antes de editar.');
    }
    throw e;
  }
  return versaoAtual + 1;
}

function registroAdmin(acao, alvo, email) {
  return {
    update: {
      name: nomeDoc(`historico/admin-${Date.now()}-${aleatorio().slice(0, 6)}`),
      fields: { tipo: s('admin'), autor: s(email), detalhe: s(`${acao} ${alvo}`) }
    },
    currentDocument: { exists: false },
    updateTransforms: [agoraServidor('em')]
  };
}

export function emailAdminValido(email) {
  return new RegExp(`^[a-z0-9._-]+@${DOMINIO.replace(/\./g, '\\.')}$`).test(String(email || '').trim().toLowerCase());
}

export async function adicionarAdmin(sessao, email) {
  const alvo = String(email || '').trim().toLowerCase();
  if (!emailAdminValido(alvo)) throw new Error('Use a sua conta @enviagora.com.br.');
  try {
    await chamar(sessao, ':commit', {
      writes: [
        {
          update: { name: nomeDoc(`admins/${alvo}`), fields: { adicionadoPor: s(sessao.email) } },
          currentDocument: { exists: false },
          updateTransforms: [agoraServidor('em')]
        },
        registroAdmin('Adicionou', alvo, sessao.email)
      ]
    });
  } catch (e) {
    if (/ALREADY_EXISTS|already exists/i.test(e.message)) throw new Error('Esta conta já é administradora.');
    throw e;
  }
}

export async function removerAdmin(sessao, email) {
  if (email === sessao.email) throw new Error('O menu precisa de pelo menos um administrador.');
  await chamar(sessao, ':commit', {
    writes: [{ delete: nomeDoc(`admins/${email}`) }, registroAdmin('Removeu', email, sessao.email)]
  });
}

export async function listarAdmins(sessao) {
  const d = await chamar(sessao, '/admins?pageSize=50', null, 'GET');
  return (d.documents || []).map((doc) => doc.name.split('/').pop()).sort();
}

export async function lerHistorico(sessao) {
  const d = await chamar(sessao, ':runQuery', {
    structuredQuery: { from: [{ collectionId: 'historico' }], orderBy: [{ field: { fieldPath: 'em' }, direction: 'DESCENDING' }], limit: 30 }
  });
  return (Array.isArray(d) ? d : [])
    .filter((x) => x.document)
    .map(({ document: { fields: f } }) => ({ autor: f.autor.stringValue, detalhe: f.detalhe.stringValue, tipo: f.tipo.stringValue, em: f.em.timestampValue }));
}

/* --------------------- registro de máquinas (D-12) --------------------- */

const MAQUINA_KEY = 'ea_maquina';

/** Gravação de `maquinas/{id}`: cria com as duas datas ou só atualiza versão e último acesso. */
export function gravacaoMaquina(id, versao, nova) {
  return {
    update: { name: nomeDoc(`maquinas/${id}`), fields: { versao: s(versao) } },
    ...(nova ? { currentDocument: { exists: false } } : { updateMask: { fieldPaths: ['versao'] }, currentDocument: { exists: true } }),
    updateTransforms: nova ? [agoraServidor('primeiroAcesso'), agoraServidor('ultimoAcesso')] : [agoraServidor('ultimoAcesso')]
  };
}

/** No máximo uma gravação por dia (ou por versão nova). Sem login; nunca lança para quem chama. */
export async function registrarMaquina(fetchFn = fetch, hoje = new Date().toISOString().slice(0, 10)) {
  try {
    const { [MAQUINA_KEY]: m = {} } = await chrome.storage.local.get(MAQUINA_KEY);
    if (m.id && m.dia === hoje && m.versao === APP_VERSION) return false;
    const id = m.id || crypto.randomUUID();
    const enviar = (nova) =>
      fetchFn(`${BASE}:commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: [gravacaoMaquina(id, APP_VERSION, nova)] })
      });
    let r = await enviar(!m.id);
    if (!r.ok && m.id) r = await enviar(true); // registro apagado no console: cria de novo com o mesmo ID
    if (!r.ok) return false;
    await chrome.storage.local.set({ [MAQUINA_KEY]: { id, dia: hoje, versao: APP_VERSION } });
    return true;
  } catch {
    return false;
  }
}

// ponytail: uma página de 300; paginar se passar disso (60 máquinas hoje).
export async function listarMaquinas(sessao) {
  const d = await chamar(sessao, '/maquinas?pageSize=300', null, 'GET');
  return (d.documents || []).map(({ fields: f }) => ({ versao: f.versao.stringValue, ultimoAcesso: f.ultimoAcesso.timestampValue }));
}
