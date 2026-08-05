/* diagnostico.js v16.36 — a caixa-preta da IMPRESSORA ENVIAGORA
 *
 * POR QUE EXISTE
 * Quando uma etiqueta falha na operacao, o que chega ate quem conserta e "deu erro" e uma
 * foto do papel. O console do Chrome tem a resposta, mas ninguem vai pedir para o operador
 * abrir o F12 no meio do turno — e quando alguem abre, o erro ja rolou para fora da tela.
 * Este arquivo guarda os ultimos eventos numa fila circular, para que a resposta ainda
 * esteja la meia hora depois, a um clique de distancia no popup.
 *
 * REGRA NUMERO UM: ISTO NUNCA PODE ATRAPALHAR A IMPRESSAO.
 * Todo registro e disparado e esquecido — ninguem espera por ele. Tudo dentro de
 * try/catch. Se o storage encher, der erro ou sumir, a extensao continua imprimindo como
 * se este arquivo nao existisse. Diagnostico que derruba producao e pior que diagnostico
 * nenhum.
 *
 * REGRA NUMERO DOIS: NAO GUARDA CONTEUDO DE ETIQUETA.
 * Nada de bytes de PDF, nada de texto extraido, nada de nome de destinatario ou endereco.
 * Etiqueta tem dado pessoal de cliente. O que fica aqui e METADADO: quanto tempo levou,
 * qual caminho seguiu, qual transportadora foi detectada, tamanho da pagina, mensagem de
 * erro. Da para consertar bug com isso; nao da para vazar cliente com isso.
 *
 * COMO CHEGA AQUI, DE CADA CONTEXTO
 *   background.js  -> chama registrar() direto (tem chrome.storage)
 *   content.js     -> chama registrar() direto
 *   hook.js        -> roda no MUNDO MAIN, sem chrome.storage: manda postMessage e o
 *                     content.js repassa. E o caminho mais importante, porque e no hook
 *                     que a impressao acontece.
 */
(function (glob) {
  'use strict';

  const CHAVE = 'diagnostico';
  const MAX_EVENTOS = 300;      // ~algumas horas de operacao normal
  const MAX_TEXTO = 300;        // corta mensagem de erro gigante
  const ESPERA_GRAVACAO = 800;  // agrupa gravacoes para nao bater no storage a cada linha

  let fila = [];
  let agendado = null;

  function encurtar(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return v.length > MAX_TEXTO ? v.slice(0, MAX_TEXTO) + '…' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    return encurtar(String(v));
  }

  /* Limpa o que nao pode sair da maquina. Alem de nao registrarmos conteudo, esta funcao e
     a rede: se alguem adicionar um campo novo sem pensar, ela corta o que tiver cara de
     dado sensivel antes de gravar. */
  const PROIBIDOS = /base64|b64|bytes|texto|conteudo|endereco|destinatario|nome|cpf|cnpj/i;

  function limpar(dados) {
    const saida = {};
    for (const [k, v] of Object.entries(dados || {})) {
      if (PROIBIDOS.test(k)) continue;
      if (typeof v === 'object' && v !== null) continue;   // so campo simples
      saida[k] = encurtar(v);
    }
    return saida;
  }

  function gravar() {
    agendado = null;
    const lote = fila;
    fila = [];
    if (!lote.length) return;
    try {
      chrome.storage.local.get({ [CHAVE]: [] }, (i) => {
        try {
          const atual = Array.isArray(i && i[CHAVE]) ? i[CHAVE] : [];
          const novo = atual.concat(lote).slice(-MAX_EVENTOS);
          chrome.storage.local.set({ [CHAVE]: novo }, () => {
            // se o set falhar (cota, storage indisponivel), simplesmente perdemos o lote
            if (chrome.runtime && chrome.runtime.lastError) { /* silencio proposital */ }
          });
        } catch (e) { /* nunca propaga */ }
      });
    } catch (e) { /* nunca propaga */ }
  }

  /** Registra um evento. Dispara e esquece: NUNCA espere por isto. */
  function registrar(tipo, dados) {
    try {
      fila.push({ t: Date.now(), tipo: String(tipo).slice(0, 40), ...limpar(dados) });
      if (fila.length > MAX_EVENTOS) fila = fila.slice(-MAX_EVENTOS);
      if (!agendado) agendado = setTimeout(gravar, ESPERA_GRAVACAO);
    } catch (e) { /* nunca propaga */ }
  }

  /** Le tudo o que esta guardado, ja com o que ainda nao foi gravado. */
  function ler() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [CHAVE]: [] }, (i) => {
          const atual = Array.isArray(i && i[CHAVE]) ? i[CHAVE] : [];
          resolve(atual.concat(fila));
        });
      } catch (e) { resolve(fila.slice()); }
    });
  }

  function limparTudo() {
    fila = [];
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [CHAVE]: [] }, () => resolve()); } catch (e) { resolve(); }
    });
  }

  /* Monta o texto que o suporte vai ler. Vai junto o contexto que sempre e a primeira
     pergunta: que versao, que Chrome, que config, ha quanto tempo. */
  async function relatorio(extra) {
    const eventos = await ler();
    const cab = {
      gerado: new Date().toISOString(),
      versao: (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return '?'; } })(),
      navegador: (() => { try { return navigator.userAgent; } catch (e) { return '?'; } })(),
      eventos: eventos.length,
      ...(extra || {})
    };
    const linhas = eventos.map((e) => {
      const { t, tipo, ...resto } = e;
      const hora = new Date(t).toISOString().slice(11, 23);
      const campos = Object.entries(resto).map(([k, v]) => k + '=' + v).join(' ');
      return hora + '  ' + String(tipo).padEnd(22) + ' ' + campos;
    });
    return [
      '=== IMPRESSORA ENVIAGORA — diagnostico ===',
      ...Object.entries(cab).map(([k, v]) => k + ': ' + v),
      '',
      '--- eventos (mais antigo primeiro) ---',
      ...linhas,
      '',
      '(sem conteudo de etiqueta: so metadado — tempos, caminhos, tamanhos e erros)'
    ].join('\n');
  }

  glob.EnviagoraDiag = { registrar, ler, limparTudo, relatorio, CHAVE, MAX_EVENTOS };
})(typeof self !== 'undefined' ? self : this);
