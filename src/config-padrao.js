/* config-padrao.js v16.34 — IMPRESSORA ENVIAGORA
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Ate a v16.33 os padroes viviam copiados em CINCO lugares: DEFAULT_SETTINGS no
 * background.js (o unico completo), no popup.js, e PADRAO no motor.js, viewer.js e
 * worker.js. Os tres ultimos nem tinham printSafeMarginMm nem printScaling. Nao quebrava
 * porque o onInstalled gravava todos os campos no storage, entao o get(PADRAO) sempre
 * achava valor — mas qualquer campo novo nascia divergente. Agora e aqui, e so aqui.
 *
 * ELE TAMBEM E O CONTRATO DO CONFIG REMOTO
 * O ESQUEMA abaixo diz, campo a campo, qual e o tipo e a faixa valida. E o que permite
 * confiar num JSON baixado da internet: nada entra sem passar por validarCampo().
 *
 * REGRA DE OURO: se a busca do config remoto falhar, se o JSON vier quebrado, ou se um
 * campo vier fora da faixa, vale o PADRAO embutido. GitHub fora do ar NUNCA pode parar a
 * impressao das 60 maquinas.
 *
 * Roda em tres contextos: service worker (importScripts), content script (motor.js) e
 * pagina da extensao (viewer.html, popup.html). Por isso e IIFE em global, sem modulo.
 */
