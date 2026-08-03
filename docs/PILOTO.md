# Piloto — 2 máquinas, antes de qualquer rollout

Existe **uma incerteza que só o teste resolve**, e ela decide qual dos dois caminhos de
distribuição a Enviagora vai seguir. Este documento é para descobrir isso em duas máquinas
em vez de descobrir em sessenta.

Não continue para o [ROLLOUT.md](ROLLOUT.md) antes de terminar aqui.

---

## A pergunta

> O Chrome dessas máquinas aceita instalar um CRX auto-hospedado usando política local de
> registro (`ExtensionInstallSources` + `ExtensionInstallAllowlist`), **sem** inscrição no
> Chrome Enterprise Core — e o toggle "Permitir acesso a URLs de arquivo" **fica ligado e
> persiste** depois de reiniciar o Chrome?

Pode funcionar. Pode ser bloqueado, dependendo da versão do Chrome e do estado da máquina.
Ninguém consegue responder isso lendo documentação: as duas coisas mudaram de comportamento
mais de uma vez nos últimos anos.

### Por que a pergunta é essa e não outra

Force-install (`ExtensionInstallForcelist`) está **descartado** e não deve ser proposto:
extensão marcada como "Instalada por política empresarial" **não mantém** o acesso a
`file://`, e o checkbox não persiste entre reinícios. É limitação conhecida e aberta do
Chromium (issues 40159841 e 40300638). E os operadores **precisam** de `file://`: eles
abrem PDFs salvos no disco.

Ou seja: o que estamos testando é o caminho que **permite** a instalação sem force-install,
mantendo o toggle nas mãos de quem instala.

---

## Preparação

**Escolha 2 máquinas representativas.** Não pegue as duas melhores. O ideal é:

- uma máquina de uso pesado, do dia a dia da expedição;
- uma máquina que costuma dar problema, ou a mais antiga do galpão.

**Anote antes de começar**, para cada uma:

| | Máquina A | Máquina B |
|---|---|---|
| Identificação (etiqueta/nome na rede) | | |
| Versão do Chrome (`chrome://version`) | | |
| Windows é Home ou Pro? (`winver`) | | |
| Já tem a Impressora Enviagora instalada? | | |

> A coluna "Home ou Pro" importa: o Windows Home não tem Editor de Política de Grupo, e o
> `instalar.ps1` escreve direto no registro justamente por isso. Se der diferença entre as
> duas máquinas, provavelmente é aqui.

---

## O teste

### Passo 1 — rodar o instalador

Na máquina A, com o **PowerShell como administrador**:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\instalar.ps1
```

O script aplica a política local, baixa a última versão e imprime na tela o que falta
fazer. Ele é idempotente: rodar duas vezes não quebra nada.

### Passo 2 — instalar o CRX

Siga o que o script imprimiu. Ele vai pedir para arrastar o arquivo `.crx` para a janela
`chrome://extensions` com o Modo do desenvolvedor ligado.

**Anote o que aconteceu**, palavra por palavra se der erro:

- [ ] instalou normalmente
- [ ] apareceu "Não é possível adicionar aplicativos, extensões e scripts de usuário deste site"
- [ ] apareceu "Este tipo de arquivo pode danificar seu computador" e sumiu
- [ ] apareceu "CRX_REQUIRED_PROOF_MISSING"
- [ ] outra coisa: ______________________

### Passo 3 — ligar o `file://`

`chrome://extensions` → **Detalhes** na Impressora Enviagora → ligar **Permitir acesso a
URLs de arquivo**.

- [ ] o toggle existe e liga

### Passo 4 — o teste que realmente decide

1. Feche o Chrome **completamente** (confira no Gerenciador de Tarefas que não sobrou
   nenhum processo `chrome.exe`).
2. Reinicie o computador.
3. Abra o Chrome e volte em `chrome://extensions` → Detalhes.

- [ ] **"Permitir acesso a URLs de arquivo" continua LIGADO**

### Passo 5 — funciona de verdade?

1. Salve um PDF de etiqueta no disco e abra com duplo clique.
   - [ ] a etiqueta sai ajustada em 100×150 mm
2. Imprima uma etiqueta pelo WMS, do jeito normal.
   - [ ] sai ajustada
3. Imprima uma etiqueta dos **Correios**.
   - [ ] sai no tamanho cheio, colada na borda, e o leitor bipa
4. Abra a extensão, item 9.
   - [ ] mostra "Config v1" com data e hora recentes

### Passo 6 — repita tudo na máquina B

Sem pular passos. É comum a A funcionar e a B não.

---

## A decisão

### ✅ Funcionou nas duas

Critério: **instalou, e o toggle de `file://` continua ligado depois de reiniciar** (passo
4), e os passos 5.1 a 5.4 passaram.

→ **Siga a trilha A do [ROLLOUT.md](ROLLOUT.md): auto-hospedado.**

O que você ganha: atualização instantânea, sem revisão de ninguém. Publicar uma correção é
`git tag` e esperar as máquinas pegarem sozinhas.

### ⚠️ Funcionou numa e na outra não

Não é empate — é resposta. Descubra o que difere (versão do Chrome, Home vs Pro, antivírus,
usuário sem direito de administrador) e anote. Se a diferença for algo que existe em boa
parte do galpão, trate como "bloqueou".

Na dúvida, **trate como bloqueou**. O plano B funciona nas duas.

### ❌ Bloqueou

Critério: não instalou, **ou** instalou mas o toggle de `file://` voltou desligado depois
de reiniciar.

→ **Siga a trilha B do [ROLLOUT.md](ROLLOUT.md): Chrome Web Store "não listada".**

- US$ 5, uma vez na vida
- auto-update nativo, zero configuração nas máquinas
- como a instalação é normal (não por política), o toggle de `file://` **funciona e
  persiste**
- o preço é a revisão do Google a cada atualização: horas a dias

> **A revisão do Google é exatamente o motivo de o config remoto existir.** Com ele, ajuste
> de margem, texto de cabeçalho e o kill switch valem em **1 hora** sem passar por revisão
> nenhuma — porque não são atualização da extensão, são dados. Só mudança de lógica precisa
> de release novo. Na prática, a trilha B é bem menos dolorosa do que parece.

O repositório já está pronto para os dois desfechos: o `build.mjs` gera
`impressora-enviagora-<versão>-webstore.zip` no formato que a Web Store aceita, sem `key` e
sem `update_url`.

---

## Registro do piloto

Preencha e guarde. Se o rollout der problema daqui a três meses, é isto que vai explicar.

```
Data do piloto: ____/____/______     Quem executou: ______________________

MÁQUINA A ______________  Chrome ________  Windows: Home / Pro
  passo 2 (instalou)          [ ] sim  [ ] não   erro: ____________________
  passo 4 (toggle persistiu)  [ ] sim  [ ] não
  passo 5 (imprimiu certo)    [ ] sim  [ ] não

MÁQUINA B ______________  Chrome ________  Windows: Home / Pro
  passo 2 (instalou)          [ ] sim  [ ] não   erro: ____________________
  passo 4 (toggle persistiu)  [ ] sim  [ ] não
  passo 5 (imprimiu certo)    [ ] sim  [ ] não

DECISÃO:  [ ] Trilha A — auto-hospedado     [ ] Trilha B — Web Store não listada

Observações: ____________________________________________________________
```
