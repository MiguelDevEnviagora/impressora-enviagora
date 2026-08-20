// background.js v16.31 — IMPRESSORA ENVIAGORA
//
// ARQUITETURA (depois da regressão da 16.19-16.24 no WMS/Stock):
//   NÍVEL 1 — este service worker, com pdf-lib. É o caminho que SEMPRE funcionou
//     (v16.15): recorta Amazon/Shopee/Mercado Livre pelo tamanho da página e aplica
//     cabeçalho, DDI e operador. Não depende de canvas, nem de DOM, nem de nada da página.
//   NÍVEL 2 — o "motor" (worker.html, iframe oculto na página do WMS). Faz o que exige
//     canvas: recorte da etiqueta dos Correios e reconstrução do código de barras.
//
// Toda etiqueta tenta o NÍVEL 2 primeiro; se ele não responder (página bloqueia iframe,
// PDF em contexto sem DOM, etc), cai no NÍVEL 1. Nunca fica pior do que a v16.15.
importScripts('pdf-lib.min.js');
importScripts('crop-etiqueta.js');
importScripts('config-padrao.js');
importScripts('diagnostico.js');

const processedFileTabs = new Set();
const MARCA = 'ENVIAGORA_OK';

// ── TRAVA POR SENHA ────────────────────────────────────────────────────────
// Senha unica da operacao, igual nas ~60 maquinas. NAO ha como troca-la pelo popup:
// isso saiu na v16.35 a pedido da operacao, e o motivo e bom — trocar senha maquina a
// maquina era mais um passo manual no rollout, e senha diferente em cada uma vira
// chamado de suporte quando ninguem lembra qual e.
//
// O QUE ESTA TRAVA PROTEGE, HONESTAMENTE
// Ela impede o desligamento POR DESCUIDO: ninguem desliga sem querer, e o background
// desfaz desligamento feito por fora do popup. So isso, e ja e o que a operacao precisa.
// Ela NAO e segredo: este repositorio e publico, entao a senha abaixo e legivel por
// qualquer um — e, mesmo que nao fosse, qualquer operador abre a pasta da extensao e le.
// Continua valendo o que sempre valeu: nenhuma extensao impede desativar em
// chrome://extensions. Ver docs/ARQUITETURA.md.
const SENHA_PADRAO = 'impressora-enviagora';
// Janela, em ms, em que o desligamento fica liberado depois de a senha ser aceita
// no popup. Fora dela qualquer tentativa de desligar e desfeita automaticamente.
const JANELA_DESBLOQUEIO_MS = 60000;

// v16.34 — os padroes sairam daqui e viraram fonte unica em config-padrao.js, junto com
// o esquema de validacao do config remoto. Os VALORES sao os mesmos da v16.33.
const DEFAULT_SETTINGS = self.EnviagoraConfig.PADRAO;

function mmToPt(mm) { return Number(mm || 0) * 72 / 25.4; }

// Resolve embutido < remoto < ajuste do operador. O killSwitch vem junto, dentro de s.
async function getSettings() {
  try {
    const { s } = await self.EnviagoraConfig.carregar();
    return s;
  } catch (e) {
    console.warn('[Enviagora] falha ao montar as configuracoes — usando o padrao embutido:', e && e.message);
    return { ...DEFAULT_SETTINGS, killSwitch: false };
  }
}

// ── CONFIG REMOTO ──────────────────────────────────────────────────────────
// Quase toda "atualizacao" desta extensao e ajuste de parametro, nao de logica: margem,
// texto do cabecalho, escala. Buscar isso de um JSON publico transforma "passar nas 60
// maquinas" em "um commit valendo em ate 1 hora".
//
// A busca acontece em tres momentos: quando o Chrome abre (onStartup), quando a extensao
// instala/atualiza (onInstalled) e de hora em hora (chrome.alarms). Falhou? Vale o cache;
// sem cache, vale o embutido. Ver config-padrao.js.
const ALARME_CONFIG = 'enviagora-config';

function agendarConfig() {
  try {
    // Recriar o alarme a cada acordada do service worker reiniciaria a contagem e ele
    // poderia nunca disparar. So cria se ainda nao existe.
    chrome.alarms.get(ALARME_CONFIG, (a) => {
      if (!a) {
        chrome.alarms.create(ALARME_CONFIG, {
          periodInMinutes: self.EnviagoraConfig.INTERVALO_MIN,
          delayInMinutes: 1
        });
      }
    });
  } catch (e) { console.warn('[Enviagora] sem chrome.alarms:', e && e.message); }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name !== ALARME_CONFIG) return;
  self.EnviagoraConfig.atualizarRemoto();
  procurarAtualizacao();
});

chrome.runtime.onStartup.addListener(() => {
  agendarConfig();
  self.EnviagoraConfig.atualizarRemoto();
  procurarAtualizacao();
});

agendarConfig();

// Prova de vida: garante que o diagnostico NUNCA volte vazio numa maquina que rodou.
// Se o arquivo baixado nao tiver nem esta linha, o problema e a propria caixa-preta —
// e nao "nao aconteceu nada". Foi exatamente essa duvida que a v16.36.0 gerou.
//
// POR QUE E ESTRANGULADO (v16.36.4)
// Este arquivo inteiro roda de novo toda vez que o service worker ACORDA, e em Manifest V3
// ele acorda e morre o tempo todo — num log de 10 minutos apareceram quatro "extensao-ligou".
// Lido de fora, parece que a extensao reiniciou quatro vezes; na pratica so significa que
// o Chrome suspendeu o worker ocioso, que e o comportamento normal. Barulho num log de 300
// linhas empurra para fora justamente o evento raro que interessa. Entao: registra no
// maximo uma vez por hora, e sempre que a VERSAO mudar (essa linha e a prova de que a
// atualizacao chegou naquela maquina — nunca pode ser engolida).
const CHAVE_LIGOU = 'ultimoLigou';
const INTERVALO_LIGOU_MS = 60 * 60 * 1000;

