// hook.js v16.31 — roda no MUNDO PRINCIPAL da página (world: MAIN), em todos os frames.
//
// O QUE ELE RESOLVE
//  a) O Stokki cria o PDF como blob e REVOGA a URL logo depois. Ler o PDF mais tarde
//     falha ("Failed to fetch"). Aqui capturamos os bytes no momento da CRIAÇÃO do blob.
//  b) O PDF pode ser um blob de origem opaca (blob:null), que content script nenhum lê.
//
// O QUE ELE NÃO FAZ MAIS (e por que)
//  Na v16.27/16.28 eu SEGURAVA o src do iframe até o ajuste ficar pronto. Só que o site
//  chama print() num tempo fixo depois de setar o src — com o iframe ainda vazio, não
//  imprimia NADA (foi o que aconteceu com a etiqueta dos Correios).
//  Agora deixamos o iframe carregar normalmente e, em vez disso, INTERCEPTAMOS o print():
//  ele espera o ajuste, troca o PDF no iframe, e só então imprime. Se o ajuste demorar
//  demais, imprime o original — melhor cru do que não sair.
(function () {
  if (window.__enviagoraHook) return;
  window.__enviagoraHook = true;

  const TETO_MS = 8000;
  const origCreate = URL.createObjectURL.bind(URL);
  const pendentes = new Map();   // url do blob -> { promessa, resolvida, novaUrl }

  function bytesToB64(a) {
    let s = ''; const C = 8192;
    for (let i = 0; i < a.length; i += C) s += String.fromCharCode.apply(null, a.subarray(i, i + C));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  // ── 1. captura o Blob do PDF na criação (antes de o site revogar) ─────────
  URL.createObjectURL = function (obj) {
    const url = origCreate(obj);
    try {
      const ehPdf = obj instanceof Blob &&
        (obj.type === 'application/pdf' || obj.type === '' || obj.type === 'application/octet-stream');
      if (!ehPdf) return url;

      const registro = { novaUrl: null, pronta: false };
      registro.promessa = new Promise((resolve) => {
        const prazo = setTimeout(() => { registro.pronta = true; resolve(null); }, TETO_MS);
        obj.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
            clearTimeout(prazo); registro.pronta = true; return resolve(null);
          }
          const token = 'eg_' + Math.random().toString(36).slice(2);
          const ouvir = (ev) => {
            const d = ev.data;
            if (!d || d.__enviagora !== 'pronto' || d.token !== token) return;
            window.removeEventListener('message', ouvir);
            clearTimeout(prazo);
            registro.pronta = true;
            if (!d.b64) return resolve(null);
            try {
              registro.novaUrl = origCreate(new Blob([b64ToBytes(d.b64)], { type: 'application/pdf' }));
              resolve(registro.novaUrl);
            } catch (e) { resolve(null); }
          };
          window.addEventListener('message', ouvir);
          window.postMessage({ __enviagora: 'processar', token, url, b64: bytesToB64(bytes) }, '*');
        }).catch(() => { clearTimeout(prazo); registro.pronta = true; resolve(null); });
      });
      pendentes.set(url, registro);
    } catch (e) { /* nunca quebra a página */ }
    return url;
  };

  // ── 2. print() do iframe: espera o ajuste, troca o PDF, aí imprime ────────
  const descCW = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');

  async function imprimirAjustado(iframe, janelaOriginal) {
    let alvo = janelaOriginal;
    try {
      const src = String(iframe.src || '');
      const reg = pendentes.get(src);
      if (reg) {
        const nova = await reg.promessa;           // espera o ajuste (teto de 12s)
        if (nova) {
          await new Promise((resolve) => {
            let feito = false;
            const ok = () => { if (!feito) { feito = true; resolve(); } };
            iframe.addEventListener('load', ok, { once: true });
            setTimeout(ok, 4000);
            iframe.src = nova;                     // troca o PDF NO MESMO IFRAME
          });
          try { alvo = descCW.get.call(iframe); } catch (e) {}
          console.log('[Enviagora] etiqueta ajustada — imprimindo a versão nova.');
        } else {
          console.warn('[Enviagora] sem ajuste a tempo — imprimindo o original.');
        }
      }
    } catch (e) {
      console.warn('[Enviagora] problema ao trocar a etiqueta:', e && e.message);
    }
    // Guarda quem estava com o foco, para devolver depois. Sem isso a tela do WMS ficava
    // "travada" ate o operador clicar em algum lugar: o foco ficava preso no iframe do PDF
    // e o site so retomava o fluxo ao receber uma nova interacao.
    let focoAnterior = null;
    try { focoAnterior = document.activeElement; } catch (e) {}

    try { alvo.focus(); } catch (e) {}
    try { alvo.print(); } catch (e) { console.warn('[Enviagora] print falhou:', e && e.message); }

    // Devolve o foco para a pagina e avisa o site que a impressao terminou. Muitos fluxos
    // (inclusive o do Stokki) continuam a partir do afterprint — e ele nao dispara na
    // janela principal quando quem imprimiu foi o iframe.
    const retomar = () => {
      try { window.focus(); } catch (e) {}
      try {
        if (focoAnterior && typeof focoAnterior.focus === 'function') focoAnterior.focus();
        else if (document.body && document.body.focus) document.body.focus();
      } catch (e) {}
      try { window.dispatchEvent(new Event('afterprint')); } catch (e) {}
      try {
        if (window.top && window.top !== window) {
          window.top.focus();
          window.top.dispatchEvent(new Event('afterprint'));
        }
      } catch (e) {}
    };
    setTimeout(retomar, 0);
    setTimeout(retomar, 400);   // o dialogo de impressao pode roubar o foco de novo
  }

  if (descCW && descCW.get) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      enumerable: descCW.enumerable,
      get: function () {
        const w = descCW.get.call(this);
        if (!w) return w;
        const iframe = this;
        try {
          return new Proxy(w, {
            get(alvo, prop) {
              if (prop === 'print') {
                return function () { imprimirAjustado(iframe, alvo); };
              }
              const v = alvo[prop];
              return (typeof v === 'function') ? v.bind(alvo) : v;
            },
            set(alvo, prop, valor) { alvo[prop] = valor; return true; }
          });
        } catch (e) { return w; }
      }
    });
  }

  // ── 3. o próprio documento é o PDF (aba/janela): troca e imprime ──────────
  const origPrint = window.print ? window.print.bind(window) : null;
  if (origPrint) {
    window.print = function () {
      const reg = pendentes.get(String(location.href));
      if (!reg) return origPrint();
      reg.promessa.then((nova) => {
        if (nova) location.replace(nova); else origPrint();
      });
    };
  }
})();
