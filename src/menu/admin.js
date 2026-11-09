import {
  carregarMenu,
  normalizarConfig,
  errosDoMenu,
  urlValida,
  temCredencial,
  criarTile,
  dataBR,
  entrarComGoogle,
  sessaoAtual,
  sair,
  publicar,
  listarAdmins,
  adicionarAdmin,
  removerAdmin,
  lerHistorico,
  listarMaquinas,
  APP_VERSION
} from './shared.js';

const el = (id) => document.getElementById(id);
const telaEntrar = el('telaEntrar');
const telaEditor = el('telaEditor');
const elGrupos = el('grupos');

let CONFIG = null;
let VERSAO = null; // versão do Firestore em que a edição se baseia; null = sem conexão
let SESSAO = null;

/* ----------------------------- avisos ----------------------------- */

function aviso(no, texto, tipo = 'erro') {
  no.textContent = texto;
  no.className = `aviso aviso-${tipo}`;
}
function limpar(no) {
  no.textContent = '';
  no.className = 'aviso oculto';
}

/* ------------------------------ entrar ------------------------------ */

function mostrarEntrar(msg) {
  SESSAO = null;
  telaEditor.classList.add('oculto');
  telaEntrar.classList.remove('oculto');
  if (msg) aviso(el('entrarAviso'), msg);
  el('btnEntrar').focus();
}

el('btnEntrar').addEventListener('click', async () => {
  limpar(el('entrarAviso'));
  try {
    SESSAO = await entrarComGoogle();
    await abrirEditor();
  } catch (e) {
    await sair();
    mostrarEntrar(e.message);
  }
});

el('btnSair').addEventListener('click', async () => {
  await sair();
  mostrarEntrar();
});

/* ------------------------------ editor (da base) ------------------------------ */

