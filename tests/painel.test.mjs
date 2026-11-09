// Painel de Operação: a aba Menu e a edição não podem mexer na impressão nem pedir aceite nas máquinas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');
const ler = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('permissões: só "identity" a mais, e nenhum host novo', () => {
  // Permissão com aviso numa atualização desativa a extensão nas ~60 máquinas até alguém aceitar.
  // "identity" não tem aviso (conferido com chrome.management.getPermissionWarningsByManifest).
  // Qualquer outra mudança aqui precisa da mesma conferência antes de entrar.
  const m = JSON.parse(ler('manifest.json'));
  assert.deepEqual(m.permissions, ['tabs', 'scripting', 'webNavigation', 'storage', 'alarms', 'identity']);
  assert.deepEqual(m.host_permissions, ['<all_urls>', 'file://*/*']);
  assert.ok(!m.content_security_policy, 'CSP nova pode bloquear o fetch do Firestore');
});

test('popup: abas, Menu por padrão e o painel de impressão inteiro dentro da aba Impressão', () => {
  const html = ler('popup.html');
  const iImp = html.indexOf('<section id="abaImpressao" hidden>');
  const fimImp = html.indexOf('</section>', iImp);
  assert.ok(html.includes('<section id="abaMenu">'), 'falta a aba Menu');
  assert.ok(iImp > 0 && fimImp > iImp, 'falta a aba Impressão');
  const impressao = html.slice(iImp, fimImp);
  for (const id of ['enabled', 'outputWidthMm', 'procurarAtualizacao', 'baixarDiag', 'save']) {
    assert.match(impressao, new RegExp(`id="${id}"`), `${id} saiu da aba Impressão`);
  }
  // O aviso de desligada fica fora das abas: quem está no Menu também precisa ver.
  assert.ok(html.indexOf('id="avisoOff"') < html.indexOf('class="abas"'), 'aviso de desligada dentro de uma aba');
  assert.match(html, /<script src="popup\.js"><\/script>\s*<script type="module" src="menu\/menu\.js"><\/script>/);
});

test('o menu fica em src/menu/: motor, content scripts e background não o importam', () => {
  for (const arq of ['background.js', 'content.js', 'hook.js', 'motor.js', 'labeler.js', 'popup.js']) {
    assert.doesNotMatch(ler(arq), /menu\//, `${arq} passou a depender do menu`);
  }
});

test('config do menu vai ao git só com marcadores (o build injeta)', () => {
  const c = ler('menu/config.js');
  assert.match(c, /API_KEY = '__API_KEY__'/);
  assert.match(c, /OAUTH_CLIENT_ID = '__OAUTH_CLIENT_ID__'/);
  assert.doesNotMatch(c, /AIza[0-9A-Za-z_-]{20,}/, 'API key real no git');
});

// Leitura do menu: precedência e falhas (mesmos casos da extensão Menu da Operação).
const local = new Map();
globalThis.chrome = {
  runtime: { getManifest: () => ({ version: 'teste' }) },
  storage: {
    managed: { get: async () => ({}) },
    local: {
      get: async (k) => (local.has(k) ? { [k]: local.get(k) } : {}),
      set: async (o) => Object.entries(o).forEach(([k, v]) => local.set(k, v))
    }
  }
};
const m = await import('../src/menu/shared.js');
const menu = (titulo) => ({ titulo, grupos: [{ nome: 'G', links: [{ titulo: 'WMS', url: 'https://wms.example', nota: '' }] }] });
const doc = (versao, cfg) => ({
  fields: { conteudo: { stringValue: JSON.stringify(cfg) }, versao: { integerValue: String(versao) }, atualizadoEm: { timestampValue: '2026-11-09T12:00:00Z' } }
});
const responde = (status, corpo) => async () => ({ ok: status < 400, status, json: async () => corpo });
const cai = async () => {
  throw new Error('offline');
};

test('menu: versão nova do Firestore substitui a cópia local', async () => {
  local.clear();
  await m.carregarMenu(responde(200, doc(3, menu('V3'))));
  const r = await m.carregarMenu(responde(200, doc(4, menu('V4'))));
  assert.equal(r.versao, 4);
  assert.equal((await m.lerCache()).versao, 4);
});

test('menu: sem internet mostra a última cópia, e sem cópia mostra o padrão (nunca vazio)', async () => {
  local.clear();
  const vazio = await m.carregarMenu(cai);
  assert.equal(vazio.origem, 'padrao');
  assert.ok(vazio.config.grupos.length > 0);
  await m.carregarMenu(responde(200, doc(3, menu('V3'))));
  const r = await m.carregarMenu(cai);
  assert.equal(r.origem, 'cache');
  assert.equal(r.versao, 3);
  assert.equal(r.offline, true);
});

test('menu: link sem https não abre (vira Pendente)', () => {
  assert.equal(m.urlValida('https://enviagora.stokki.com.br'), true);
  assert.equal(m.urlValida('http://exemplo'), false);
  assert.equal(m.urlValida(''), false);
});

test('menu: logos com caminho absoluto, porque o popup e a edição ficam em pastas diferentes', () => {
  assert.equal(m.logoDoSistema('https://enviagora.stokki.com.br/pt-br/login'), '/menu/logos/stokki.png');
  for (const arq of ['stokki.png', 'cockpit.svg', 'apps-script.png', 'cockpit-escuro.svg']) {
    assert.ok(fs.existsSync(path.join(SRC, 'menu', 'logos', arq)), `falta logos/${arq}`);
  }
});
