// Aba "Menu da operação" do popup: os atalhos para os sistemas da operação, lidos do Firestore
// (menu-enviagora) com cópia local para abrir sem internet. Só leitura aqui; nada desta aba mexe
// em impressão. Busca filtra pelo nome, Enter abre o primeiro, Esc limpa; link sem endereço válido
// aparece como "Pendente" e não abre.
import { carregarMenu, lerCache, normalizarConfig, DEFAULT_CONFIG, urlValida, criarTile, dataBR } from './shared.js';

const $ = (id) => document.getElementById(id);
let CONFIG = normalizarConfig(DEFAULT_CONFIG);

function item(link) {
  const ok = urlValida(link.url);
  const no = document.createElement(ok ? 'a' : 'div');
  no.className = 'menu-item' + (ok ? '' : ' menu-pendente');
  if (ok) Object.assign(no, { href: link.url, target: '_blank', rel: 'noreferrer', title: link.url });
  const titulo = document.createElement('div');
  titulo.className = 'menu-titulo';
  titulo.textContent = link.titulo;
  no.append(criarTile(link), titulo);
  if (!ok) {
    const b = document.createElement('span');
    b.className = 'menu-badge';
    b.textContent = 'Pendente';
    no.appendChild(b);
  }
  return no;
}

function render(filtro = '') {
  const q = filtro.trim().toLowerCase();
  const alvo = $('menuGrupos');
  alvo.textContent = '';
  for (const g of CONFIG.grupos) {
    const links = g.links.filter((l) => !q || l.titulo.toLowerCase().includes(q));
    if (!links.length) continue;
    const h = document.createElement('div');
    h.className = 'menu-grupo';
    h.textContent = g.nome;
    const lista = document.createElement('div');
    lista.className = 'menu-lista';
    links.forEach((l) => lista.appendChild(item(l)));
    alvo.append(h, lista);
  }
  if (!alvo.children.length) {
    const v = document.createElement('div');
    v.className = 'menu-vazio';
    v.textContent = 'Nenhum sistema com esse nome.';
    alvo.appendChild(v);
  }
}

function aba(qual) {
  $('abaMenu').hidden = qual !== 'menu';
  $('abaImpressao').hidden = qual !== 'impressao';
  $('btnAbaMenu').setAttribute('aria-selected', String(qual === 'menu'));
  $('btnAbaImpressao').setAttribute('aria-selected', String(qual === 'impressao'));
  if (qual === 'menu') $('menuBusca').focus();
}
$('btnAbaMenu').addEventListener('click', () => aba('menu'));
$('btnAbaImpressao').addEventListener('click', () => aba('impressao'));

$('menuBusca').addEventListener('input', (e) => render(e.target.value));
$('menuBusca').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.target.value = '';
    render();
  }
  if (e.key === 'Enter') {
    const primeiro = $('menuGrupos').querySelector('a.menu-item');
    if (primeiro) primeiro.click();
  }
});

(async () => {
  aba('menu');
  // Cópia local na hora (nunca tela em branco); depois a versão atual do Firestore.
  const cache = await lerCache();
  if (cache) CONFIG = cache.config;
  render();
  const r = await carregarMenu();
  CONFIG = r.config;
  render($('menuBusca').value);
  $('menuRodape').textContent = r.offline
    ? 'Sem conexão: mostrando o último menu recebido.'
    : r.atualizadoEm ? `Menu atualizado em ${dataBR(r.atualizadoEm)}` : '';
})();
