/* popup.js v16.34 — IMPRESSORA ENVIAGORA
 *
 * O QUE MUDOU NESTA VERSAO, E POR QUE
 * Ate a 16.33 o popup gravava os 34 campos no chrome.storage.sync a cada "Salvar". Isso
 * tornava impossivel saber o que o operador realmente mexeu: padrao gravado e escolha
 * deliberada ficavam identicos no storage. Com o config remoto, essa diferenca e tudo —
 * e o que decide se um ajuste da matriz vale nesta maquina ou nao.
 *
 * Agora o popup grava SO O DELTA: campo cujo valor e igual ao padrao vigente (embutido +
 * remoto) e REMOVIDO do storage e volta a seguir a matriz. Campo diferente fica gravado e
 * ganha do remoto para sempre, ate o operador clicar em "Voltar ao padrao da empresa".
 *
 * A trava por senha nao mudou em nada. Continua valendo o mesmo contrato: sem senha
 * aceita, nunca sai um enabled:false daqui, e o background reverte o que passar por fora.
 */
const CFG = EnviagoraConfig;

const statusEl = document.getElementById('status');
const elEnabled = document.getElementById('enabled');
const boxSenha = document.getElementById('senhaBox');
const inputSenha = document.getElementById('senhaInput');
const erroSenha = document.getElementById('senhaErro');
const avisoOff = document.getElementById('avisoOff');
const elConfigEstado = document.getElementById('configEstado');
const elListaAjustes = document.getElementById('listaAjustes');

// Vira true quando a senha já foi aceita nesta abertura do popup.
let desligamentoLiberado = false;

// Padrão vigente = embutido + remoto. É contra ISTO que o "Salvar" compara para decidir
// o que é ajuste do operador. Preenchido em recarregar().
let baseline = { ...CFG.PADRAO };

function setStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => { statusEl.textContent = ''; }, 2400);
}

function pintarAviso() {
  avisoOff.classList.toggle('on', !elEnabled.checked);
}

function readForm() {
  const result = {};
  for (const key of CFG.CAMPOS) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') result[key] = el.checked;
    else if (el.type === 'number') result[key] = el.value === '' ? NaN : Number(el.value);
    else result[key] = el.value;
  }
  return result;
}

function fillForm(settings) {
  for (const key of CFG.CAMPOS) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(settings[key]);
    else el.value = settings[key];
  }
  pintarAviso();
}

// ── Estado da configuração da empresa ──────────────────────────────────────
function descreverCache(cache, delta) {
  if (!cache) {
    elConfigEstado.innerHTML =
      '<b>Nunca baixou.</b> Rodando com os padrões embutidos na extensão — ' +
      'que é exatamente o comportamento da v16.33. Nada quebrado.';
  } else {
    const quando = new Date(cache.buscadoEm);
    const p2 = (n) => String(n).padStart(2, '0');
    const idade = Math.round((Date.now() - cache.buscadoEm) / 60000);
    const linhas = [
      '<b>Config v' + cache.configVersion + '</b> — ' + Object.keys(cache.campos || {}).length +
      ' campo(s) definidos pela matriz.',
      'Baixado em ' + p2(quando.getDate()) + '/' + p2(quando.getMonth() + 1) + ' às ' +
      p2(quando.getHours()) + ':' + p2(quando.getMinutes()) +
      ' (há ' + (idade < 60 ? idade + ' min' : Math.round(idade / 60) + ' h') + ').'
    ];
    if (cache.killSwitch) {
      linhas.push('<b style="color:#b45309">KILL SWITCH LIGADO</b> — a extensão está pausada ' +
                  'pela central e as etiquetas saem sem ajuste.');
    }
    if (cache.erros && cache.erros.length) {
      linhas.push('<b style="color:#b91c1c">Campos recusados:</b> ' + cache.erros.join('; ') +
                  ' — esses seguem no padrão embutido.');
    }
    elConfigEstado.innerHTML = linhas.join('<br>');
  }

  const meus = CFG.CAMPOS.filter((k) => k !== 'enabled' && k !== 'lockEnabled' &&
                                        delta[k] !== undefined);
  elListaAjustes.innerHTML = meus.length
    ? '<b>Ajustes desta máquina</b> (ganham da matriz): ' + meus.join(', ')
    : 'Esta máquina não tem nenhum ajuste manual — segue 100% o padrão da empresa.';
}

async function recarregar() {
  const { s, cache, delta } = await CFG.carregar();
  baseline = CFG.efetivo(cache && cache.campos, null);
  fillForm(s);
  descreverCache(cache, delta);
}

recarregar();

document.getElementById('buscarConfig').addEventListener('click', async () => {
  elConfigEstado.textContent = 'Buscando…';
  const r = await CFG.atualizarRemoto();
  await recarregar();
  setStatus(r.ok ? 'Configuração da empresa atualizada.'
                 : 'Não consegui buscar (' + r.motivo + ') — seguindo com o ' + r.usando + '.');
});

// ── Trava: interceptar o desligamento ──────────────────────────────────────
// O toggle volta sozinho para ligado enquanto a senha não for aceita. Só depois do
// "Confirmar" o background abre a janela em que um enabled:false é aceito — fora dela
// ele reverte, mesmo que alguém escreva direto no storage.
function pedirSenha() {
  boxSenha.classList.add('on');
  erroSenha.textContent = '';
  inputSenha.value = '';
  setTimeout(() => inputSenha.focus(), 30);
}