(function provaDeVida() {
  const versao = chrome.runtime.getManifest().version;
  try {
    chrome.storage.local.get({ [CHAVE_LIGOU]: null }, (i) => {
      try {
        const ultimo = i && i[CHAVE_LIGOU];
        const mudouVersao = !ultimo || ultimo.versao !== versao;
        const passouTempo = !ultimo || (Date.now() - (ultimo.t || 0)) > INTERVALO_LIGOU_MS;
        if (!mudouVersao && !passouTempo) return;
        chrome.storage.local.set({ [CHAVE_LIGOU]: { t: Date.now(), versao } });
        self.EnviagoraDiag.registrar('extensao-ligou', {
          versao,
          motivo: mudouVersao ? (ultimo ? 'versao-nova' : 'primeira-vez') : 'periodico'
        });
      } catch (e) { /* prova de vida nunca derruba nada */ }
    });
  } catch (e) {
    // Sem storage nao da para estrangular; melhor registrar de novo do que nao registrar.
    self.EnviagoraDiag.registrar('extensao-ligou', { versao, motivo: 'sem-storage' });
  }
})();

// ── ATUALIZACAO DA EXTENSAO ────────────────────────────────────────────────
// O Chrome NAO recebe empurrao: ele consulta a update_url por conta propria, mais ou
// menos a cada 5 horas. Nao existe comando que atualize as 60 maquinas na hora.
//
// O que da para fazer e PEDIR que ele procure agora. E isso que requestUpdateCheck faz.
// Pendurando essa chamada no alarme de 1 hora que ja existe para o config, o ciclo cai de
// ~5 h para ~1 h sem nenhuma infraestrutura nova. O Chrome throttla a chamada e as vezes
// responde 'throttled' — nesse caso a procura periodica dele continua valendo normalmente,
// entao o pior caso e exatamente o comportamento de antes.
function procurarAtualizacao() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.requestUpdateCheck((status, detalhes) => {
        const versao = detalhes && detalhes.version;
        console.log('[Enviagora] procura de atualizacao: ' + status +
                    (versao ? ' (v' + versao + ')' : ''));
        resolve({ status, versao });
      });
    } catch (e) {
      console.warn('[Enviagora] nao consegui procurar atualizacao:', e && e.message);
      resolve({ status: 'erro', motivo: e && e.message });
    }
  });
}

/* Aplicar a atualizacao sem estragar uma etiqueta no meio do caminho.
 *
 * Achando versao nova, o Chrome baixa mas SEGURA a troca enquanto a extensao esta em uso —
 * as vezes por dias. chrome.runtime.reload() aplica na hora. So que recarregar o service
 * worker no meio de um cropPdf mata aquela etiqueta: o WMS fica esperando uma resposta que
 * nunca chega e o operador ve a impressao falhar.
 *
 * Por isso contamos os trabalhos em andamento e so recarregamos com a fila vazia. */
let trabalhosEmAndamento = 0;
let recarregarQuandoLivre = false;

function talvezRecarregar() {
  if (trabalhosEmAndamento > 0) return;
  if (!recarregarQuandoLivre) return;
  console.log('[Enviagora] aplicando a atualizacao agora (nenhuma etiqueta em andamento).');
  chrome.runtime.reload();
}

chrome.runtime.onUpdateAvailable.addListener((detalhes) => {
  console.log('[Enviagora] versao ' + (detalhes && detalhes.version) + ' pronta para aplicar.');
  recarregarQuandoLivre = true;
  talvezRecarregar();
});

// ── TRAVA POR SENHA ────────────────────────────────────────────────────────
// O que a trava garante: ninguem desliga a extensao pelo popup sem a senha, e se alguem
// forcar o desligamento por fora (console, storage), o background desfaz sozinho.
// O que ela NAO garante: desativar/remover a extensao em chrome://extensions. Isso so
// politica corporativa impede — nenhuma extensao consegue.
//
// A partir da v16.35 a senha e uma constante unica da operacao e nao ha como troca-la
// pelo popup. Ver o comentario longo em SENHA_PADRAO, no topo do arquivo.

function lerTrava() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ unlockUntil: 0 }, (i) => resolve(i || {}));
  });
}

// A senha e uma constante publica, entao guardar hash com sal dela seria teatro: nao
// protegeria de nada e daria a impressao errada de que protege. Comparacao direta, e o
// comentario acima explicando o que a trava realmente faz.
function senhaConfere(senha) {
  return String(senha || '') === SENHA_PADRAO;
}

async function liberarDesligamento() {
  await new Promise(r => chrome.storage.local.set({ unlockUntil: Date.now() + JANELA_DESBLOQUEIO_MS }, r));
}

// Vigia: se "enabled" virar false fora da janela liberada, volta para true.
chrome.storage.onChanged.addListener(async (mudancas, area) => {
  if (area !== 'sync' || !mudancas.enabled) return;
  if (mudancas.enabled.newValue !== false) return;

  const s = await getSettings();
  if (!s.lockEnabled) return;

  const t = await lerTrava();
  if (Number(t.unlockUntil || 0) > Date.now()) return;   // desligamento autorizado

  console.warn('[Enviagora] desligamento sem senha — revertendo.');
  chrome.storage.sync.set({ enabled: true });
});