function botao(texto, classe, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${classe} btn-mini`;
  b.textContent = texto;
  b.addEventListener('click', onClick);
  return b;
}

function campo(rotulo, valor, classe, placeholder = '') {
  const label = document.createElement('label');
  label.className = 'campo';
  const span = document.createElement('span');
  span.textContent = rotulo;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = valor || '';
  input.className = classe;
  input.placeholder = placeholder;
  label.append(span, input);
  return label;
}

function coletar() {
  CONFIG.titulo = el('tituloMenu').value.trim() || 'MENU DA OPERAÇÃO';
  CONFIG.grupos = [...elGrupos.querySelectorAll('.cartao-grupo')].map((cg) => ({
    nome: (cg.querySelector('.nome-grupo').value || 'SEM NOME').trim(),
    links: [...cg.querySelectorAll('.linha-link')].map((ll) => ({
      titulo: ll.querySelector('.titulo').value.trim(),
      url: ll.querySelector('.url').value.trim(),
      nota: ll.querySelector('.nota').value.trim()
    }))
  }));
}

function mover(lista, de, para) {
  if (para < 0 || para >= lista.length) return;
  const [item] = lista.splice(de, 1);
  lista.splice(para, 0, item);
}

function renderEditor() {
  el('tituloMenu').value = CONFIG.titulo;
  elGrupos.textContent = '';

  CONFIG.grupos.forEach((grupo, gi) => {
    const cartao = document.createElement('div');
    cartao.className = 'cartao cartao-grupo';

    const cab = document.createElement('div');
    cab.className = 'cabecalho-grupo';
    cab.appendChild(campo('Nome do grupo', grupo.nome, 'nome-grupo', 'Ex.: SISTEMAS DA OPERAÇÃO'));
    const acoesGrupo = document.createElement('div');
    acoesGrupo.className = 'grupo-botoes';
    acoesGrupo.append(
      botao('Subir grupo', 'btn-secundario', () => (coletar(), mover(CONFIG.grupos, gi, gi - 1), renderEditor())),
      botao('Descer grupo', 'btn-secundario', () => (coletar(), mover(CONFIG.grupos, gi, gi + 1), renderEditor())),
      botao('Excluir grupo', 'btn-perigo', () => {
        if (!confirm(`Excluir o grupo "${grupo.nome}" e todos os links dele?`)) return;
        coletar();
        CONFIG.grupos.splice(gi, 1);
        renderEditor();
      })
    );
    cab.appendChild(acoesGrupo);
    cartao.appendChild(cab);

    if (!grupo.links.length) {
      const p = document.createElement('p');
      p.className = 'sem-link';
      p.textContent = 'Nenhum link neste grupo.';
      cartao.appendChild(p);
    }

    grupo.links.forEach((link, li) => {
      const linha = document.createElement('div');
      linha.className = 'linha-link' + (urlValida(link.url) ? '' : ' link-invalido');
      linha.append(
        criarTile(link),
        campo('Nome do botão', link.titulo, 'titulo', 'Ex.: WMS'),
        campo('Endereço (URL)', link.url, 'url', 'https://…'),
        campo('Descrição curta', link.nota, 'nota', 'Aparece embaixo do nome')
      );
      const acoes = document.createElement('div');
      acoes.className = 'acoes';
      acoes.append(
        botao('Subir', 'btn-secundario', () => (coletar(), mover(CONFIG.grupos[gi].links, li, li - 1), renderEditor())),
        botao('Descer', 'btn-secundario', () => (coletar(), mover(CONFIG.grupos[gi].links, li, li + 1), renderEditor())),
        botao('Excluir', 'btn-perigo', () => {
          if (!confirm(`Excluir o link "${link.titulo || 'sem nome'}"?`)) return;
          coletar();
          CONFIG.grupos[gi].links.splice(li, 1);
          renderEditor();
        })
      );
      linha.appendChild(acoes);
      cartao.appendChild(linha);
    });

    cartao.appendChild(
      botao('Adicionar link neste grupo', 'btn-secundario', () => {
        coletar();
        CONFIG.grupos[gi].links.push({ titulo: '', url: '', nota: '' });
        renderEditor();
      })
    );
    elGrupos.appendChild(cartao);
  });
}

el('btnAddGrupo').addEventListener('click', () => {
  coletar();
  CONFIG.grupos.push({ nome: 'NOVO GRUPO', links: [{ titulo: '', url: '', nota: '' }] });
  renderEditor();
});

/* ------------------------------ publicar ------------------------------ */

el('btnPublicar').addEventListener('click', async () => {
  const no = el('editorAviso');
  limpar(no);
  coletar();
  if (VERSAO === null) return aviso(no, 'Sem conexão. Mostrando o menu padrão.');

  const erros = errosDoMenu(CONFIG);
  if (erros.length) return aviso(no, erros[0]);

  const btn = el('btnPublicar');
  btn.disabled = true;
  try {
    VERSAO = await publicar(SESSAO, CONFIG, VERSAO);
    CONFIG = normalizarConfig(CONFIG);
    renderEditor();
    info();
    const pendentes = CONFIG.grupos.flatMap((g) => g.links.filter((l) => !urlValida(l.url)).map((l) => l.titulo));
    if (pendentes.length) {
      aviso(no, `Menu publicado. Atenção: ${pendentes.join(', ')} sem endereço válido — aparecem como "Pendente" no menu.`, 'alerta');
    } else {
      aviso(no, 'Menu publicado. As máquinas atualizam na próxima vez que abrirem o menu.', 'ok');
    }
    await atualizarHistorico();
  } catch (e) {
    if (/sessão expirou/.test(e.message)) return mostrarEntrar(e.message);
    aviso(no, e.message);
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------ administradores ------------------------------ */

async function atualizarAdmins() {
  const ul = el('admins');
  ul.textContent = '';
  for (const email of await listarAdmins(SESSAO)) {
    const li = document.createElement('li');
    const nome = document.createElement('span');
    nome.textContent = email;
    li.appendChild(nome);
    if (email !== SESSAO.email) {
      li.appendChild(
        botao('Remover', 'btn-perigo', async () => {
          if (!confirm(`Remover ${email} dos administradores?`)) return;
          try {
            await removerAdmin(SESSAO, email);
            await Promise.all([atualizarAdmins(), atualizarHistorico()]);
          } catch (e) {
            aviso(el('adminAviso'), e.message);
          }
        })
      );
    }
    ul.appendChild(li);
  }
}

el('btnAddAdmin').addEventListener('click', async () => {
  const no = el('adminAviso');
  limpar(no);
  try {
    await adicionarAdmin(SESSAO, el('novoAdmin').value);
    el('novoAdmin').value = '';
    await Promise.all([atualizarAdmins(), atualizarHistorico()]);
    aviso(no, 'Administrador adicionado.', 'ok');
  } catch (e) {
    aviso(no, e.message);
  }
});

/* ------------------------------- histórico ------------------------------- */

async function atualizarHistorico() {
  const ul = el('historico');
  ul.textContent = '';
  const lista = await lerHistorico(SESSAO);
  if (!lista.length) {
    const li = document.createElement('li');
    li.textContent = 'Nenhuma alteração registrada ainda.';
    ul.appendChild(li);
    return;
  }
  lista.forEach((r) => {
    const li = document.createElement('li');
    const esq = document.createElement('span');
    esq.textContent = `${r.tipo === 'menu' ? 'Menu publicado' : r.detalhe.split(' ')[0]} — ${r.tipo === 'menu' ? r.detalhe : r.detalhe.split(' ').slice(1).join(' ')} — ${r.autor}`;
    const dir = document.createElement('span');
    dir.textContent = dataBR(r.em);
    li.append(esq, dir);
    ul.appendChild(li);
  });
}

/* -------------------------------- máquinas -------------------------------- */

async function atualizarMaquinas() {
  const ul = el('maquinas');
  ul.textContent = '';
  const linha = (esq, dir) => {
    const li = document.createElement('li');
    const a = document.createElement('span');
    a.textContent = esq;
    const b = document.createElement('span');
    b.textContent = dir;
    li.append(a, b);
    ul.appendChild(li);
  };
  const lista = await listarMaquinas(SESSAO);
  const corte = Date.now() - 7 * 24 * 3600 * 1000;
  linha('Registradas', String(lista.length));
  linha('Vistas nos últimos 7 dias', String(lista.filter((m) => Date.parse(m.ultimoAcesso) >= corte).length));
  const porVersao = {};
  lista.forEach((m) => (porVersao[m.versao] = (porVersao[m.versao] || 0) + 1));
  Object.keys(porVersao).sort().reverse().forEach((v) => linha(`Na versão ${v}`, String(porVersao[v])));
}

/* -------------------------------- início -------------------------------- */

function info(atualizadoEm) {
  el('editorInfo').textContent = `Versão ${APP_VERSION} · menu v${VERSAO} · ${SESSAO.email}${atualizadoEm ? ` · última publicação: ${dataBR(atualizadoEm)}` : ''}`;
}

async function abrirEditor() {
  // A lista de admins só abre para admin: 403 aqui = conta sem permissão.
  try {
    await atualizarAdmins();
  } catch (e) {
    await sair();
    return mostrarEntrar(e.message);
  }

  const r = await carregarMenu();
  CONFIG = r.config;
  VERSAO = r.origem === 'remoto' || r.origem === 'padrao' ? (r.versao ?? 0) : null;
  if (r.offline) VERSAO = null;

  telaEntrar.classList.add('oculto');
  telaEditor.classList.remove('oculto');
  limpar(el('editorAviso'));
  if (VERSAO === null) aviso(el('editorAviso'), 'Sem conexão. Mostrando o menu padrão.');
  info(r.atualizadoEm);
  renderEditor();
  await Promise.all([atualizarHistorico(), atualizarMaquinas().catch(() => {})]);
  const primeiro = elGrupos.querySelector('input');
  if (primeiro) primeiro.focus();
}

async function iniciar() {
  const r = await carregarMenu();
  if (r.origem === 'politica') {
    telaEntrar.classList.add('oculto');
    telaEditor.classList.remove('oculto');
    el('editorInfo').textContent = 'Este menu vem de política de TI e não pode ser editado nesta máquina.';
    CONFIG = r.config;
    renderEditor();
    document.querySelectorAll('.tela-editor button, .tela-editor input').forEach((n) => (n.disabled = true));
    return;
  }
  SESSAO = await sessaoAtual();
  if (SESSAO) return abrirEditor();
  mostrarEntrar();
}

// Aviso imediato ao colar link com credencial (a regra do Firestore recusa de qualquer jeito).
elGrupos.addEventListener('input', (ev) => {
  if (ev.target.classList.contains('url') && temCredencial(ev.target.value)) {
    aviso(el('editorAviso'), 'Este endereço tem senha ou token. Use o link sem credencial.');
  }
});

iniciar();
