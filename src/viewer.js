// viewer.js v16.22 — substitui o visualizador de PDF do Chrome NA MESMA ABA e faz
// TODO o ajuste aqui mesmo (pdf.js + pdf-lib carregados nesta página).
// Nada de service worker/offscreen no caminho: era ali que travava.
// Regra de ouro: qualquer falha => mostra a etiqueta ORIGINAL e imprime.
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

const aviso = document.getElementById('aviso');
const view  = document.getElementById('view');
const drop  = document.getElementById('drop');
const file  = document.getElementById('file');

const params = new URLSearchParams(location.search);
const src  = params.get('src') || '';
const auto = params.get('auto') === '1';

// v16.34: o PADRAO local saiu daqui. Ele era uma copia incompleta (faltavam
// printSafeMarginMm, printScaling e pickTrayByPdfSize) e so nao dava problema porque o
// storage ja vinha preenchido. Agora vem tudo de config-padrao.js.

function mostrar(bytes, nome, texto) {
  if (nome) document.title = nome;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  view.onload = () => {
    aviso.textContent = texto;
    if (auto) setTimeout(() => { try { view.contentWindow.focus(); view.contentWindow.print(); } catch (e) {} }, 300);
    setTimeout(() => { aviso.style.display = 'none'; }, 4000);
  };
  view.src = url;
}

async function config() {
  const { s } = await EnviagoraConfig.carregar();
  const op = await new Promise(r => chrome.storage.local.get({ lastOperator: null }, i => r(i && i.lastOperator)));
  return { s, op };
}

async function ajustar(bytes, nome) {
  const t0 = Date.now();
  try {
    const { s, op } = await config();
    const { bytes: saida, info } = await EnviagoraLabeler.processar(bytes, s, op);
    console.log('[Enviagora] ' + (Date.now() - t0) + 'ms — ' + info);
    if (saida) return mostrar(saida, nome, 'Etiqueta ajustada — imprimindo…');
    mostrar(bytes, nome, 'Etiqueta pronta (sem ajuste)');
  } catch (e) {
    console.error('[Enviagora] Falha ao ajustar:', e);
    mostrar(bytes, nome, 'Não deu para ajustar — imprimindo o original');
  }
}

async function start() {
  if (!src) return drop.classList.add('on');
  try {
    const nome = decodeURIComponent(src.split('/').pop().split('?')[0]);
    const r = await fetch(src, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await ajustar(new Uint8Array(await r.arrayBuffer()), nome);
  } catch (e) {
    console.warn('[Enviagora] Não consegui abrir o PDF:', e.message);
    aviso.style.display = 'none';
    drop.classList.add('on');
  }
}

async function usarArquivo(f) {
  if (!f) return;
  drop.classList.remove('on');
  aviso.style.display = '';
  aviso.textContent = 'Ajustando a etiqueta…';
  await ajustar(new Uint8Array(await f.arrayBuffer()), f.name);
}

document.getElementById('pick').addEventListener('click', () => file.click());
file.addEventListener('change', (e) => usarArquivo(e.target.files[0]));
['dragover','dragenter'].forEach(ev => drop.addEventListener(ev, e => e.preventDefault()));
drop.addEventListener('drop', (e) => { e.preventDefault(); usarArquivo(e.dataTransfer.files[0]); });

start();