/* MIGRACAO 1633 -> 1634 — o storage passa a guardar SO o delta do operador.
 *
 * POR QUE ISSO PRECISOU MUDAR
 * Ate a 1633 este listener gravava os 34 campos no chrome.storage.sync. Depois disso,
 * "o operador escolheu 2 mm" e "2 mm e so o padrao que foi gravado sozinho" viravam a
 * MESMA coisa no storage — indistinguiveis. Com o config remoto isso seria fatal: ou o
 * remoto nunca valeria nada (tudo parece ajuste manual), ou atropelaria o ajuste que o
 * operador fez de verdade. Nao existe meio-termo enquanto o padrao estiver gravado.
 *
 * Agora o sync guarda apenas o que difere do padrao. A regra da migracao e conservadora:
 * campo cujo valor salvo e IGUAL ao padrao da 1633 nunca foi tocado -> sai do sync e
 * passa a seguir o remoto. Campo diferente e ajuste real -> fica exatamente como esta.
 * O valor EFETIVO nao muda para ninguem nesta atualizacao.
 */
chrome.runtime.onInstalled.addListener(() => {
  agendarConfig();
  self.EnviagoraConfig.atualizarRemoto();

  chrome.storage.sync.get(null, (items) => {
    // A decisao mora em config-padrao.js/migrarSync, que e uma funcao pura e tem teste
    // caso a caso. Aqui fica so o efeito colateral: gravar o resultado.
    const { gravar, remover, preservados, veioDa1632 } = self.EnviagoraConfig.migrarSync(items);

    if (veioDa1632) {
      console.log('[Enviagora] migrando da 16.32: margem de seguranca zerada (Correios).');
    }
    console.log('[Enviagora] migracao 1634: ' + preservados.length + ' ajuste(s) do operador preservado(s)' +
                (preservados.length ? ' (' + preservados.join(', ') + ')' : '') +
                '; ' + remover.length + ' campo(s) voltando a seguir o padrao.');

    const aplicar = () => chrome.storage.sync.set(gravar);
    if (remover.length) chrome.storage.sync.remove(remover, aplicar); else aplicar();
  });
});

let lastOperator = null;
chrome.storage.local.get({ lastOperator: null }, (i) => { lastOperator = (i && i.lastOperator) || null; });

// ── Navegação ───────────────────────────────────────────────────────────────
chrome.webNavigation.onCommitted.addListener(async (d) => {
  const url = d.url || '';

  // PDF blob (iframe do Cockpit/Stock): injeta o content.js nele — fluxo da v16.15
  if (url.startsWith('blob:')) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: d.tabId, frameIds: [d.frameId] },
        files: ['content.js']
      });
    } catch (e) {}
    return;
  }

  const isFile = url.startsWith('file:');
  const isHttp = url.startsWith('http:') || url.startsWith('https:');
  if (!isFile && !isHttp) return;

  const s = await getSettings();
  if (!s.enabled) return;
  // KILL SWITCH: freio de emergencia central. Nao troca a aba pelo ajustador — o PDF
  // original abre no visualizador do Chrome e imprime normal.
  if (s.killSwitch) return;
  if (isHttp && !s.interceptHttpPdfs) return;
  if (!pareceEtiquetaPdf(url)) return;

  // PDF ocupando a aba inteira: content script não roda dentro do visualizador de PDF
  // do Chrome, então trocamos a aba pela nossa página (MESMA ABA, nunca abre outra).
  if (d.frameId === 0) {
    const chave = d.tabId + ':' + url;
    if (processedFileTabs.has(chave)) return;
    processedFileTabs.add(chave);
    setTimeout(() => processedFileTabs.delete(chave), 30000);
    try {
      const alvo = chrome.runtime.getURL('viewer.html') +
        '?auto=' + (s.autoPrintStandalone ? '1' : '0') + '&src=' + encodeURIComponent(url);
      console.log('[Enviagora] Etiqueta em aba própria — abrindo no ajustador (mesma aba).');
      await chrome.tabs.update(d.tabId, { url: alvo });
    } catch (e) {
      console.warn('[Enviagora] não consegui abrir o ajustador:', e && e.message);
    }
  }
});