function fecharSenha() {
  boxSenha.classList.remove('on');
  inputSenha.value = '';
  erroSenha.textContent = '';
}

elEnabled.addEventListener('change', () => {
  if (elEnabled.checked) { fecharSenha(); pintarAviso(); return; }

  const travaLigada = document.getElementById('lockEnabled').checked;
  if (!travaLigada || desligamentoLiberado) { pintarAviso(); return; }

  elEnabled.checked = true;      // segura ligado até a senha ser aceita
  pintarAviso();
  pedirSenha();
});

document.getElementById('senhaOk').addEventListener('click', async () => {
  const senha = inputSenha.value;
  erroSenha.textContent = 'Verificando…';
  try {
    const r = await chrome.runtime.sendMessage({ action: 'destravar', senha });
    if (r && r.ok) {
      desligamentoLiberado = true;
      elEnabled.checked = false;
      fecharSenha();
      pintarAviso();
      setStatus('Desligamento liberado — clique em Salvar.');
    } else {
      erroSenha.textContent = 'Senha incorreta.';
      inputSenha.select();
    }
  } catch (e) {
    erroSenha.textContent = 'Não consegui falar com a extensão.';
  }
});

inputSenha.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') document.getElementById('senhaOk').click();
});

document.getElementById('senhaCancel').addEventListener('click', () => {
  elEnabled.checked = true;
  fecharSenha();
  pintarAviso();
});

// ── Trocar a senha ─────────────────────────────────────────────────────────
document.getElementById('trocarSenha').addEventListener('click', async () => {
  const st = document.getElementById('statusSenha');
  const senhaAtual = document.getElementById('senhaAtual').value;
  const senhaNova = document.getElementById('senhaNova').value;

  if (String(senhaNova || '').trim().length < 4) {
    st.style.color = '#b91c1c';
    st.textContent = 'A nova senha precisa ter pelo menos 4 caracteres.';
    return;
  }
  st.style.color = '#6b7280';
  st.textContent = 'Alterando…';
  try {
    const r = await chrome.runtime.sendMessage({ action: 'trocarSenha', senhaAtual, senhaNova });
    if (r && r.ok) {
      st.style.color = '#047857';
      st.textContent = 'Senha alterada.';
      document.getElementById('senhaAtual').value = '';
      document.getElementById('senhaNova').value = '';
    } else {
      st.style.color = '#b91c1c';
      st.textContent = 'Senha atual incorreta.';
    }
  } catch (e) {
    st.style.color = '#b91c1c';
    st.textContent = 'Não consegui falar com a extensão.';
  }
});

// ── Salvar (só o delta) ────────────────────────────────────────────────────
document.getElementById('save').addEventListener('click', () => {
  const dados = readForm();

  // Cinto de segurança: sem senha aceita, nunca sai um enabled:false daqui.
  if (dados.enabled === false && dados.lockEnabled && !desligamentoLiberado) {
    elEnabled.checked = true;
    pintarAviso();
    pedirSenha();
    return;
  }

  // Valida antes de gravar. Campo fora da faixa é recusado com nome e motivo, em vez de
  // ser cortado em silêncio — silêncio aqui vira etiqueta errada lá na frente.
  const problemas = [];
  for (const k of Object.keys(dados)) {
    const r = CFG.validarCampo(k, dados[k]);
    if (!r.ok) problemas.push(k + ' (' + r.motivo + ')');
    else dados[k] = r.valor;
  }
  if (problemas.length) {
    setStatus('Não salvei — corrija: ' + problemas.join(', '));
    return;
  }

  const gravar = {};
  const remover = [];
  for (const k of CFG.CAMPOS) {
    if (dados[k] === undefined) continue;              // campo sem controle no popup
    if (dados[k] === baseline[k]) remover.push(k);     // igual ao padrão: volta a seguir a matriz
    else gravar[k] = dados[k];                         // ajuste do operador: ganha do remoto
  }
  gravar.settingsSchemaVersion = CFG.SCHEMA_VERSION;

  const aplicar = () => chrome.storage.sync.set(gravar, async () => {
    await recarregar();
    const n = Object.keys(gravar).length - 1;
    setStatus(n ? 'Salvo — ' + n + ' ajuste(s) desta máquina.'
                : 'Salvo — esta máquina segue 100% o padrão da empresa.');
  });
  if (remover.length) chrome.storage.sync.remove(remover, aplicar); else aplicar();
});

// ── Voltar ao padrão da empresa ────────────────────────────────────────────
// Apaga os ajustes locais e devolve a máquina ao padrão vigente (embutido + remoto).
// Não mexe em enabled nem em lockEnabled: estado de segurança é outra conversa.
document.getElementById('reset').addEventListener('click', () => {
  const apagar = CFG.CAMPOS.filter((k) => k !== 'enabled' && k !== 'lockEnabled');
  chrome.storage.sync.remove(apagar, async () => {
    await recarregar();
    setStatus('Pronto — esta máquina voltou ao padrão da empresa.');
  });
});
