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

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Caixa-preta. Este arquivo roda no MUNDO MAIN e nao alcanca chrome.storage, entao
     manda o evento para o content.js, que repassa ao background. Dispara e esquece:
     nenhum passo da impressao espera por isto, e qualquer falha aqui e engolida. */
  function logar(tipo, dados) {
    try { window.postMessage({ __enviagora: 'log', tipo, dados: dados || {} }, '*'); } catch (e) {}
  }

  /* ASSENTAMENTO — a correção do "Falha ao imprimir".
   *
   * O evento `load` do iframe avisa que o DOCUMENTO carregou, e não que o visualizador
   * de PDF do Chrome (PDFium) já consegue imprimir. Chamando print() no instante do load,
   * o preview às vezes não acha documento nenhum e o Chrome mostra:
   *   "Falha ao imprimir — Ocorreu um erro durante a impressão."
   * Intermitente de propósito: depende da velocidade da máquina e do tamanho do PDF.
   *
   * O viewer.js já esperava 300 ms depois do load antes de imprimir — e é justamente o
   * caminho que nunca deu esse erro. Aqui não havia espera nenhuma.
   *
   * O valor vem do config remoto (printSettleMs), então dá para subir em todas as
   * máquinas em 1 hora, sem publicar versão nova, se alguma continuar falhando. O
   * content.js entrega o valor por postMessage: este arquivo roda no MUNDO MAIN e não
   * enxerga chrome.storage. */
  let assentamentoMs = 400;
  let afterprintSintetico = true;
  let bloquearPrintDaTela = true;
  let bloquearEcoDePrint = true;

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d) return;

    if (d.__enviagora === 'config' && ev.source === window) {
      if (Number.isFinite(d.printSettleMs)) assentamentoMs = d.printSettleMs;
      if (typeof d.afterprintSintetico === 'boolean') afterprintSintetico = d.afterprintSintetico;
      if (typeof d.bloquearPrintDaTela === 'boolean') bloquearPrintDaTela = d.bloquearPrintDaTela;
      if (typeof d.bloquearEcoDePrint === 'boolean') bloquearEcoDePrint = d.bloquearEcoDePrint;
      return;
    }
    // Eco vindo de um frame filho: ele acabou de disparar o afterprint sintetico aqui.
    if (d.__enviagora === 'eco-afterprint') ultimoAfterprintSintetico = Date.now();
  });

  /* Marca de quando disparamos o afterprint sintetico.
   *
   * O PROBLEMA QUE ISSO RESOLVE
   * Saía uma folha inteira PRETA junto com a etiqueta certa. Era a TELA do WMS sendo
   * impressa: `window.print()` numa página que não é PDF manda a página inteira para a
   * impressora, e uma interface escura vira um retângulo preto.
   *
   * O gatilho é nosso: para destravar a tela depois de imprimir, disparamos um `afterprint`
   * sintético. Se o fluxo do WMS escuta esse evento e responde chamando print() de novo,
   * ele imprime a si mesmo — e a extensão desligada não tem esse comportamento, que é
   * exatamente o que a operação relatou.
   *
   * Aqui guardamos o instante do disparo. Um print() da PÁGINA logo depois dele é eco
   * nosso, e não pedido de ninguém: ignoramos e avisamos no console. */
  let ultimoAfterprintSintetico = 0;
  const JANELA_ECO_MS = 3000;

  /* GUARDA DE ECO DE IMPRESSAO — achada pelo diagnostico de producao.
   *
   * O QUE O DADO MOSTROU
   *   print-chamado    assentamento=400 ms=2    <- imprime a etiqueta ajustada
   *   print-pedido     temAjuste=false          <- 15 ms depois, OUTRO print
   *   print-chamado    ms=1                     <- imprime NA HORA, sem assentamento
   *
   * Um segundo print() chega logo depois do primeiro, no MESMO iframe, sem ajuste
   * registrado — e por isso pula o assentamento inteiro e cai em cima do preview que
   * acabou de abrir. Dois previews ao mesmo tempo o Chrome nao faz: o segundo morre com
   * "Falha ao imprimir".
   *
   * A fila que ja existia nao protegia disto. Ela espera a FUNCAO terminar, e a funcao
   * termina assim que print() retorna — que, agora sabemos, e instantaneo.
   *
   * Condicao deliberadamente estreita: so pega pedido SEM ajuste proprio (temAjuste
   * false) e dentro da janela. Um segundo documento de verdade — a declaracao, por
   * exemplo — cria o proprio blob, chega com temAjuste true e passa batido por aqui. */
  let ultimoPrint = 0;
  const JANELA_ECO_PRINT_MS = 1500;

  /* FILA — uma impressão por vez.
   *
   * O WMS solta etiqueta e declaração praticamente juntas. Como imprimirAjustado é
   * assíncrono, duas chamadas se sobrepunham: a segunda trocava o src do MESMO iframe
   * enquanto o preview da primeira ainda estava abrindo, e o preview morria sem
   * documento. O motor.js já serializava o processamento; faltava serializar a impressão. */
  let fila = Promise.resolve();

  function imprimirAjustado(iframe, janelaOriginal) {
    fila = fila.then(() => imprimirAgora(iframe, janelaOriginal)).catch((e) => {
      console.warn('[Enviagora] impressão falhou:', e && e.message);
      logar('print-erro', { erro: e && e.message });
    });
    return fila;
  }

  async function imprimirAgora(iframe, janelaOriginal) {
    let alvo = janelaOriginal;
    try {
      const src = String(iframe.src || '');
      const reg = pendentes.get(src);
      const desdeUltimoPrint = Date.now() - ultimoPrint;
      logar('print-pedido', { temAjuste: Boolean(reg), desdeUltimoPrint });

      if (!reg && bloquearEcoDePrint && desdeUltimoPrint < JANELA_ECO_PRINT_MS) {
        console.warn('[Enviagora] ignorei um segundo print() ' + desdeUltimoPrint +
                     'ms depois do anterior, sem ajuste proprio. Ele cairia em cima do ' +
                     'preview que acabou de abrir — e e assim que aparece o "Falha ao ' +
                     'imprimir". Se alguma etiqueta parar de sair, desligue ' +
                     'bloquearEcoDePrint no config remoto.');
        logar('print-eco-bloqueado', { desdeUltimoPrint });
        return;
      }

      if (reg) {
        const tAjuste = Date.now();
        const nova = await reg.promessa;           // espera o ajuste (teto de 8s)
        logar('print-ajuste', { ms: Date.now() - tAjuste, ok: Boolean(nova) });
        if (nova) {
          const tLoad = Date.now();
          const comoTerminou = await new Promise((resolve) => {
            let feito = false;
            const ok = (motivo) => { if (!feito) { feito = true; resolve(motivo); } };
            iframe.addEventListener('load', () => ok('load'), { once: true });
            setTimeout(() => ok('timeout'), 4000);
            iframe.src = nova;                     // troca o PDF NO MESMO IFRAME
          });
          // 'timeout' aqui significa que o PDF nao terminou de carregar em 4 s. E o caso
          // em que o print() tem mais chance de falhar — vale saber com que frequencia
          // acontece nas maquinas de verdade.
          logar('print-carregou', { ms: Date.now() - tLoad, via: comoTerminou });

          // Deixa o visualizador de PDF terminar de subir antes de mandar imprimir.
          await dormir(assentamentoMs);

          // O site pode ter mexido no iframe enquanto esperávamos. Imprimir um iframe
          // que saiu da página, ou que já aponta para outra coisa, é a mesma tela de
          // "Falha ao imprimir" — só que aí a culpa não é do assentamento.
          if (!iframe.isConnected) {
            console.warn('[Enviagora] o iframe saiu da página antes de imprimir — desistindo.');
            logar('print-iframe-sumiu', {});
            return;
          }
          if (String(iframe.src || '') !== nova) {
            console.warn('[Enviagora] o site trocou o PDF do iframe no meio do caminho — ' +
                         'imprimindo o que está lá agora.');
            logar('print-src-trocado', {});
          }

          try { alvo = descCW.get.call(iframe); } catch (e) {}
          if (!alvo) {
            console.warn('[Enviagora] iframe sem janela após a troca — desistindo.');
            return;
          }
          console.log('[Enviagora] etiqueta ajustada — imprimindo a versão nova (assentamento ' +
                      assentamentoMs + 'ms).');
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
    const tPrint = Date.now();
    try {
      alvo.print();
      // NAO tire conclusao do 'ms' aqui. Eu supunha que print() so retornasse quando o
      // dialogo fechasse, e que um retorno instantaneo denunciasse falha. O diagnostico
      // de producao derrubou isso: impressoes que deram certo registraram ms=0, 1 e 2.
      // Neste contexto print() retorna na hora. O 'ms' fica so como referencia.
      ultimoPrint = Date.now();
      logar('print-chamado', { ms: Date.now() - tPrint, assentamento: assentamentoMs });
    } catch (e) {
      console.warn('[Enviagora] print falhou:', e && e.message);
      logar('print-excecao', { erro: e && e.message, assentamento: assentamentoMs });
    }

    // Devolve o foco para a pagina e avisa o site que a impressao terminou. Muitos fluxos
    // (inclusive o do Stokki) continuam a partir do afterprint — e ele nao dispara na
    // janela principal quando quem imprimiu foi o iframe.
    const retomar = () => {
      try { window.focus(); } catch (e) {}
      try {
        if (focoAnterior && typeof focoAnterior.focus === 'function') focoAnterior.focus();
        else if (document.body && document.body.focus) document.body.focus();
      } catch (e) {}
      // Desligavel pelo config remoto: se este afterprint for mesmo o que faz o WMS
      // imprimir a tela, da para conferir em producao numa hora, sem publicar versao.
      // Desligando, o efeito colateral conhecido e a tela do WMS voltar a ficar "travada"
      // ate o operador clicar em algum lugar — foi o bug que ele veio corrigir.
      if (!afterprintSintetico) return;

      ultimoAfterprintSintetico = Date.now();
      try { window.dispatchEvent(new Event('afterprint')); } catch (e) {}
      try {
        if (window.top && window.top !== window) {
          window.top.focus();
          window.top.dispatchEvent(new Event('afterprint'));
          // O frame de cima tem a propria copia deste script e a propria marca de tempo.
          window.top.postMessage({ __enviagora: 'eco-afterprint' }, '*');
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
      if (reg) {
        logar('print-doc-pedido', {});
        reg.promessa.then((nova) => {
          logar('print-doc-ajuste', { ok: Boolean(nova) });
          if (nova) location.replace(nova); else origPrint();
        });
        return;
      }

      // Chegou aqui: este documento NAO e um PDF nosso. Imprimir significa mandar a
      // PAGINA INTEIRA para a impressora — a tela do WMS, que sai como um bloco preto na
      // etiqueta. Se veio logo depois do nosso afterprint sintetico, o pedido e eco nosso.
      const desdeOEco = Date.now() - ultimoAfterprintSintetico;
      if (bloquearPrintDaTela && desdeOEco < JANELA_ECO_MS) {
        console.warn('[Enviagora] ignorei um print() da PAGINA disparado ' + desdeOEco +
                     'ms depois do nosso afterprint. Isso imprimiria a TELA, nao a etiqueta. ' +
                     'Se alguma impressao legitima estiver sumindo, desligue ' +
                     'bloquearPrintDaTela no config remoto.');
        logar('print-tela-bloqueado', { desdeOEco });
        return;
      }
      logar('print-pagina', { desdeOEco });
      return origPrint();
    };
  }

  /* REDE DE SEGURANCA DO DIAGNOSTICO (v16.36.4)
   *
   * O log de uma falha real veio com DUAS etiquetas ajustadas (crop-ok) e ZERO eventos de
   * impressao. Ou seja: a impressao aconteceu por um caminho que a extensao nao intercepta,
   * e nos so descobrimos isso pela AUSENCIA de linhas — o pior jeito possivel de descobrir.
   *
   * `beforeprint` dispara sempre que ESTE frame vai para a impressora, tenha sido a
   * extensao quem pediu ou nao (Ctrl+P, botao do site, script de dentro da pagina). Nao
   * cobre o frame do visualizador de PDF do Chrome, onde nenhum script nosso roda — mas
   * cobre a janela do WMS, que e onde a folha preta nasce.
   *
   * Registrar aqui separa duas hipoteses que hoje se confundem: "o print nunca aconteceu"
   * e "o print aconteceu sem passar por nos". */
  try {
    window.addEventListener('beforeprint', () => {
      logar('print-beforeprint', {
        topo: window.top === window,
        desdeUltimoPrint: ultimoPrint ? Date.now() - ultimoPrint : -1
      });
    });
  } catch (e) { /* nunca quebra a pagina */ }
})();