function pareceEtiquetaPdf(url) {
  const u = url.toLowerCase();
  if (/\.pdf($|[?#&])/.test(u)) return true;
  return ['etiqueta', 'label', 'correios', 'sigep', 'declaracao', 'romaneio'].some(k => u.includes(k));
}

// ── Mensagens ───────────────────────────────────────────────────────────────
/* ── TRABALHO REPETIDO POR ETIQUETA (v16.36.5) ─────────────────────────────────
 *
 * O QUE O DIAGNOSTICO DE PRODUCAO MOSTROU
 * Uma unica etiqueta do WMS entrava TRES vezes aqui. Recortado de um log real:
 *
 *   22.180  crop-entrou      mm=105x148     <- 1o: o PDF original
 *   22.294  crop-entrou      mm=105x148     <- 2o: o MESMO PDF original, 114 ms depois
 *   22.737  print-carregou   via=load       <- o iframe ja recebeu a etiqueta ajustada
 *   22.834  crop-entrou      mm=100x150     <- 3o: a NOSSA PROPRIA saida
 *   23.111  crop-ok          ms=898         <- o 2o so termina aqui
 *   23.184  print-chamado                   <- o print() sai no meio disso tudo
 *
 * DE ONDE VEM CADA UM
 *   1o) o hook.js captura o blob na criacao e manda ajustar (postMessage -> content.js);
 *   2o) o content.js TAMBEM roda dentro do frame do PDF e busca o blob por conta propria.
 *       O comentario dele diz "se o site ja revogou o blob, quem salva e o hook" — nesta
 *       operacao o blob NAO e revogado, entao os dois caminhos rodam, sempre;
 *   3o) depois que o hook troca o src do iframe, o content.js roda de novo — agora dentro
 *       da etiqueta que nos mesmos acabamos de gerar — e pede ajuste dela.
 *
 * POR QUE ISSO IMPORTA, E NAO E SO DESPERDICIO
 * Os pedidos 1 e 2 vao para o MOTOR, que roda pdf.js e canvas COMO CONTENT SCRIPT, no
 * mesmo processo de renderizacao da pagina do WMS. Ou seja: ~500 a 900 ms de trabalho
 * pesado no exato instante em que o Chrome tenta abrir a previa de impressao. Em maquina
 * folgada passa; em maquina apertada e assim que aparece "Falha ao imprimir". Bate com o
 * relato de que o erro so acontece em ALGUMAS estacoes.
 *
 * O QUE ESTES DOIS FREIOS FAZEM
 *   deduplicarCrop  — pedidos identicos dividem o MESMO trabalho. Mesma entrada, mesma
 *                     saida: a resposta e igual, so nao e calculada duas vezes.
 *   pularJaAjustado — um PDF que ja tem a nossa marca sai daqui na hora, sem motor.
 *
 * O que NAO foi mexido: quem chama, quando chama e o que cada caminho faz com a resposta.
 * A logica de impressao continua exatamente a mesma; o que mudou e nao refazer duas vezes
 * a mesma conta. Os dois sao desligaveis pelo config remoto.
 */
const emVoo = new Map();          // chave -> Promise<{ b64, via }>
// Teto de espera do motor quando ele so esta CONFERINDO um palpite. Curto de proposito:
// aqui existe um recorte de reserva perfeitamente utilizavel (o de hoje), entao esperar
// os 8 s do caminho normal seria trocar uma etiqueta pequena por uma etiqueta atrasada.
const TETO_MOTOR_PALPITE_MS = 2000;
const JANELA_DEDUP_MS = 4000;

/* A chave e o que define "o mesmo pedido". Nao usamos o base64 inteiro como chave para
 * nao guardar uma copia do PDF na memoria do worker (nem do conteudo da etiqueta, que
 * e dado de cliente). O operador e a rota entram porque MUDAM a saida — o nome do
 * operador e impresso na etiqueta.
 *
 * POR QUE HASH DO CONTEUDO INTEIRO, E NAO SO TAMANHO + COMECO + FIM (v16.36.6)
 * A primeira versao usava tamanho + primeiros/ultimos 64 chars. O teste de estresse
 * derrubou isso em minutos: 20 PDFs DIFERENTES do mesmo gerador, 18 tratados como
 * repeticao — mesmo produtor da o mesmo comeco, e dois PDFs com o MESMO tamanho ficam
 * com o mesmo fim (o fim e o startxref, que so depende do tamanho). Colisao aqui nao e
 * desperdicio: e a etiqueta de UM cliente saindo na encomenda de OUTRO. Entao a chave
 * passa a ser um hash FNV-1a de TODO o conteudo — 1 a 2 ms por MB, sincrono, e continua
 * sem guardar byte nenhum da etiqueta. */
function hashFnv(str) {
  let a = 0x811c9dc5, b = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ ((c * 31 + i) & 0xffff), 0x01000193);
  }
  return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
}
function chaveDoPedido(msg, operador) {
  const b = String(msg.base64 || '');
  return [b.length, hashFnv(b), operador || '-', msg.semMotor ? 'sm' : 'cm'].join('|');
}

/* O calculo em si, separado do protocolo de resposta para que dois pedidos iguais possam
 * dividir a MESMA promessa. Devolve { b64, via }; b64 null significa "sem ajuste". */
async function calcular(msg, operador, tabId, cfg) {
  // Amazon / Shopee / Mercado Livre: caminho RAPIDO da v16.15, direto no pdf-lib.
  // Nao consulta o motor — o WMS dispara o print() em seguida e nao pode esperar.
  const retrato = await ehEtiquetaConhecida(msg.base64);
  // Fica no log ANTES de qualquer processamento: se o passo seguinte travar, ainda
  // sabemos que PDF entrou. 'detectada=-' significa que nenhuma regra bateu.
  self.EnviagoraDiag.registrar('crop-entrou', {
    detectada: retrato.nome || '-',
    paginas: retrato.paginas,
    mm: retrato.mm,
    jaAjustado: retrato.jaAjustado
  });

  // Nossa propria saida voltando para ca. Antes disto ela ia ate o motor, gastava ~400 ms
  // e no fim caia no mesmo lugar: processarBasico ve a marca e devolve null.
  if (retrato.jaAjustado && cfg.pularJaAjustado !== false) {
    return { b64: null, via: 'ja ajustado' };
  }

  /* A4 RETRATO DE 1 PAGINA: CONFERIR ANTES DE RECORTAR (v16.36.7)
   *
   * O QUE ACONTECIA
   * Duas etiquetas dos Correios de 19/08 sairam recortadas em 10x15 com a etiqueta
   * PEQUENA no meio do papel — 64 mm e 61 mm de largura numa etiqueta de 100 mm.
   *
   * A causa: as duas sao A4 de 1 pagina, o que faz a regra dizer "Shopee". O caminho
   * rapido entao recorta um retangulo FIXO (0,398)-(300,842) e nunca olha onde a
   * etiqueta esta de verdade. Como a etiqueta dos Correios ocupava so um pedaco desse
   * retangulo, o que foi ampliado ate 10x15 foi o retangulo — a etiqueta veio junto,
   * na proporcao dela, pequena. O recorte "funcionou"; o alvo e que estava errado.
   *
   * O CONSERTO
   * So neste caso — e so quando a regra e um palpite, nunca quando ha prova — a etiqueta
   * passa pelo motor antes. O motor roda o labeler.js, que le o texto e mede onde a
   * tinta esta:
   *   - etiqueta da Shopee de verdade: o labeler tambem detecta Shopee, ve a marca
   *     "shopee"/"SHP:" no texto e devolve EXATAMENTE o mesmo recorte de hoje;
   *   - etiqueta dos Correios em A4: o texto entrega ("Contrato" + SEDEX/PAC, codigo
   *     AA999999999BR) e o recorte passa a ser a tinta, com preenchimento de largura.
   * Nas duas etiquetas de 19/08 isso leva a largura de 64 mm para 98 mm.
   *
   * POR QUE ISTO E SEGURO
   * O teto e curto (2 s) e a queda e limpa: motor mudo, lento ou ausente devolve null e
   * seguimos no recorte de hoje, sem piorar nada. E `conferirA4NoMotor` desliga tudo
   * pelo config remoto, valendo em 1 hora, sem publicar versao. */
  if (retrato.nome && retrato.palpite && cfg.conferirA4NoMotor !== false &&
      !msg.semMotor && tabId != null) {
    const viaMotor = await pedirAoMotor(tabId, msg.base64, operador, TETO_MOTOR_PALPITE_MS);
    if (viaMotor) return { b64: viaMotor, via: 'motor (A4 conferida)' };
    self.EnviagoraDiag.registrar('a4-motor-mudo', { detectada: retrato.nome });
  }

  if (retrato.nome) {
    return { b64: await processarBasico(msg.base64, operador), via: 'background (' + retrato.nome + ')' };
  }

  // Nenhuma regra bateu. O motor faz o recorte por LEITURA da pagina (procura o
  // codigo de barras), que e o caminho que funciona para Correios e J&T. Timeout
  // curto — se nao responder rapido, segue o ajuste padrao.
  //
  // O nome desta rota nao afirma transportadora nenhuma, de proposito: quem cai aqui
  // e justamente a etiqueta que a deteccao NAO reconheceu.
  if (!msg.semMotor && tabId != null) {
    const viaMotor = await pedirAoMotor(tabId, msg.base64, operador);
    if (viaMotor) return { b64: viaMotor, via: 'motor (recorte por leitura)' };
  }
  return { b64: await processarBasico(msg.base64, operador), via: 'background (ajuste padrão)' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── trava por senha (falado so pelo popup) ──
  if (msg && msg.action === 'destravar') {
    (async () => {
      const ok = senhaConfere(msg.senha);
      if (ok) await liberarDesligamento();
      sendResponse({ ok });
    })();
    return true;
  }

  // Botao "Procurar atualizacao agora" do popup — o gatilho manual, para quando alguem
  // nao pode esperar o ciclo de 1 hora.
  if (msg && msg.action === 'procurarAtualizacao') {
    (async () => {
      const r = await procurarAtualizacao();
      sendResponse({ ...r, versaoAtual: chrome.runtime.getManifest().version });
    })();
    return true;
  }

  // Log vindo do hook.js / content.js. O hook roda no MUNDO MAIN e nao tem chrome.storage,
  // entao a caixa-preta mora aqui e ele manda os eventos por aqui. Dispara e esquece.
  if (msg && msg.action === 'log') {
    self.EnviagoraDiag.registrar(msg.tipo, msg.dados);
    return;
  }

  if (msg && msg.action === 'diagnostico') {
    (async () => {
      if (msg.limpar) { await self.EnviagoraDiag.limparTudo(); return sendResponse({ ok: true }); }
      if (msg.contar) return sendResponse({ ok: true, total: (await self.EnviagoraDiag.ler()).length });
      sendResponse({ ok: true, texto: await self.EnviagoraDiag.relatorio() });
    })();
    return true;
  }

  if (msg && msg.action === 'saveOperator') {
    if (msg.operatorName && msg.operatorName !== lastOperator) {
      lastOperator = msg.operatorName;
      chrome.storage.local.set({ lastOperator });
    }
    return;
  }

  if (msg && msg.action === 'cropPdf') {
    const t0 = Date.now();
    const tabId = sender && sender.tab && sender.tab.id;
    const operador = msg.operatorName || lastOperator || null;

    // Segura a atualizacao enquanto esta etiqueta estiver em andamento. Ver talvezRecarregar.
    trabalhosEmAndamento++;

    let respondido = false;
    const responder = (b64, via) => {
      if (respondido) return;
      respondido = true;
      const ms = Date.now() - t0;
      console.log('[Enviagora] cropPdf ' + ms + 'ms — ' + (b64 ? 'ajustado via ' + via : 'sem ajuste'));
      self.EnviagoraDiag.registrar(b64 ? 'crop-ok' : 'crop-sem-ajuste', { ms, via });
      sendResponse({ croppedBase64: b64 });
      trabalhosEmAndamento = Math.max(0, trabalhosEmAndamento - 1);
      talvezRecarregar();
    };
    const guarda = setTimeout(() => responder(null, '-'), 12000);

    (async () => {
      // KILL SWITCH antes de tudo: nem consulta o motor, nem abre o pdf-lib. Devolve
      // "sem ajuste" e o hook imprime o PDF original, exatamente como se a extensao
      // nao estivesse ali. E o freio para quando um ajuste de config quebra a operacao.
      const cfg = await getSettings();
      if (cfg.killSwitch) { clearTimeout(guarda); return responder(null, 'kill switch'); }

      // DEDUPLICACAO — ver a nota longa em chaveDoPedido.
      const chave = chaveDoPedido(msg, operador);
      if (cfg.deduplicarCrop !== false && emVoo.has(chave)) {
        const r = await emVoo.get(chave);
        clearTimeout(guarda);
        return responder(r.b64, r.via + ' [reaproveitado]');
      }

      const trabalho = calcular(msg, operador, tabId, cfg);
      if (cfg.deduplicarCrop !== false) {
        emVoo.set(chave, trabalho);
        // Vale por alguns segundos DEPOIS de pronto, e nao so enquanto roda: os dois
        // pedidos do mesmo PDF chegam com ~90 ms de diferenca, mas o segundo as vezes
        // chega depois de o primeiro ja ter terminado.
        const soltar = () => setTimeout(() => { if (emVoo.get(chave) === trabalho) emVoo.delete(chave); }, JANELA_DEDUP_MS);
        trabalho.then(soltar, soltar);
      }

      const r = await trabalho;
      clearTimeout(guarda);
      responder(r.b64, r.via);
    })().catch((e) => {
      clearTimeout(guarda);
      console.error('[Enviagora] cropPdf falhou:', e && e.message);
      self.EnviagoraDiag.registrar('crop-erro', { erro: e && e.message });
      responder(null, '-');
    });

    return true;
  }
});

// ── MOTOR ───────────────────────────────────────────────────────────────────
// Injetado como CONTENT SCRIPT no frame de cima (mundo isolado da extensão). Isso é o
// que faz ele funcionar no Stokki: content script ignora a política de segurança do site,
// ao contrário do iframe da extensão, que o site bloqueia. Tem canvas e chrome.runtime.
// Motor enxuto: só o necessário para o recorte dos Correios. A reconstrução do código
// de barras (J&T) saiu — ela varria a imagem inteira linha por linha e era o que fazia a
// janela de impressão ficar carregando.
const MOTOR_ARQUIVOS = ['lib/pdf.min.js', 'pdf-lib.min.js', 'crop-etiqueta.js', 'config-padrao.js', 'diagnostico.js', 'labeler.js', 'motor.js'];
const motorNaAba = new Map();   // tabId -> Promise de injeção

// O motor responde ao ping? (o service worker pode ter sido suspenso e perdido o mapa)
function motorVivo(tabId) {
  return new Promise((resolve) => {
    let respondeu = false;
    const t = setTimeout(() => { if (!respondeu) { respondeu = true; resolve(false); } }, 400);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'motorPing' }, { frameId: 0 }, (r) => {
        if (respondeu) return;
        respondeu = true; clearTimeout(t);
        resolve(!chrome.runtime.lastError && r && r.ok === true);
      });
    } catch (e) { clearTimeout(t); resolve(false); }
  });
}

