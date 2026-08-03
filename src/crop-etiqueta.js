/* crop-etiqueta.js v16.32 — IMPRESSORA ENVIAGORA
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Até a v16.31 a transportadora era adivinhada pela QUANTIDADE DE PÁGINAS do PDF:
 *   "A4 com mais de uma página = Amazon; A4 com uma página = Shopee".
 * Só que etiqueta da Amazon sem a lista de postagem anexa vem com UMA página. Ela caía
 * no ramo do Shopee e era recortada em bottom:398 — a metade de cima da folha, que na
 * Amazon está em branco. Era isso que fazia "umas saírem certas e outras não".
 *
 * E existe mais de um layout: tem etiqueta que vem no quadrante de baixo (matriz
 * identidade) e tem etiqueta que vem no quadrante de cima, com marcas de corte
 * tracejadas e escala levemente diferente (cm de 1.03 0 0 0.97454 0 421). Nenhum
 * retângulo fixo cobre as duas.
 *
 * COMO ISTO RESOLVE
 * O que não muda entre as variantes é estrutural: a etiqueta é sempre desenhada dentro
 * de um Form XObject com BBox de 4x6 polegadas (288 x 432 pt). O que muda é só a matriz
 * que cola esse bloco na página. Então: percorre o content stream rastreando q / Q / cm,
 * desce recursivamente em cada Do, acha o XObject 4x6 e transforma os 4 cantos dele pela
 * CTM acumulada. O bounding box dos cantos é o recorte exato, seja qual for o layout.
 *
 * Validado em 5 etiquetas reais (ver tests/). Roda em pdf-lib puro: serve tanto no
 * service worker (Nível 1) quanto no motor da página (Nível 2).
 */
