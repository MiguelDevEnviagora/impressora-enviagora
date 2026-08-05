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

  /* POR QUE NAO HA setTimeout AQUI — a v16.36.0 saiu com esse bug.
   *
   * A primeira versao juntava os eventos em memoria e gravava 800 ms depois, para nao
   * bater no storage a cada linha. Parecia cuidado; era perda de dados.
   *
   * Em Manifest V3 o service worker E ENCERRADO quando fica ocioso, e um setTimeout puro
   * NAO o mantem vivo — é armadilha conhecida do MV3. O worker morria antes do prazo e
   * levava a fila junto. Resultado: imprimir uma etiqueta com sucesso e depois baixar o
   * diagnostico devolvia um arquivo VAZIO.
   *
   * Agora cada evento e gravado na hora. Uma promessa encadeada serializa as gravacoes,
   * que e o que evita a corrida do le-altera-grava quando dois eventos caem juntos. O
   * callback do chrome.storage, esse sim, segura o worker vivo ate terminar. */
  let cadeia = Promise.resolve();
  let pendentes = [];           // so para o ler() nao perder o que esta a caminho do disco

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

  function gravarUm(evento) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [CHAVE]: [] }, (i) => {
          try {
            const atual = Array.isArray(i && i[CHAVE]) ? i[CHAVE] : [];
            const novo = atual.concat([evento]).slice(-MAX_EVENTOS);
            chrome.storage.local.set({ [CHAVE]: novo }, () => {
              // set falhou (cota, storage fora)? perde-se este evento e a vida segue.
              if (chrome.runtime && chrome.runtime.lastError) { /* silencio proposital */ }
              pendentes = pendentes.filter((p) => p !== evento);
              resolve();
            });
          } catch (e) { pendentes = pendentes.filter((p) => p !== evento); resolve(); }
        });
      } catch (e) { pendentes = pendentes.filter((p) => p !== evento); resolve(); }
    });
  }

  /** Registra um evento. Dispara e esquece: NUNCA espere por isto. */
  function registrar(tipo, dados) {
    try {
      const evento = { t: Date.now(), tipo: String(tipo).slice(0, 40), ...limpar(dados) };
      pendentes.push(evento);
      if (pendentes.length > MAX_EVENTOS) pendentes = pendentes.slice(-MAX_EVENTOS);
      cadeia = cadeia.then(() => gravarUm(evento)).catch(() => {});
    } catch (e) { /* nunca propaga */ }
  }

  /** Le tudo o que esta guardado, ja com o que ainda nao chegou ao disco. */
  function ler() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [CHAVE]: [] }, (i) => {
          const atual = Array.isArray(i && i[CHAVE]) ? i[CHAVE] : [];
          const faltando = pendentes.filter((p) => !atual.includes(p));
          resolve(atual.concat(faltando));
        });
      } catch (e) { resolve(pendentes.slice()); }
    });
  }

  function limparTudo() {
    pendentes = [];
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [CHAVE]: [] }, () => resolve()); } catch (e) { resolve(); }
    });
  }

  /* AUSENCIA TAMBEM E INFORMACAO — e e a mais facil de nao enxergar.
   *
   * Um log real chegou com duas etiquetas ajustadas e NENHUM evento de impressao. A
   * informacao estava toda ali, mas na forma de linhas que nao existiam: para ler isso e
   * preciso saber de cor quais eventos deveriam aparecer. Estas duas linhas dizem em
   * portugues o que a falta de linha significa, para quem abrir o arquivo nao precisar
   * saber. Sao SUSPEITAS, nao veredito — por isso a palavra "provavel" fica de fora e o
   * texto diz o que observar, nao o que concluir. */
  function pistas(eventos) {
    const tem = (p) => eventos.some((e) => String(e.tipo || '').startsWith(p));
    const fora = [];
    if (tem('crop') && !tem('print')) {
      fora.push('ATENCAO: houve etiqueta ajustada, mas NENHUM evento de impressao foi',
                'registrado. A impressao saiu por um caminho que a extensao nao acompanha.',
                'Se a pagina do WMS ficou aberta desde antes da ultima atualizacao da',
                'extensao, recarregue com F5 e repita — e a causa mais comum.');
    }
    if (!eventos.length) {
      fora.push('ATENCAO: nenhum evento. Se a extensao imprimiu nesta maquina, o problema',
                'esta na propria caixa-preta, e nao na impressao.');
    }
    return fora.length ? ['--- leitura rapida ---', ...fora, ''] : [];
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
      ...pistas(eventos),
      '--- eventos (mais antigo primeiro) ---',
      ...linhas,
      '',
      '(sem conteudo de etiqueta: so metadado — tempos, caminhos, tamanhos e erros)'
    ].join('\n');
  }

  glob.EnviagoraDiag = { registrar, ler, limparTudo, relatorio, CHAVE, MAX_EVENTOS };
})(typeof self !== 'undefined' ? self : this);