async function garantirMotor(tabId) {
  if (await motorVivo(tabId)) return true;
  if (motorNaAba.has(tabId)) return motorNaAba.get(tabId);

  const p = chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: MOTOR_ARQUIVOS
  }).then(() => {
    console.log('[Enviagora] motor injetado na página.');
    return true;
  }).catch((e) => {
    console.warn('[Enviagora] não consegui injetar o motor:', e && e.message);
    motorNaAba.delete(tabId);
    return false;
  });
  motorNaAba.set(tabId, p);
  return p;
}
chrome.tabs.onRemoved.addListener((id) => motorNaAba.delete(id));

// PRÉ-AQUECIMENTO: injeta o motor assim que a tela do WMS carrega, ANTES de a etiqueta
// aparecer. Sem isso, a primeira etiqueta pegava o motor "frio" (1,7 MB de scripts para
// carregar) e o hook soltava o PDF cru antes de ficar pronto — era a intermitência.
chrome.webNavigation.onCompleted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const s = await getSettings();
  if (!s.enabled || s.killSwitch) return;
  motorNaAba.delete(d.tabId);
  garantirMotor(d.tabId);
  console.log('[Enviagora] pré-aquecendo o motor nesta página.');
}, { url: [{ urlMatches: '^https?://.*(stokki|enviagora|wms|cockpit|packaging|expedicao|expedição)' }] });