(function (glob) {
  'use strict';

  const ALVO_W = 288;    // 4 pol
  const ALVO_H = 432;    // 6 pol
  const TOL = 0.06;      // 6% — cobre a variante 296.64 x 421
  const PROF_MAX = 8;    // trava contra PDF malformado / referência circular

  // Matrizes PDF [a b c d e f]. O cm multiplica PELA ESQUERDA: nova = cm x atual.
  function mul(m, n) {
    return [
      m[0] * n[0] + m[1] * n[2],
      m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2],
      m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4],
      m[4] * n[1] + m[5] * n[3] + n[5]
    ];
  }

  function aplica(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  // Converte os bytes do stream em texto latin-1 para o scanner.
  function paraTexto(bytes) {
    let s = '';
    const N = 8192;
    for (let i = 0; i < bytes.length; i += N) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + N));
    }
    return s;
  }

  // Bytes de um stream do pdf-lib, seja ele cru (comprimido) ou já montado.
  function bytesDoStream(obj) {
    if (!obj) return null;
    try {
      if (obj instanceof PDFLib.PDFRawStream) {
        return PDFLib.decodePDFRawStream(obj).decode();
      }
      if (typeof obj.getContents === 'function') return obj.getContents();
    } catch (e) { /* stream ilegível: segue sem ele */ }
    return null;
  }

  // Concatena o(s) content stream(s) de um nó de página.
  function conteudoDaPagina(contexto, node) {
    let ref;
    try { ref = node.get(PDFLib.PDFName.of('Contents')); } catch (e) { return null; }
    if (!ref) return null;
    const alvo = contexto.lookup(ref);
    if (!alvo) return null;

    if (alvo instanceof PDFLib.PDFArray) {
      const partes = [];
      for (let i = 0; i < alvo.size(); i++) {
        const b = bytesDoStream(contexto.lookup(alvo.get(i)));
        if (b) partes.push(paraTexto(b));
      }
      return partes.join('\n');
    }
    const b = bytesDoStream(alvo);
    return b ? paraTexto(b) : null;
  }

  /* Scanner do content stream.
     Anda caractere a caractere para poder PULAR strings literais (...) e hexadecimais
     <...> — sem isso, um texto que contenha "Q" ou "cm" corromperia a pilha de matrizes. */
  function varrer(contexto, texto, recursos, ctm, achados, prof) {
    if (prof > PROF_MAX || !texto) return;

    const pilha = [];
    let atual = ctm.slice();
    let nums = [];
    let nome = null;
    let i = 0;
    const n = texto.length;

    while (i < n) {
      const c = texto[i];

      if (c === '%') {                                  // comentário até o fim da linha
        while (i < n && texto[i] !== '\n' && texto[i] !== '\r') i++;
        continue;
      }
      if (c === '(') {                                  // string literal, com escapes
        let nivel = 1; i++;
        while (i < n && nivel > 0) {
          if (texto[i] === '\\') { i += 2; continue; }
          if (texto[i] === '(') nivel++;
          else if (texto[i] === ')') nivel--;
          i++;
        }
        continue;
      }
      if (c === '<' && texto[i + 1] !== '<') {           // string hexadecimal
        while (i < n && texto[i] !== '>') i++;
        i++;
        continue;
      }
      if (c === '/') {                                   // nome
        let j = i + 1;
        while (j < n && !/[\s/[\]<>(){}%]/.test(texto[j])) j++;
        nome = texto.slice(i + 1, j);
        i = j;
        continue;
      }
      if (c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) {
        let j = i;
        while (j < n && /[-+.0-9eE]/.test(texto[j])) j++;
        const v = parseFloat(texto.slice(i, j));
        if (!Number.isNaN(v)) { nums.push(v); if (nums.length > 6) nums.shift(); }
        i = j;
        continue;
      }
      if (/[A-Za-z'"*]/.test(c)) {                       // operador
        let j = i;
        while (j < n && /[A-Za-z0-9'"*]/.test(texto[j])) j++;
        const op = texto.slice(i, j);
        i = j;

        if (op === 'q') { pilha.push(atual.slice()); nums = []; }
        else if (op === 'Q') { if (pilha.length) atual = pilha.pop(); nums = []; }
        else if (op === 'cm') { if (nums.length >= 6) atual = mul(nums.slice(-6), atual); nums = []; }
        else if (op === 'Do') {
          try { visitarXObject(contexto, recursos, nome, atual, achados, prof); } catch (e) {}
          nums = []; nome = null;
        } else { nums = []; }
        continue;
      }
      i++;                                               // espaço, colchete, dicionário
    }
  }

  function visitarXObject(contexto, recursos, nome, ctm, achados, prof) {
    if (!nome || !recursos) return;
    const xoRef = recursos.get(PDFLib.PDFName.of('XObject'));
    if (!xoRef) return;
    const xo = contexto.lookup(xoRef);
    if (!xo || typeof xo.get !== 'function') return;

    const alvoRef = xo.get(PDFLib.PDFName.of(nome));
    if (!alvoRef) return;
    const obj = contexto.lookup(alvoRef);
    if (!obj || !obj.dict) return;

    const sub = obj.dict.get(PDFLib.PDFName.of('Subtype'));
    if (!sub || String(sub) !== '/Form') return;         // ignora Image XObject

    const bboxArr = contexto.lookup(obj.dict.get(PDFLib.PDFName.of('BBox')));
    if (!bboxArr || typeof bboxArr.size !== 'function' || bboxArr.size() < 4) return;
    const bb = [0, 1, 2, 3].map(k => Number(contexto.lookup(bboxArr.get(k)).asNumber
      ? contexto.lookup(bboxArr.get(k)).asNumber() : bboxArr.get(k).value()));

    let mtx = [1, 0, 0, 1, 0, 0];
    const mArr = contexto.lookup(obj.dict.get(PDFLib.PDFName.of('Matrix')));
    if (mArr && typeof mArr.size === 'function' && mArr.size() === 6) {
      mtx = [0, 1, 2, 3, 4, 5].map(k => {
        const e = contexto.lookup(mArr.get(k));
        return Number(e.asNumber ? e.asNumber() : e.value());
      });
    }

    const interno = mul(mtx, ctm);
    const larg = Math.abs(bb[2] - bb[0]);
    const alt = Math.abs(bb[3] - bb[1]);

    if (larg > 0 && alt > 0 &&
        Math.abs(larg - ALVO_W) / ALVO_W < TOL &&
        Math.abs(alt - ALVO_H) / ALVO_H < TOL) {
      const cantos = [
        aplica(interno, bb[0], bb[1]), aplica(interno, bb[2], bb[1]),
        aplica(interno, bb[2], bb[3]), aplica(interno, bb[0], bb[3])
      ];
      const xs = cantos.map(p => p[0]), ys = cantos.map(p => p[1]);
      achados.push({
        left: Math.min.apply(null, xs),
        bottom: Math.min.apply(null, ys),
        width: Math.max.apply(null, xs) - Math.min.apply(null, xs),
        height: Math.max.apply(null, ys) - Math.min.apply(null, ys)
      });
      return;                                            // achou: não desce no corpo da etiqueta
    }

    const bytes = bytesDoStream(obj);
    if (!bytes) return;
    const recInternos = contexto.lookup(obj.dict.get(PDFLib.PDFName.of('Resources'))) || recursos;
    varrer(contexto, paraTexto(bytes), recInternos, interno, achados, prof + 1);
  }

  /* Devolve { name:'Amazon', left, bottom, width, height } ou null.
     Recebe uma PDFPage do pdf-lib. Nunca lança: em qualquer erro devolve null e o
     chamador segue com as regras antigas. */
  function detectarEtiqueta(page) {
    try {
      const contexto = page.doc.context;
      const node = page.node;
      const texto = conteudoDaPagina(contexto, node);
      if (!texto) return null;

      const recursos = contexto.lookup(node.get(PDFLib.PDFName.of('Resources')));
      if (!recursos) return null;

      const achados = [];
      varrer(contexto, texto, recursos, [1, 0, 0, 1, 0, 0], achados, 0);
      if (!achados.length) return null;

      // Se houver mais de um bloco 4x6 na folha (sheet 2-up), fica com o maior.
      achados.sort((a, b) => (b.width * b.height) - (a.width * a.height));
      const r = achados[0];

      const tam = page.getSize();
      if (r.width < 20 || r.height < 20) return null;
      if (r.width > tam.width * 1.05 || r.height > tam.height * 1.05) return null;

      /* GUARDA DE AREA — v16.32.1, aprendida quebrando os Correios.
         A tolerancia de 6% sobre 288x432 (4x6 pol) tambem alcanca 283x425 pt, que e
         100x150 mm: o tamanho exato da etiqueta dos Correios. Numa etiqueta dos Correios
         que ja vem no tamanho final, o "bloco 4x6" encontrado E a pagina inteira — e
         devolver isso como Amazon fazia o fluxo PULAR o recorte dos Correios.
         Este detector so faz sentido quando ha uma etiqueta PEQUENA dentro de uma folha
         MAIOR. Se o bloco ocupa quase toda a pagina nao ha o que recortar: devolve null
         e o caminho antigo assume. */
      const fracao = (r.width * r.height) / (tam.width * tam.height);
      if (fracao > 0.70) return null;

      // geo:true avisa quem chamou que este palpite veio da geometria e pode ser
      // derrubado por um sinal mais especifico — o texto dos Correios.
      return { name: 'Amazon', geo: true, left: r.left, bottom: r.bottom, width: r.width, height: r.height };
    } catch (e) {
      return null;
    }
  }

  glob.EnviagoraCrop = { detectarEtiqueta: detectarEtiqueta, _mul: mul, _aplica: aplica };
})(typeof self !== 'undefined' ? self : this);
