/* labeler.js v16.30 — TODA a lógica da etiqueta, rodando numa página normal
   (viewer.html), com pdf.js e pdf-lib carregados ali mesmo.
   Sem service worker, sem documento offscreen, sem troca de mensagens — foi
   justamente o offscreen que travava (cropPdf estourava 15s sem resposta). */
(function (glob) {
  const MM = 72 / 25.4;
  const MARCA = 'ENVIAGORA_OK';

  function mm(v) { return Number(v || 0) * MM; }

  // ── quem é quem ───────────────────────────────────────────────────────────
  // v16.33: a Amazon passou a ser achada pela GEOMETRIA (o bloco de 4x6 polegadas dentro
  // do PDF, onde quer que esteja colado na folha), e não mais pela contagem de páginas.
  // O porquê está no cabeçalho de crop-etiqueta.js. As regras antigas seguem como
  // segundo nível, intactas, para Shopee e Mercado Livre.
  function detectLabel(page, pageCount) {
    try {
      if (window.EnviagoraCrop) {
        const geo = window.EnviagoraCrop.detectarEtiqueta(page);
        if (geo) return geo;
      }
    } catch (e) { /* qualquer problema: cai nas regras antigas */ }

    const { width, height } = page.getSize();
    const a4Retrato  = width > 550 && width < 640 && height > 800;
    const a4Paisagem = width > 800 && height > 550 && height < 640;
    if (a4Retrato && pageCount > 1)   return { name: 'Amazon',        left: 0, bottom: 0,   width: 300, height: 430 };
    if (a4Retrato && pageCount === 1) return { name: 'Shopee',        left: 0, bottom: 398, width: 300, height: 444 };
    if (a4Paisagem)                   return { name: 'Mercado Livre', left: 0, bottom: 154, width: 300, height: 410 };
    return null;
  }

  const RE_RASTREIO = /\b[A-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\s?BR\b/;
  function ehTextoCorreios(t) {
    t = String(t || '');
    if (RE_RASTREIO.test(t)) return true;
    if (/correios/i.test(t)) return true;
    return /contrato/i.test(t) && /\b(sedex|pac\b|carta registrada|impresso)/i.test(t);
  }

  // ── pdf.js: texto e área realmente impressa ───────────────────────────────
  async function analisar(bytes, pageIndex, padPt) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const page = await pdf.getPage(pageIndex + 1);

    const tc = await page.getTextContent();
    const texto = tc.items.map(i => i.str).join(' ');

    const R = 2;
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const vp   = page.getViewport({ scale: R, rotation: 0 });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    const THR = 245;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] < THR || data[i + 1] < THR || data[i + 2] < THR) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { texto, page, box: null };

    const view = page.view || [0, 0, base.width, base.height];
    const x0 = view[0], y1 = view[3];
    const L = Math.max(view[0], x0 + minX / R - padPt);
    const Rr = Math.min(view[2], x0 + (maxX + 1) / R + padPt);
    const B = Math.max(view[1], y1 - (maxY + 1) / R - padPt);
    const T = Math.min(view[3], y1 - minY / R + padPt);
    return { texto, page, box: { left: L, bottom: B, width: Rr - L, height: T - B } };
  }

  // ── pdf-lib: monta a etiqueta 10x15 ───────────────────────────────────────
  async function desenhar(novoDoc, outPage, srcPage, crop, s, operador, fillFirst) {
    const W = outPage.getWidth(), H = outPage.getHeight();
    // v16.33.1: o piso de margem de impressão NUNCA se aplica aos Correios.
    // A etiqueta dos Correios precisa sair o maior possível, sem borda branca nas
    // laterais — senão o leitor dos Correios não consegue bipar o código. Quem manda ali
    // é correiosMarginMm (1 mm) junto com "preencher a largura".
    const piso = fillFirst ? 0 : Math.max(0, Math.min(10, Number(s.printSafeMarginMm || 0)));
    const margem = mm(Math.max(Number(fillFirst ? s.correiosMarginMm : s.marginMm) || 0, piso));
    const offX = mm(s.offsetXMm), offY = mm(s.offsetYMm);
    const escala = Math.max(50, Math.min(110, Number(s.safeScale || 100))) / 100;

    const fTs  = Math.max(5, Math.min(14, Number(s.timestampFontSize || 9)));
    const fHdr = Math.max(5, Math.min(14, Number(s.headerFontSize || 8)));
    const fOp  = Math.max(5, Math.min(14, Number(s.operatorNameFontSize || 9)));

    const temTs  = Boolean(s.addTimestamp) && s.timestampPosition !== 'none';
    const temHdr = Boolean(s.addHeaderText) && String(s.headerText || '').trim().length > 0;
    const temOp  = Boolean(s.addOperatorName) && Boolean(operador);

    const linhaRodape = (temTs || temOp) ? Math.max(fTs, temOp ? fOp : 0) + 3 : 0;
    const gapTopo  = (temHdr ? fHdr + 3 : 0) + (temTs && ['top','both'].includes(s.timestampPosition) ? linhaRodape : 0);
    const gapBaixo = ((temTs && ['bottom','both'].includes(s.timestampPosition)) || temOp) ? linhaRodape : 0;

    const dispW = Math.max(20, W - margem * 2);
    let dw, dh, x, y, encaixouLargura = false;

    if (fillFirst) {   // Correios: largura manda; texto usa a sobra vertical
      const dispHTot = Math.max(20, H - margem * 2);
      const e = Math.min(dispW / crop.width, dispHTot / crop.height) * escala;
      const w2 = crop.width * e, h2 = crop.height * e;
      const sobra = dispHTot - h2;
      if (sobra >= gapTopo + gapBaixo) {
        dw = w2; dh = h2;
        x = margem + (dispW - dw) / 2 + offX;
        y = margem + gapBaixo + (sobra - gapTopo - gapBaixo) / 2 + offY;
        encaixouLargura = true;
      }
    }
    if (!encaixouLargura) {
      const dispH = Math.max(20, H - margem * 2 - gapTopo - gapBaixo);
      const e = Math.min(dispW / crop.width, dispH / crop.height) * escala;
      dw = crop.width * e; dh = crop.height * e;
      x = margem + (dispW - dw) / 2 + offX;
      y = margem + gapBaixo + (dispH - dh) / 2 + offY;
    }

    const emb = await novoDoc.embedPage(srcPage, {
      left: crop.left, bottom: crop.bottom,
      right: crop.left + crop.width, top: crop.bottom + crop.height
    });
    outPage.drawPage(emb, { x, y, width: dw, height: dh });


    const font = await novoDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    const centro = (txt, size) => Math.max(margem, (W - font.widthOfTextAtSize(txt, size)) / 2);

    if (temHdr) {
      const t = String(s.headerText).trim();
      outPage.drawText(t, { x: centro(t, fHdr), y: H - margem - fHdr, size: fHdr, font });
    }
    const agora = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const dataTxt = temTs ? `${s.timestampText || 'DDI:'} ${p2(agora.getDate())}/${p2(agora.getMonth()+1)}/${agora.getFullYear()} ${p2(agora.getHours())}:${p2(agora.getMinutes())}:${p2(agora.getSeconds())}` : '';
    const opTxt = temOp ? `OPERADOR: ${operador}` : '';
    const rodape = [dataTxt, opTxt].filter(Boolean).join('   |   ');
    if (rodape && ((temTs && ['bottom','both'].includes(s.timestampPosition)) || temOp)) {
      outPage.drawText(rodape, { x: centro(rodape, fTs), y: margem + 3, size: fTs, font });
    }
    if (temTs && ['top','both'].includes(s.timestampPosition)) {
      outPage.drawText(dataTxt, { x: centro(dataTxt, fTs), y: H - margem - fTs - (temHdr ? fHdr + 3 : 0), size: fTs, font });
    }
  }

  // ── pipeline completo ─────────────────────────────────────────────────────
  // Devolve { bytes, info } — bytes = null quando não há nada a fazer.
  async function processar(bytes, s, operador) {
    if (!s.enabled) return { bytes: null, info: 'extensão desligada' };
    // KILL SWITCH central (config remoto). Devolver bytes:null faz o chamador imprimir o
    // PDF original — é o freio de emergência para quando um ajuste quebra a operação.
    if (s.killSwitch) return { bytes: null, info: 'kill switch ligado (config remoto)' };

    const doc = await PDFLib.PDFDocument.load(bytes.buffer ? bytes.buffer : bytes, { ignoreEncryption: true });
    try {
      const kw = doc.getKeywords();
      if (kw && String(kw).includes(MARCA)) return { bytes: null, info: 'PDF já ajustado antes' };
    } catch (e) {}

    const pages = doc.getPages();
    if (!pages.length) return { bytes: null, info: 'PDF sem páginas' };

    const novo = await PDFLib.PDFDocument.create();
    const W = mm(s.outputWidthMm), H = mm(s.outputHeightMm);
    const indices = s.batchMode ? pages.map((_, i) => i) : [0];
    const notas = [];

    for (const i of indices) {
      const src = pages[i];
      const tam = src.getSize();
      const detectada = detectLabel(src, pages.length);

      let crop = detectada || { name: 'Desconhecido', left: 0, bottom: 0, width: tam.width, height: tam.height };
      let correios = false;

      // v16.33.1: quando o palpite veio da GEOMETRIA (detectada.geo), o teste dos
      // Correios ainda roda e pode derrubá-lo. O texto ("Contrato:", "SEDEX", código
      // AA999999999BR) é um sinal muito mais específico do que "existe um bloco de
      // 4x6 polegadas nesta folha". Amazon detectada pela regra antiga (contagem de
      // páginas) continua fora do caminho dos Correios, como sempre esteve.
      const podeCorreios = s.correiosFit &&
        detectada?.name !== 'Mercado Livre' &&
        (detectada?.geo === true || detectada?.name !== 'Amazon');

      if (podeCorreios) {
        try {
          const { texto, box } = await analisar(bytes, i, mm(s.correiosPadMm));

          const marcaShopee = /shopee|SHP:/i.test(texto || '');
          const ehCorreios = (ehTextoCorreios(texto) && !(detectada && marcaShopee)) ||
                             (!detectada && s.correiosScope === 'unknown');
          if (ehCorreios && box &&
              box.width > tam.width * 0.15 && box.height > tam.height * 0.15) {
            crop = { name: 'Correios', ...box };
            correios = true;
          }
          notas.push('pág ' + (i + 1) + ': ' + (correios ? 'CORREIOS (recortada)' : (detectada?.name || 'desconhecida')));
        } catch (e) {
          notas.push('pág ' + (i + 1) + ': falha ao analisar (' + e.message + ')');
        }
      } else {
        notas.push('pág ' + (i + 1) + ': ' + (detectada?.name || 'desconhecida'));
      }

      if (!detectada && !correios && !s.processUnknownPdfs) continue;

      const outPage = novo.addPage([W, H]);
      await desenhar(novo, outPage, src, crop, s, operador, correios && s.correiosFillFirst);
    }

    if (novo.getPageCount() === 0) return { bytes: null, info: 'nada a processar' };

    // v16.33 — preferências de impressão gravadas no PDF. Ver a nota longa em
    // background.js: o seletor de escala do Chrome não é acessível por extensão; o que
    // resolve de verdade é entregar um PDF que sai igual em qualquer opção.
    try {
      const vp = novo.catalog.getOrCreateViewerPreferences();
      if (PDFLib.PrintScaling) {
        vp.setPrintScaling(String(s.printScaling) === 'appdefault'
          ? PDFLib.PrintScaling.AppDefault : PDFLib.PrintScaling.None);
      }
      if (s.pickTrayByPdfSize !== false && typeof vp.setPickTrayByPDFSize === 'function') {
        vp.setPickTrayByPDFSize(true);
      }
    } catch (e) {}
    try {
      for (const p of novo.getPages()) {
        const { width, height } = p.getSize();
        p.setMediaBox(0, 0, width, height);
        p.setCropBox(0, 0, width, height);
        if (typeof p.setTrimBox === 'function') p.setTrimBox(0, 0, width, height);
        if (typeof p.setBleedBox === 'function') p.setBleedBox(0, 0, width, height);
      }
    } catch (e) {}

    try {
      novo.setKeywords([MARCA]);
      novo.setProducer('IMPRESSORA ENVIAGORA v' + chrome.runtime.getManifest().version);
    } catch (e) {}
    return { bytes: await novo.save(), info: notas.join(' | ') };
  }

  glob.EnviagoraLabeler = { processar, detectLabel, ehTextoCorreios };
})(window);
