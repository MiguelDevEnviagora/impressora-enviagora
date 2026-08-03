# Piloto — 2 máquinas, antes de repetir 60 vezes

**O caminho já está escolhido: auto-hospedado.** A Chrome Web Store leva de horas a dias
para revisar cada atualização, e isso é incompatível com corrigir uma etiqueta errada no
meio do turno.

Este documento não decide mais nada. Ele confirma, em duas máquinas, que o caminho
escolhido funciona no galpão de vocês — antes de alguém repetir o processo sessenta vezes
e descobrir o problema na máquina 37.

Depois daqui, vá para o [ROLLOUT.md](ROLLOUT.md).

---

## A pergunta que sobra

> O Chrome dessas máquinas aceita instalar o CRX auto-hospedado com a política local de
> registro (`ExtensionInstallSources` + `ExtensionInstallAllowlist`), **sem** inscrição no
> Chrome Enterprise Core — e o toggle "Permitir acesso a URLs de arquivo" **fica ligado e
> persiste** depois de reiniciar o Chrome?

### Por que o risco é menor do que parece

Existe um bug conhecido e aberto do Chromium (issues 40159841 e 40300638): extensão
**instalada por política** — a que aparece como "Instalada por política empresarial",
via `ExtensionInstallForcelist` — **não mantém** o acesso a `file://` entre reinícios.
É por isso que force-install está descartado, e os operadores precisam de `file://`:
eles abrem PDFs salvos no disco.

**Não é o nosso caso.** A política que usamos apenas *permite* a instalação; quem instala é
a pessoa, arrastando o arquivo. A extensão fica registrada como instalação normal de
usuário — não aparece como "instalada por política" — e o toggle se comporta como em
qualquer outra extensão.

Ou seja: a expectativa é que funcione. O passo 4 abaixo existe para **confirmar**, não
porque haja motivo forte para duvidar.

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

### Passo 1 — rodar o preparo

Na máquina A: Botão Iniciar → digite `powershell` → botão direito em **Windows PowerShell**
→ **Executar como administrador**. Cole o bloco inteiro:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-RestMethod https://raw.githubusercontent.com/Enviagora/impressora-enviagora/main/scripts/instalar.ps1 -OutFile "$env:TEMP\instalar-enviagora.ps1"
& "$env:TEMP\instalar-enviagora.ps1"
```

O script aplica a política local, baixa a última versão, abre a pasta e imprime o que falta
fazer. É idempotente: rodar duas vezes não quebra nada.

**Feche o Chrome por completo e abra de novo** — a política só passa a valer depois disso.

### Passo 2 — instalar o CRX

`chrome://extensions` → **Modo do desenvolvedor** ligado → arraste o `.crx` **da pasta**
`C:\Impressora-Enviagora` (não da barra de downloads) para dentro da janela.

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

### Passo 4b — o diagnóstico automático concorda?

```powershell
& "$env:TEMP\instalar-enviagora.ps1" -Conferir
```

- [ ] as três linhas saem em verde (política, extensão instalada, `file://` ligado)

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

→ **Siga o [ROLLOUT.md](ROLLOUT.md) nas 60.** Publicar uma correção passa a ser `git tag`,
e as máquinas pegam sozinhas em algumas horas.

### ⚠️ Funcionou numa e na outra não

Não é empate — é pista. Descubra o que difere (versão do Chrome, Home vs Pro, antivírus,
usuário sem direito de administrador) e anote. Muitas vezes é algo pontual e contornável
naquela máquina.

Se a diferença for algo que existe em boa parte do galpão, pare e fale com o Rafael antes
de seguir para as 60.

### ❌ Bloqueou

Critério: não instalou, **ou** instalou mas o toggle de `file://` voltou desligado depois
de reiniciar.

→ **Único caso em que vale reabrir a decisão:** o plano B do [ROLLOUT.md](ROLLOUT.md),
Chrome Web Store "não listada". Avise o Rafael antes — ele descartou esse caminho de
propósito, por causa do tempo de revisão, e a escolha é dele.

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

RESULTADO:  [ ] Confirmado, seguir para as 60     [ ] Travou — falar com o Rafael

Observações: ____________________________________________________________
```