function pedirAoMotor(tabId, base64, operatorName, tetoMs) {
  const teto = Number.isFinite(Number(tetoMs)) ? Number(tetoMs) : 8000;
  return new Promise(async (resolve) => {
    const ok = await garantirMotor(tabId);
    if (!ok) return resolve(null);

    let pronto = false;
    const prazo = setTimeout(() => {
      if (pronto) return;
      pronto = true;
      self.EnviagoraDiag.registrar('motor-timeout', { ms: teto });
      resolve(null);
    }, teto);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'motorProcessar', base64, operatorName },
        { frameId: 0 }, (resp) => {
          if (pronto) return;
          pronto = true;
          clearTimeout(prazo);
          if (chrome.runtime.lastError) {
            console.warn('[Enviagora] motor não respondeu:', chrome.runtime.lastError.message);
          self.EnviagoraDiag.registrar('motor-mudo', { erro: chrome.runtime.lastError.message });
            resolve(null); return;
          }
          resolve((resp && resp.b64) || null);
        });
    } catch (e) { clearTimeout(prazo); resolve(null); }
  });
}

// ── NÍVEL 1: ajuste padrão com pdf-lib (idêntico à v16.15) ──────────────────
// v16.32 — A DETECCAO MUDOU. Leia antes de mexer.
//
// Ate a v16.31 a transportadora era adivinhada pela QUANTIDADE DE PAGINAS:
//   "A4 com mais de uma pagina = Amazon; A4 com uma pagina = Shopee".
// Etiqueta da Amazon sem a lista de postagem anexa vem com UMA pagina. Caia no ramo do
// Shopee e era recortada em bottom:398 — a metade de cima da folha, em branco na Amazon.
// Era isso que fazia "umas sairem certas e outras nao". E ha ainda uma segunda variante,
// com a etiqueta no quadrante de CIMA e escala levemente diferente: nenhum retangulo fixo
// cobre as duas.
//
// Agora a Amazon e achada pela GEOMETRIA do arquivo (crop-etiqueta.js): o bloco de 4x6
// polegadas dentro do PDF, onde quer que ele esteja colado na folha. As regras antigas
// continuam intactas como segundo nivel, para Shopee e Mercado Livre.
function detectLabel(page, pageCount) {
  try {
    if (self.EnviagoraCrop) {
      const geo = self.EnviagoraCrop.detectarEtiqueta(page);
      if (geo) return geo;
    }
  } catch (e) { /* qualquer problema: segue nas regras antigas */ }

  const { width, height } = page.getSize();
  const a4Retrato  = width > 550 && width < 640 && height > 800;
  const a4Paisagem = width > 800 && height > 550 && height < 640;
  if (a4Retrato && pageCount > 1)   return { name: 'Amazon',        left: 0, bottom: 0,   width: 300, height: 430 };
  // 'palpite' marca a UNICA regra desta lista que nao tem prova nenhuma por tras.
  // "A4 retrato de 1 pagina" descreve etiqueta da Shopee — e descreve tambem etiqueta
  // dos Correios impressa em folha A4, que e comum. As outras regras se apoiam em algo:
  // o detector geometrico achou um retangulo 4x6, a Amazon tem mais de uma pagina, o
  // Mercado Livre e paisagem. Esta aqui e so "sobrou A4". Ver calcular().
  if (a4Retrato && pageCount === 1) return { name: 'Shopee',        left: 0, bottom: 398, width: 300, height: 444, palpite: true };
  if (a4Paisagem)                   return { name: 'Mercado Livre', left: 0, bottom: 154, width: 300, height: 410 };
  return null;
}