(function (glob) {
  'use strict';

  // Endereco do config remoto. O Pages e publico por necessidade: o Chrome NAO autentica
  // ao consultar update_url nem ao buscar este arquivo. Ver docs/ARQUITETURA.md.
  const URL_CONFIG = 'https://enviagora.github.io/impressora-enviagora/config/defaults.json';

  // Versao do formato das configuracoes gravadas na maquina. Sobe quando a forma de
  // guardar muda (nao quando um valor muda). 1634 = storage passou a guardar so o delta.
  const SCHEMA_VERSION = 1634;

  const INTERVALO_MIN = 60;      // de quanto em quanto tempo rebusca o config
  const TIMEOUT_MS = 10000;      // teto da busca; estourou, fica com o cache

  /* ── PADRAO EMBUTIDO ──────────────────────────────────────────────────────
     Valores IDENTICOS aos da v16.33. Nenhum foi ajustado nesta unificacao —
     tests/config.test.mjs trava isso contra a tabela da v16.33. */
  const PADRAO = {
    settingsSchemaVersion: SCHEMA_VERSION,
    enabled: true,
    // trava por senha
    lockEnabled: true,
    // preferencias gravadas no PDF de saida
    printScaling: 'none',        // 'none' = tamanho real | 'appdefault' = visualizador decide
    pickTrayByPdfSize: true,     // pede a bandeja/papel do tamanho do PDF
    printSafeMarginMm: 0,        // piso de margem opcional (0 = comportamento da v16.31)
    // Espera, em ms, entre o PDF carregar e o print() ser chamado. Ver o comentario
    // "ASSENTAMENTO" em hook.js: sem essa pausa o Chrome as vezes abre o dialogo e
    // devolve "Falha ao imprimir". Se alguma maquina continuar falhando, subir aqui
    // resolve em 1 hora, sem publicar versao nova.
    printSettleMs: 400,
    // Disparar o afterprint sintetico depois de imprimir. Ligado, destrava a tela do WMS;
    // e o suspeito de fazer o WMS imprimir a propria tela. Desligavel remotamente para
    // conferir a causa em producao sem publicar versao. Ver hook.js.
    afterprintSintetico: true,
    // Ignorar um print() da PAGINA disparado logo depois do nosso afterprint. E o que
    // impede a tela do WMS de sair impressa como um bloco preto.
    bloquearPrintDaTela: true,
    // Ignorar um segundo print() que chega logo apos o anterior sem ajuste proprio. Foi
    // o diagnostico de producao que mostrou esse eco chegando 15 ms depois e caindo em
    // cima do preview aberto. Ver "GUARDA DE ECO DE IMPRESSAO" em hook.js.
    bloquearEcoDePrint: true,

    /* v16.36.5 — dois freios de trabalho REPETIDO, achados no diagnostico de producao.
     * Cada etiqueta do WMS entrava TRES vezes no cropPdf: duas com o PDF original (o
     * hook.js e o content.js pedem o ajuste por caminhos diferentes, e nesta operacao os
     * dois chegam) e uma com a NOSSA PROPRIA saida, quando o content.js roda de novo
     * dentro do iframe ja trocado. As duas repeticoes acabavam de rodar o motor (pdf.js
     * + canvas) no mesmo processo da pagina, no exato momento em que o Chrome abre a
     * previa de impressao. Ver o comentario longo no cropPdf do background.js.
     * Desligaveis pelo config remoto: se alguma etiqueta parar de sair, da para voltar
     * ao comportamento antigo em 1 hora, sem publicar versao. */
    pularJaAjustado: true,
    deduplicarCrop: true,

    /* v16.36.7 — "A4 retrato de 1 pagina" e a unica regra de deteccao sem prova nenhuma
     * por tras: descreve etiqueta da Shopee e descreve tambem etiqueta dos Correios
     * impressa em folha A4. Duas etiquetas dos Correios de 19/08 sairam com 64 mm e
     * 61 mm de largura numa etiqueta de 100 mm por causa disso. Ligado, o palpite passa
     * pelo motor antes de virar recorte. Desligado, volta o comportamento anterior. */
    conferirA4NoMotor: true,
    outputWidthMm: 100,
    outputHeightMm: 150,
    marginMm: 2,
    safeScale: 100,
    centerContent: true,
    addTimestamp: true,
    timestampPosition: 'bottom',
    timestampText: 'DDI:',
    timestampFontSize: 9,
    addHeaderText: true,
    headerText: 'PEDIDO PROCESSADO E EMBALADO POR ENVIAGORA',
    headerFontSize: 8,
    addOperatorName: true,
    operatorNameFontSize: 9,
    batchMode: false,
    // extras (dependem do motor)
    correiosFit: true,
    correiosScope: 'correios',
    correiosPadMm: 0.5,
    correiosMarginMm: 1,
    correiosFillFirst: true,
    // captura
    interceptHttpPdfs: true,
    autoPrintStandalone: true,
    processUnknownPdfs: true,
    offsetXMm: 0,
    offsetYMm: 0
  };

  /* ── ESQUEMA ──────────────────────────────────────────────────────────────
     tipo:   'bool' | 'num' | 'int' | 'texto' | 'enum'
     remoto: se false, o campo NUNCA vem do config remoto (so local).
     As faixas numericas repetem de proposito os limites que o codigo de desenho ja
     aplica (safeScale 50-110, fontes 5-14, printSafeMarginMm 0-10): assim o valor e
     recusado na entrada, com aviso no console, em vez de ser silenciosamente cortado. */
  const ESQUEMA = {
    settingsSchemaVersion: { tipo: 'int', min: 0, max: 999999, remoto: false },

    // Estado local da maquina. Fora do remoto de proposito:
    // um "enabled: false" vindo do servidor seria uma porta dos fundos na trava por
    // senha. A parada de emergencia e o killSwitch, que e outra coisa e nao mexe aqui.
    enabled: { tipo: 'bool', remoto: false },
    lockEnabled: { tipo: 'bool', remoto: false },

    // Geometria da saida
    outputWidthMm: { tipo: 'num', min: 50, max: 210, remoto: true },
    outputHeightMm: { tipo: 'num', min: 50, max: 297, remoto: true },
    marginMm: { tipo: 'num', min: 0, max: 20, remoto: true },
    safeScale: { tipo: 'num', min: 50, max: 110, remoto: true },
    centerContent: { tipo: 'bool', remoto: true },
    offsetXMm: { tipo: 'num', min: -10, max: 10, remoto: true },
    offsetYMm: { tipo: 'num', min: -10, max: 10, remoto: true },

    // Correios — a zona de risco. Ver o comentario em labeler.js/desenhar.
    correiosFit: { tipo: 'bool', remoto: true },
    correiosScope: { tipo: 'enum', opcoes: ['correios', 'unknown'], remoto: true },
    correiosPadMm: { tipo: 'num', min: 0, max: 5, remoto: true },
    // Teto de 3 mm de proposito, e nao os 20 do marginMm: acima disso a etiqueta dos
    // Correios ganha borda branca lateral e o leitor deles nao bipa. Ja quebrou a
    // operacao uma vez (v16.32). Valor fora da faixa e RECUSADO, nao cortado.
    correiosMarginMm: { tipo: 'num', min: 0, max: 3, remoto: true },
    correiosFillFirst: { tipo: 'bool', remoto: true },

    // Impressao
    printScaling: { tipo: 'enum', opcoes: ['none', 'appdefault'], remoto: true },
    pickTrayByPdfSize: { tipo: 'bool', remoto: true },
    printSafeMarginMm: { tipo: 'num', min: 0, max: 10, remoto: true },
    // Teto de 5 s: acima disso o operador percebe a demora e acha que travou.
    printSettleMs: { tipo: 'num', min: 0, max: 5000, remoto: true },
    afterprintSintetico: { tipo: 'bool', remoto: true },
    bloquearPrintDaTela: { tipo: 'bool', remoto: true },
    bloquearEcoDePrint: { tipo: 'bool', remoto: true },
    pularJaAjustado: { tipo: 'bool', remoto: true },
    deduplicarCrop: { tipo: 'bool', remoto: true },
    conferirA4NoMotor: { tipo: 'bool', remoto: true },

    // Textos e carimbos
    addHeaderText: { tipo: 'bool', remoto: true },
    headerText: { tipo: 'texto', max: 80, remoto: true },
    headerFontSize: { tipo: 'num', min: 5, max: 14, remoto: true },
    addTimestamp: { tipo: 'bool', remoto: true },
    timestampPosition: { tipo: 'enum', opcoes: ['none', 'top', 'bottom', 'both'], remoto: true },
    timestampText: { tipo: 'texto', max: 20, remoto: true },
    timestampFontSize: { tipo: 'num', min: 5, max: 14, remoto: true },
    addOperatorName: { tipo: 'bool', remoto: true },
    operatorNameFontSize: { tipo: 'num', min: 5, max: 14, remoto: true },

    // Captura
    batchMode: { tipo: 'bool', remoto: true },
    interceptHttpPdfs: { tipo: 'bool', remoto: true },
    autoPrintStandalone: { tipo: 'bool', remoto: true },
    processUnknownPdfs: { tipo: 'bool', remoto: true }
  };

  const CAMPOS = Object.keys(ESQUEMA);
  const CAMPOS_REMOTOS = CAMPOS.filter((k) => ESQUEMA[k].remoto);

  /* ── Validacao ────────────────────────────────────────────────────────────
     Devolve { ok, valor, motivo }. Nunca lanca. */
  function validarCampo(nome, valor) {
    const def = ESQUEMA[nome];
    if (!def) return { ok: false, motivo: 'campo desconhecido' };

    switch (def.tipo) {
      case 'bool':
        if (typeof valor !== 'boolean') return { ok: false, motivo: 'esperava true/false' };
        return { ok: true, valor };

      case 'int':
      case 'num': {
        const n = Number(valor);
        if (!Number.isFinite(n)) return { ok: false, motivo: 'nao e um numero finito' };
        if (def.tipo === 'int' && !Number.isInteger(n)) return { ok: false, motivo: 'esperava inteiro' };
        if (n < def.min || n > def.max) {
          return { ok: false, motivo: 'fora da faixa ' + def.min + '..' + def.max };
        }
        return { ok: true, valor: n };
      }

      case 'texto': {
        if (typeof valor !== 'string') return { ok: false, motivo: 'esperava texto' };
        if (valor.length > def.max) return { ok: false, motivo: 'passa de ' + def.max + ' caracteres' };
        // A fonte de saida e Helvetica (WinAnsi). Caractere fora dessa faixa faz o
        // pdf-lib LANCAR na hora de desenhar — e ai a etiqueta nao sai. Recusa aqui.
        if (/[^\x20-\xFF]/.test(valor)) return { ok: false, motivo: 'tem caractere que a Helvetica nao imprime' };
        return { ok: true, valor };
      }

      case 'enum':
        if (!def.opcoes.includes(valor)) return { ok: false, motivo: 'esperava um de: ' + def.opcoes.join(', ') };
        return { ok: true, valor };

      default:
        return { ok: false, motivo: 'tipo nao tratado' };
    }
  }

  /* Valida o JSON remoto inteiro. Campo ruim nao contamina os outros: ele e descartado
     (cai no embutido) e os bons seguem valendo. Devolve tambem o que foi recusado, para
     aparecer no popup e no console — config errado silencioso e pior que config errado. */
  function validarRemoto(bruto) {
    const erros = [];
    const campos = {};

    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
      return { campos: {}, erros: ['o JSON nao e um objeto'], killSwitch: false, configVersion: 0, aplicavel: false };
    }

    const configVersion = Number.isFinite(Number(bruto.configVersion)) ? Number(bruto.configVersion) : 0;

    // Trava para o outro lado: se o arquivo declara exigir uma extensao mais nova do que
    // esta, ignora o config INTEIRO. Deixa publicar um defaults.json que so faz sentido
    // depois de uma atualizacao, sem quebrar quem ainda nao atualizou.
    const minSchema = Number(bruto.minSchemaVersion || 0);
    if (Number.isFinite(minSchema) && minSchema > SCHEMA_VERSION) {
      return {
        campos: {}, killSwitch: false, configVersion, aplicavel: false,
        erros: ['config exige settingsSchemaVersion >= ' + minSchema + ' e esta extensao e ' + SCHEMA_VERSION]
      };
    }

    const fonte = (bruto.settings && typeof bruto.settings === 'object') ? bruto.settings : bruto;

    for (const nome of Object.keys(fonte)) {
      if (!CAMPOS_REMOTOS.includes(nome)) continue;      // meta, campo morto ou nao-remoto
      const r = validarCampo(nome, fonte[nome]);
      if (r.ok) campos[nome] = r.valor;
      else erros.push(nome + ': ' + r.motivo);
    }

    // NAO existe checagem cruzada de "a margem cabe na largura" aqui, e isso e de
    // proposito: com marginMm <= 20 e outputWidthMm >= 50, 2*20 = 40 < 50 — as faixas
    // ja tornam a combinacao impossivel. Uma guarda que nunca dispara so daria a falsa
    // impressao de que o caso esta coberto. tests/config.test.mjs trava essa aritmetica,
    // entao se alguem alargar uma das faixas o teste avisa que a guarda passou a fazer falta.

    return { campos, erros, killSwitch: bruto.killSwitch === true, configVersion, aplicavel: true };
  }

  /* ── Precedencia ──────────────────────────────────────────────────────────
     embutido  <  remoto  <  ajuste manual do operador
     O remoto define o PADRAO da empresa; o que o operador mexeu no popup continua
     ganhando. Isso so funciona porque, da v16.34 em diante, o chrome.storage.sync
     guarda SO o delta — ver a migracao em background.js/onInstalled. */
  function efetivo(remoto, deltaLocal) {
    const s = Object.assign({}, PADRAO);
    if (remoto) for (const k of CAMPOS_REMOTOS) if (remoto[k] !== undefined) s[k] = remoto[k];
    if (deltaLocal) {
      for (const k of CAMPOS) {
        if (deltaLocal[k] === undefined) continue;
        const r = validarCampo(k, deltaLocal[k]);
        if (r.ok) s[k] = r.valor;   // delta corrompido tambem cai no padrao
      }
    }
    return s;
  }

  /* ── MIGRACAO 1633 -> 1634 ────────────────────────────────────────────────
     Funcao PURA de proposito: ela decide o que fica e o que sai do chrome.storage.sync
     de ~60 maquinas em producao, e errar aqui apaga o ajuste manual de alguem sem
     ninguem perceber. Sendo pura, tests/carregar.test.mjs exercita todos os casos.

     A regra e conservadora:
       valor igual ao padrao da 1633  -> nunca foi tocado, sai do sync e segue o remoto
       valor diferente                -> ajuste real do operador, fica intacto
       campo que nao existe mais      -> sai (autoPrint, debugBorder, corrigirCodigoBarras)

     O valor EFETIVO nao muda para ninguem: o que sai do sync volta identico pelo PADRAO. */
  function migrarSync(salvo) {
    const saved = Object.assign({}, salvo || {});
    const versaoSalva = Number(saved.settingsSchemaVersion || 0);

    // CORRECAO DIRIGIDA 1632 -> 1633. A 16.32 saiu com printSafeMarginMm = 3 e isso
    // encolheu a etiqueta dos Correios, que precisa sair colada na borda para o leitor
    // conseguir bipar. Continua valendo para quem pulou da 16.32 direto para ca.
    const veioDa1632 = versaoSalva === 1632;
    if (veioDa1632) saved.printSafeMarginMm = 0;

    const remover = [];
    const gravar = { settingsSchemaVersion: SCHEMA_VERSION };

    for (const chave of Object.keys(saved)) {
      if (chave === 'settingsSchemaVersion') continue;
      if (!ESQUEMA[chave]) { remover.push(chave); continue; }
      if (saved[chave] === PADRAO[chave]) { remover.push(chave); continue; }
      gravar[chave] = saved[chave];
    }

    return {
      gravar,
      remover,
      veioDa1632,
      preservados: Object.keys(gravar).filter((k) => k !== 'settingsSchemaVersion')
    };
  }

  /* ── Storage ──────────────────────────────────────────────────────────────
     sync  = delta do operador (+ enabled / lockEnabled / settingsSchemaVersion)
     local = cache do config remoto */
  const CHAVE_CACHE = 'configRemoto';

  function lerSync() {
    return new Promise((r) => {
      try { chrome.storage.sync.get(null, (i) => r(i || {})); } catch (e) { r({}); }
    });
  }

  function lerCache() {
    return new Promise((r) => {
      try {
        chrome.storage.local.get({ [CHAVE_CACHE]: null }, (i) => r((i && i[CHAVE_CACHE]) || null));
      } catch (e) { r(null); }
    });
  }

  function gravarCache(c) {
    return new Promise((r) => {
      try { chrome.storage.local.set({ [CHAVE_CACHE]: c }, () => r()); } catch (e) { r(); }
    });
  }

  /* O que todo mundo chama. Devolve as configuracoes ja resolvidas, mais o killSwitch
     e de onde veio o config — os dois aparecem no popup para dar suporte a distancia. */
  async function carregar() {
    const [delta, cache] = await Promise.all([lerSync(), lerCache()]);
    const s = efetivo(cache && cache.campos, delta);
    s.killSwitch = Boolean(cache && cache.killSwitch);
    return {
      s,
      killSwitch: s.killSwitch,
      cache: cache || null,
      delta
    };
  }

  /* Busca o config remoto. NUNCA lanca e NUNCA apaga o cache bom por causa de uma falha:
     sem rede, o que ja estava vale. Devolve um resumo para log/popup. */
  async function atualizarRemoto() {
    const antes = await lerCache();
    let resposta;

    try {
      const ctrl = new AbortController();
      const prazo = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        // cache-buster: o Pages serve com cache agressivo e um ajuste precisa valer
        // dentro da proxima hora, nao no proximo deploy do CDN.
        const r = await fetch(URL_CONFIG + '?t=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        resposta = await r.json();
      } finally { clearTimeout(prazo); }
    } catch (e) {
      console.warn('[Enviagora] config remoto indisponivel (' + (e && e.message) +
                   ') — seguindo com ' + (antes ? 'o cache local.' : 'o padrao embutido.'));
      return { ok: false, motivo: e && e.message, usando: antes ? 'cache' : 'embutido' };
    }

    const v = validarRemoto(resposta);
    if (!v.aplicavel) {
      console.warn('[Enviagora] config remoto ignorado: ' + v.erros.join(' | '));
      return { ok: false, motivo: v.erros.join(' | '), usando: antes ? 'cache' : 'embutido' };
    }
    if (v.erros.length) {
      console.warn('[Enviagora] campos recusados no config remoto: ' + v.erros.join(' | '));
    }

    const novo = {
      campos: v.campos,
      killSwitch: v.killSwitch,
      configVersion: v.configVersion,
      erros: v.erros,
      buscadoEm: Date.now()
    };
    await gravarCache(novo);
    console.log('[Enviagora] config remoto v' + v.configVersion + ' aplicado (' +
                Object.keys(v.campos).length + ' campos' +
                (v.killSwitch ? ', KILL SWITCH LIGADO' : '') + ').');
    return { ok: true, configVersion: v.configVersion, campos: Object.keys(v.campos).length, killSwitch: v.killSwitch };
  }

  glob.EnviagoraConfig = {
    URL_CONFIG,
    SCHEMA_VERSION,
    INTERVALO_MIN,
    PADRAO,
    ESQUEMA,
    CAMPOS,
    CAMPOS_REMOTOS,
    CHAVE_CACHE,
    validarCampo,
    validarRemoto,
    efetivo,
    migrarSync,
    carregar,
    atualizarRemoto,
    _lerCache: lerCache
  };
})(typeof self !== 'undefined' ? self : this);
