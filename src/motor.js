// motor.js v16.30 — MOTOR DA ETIQUETA como content script injetado sob demanda.
//
// Por que assim: o iframe da extensão (worker.html) NÃO sobe no Stokki — a política de
// segurança do site bloqueia. Já um content script injetado por chrome.scripting roda no
// MUNDO ISOLADO da extensão e ignora a CSP da página. Ele tem DOM (canvas) e chrome.runtime.
// É o que permite o recorte dos Correios e a reconstrução do código de barras em QUALQUER site.
//
// O background injeta pdf.min.js + pdf-lib + crop-etiqueta + config-padrao + labeler +
// este arquivo (MOTOR_ARQUIVOS), e depois manda a etiqueta por chrome.tabs.sendMessage.
(function () {
  if (window.__enviagoraMotor) return;
  window.__enviagoraMotor = true;

  // O pdf.js quer um Worker. A CSP do site pode barrar worker vindo de chrome-extension://,
  // então preparamos o worker como blob da própria página (caminho mais compatível) e, se
  // nem isso passar, caímos na URL da extensão. Se os dois falharem, o pdf.js roda sem
  // worker (mais lento, mas funciona) — e, no pior caso, o background faz o ajuste padrão.
  const workerPronto = (async () => {
    const urlExt = chrome.runtime.getURL('lib/pdf.worker.min.js');
    try {
      const txt = await (await fetch(urlExt)).text();
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
    } catch (e) {
      try { pdfjsLib.GlobalWorkerOptions.workerSrc = urlExt; } catch (e2) {}
    }
  })();

  // v16.34: o PADRAO local saiu daqui — era copia incompleta dos padroes do background.
  // Agora vem de config-padrao.js, que o background injeta junto neste content script.

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function bytesToB64(a) {
    let s = ''; const C = 8192;
    for (let i = 0; i < a.length; i += C) s += String.fromCharCode(...a.subarray(i, i + C));
    return btoa(s);
  }

  // Fila: uma etiqueta por vez. Quando o WMS solta duas coladas (etiqueta + declaração),
  // elas chegavam juntas e disputavam o mesmo canvas do pdf.js — o segundo saía torto.
  let fila = Promise.resolve();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'motorPing') { sendResponse({ ok: true }); return; }
    if (!msg || msg.action !== 'motorProcessar') return;

    fila = fila.then(async () => {
      const t0 = Date.now();
      try {
        await workerPronto;
        const { s } = await window.EnviagoraConfig.carregar();
        const { bytes, info } = await window.EnviagoraLabeler.processar(
          b64ToBytes(msg.base64), s, msg.operatorName || null);
        console.log('[Enviagora] motor: ' + (Date.now() - t0) + 'ms — ' + info);
        sendResponse({ b64: bytes ? bytesToB64(bytes) : null, info });
      } catch (e) {
        console.error('[Enviagora] motor falhou:', e);
        sendResponse({ b64: null, info: 'erro: ' + e.message });
      }
    }).catch(() => {});

    return true;
  });

  console.log('[Enviagora] motor pronto nesta página.');
})();