// Grava no PDF de saida as preferencias de impressao e trava as caixas de pagina no
// tamanho exato da etiqueta.
//
// ATENCAO ao limite real: NENHUMA extensao consegue mexer no seletor de escala do
// dialogo de impressao do Chrome — nao existe API para isso. O que da para fazer, e o
// que este trecho faz, e entregar um PDF que ja sai certo em qualquer opcao:
//   - MediaBox / CropBox / TrimBox / BleedBox todas iguais ao tamanho da etiqueta,
//     entao "Ajustar a pagina" e 100% dao no mesmo resultado;
//   - /ViewerPreferences /PrintScaling, que o visualizador le como "imprimir em
//     tamanho real";
//   - /PickTrayByPDFSize, que pede o papel do tamanho do PDF.
// A margem de seguranca (printSafeMarginMm) e o que impede a arte de cair na faixa nao
// imprimivel da impressora, que e a causa real do "so sai certo no ajustar a pagina".
function aplicarPreferenciasDeImpressao(doc, s) {
  try {
    const vp = doc.catalog.getOrCreateViewerPreferences();
    if (PDFLib.PrintScaling) {
      vp.setPrintScaling(String(s.printScaling) === 'appdefault'
        ? PDFLib.PrintScaling.AppDefault
        : PDFLib.PrintScaling.None);
    }
    if (s.pickTrayByPdfSize && typeof vp.setPickTrayByPDFSize === 'function') {
      vp.setPickTrayByPDFSize(true);
    }
  } catch (e) { /* preferencia e enfeite: nunca derruba a impressao */ }

  try {
    for (const p of doc.getPages()) {
      const { width, height } = p.getSize();
      p.setMediaBox(0, 0, width, height);
      p.setCropBox(0, 0, width, height);
      if (typeof p.setTrimBox === 'function') p.setTrimBox(0, 0, width, height);
      if (typeof p.setBleedBox === 'function') p.setBleedBox(0, 0, width, height);
    }
  } catch (e) {}
}

// Margem efetiva: nunca menor que o piso de seguranca de impressao.
function margemEfetivaMm(s) {
  const pedida = Number(s.marginMm || 0);
  const piso = Math.max(0, Math.min(10, Number(s.printSafeMarginMm || 0)));
  return Math.max(pedida, piso);
}

