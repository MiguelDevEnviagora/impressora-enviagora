// content.js v16.27 — PONTE.
// Dois papéis:
//  1) No documento PDF (blob) do iframe: tenta o caminho clássico da v16.15 (fetch + ajuste).
//     Se o site já revogou o blob ("Failed to fetch"), tudo bem: quem salva é o hook, que
//     capturou os bytes na CRIAÇÃO do blob.
//  2) Na página do WMS: recebe do hook os bytes do PDF e manda ajustar pelo background.
//     O motor (que precisa de canvas) é injetado pelo background como content script —
//     não usamos mais iframe, porque o Stokki bloqueia iframe da extensão.
(function () {
  if (window.__zebraPonte) return;
  window.__zebraPonte = true;

  const url = window.location.href;
  const isBlobPdf = url.startsWith('blob:');

  function operadorAtual() {
    try {
      const doc = (window.top && window.top.document) || document;
      const span = doc.querySelector('span.d-none.d-md-inline.ml-2');
      if (span && span.textContent.trim()) return span.textContent.trim();
    } catch (e) {}
    return null;
  }

  async function ajustar(b64) {
    try {
      const r = await chrome.runtime.sendMessage({
        action: 'cropPdf', base64: b64, operatorName: operadorAtual()
      });
      return (r && r.croppedBase64) || null;
    } catch (e) {
      console.warn('[Enviagora] background não respondeu:', e.message);
      return null;
    }
  }

  // ── 1) documento PDF blob ────────────────────────────────────────────────
  if (isBlobPdf) {
    if (url.startsWith('blob:null')) return;   // origem opaca: só o hook alcança
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch ' + res.status);
        const u8 = new Uint8Array(await res.arrayBuffer());
        let bin = ''; const C = 8192;
        for (let i = 0; i < u8.length; i += C) bin += String.fromCharCode(...u8.subarray(i, i + C));

        const saida = await ajustar(btoa(bin));
        if (!saida) return;
        const b = atob(saida);
        const bytes = new Uint8Array(b.length);
        for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
        console.log('[Enviagora] PDF ajustado — substituindo no mesmo iframe.');
        window.location.replace(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
      } catch (e) {
        // esperado quando o site revoga o blob: o hook já cuidou disso
        console.log('[Enviagora] blob não pôde ser lido aqui (' + e.message + ') — o hook cuida.');
      }
    })();
    return;
  }

  // ── 2b) v16.32: tarja visível quando alguém desliga a extensão ───────────
  // A dor real da operação: a extensão era desligada, ninguém percebia, e as etiquetas
  // seguiam saindo erradas por horas. Agora a própria página denuncia.
  // v16.34: são DOIS motivos possíveis para a etiqueta sair sem ajuste, e o operador
  // precisa saber qual é. Desligada na máquina é problema local (alguém mexeu no popup);
  // kill switch é decisão central e temporária. Cores diferentes de propósito: vermelho
  // pede ação de quem está na máquina, âmbar avisa que a matriz já sabe.
  const ID_TARJA = '__enviagora_tarja';
  const MOTIVOS = {
    desligada: {
      cor: '#b91c1c',
      texto: 'IMPRESSORA ENVIAGORA DESLIGADA — as etiquetas estão saindo sem ajuste.'
    },
    killswitch: {
      cor: '#b45309',
      texto: 'IMPRESSORA ENVIAGORA PAUSADA PELA CENTRAL — as etiquetas estão saindo sem ajuste, ' +
             'como vinham antes da extensão. Não precisa mexer em nada nesta máquina.'
    }
  };

  function pintarTarja(motivo) {
    const velha = document.getElementById(ID_TARJA);
    if (!motivo) { if (velha) velha.remove(); return; }
    if (!document.body) return;
    if (velha) velha.remove();

    const m = MOTIVOS[motivo];
    const t = document.createElement('div');
    t.id = ID_TARJA;
    t.textContent = m.texto;
    t.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
      'background:' + m.cor, 'color:#fff', 'font:700 13px/1.4 Arial,Helvetica,sans-serif',
      'padding:8px 12px', 'text-align:center', 'letter-spacing:.2px',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(t);
  }

  if (window.top === window) {
    const olhar = () => {
      try {
        chrome.storage.sync.get({ enabled: true }, (sync) => {
          if (sync && sync.enabled === false) return pintarTarja('desligada');
          chrome.storage.local.get({ configRemoto: null }, (loc) => {
            const kill = Boolean(loc && loc.configRemoto && loc.configRemoto.killSwitch);
            pintarTarja(kill ? 'killswitch' : null);
          });
        });
      } catch (e) {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', olhar, { once: true });
    } else { olhar(); }
    try {
      chrome.storage.onChanged.addListener((m, area) => {
        if ((area === 'sync' && m.enabled) || (area === 'local' && m.configRemoto)) olhar();
      });
    } catch (e) {}
  }

  // ── 2) página do WMS: memoriza o operador e atende o hook ────────────────
  try {
    const span = document.querySelector('span.d-none.d-md-inline.ml-2');
    const nome = span && span.textContent.trim();
    if (nome) chrome.runtime.sendMessage({ action: 'saveOperator', operatorName: nome });
  } catch (e) {}

  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (!d || d.__enviagora !== 'processar' || ev.source !== window) return;
    const saida = await ajustar(d.b64);
    window.postMessage({ __enviagora: 'pronto', token: d.token, url: d.url, b64: saida }, '*');
  });
})();