function agora() {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  return `${p(n.getDate())}/${p(n.getMonth()+1)}/${n.getFullYear()} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}

// Descobre rapidinho se é uma das três etiquetas conhecidas (só lê o tamanho da página).
// Devolve SEMPRE um retrato do PDF que chegou, e nao so o nome:
//   { nome, paginas, mm }   nome = null quando nenhuma regra bateu.
//
// POR QUE DEVOLVE MAIS DO QUE O NOME
// Uma etiqueta da J&T de 76x130 mm nao bate com regra nenhuma, cai no motor, e o log
// so dizia "via=motor (Correios/codigo de barras)". Lendo isso, a conclusao natural — e
// errada — e que a extensao identificou a etiqueta como Correios. Ela nao identificou
// nada: "motor" e a ROTA de quem sobrou, nao um veredito de transportadora. Registrando
// aqui o tamanho e o que a deteccao respondeu, o log passa a dizer o que de fato houve.
async function ehEtiquetaConhecida(base64) {
  const vazio = { nome: null, palpite: false, paginas: 0, mm: '?', jaAjustado: false };
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const doc = await PDFLib.PDFDocument.load(bytes.buffer, { ignoreEncryption: true });
    const pages = doc.getPages();
    if (!pages.length) return vazio;
    const { width, height } = pages[0].getSize();
    const mm = (v) => Math.round(v / 72 * 25.4);
    const det = detectLabel(pages[0], pages.length);
    // Marca gravada por processarBasico e pelo labeler.js em tudo o que sai daqui. Ela ja
    // era conferida, so que tarde demais — depois de o motor ter rodado. Ver a nota longa
    // sobre TRABALHO REPETIDO acima.
    let jaAjustado = false;
    try {
      const kw = doc.getKeywords();
      jaAjustado = Boolean(kw && String(kw).includes(MARCA));
    } catch (e) {}
    return {
      nome: det ? det.name : null,
      palpite: Boolean(det && det.palpite),
      paginas: pages.length,
      mm: mm(width) + 'x' + mm(height),
      jaAjustado
    };
  } catch (e) { return vazio; }
}

async function processarBasico(base64, operador) {
  const s = await getSettings();
  if (!s.enabled || s.killSwitch) return null;

  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  let doc;
  try {
    doc = await PDFLib.PDFDocument.load(bytes.buffer, { ignoreEncryption: true });
  } catch (e) { console.error('[Enviagora] PDF inválido:', e.message); return null; }

  try {
    const kw = doc.getKeywords();
    if (kw && String(kw).includes(MARCA)) return null;   // já ajustado: não mexe de novo
  } catch (e) {}

  const pages = doc.getPages();
  if (!pages.length) return null;

  const novo = await PDFLib.PDFDocument.create();
  const W = mmToPt(s.outputWidthMm), H = mmToPt(s.outputHeightMm);
  const indices = s.batchMode ? pages.map((_, i) => i) : [0];

  for (const i of indices) {
    const src = pages[i];
    const tam = src.getSize();
    const det = detectLabel(src, pages.length);
    let crop = det;
    if (!crop) {
      if (!s.processUnknownPdfs) continue;
      crop = { name: 'Desconhecido', left: 0, bottom: 0, width: tam.width, height: tam.height };
    }
    const out = novo.addPage([W, H]);
    await desenhar(novo, out, src, crop, s, operador);
  }

  if (novo.getPageCount() === 0) return null;
  aplicarPreferenciasDeImpressao(novo, s);
  try {
    novo.setKeywords([MARCA]);
    novo.setProducer('IMPRESSORA ENVIAGORA v' + chrome.runtime.getManifest().version);
  } catch (e) {}

  const saida = new Uint8Array(await novo.save());
  let out = ''; const C = 8192;
  for (let i = 0; i < saida.length; i += C) out += String.fromCharCode(...saida.subarray(i, i + C));
  return btoa(out);
}

async function desenhar(novo, outPage, srcPage, crop, s, operador) {
  const W = outPage.getWidth(), H = outPage.getHeight();
  const margem = mmToPt(margemEfetivaMm(s));
  const offX = mmToPt(s.offsetXMm), offY = mmToPt(s.offsetYMm);
  const escala = Math.max(50, Math.min(110, Number(s.safeScale || 100))) / 100;

  const fTs  = Math.max(5, Math.min(14, Number(s.timestampFontSize || 9)));
  const fHdr = Math.max(5, Math.min(14, Number(s.headerFontSize || 8)));
  const fOp  = Math.max(5, Math.min(14, Number(s.operatorNameFontSize || 9)));

  const temTs  = Boolean(s.addTimestamp) && s.timestampPosition !== 'none';
  const temHdr = Boolean(s.addHeaderText) && String(s.headerText || '').trim().length > 0;
  const temOp  = Boolean(s.addOperatorName) && Boolean(operador);

  const linha = (temTs || temOp) ? Math.max(fTs, temOp ? fOp : 0) + 3 : 0;
  const gapTopo  = (temHdr ? fHdr + 3 : 0) + (temTs && ['top','both'].includes(s.timestampPosition) ? linha : 0);
  const gapBaixo = ((temTs && ['bottom','both'].includes(s.timestampPosition)) || temOp) ? linha : 0;

  const dispW = Math.max(20, W - margem * 2);
  const dispH = Math.max(20, H - margem * 2 - gapTopo - gapBaixo);
  const fit = Math.min(dispW / crop.width, dispH / crop.height) * escala;
  const dw = crop.width * fit, dh = crop.height * fit;

  let x = margem + (dispW - dw) / 2 + offX;
  let y = margem + gapBaixo + (dispH - dh) / 2 + offY;
  if (!s.centerContent) { x = margem + offX; y = margem + gapBaixo + offY; }

  const emb = await novo.embedPage(srcPage, {
    left: crop.left, bottom: crop.bottom,
    right: crop.left + crop.width, top: crop.bottom + crop.height
  });
  outPage.drawPage(emb, { x, y, width: dw, height: dh });

  const font = await novo.embedFont(PDFLib.StandardFonts.Helvetica);
  const centro = (t, size) => Math.max(margem, (W - font.widthOfTextAtSize(t, size)) / 2);

  if (temHdr) {
    const t = String(s.headerText).trim();
    outPage.drawText(t, { x: centro(t, fHdr), y: H - margem - fHdr, size: fHdr, font });
  }
  const dataTxt = temTs ? `${s.timestampText || 'DDI:'} ${agora()}` : '';
  const opTxt = temOp ? `OPERADOR: ${operador}` : '';
  const rodape = [dataTxt, opTxt].filter(Boolean).join('   |   ');
  if (rodape && ((temTs && ['bottom','both'].includes(s.timestampPosition)) || temOp)) {
    outPage.drawText(rodape, { x: centro(rodape, fTs), y: margem + 3, size: fTs, font });
  }
  if (temTs && ['top','both'].includes(s.timestampPosition)) {
    outPage.drawText(dataTxt, {
      x: centro(dataTxt, fTs),
      y: H - margem - fTs - (temHdr ? fHdr + 3 : 0), size: fTs, font
    });
  }
}
