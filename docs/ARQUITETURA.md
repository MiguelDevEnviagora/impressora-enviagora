# Arquitetura

Para quem vai mexer no código. Se você só quer instalar, vá para
[ROLLOUT.md](ROLLOUT.md).

Este documento explica **por que** cada decisão existe. A maior parte delas é cicatriz de
um bug que foi para produção, e o histórico completo está em
[HISTORICO-v16.33.txt](HISTORICO-v16.33.txt).

---

## O que a extensão faz

O WMS gera o PDF da etiqueta de envio (Amazon, Shopee, Mercado Livre, Correios) e manda
imprimir. Cada transportadora entrega num formato diferente — A4 com a etiqueta num
quadrante, A4 com duas páginas, 100×150 mm já pronto. A extensão intercepta esse PDF,
acha onde está a etiqueta de verdade, recorta, reencaixa em 100×150 mm, carimba cabeçalho
+ DDI + operador, e devolve para a impressora térmica.

Ela roda em ~60 computadores Windows **sem gestão central**: sem Active Directory, sem
Entra ID, sem MDM, sem console de administração.

---

## O caminho da etiqueta

Existem três portas de entrada, e a divisão Nível 1 / Nível 2 é diferente em cada uma.

### Caminho 1 — PDF em blob dentro de iframe (o do WMS, o principal)

```
hook.js  (MUNDO MAIN, document_start, all_frames)
 │  monkey-patch em URL.createObjectURL — captura os bytes na CRIAÇÃO do blob,
 │  antes de o site revogar a URL. Registra em `pendentes` (url → promessa).
 │  postMessage {__enviagora:'processar', token, b64}
 ▼
content.js  (mundo ISOLADO)
 │  lê o nome do operador do DOM (span.d-none.d-md-inline.ml-2)
 │  chrome.runtime.sendMessage {action:'cropPdf'}
 ▼
background.js  ── kill switch? → devolve null, o original imprime
 │              └─ ehEtiquetaConhecida() → detectLabel()
 │
 ├─ CONHECIDA (Amazon-geo / Shopee / Mercado Livre)
 │     └─► NÍVEL 1: processarBasico() — pdf-lib puro, poucos ms.
 │         NÃO consulta o motor: o WMS dispara print() logo em seguida e não espera.
 │
 └─ DESCONHECIDA (Correios)
       └─► NÍVEL 2: pedirAoMotor(tabId), teto de 8 s
             injeta lib/pdf.min.js, pdf-lib.min.js, crop-etiqueta.js,
                    config-padrao.js, labeler.js, motor.js
             labeler.processar():
                analisar() = pdf.js → texto + render em canvas 2× → bbox de tinta
                ehTextoCorreios() pode DERRUBAR o palpite geo:true
                desenhar(..., fillFirst = correios && correiosFillFirst)
             motor mudo em 8 s → cai em processarBasico()
 ▼
volta: background → content.js → postMessage 'pronto' → hook.js
 │  cria blob novo, troca iframe.src (MESMO iframe), espera load (teto 4 s)
 │  alvo.focus() → alvo.print()
 └─ devolve o foco e dispara 'afterprint' na janela e no top (0 ms e 400 ms)
```

O `afterprint` sintético não é enfeite: muitos fluxos do WMS continuam a partir dele, e
ele **não dispara na janela principal quando quem imprimiu foi o iframe**. Sem isso a
tela ficava "travada" até o operador clicar em algum lugar.

### Caminho 2 — PDF ocupando a aba inteira (`file://` e link direto)

```
background.webNavigation.onCommitted (frameId 0) → pareceEtiquetaPdf(url)
 └─ chrome.tabs.update → viewer.html?auto=1&src=…        (MESMA aba, nunca abre outra)
      viewer.js → fetch(src) → EnviagoraLabeler.processar()   ← Nível 2 completo
      mostrar() → iframe → contentWindow.print()
```

**É este caminho que exige "Permitir acesso a URLs de arquivo".** Sem o toggle, o
`fetch` no viewer falha e o operador cai no seletor manual de arquivo.

### Caminho 3 — pré-aquecimento

`webNavigation.onCompleted` em URLs que casam com
`stokki|enviagora|wms|cockpit|packaging|expedicao` injeta o motor **antes** de a primeira
etiqueta aparecer. Foi o que resolveu a intermitência da primeira impressão: sem isso, a
primeira etiqueta pegava o motor frio (1,7 MB de scripts carregando) e o hook soltava o
PDF cru antes de ele ficar pronto.

### Onde a linha cai

| | **Nível 1** — service worker | **Nível 2** — motor / viewer |
|---|---|---|
| onde roda | `background.js` | content script no frame 0, ou `viewer.html` |
| tem canvas/DOM | não | sim |
| bibliotecas | pdf-lib + crop-etiqueta | + pdf.js + labeler |
| detecta | geometria 4×6 e tamanho de página | idem **+ texto + bbox de tinta** |
| atende | Amazon, Shopee, Mercado Livre | **Correios** (é o único que sabe) |
| `correiosFillFirst` | não existe | sim |
| custo | poucos ms | 7–206 ms |

Guardas de tempo, de fora para dentro: `hook TETO_MS 8000` → `background guarda 12000` →
`motor prazo 8000` → `motorVivo ping 400`. **O teto do hook (8 s) é menor que o do
background (12 s)**, então na prática o background nunca chega a usar os 12 s neste
caminho. Não foi mexido — é comportamento observado em produção e mexer aqui sem medir é
como o time entrou na regressão da 16.19.

---

## As quatro correções que não podem regredir

Cada uma tem um teste em `tests/invariantes.test.mjs` que falha se ela sumir do código.

### 1. A detecção da Amazon é geométrica

Até a v16.31 a transportadora era adivinhada pela **quantidade de páginas**: "A4 com mais
de uma página = Amazon; A4 com uma página = Shopee". Etiqueta da Amazon sem a lista de
postagem anexa vem com uma página só — caía no ramo do Shopee e era recortada em
`bottom: 398`, a metade de cima da folha, que na Amazon está em branco.

O que não muda entre as variantes é estrutural: a etiqueta é sempre desenhada dentro de um
Form XObject de **4×6 polegadas (288 × 432 pt)**; o que muda é só a matriz que cola esse
bloco na folha. O detector (`crop-etiqueta.js`) percorre o content stream rastreando
`q`/`Q`/`cm`, desce nos XObjects aninhados, acha o bloco 4×6 e transforma os quatro cantos
pela CTM acumulada.

### 2. A guarda de área (`fracao > 0.70 → null`)

A tolerância de 6% sobre 288×432 pt **também alcança 283×425 pt, que é 100×150 mm — o
tamanho exato da etiqueta dos Correios.** Numa etiqueta dos Correios que já vem no tamanho
final, o "bloco 4×6" encontrado é a página inteira, e devolver isso como Amazon fazia o
fluxo **pular o recorte dos Correios**.

O detector só faz sentido quando há uma etiqueta **pequena** dentro de uma folha **maior**.
Amazon ocupa ~25% da folha A4; Correios no tamanho final ocupa 100%.

### 3. O palpite geométrico é derrubável (`geo: true`)

`detectLabel` marca o resultado geométrico com `geo: true`, e em `labeler.js` o teste de
texto dos Correios (`Contrato:`, `SEDEX`, código `AA999999999BR`) pode sobrepô-lo. Texto é
sinal muito mais específico do que "existe um bloco 4×6 nesta folha".

### 4. Os Correios saem no tamanho cheio

`printSafeMarginMm` nasce em 0 e **nunca** se aplica ao caminho "preencher a largura" dos
Correios (`const piso = fillFirst ? 0 : …`). A etiqueta dos Correios precisa sair colada na
borda: com margem branca lateral o leitor dos Correios não bipa. Quem manda ali é
`correiosMarginMm` (1 mm), com teto de **3 mm** no esquema de validação.

**Se você aumentar essa margem, quebra a operação.**

---

## Configuração remota

### Por quê

Olhando o que muda entre versões, quase toda "atualização" é ajuste de parâmetro, não de
lógica: `outputWidthMm`, `marginMm`, `correiosMarginMm`, `correiosPadMm`, `safeScale`,
`headerText`, `offsetXMm/YMm`. Publicar uma extensão nova para mudar uma margem é caro —
e no plano B (Web Store) custa ainda uma revisão do Google de horas a dias.

### Como funciona

```
config/defaults.json  ──(config.yml)──►  Pages  ──(fetch)──►  60 máquinas
                                                   onStartup
                                                   onInstalled
                                                   chrome.alarms, 60 min
```

Precedência, do mais fraco para o mais forte:

```
PADRAO embutido  <  config remoto  <  ajuste manual do operador
```

### A mudança de storage que fez isso funcionar

Até a v16.33 o `onInstalled` gravava os 34 campos no `chrome.storage.sync`. Depois disso,
*"o operador escolheu 2 mm"* e *"2 mm é só o padrão que foi gravado sozinho"* eram
**indistinguíveis** no storage.

Isso não é detalhe: sem essa distinção, "o remoto define o padrão, o ajuste manual
continua ganhando" é impossível de implementar. Ou o remoto nunca vale nada (tudo parece
ajuste manual), ou ele atropela o ajuste que o operador fez de verdade.

Da v16.34 em diante o `sync` guarda **só o delta**. A migração é conservadora:

| valor salvo na 1633 | o que acontece |
|---|---|
| igual ao padrão da 1633 | nunca foi tocado → sai do sync e passa a seguir o remoto |
| diferente do padrão | ajuste real → fica exatamente como está |

O valor **efetivo não muda para ninguém** nesta atualização.

### A regra de ouro

Se o fetch falhar, se o JSON for inválido, ou se qualquer campo vier fora de faixa, vale o
que já estava. GitHub fora do ar **nunca** pode parar a impressão. São três níveis:

1. busca falhou → usa o cache em `chrome.storage.local`
2. sem cache → usa o `PADRAO` embutido
3. campo inválido no meio de um JSON válido → só aquele campo cai no embutido; os outros
   valem, e o motivo aparece no item 9 do popup

### O kill switch

`killSwitch: true` no `defaults.json` corta os quatro caminhos de interceptação e deixa o
PDF original imprimir, exatamente como se a extensão não estivesse instalada. Uma tarja
**âmbar** no topo da tela avisa que a pausa é central — cor diferente da tarja **vermelha**
do desligamento local, porque a ação esperada do operador é oposta: na âmbar, não mexer.

Ele é publicado pelo `config.yml`, que **não usa o secret de assinatura**. O caminho de
emergência é de propósito o mais curto e o que depende de menos coisas.

### O que NÃO é configurável remotamente

`enabled` e `lockEnabled`. Um `enabled: false` vindo do servidor seria uma porta dos fundos
na trava por senha. A parada de emergência é o `killSwitch`, que é outra coisa e não mexe
no estado local da máquina.

---

## Distribuição

### Por que force-install está descartado

A extensão precisa de `file://` — os operadores abrem PDFs salvos no disco, e o
`background.js` trata `file:` explicitamente. Mas extensão instalada por política
(`ExtensionInstallForcelist`) **não mantém o acesso a `file://`**: o checkbox não persiste
entre reinícios em extensão marcada como "Instalada por política empresarial". É limitação
conhecida e aberta do Chromium (issues 40159841 e 40300638).

O Chrome 137+ também removeu a flag `--load-extension`, então automatizar instalação
unpacked por linha de comando não é saída.

### Por que o repositório é público

O Chrome **não autentica** ao consultar a `update_url`: sem token, sem cookie, sem header.
Logo o endpoint de atualização é obrigatoriamente público — não existe auto-update a partir
de repositório privado.

Decisão tomada com consciência de que código de extensão Chrome não é segredo em cenário
nenhum: qualquer operador abre a pasta e copia. O que **não** é público é a chave privada.

### A chave e o ID

O ID da extensão sai dos 16 primeiros bytes do SHA-256 da chave **pública**. O campo `key`
no manifest trava esse ID, e o ID travado é o que faz o toggle de `file://` sobreviver às
atualizações e à migração de unpacked para CRX. Sem ele, cada instalação vira uma extensão
diferente e o problema volta.

- `config/chave-publica.txt` — versionada, define o ID: `kigacgfagjemjheogplplhcneolndhan`
- `chave-privada.pem` — **nunca** entra no repositório. Cofre da empresa + secret
  `CRX_PRIVATE_KEY` no Actions.

O `build.mjs` **aborta** se a privada não corresponder à pública versionada: assinar com a
chave errada geraria outro ID, e as máquinas parariam de receber atualização **sem erro
visível em lugar nenhum**.

#### Perdi a chave

É um incidente, não um contratempo. Sem ela não há como publicar atualização para quem já
está instalado. O caminho é: gerar par novo, publicar como extensão nova, e passar nas 60
máquinas removendo a antiga, instalando a nova e remarcando o toggle de `file://` — uma
vez. Depois disso, guardar a chave direito.

#### Vazou a chave

Qualquer um passa a conseguir assinar um CRX que o Chrome aceita como atualização legítima
desta extensão. Mesmo procedimento acima, com urgência.

---

## Permissões — justificativa uma a uma

Permissão a mais é o que mais reprova extensão na revisão da Web Store, que é o plano B.
`scripts/validate.mjs` reprova o build se aparecer alguma fora desta lista.

| permissão | por que é necessária |
|---|---|
| `storage` | configurações do operador, cache do config remoto, janela de desbloqueio da trava |
| `alarms` | rebuscar o config remoto de hora em hora. **Sem ela a API não existe e o refresh falha em silêncio** |
| `scripting` | injetar o motor (canvas/pdf.js) no frame do WMS — o único jeito de ter canvas ignorando a CSP do site |
| `webNavigation` | detectar o PDF em blob e o PDF em aba própria no momento certo |
| `tabs` | trocar a aba pelo `viewer.html` e falar com o motor por `tabs.sendMessage` |
| `<all_urls>` | o WMS e os PDFs de etiqueta não têm domínio fixo |
| `file://*/*` | operadores abrem etiquetas salvas no disco |

MV3 proíbe código remoto: `pdf-lib`, `pdf.js` e o detector continuam **embutidos**. Só
dados/config vêm de fora.

---

## Anotado, não corrigido

Coisas que parecem erradas e que **não** foram mexidas, porque o combinado era não
refatorar a lógica de impressão. Cada uma precisa de uma decisão explícita.

1. **`centerContent` só existe no Nível 1.** `background.js` respeita; `labeler.js` ignora
   e sempre centraliza. Na prática: etiqueta dos Correios com `centerContent: false` sai
   centralizada mesmo assim. Ninguém reclamou até hoje.

2. **O `afterprint` sintético é disparado 0 ms depois do `print()`.** Em `hook.js`,
   `setTimeout(retomar, 0)` avisa o site que a impressão terminou praticamente no mesmo
   instante em que ela começou. Se o fluxo do WMS reage ao `afterprint` carregando a
   próxima etiqueta no mesmo iframe, ele derruba o preview que acabou de abrir — e o
   sintoma seria o mesmo "Falha ao imprimir".

   **Correção da premissa (v16.36.1):** `print()` **não** bloqueia neste contexto — o
   diagnóstico de produção registrou `print-chamado ms=0`, `ms=1` e `ms=2` em impressões
   que deram certo. A parte "naturalmente seguro" abaixo está errada; o que protege hoje
   é a guarda de eco (`bloquearEcoDePrint`), e ela aparece funcionando no log
   (`print-eco-bloqueado desdeUltimoPrint=0`, em toda etiqueta).

   **Não foi mexido**, por dois motivos: em Chrome moderno `window.print()` bloqueia o
   script até o diálogo fechar, o que tornaria o disparo naturalmente seguro; e esse
   `afterprint` é o que corrigiu a tela do WMS travando depois de imprimir, um bug que
   custou caro. Se o "Falha ao imprimir" persistir depois do assentamento
   (`printSettleMs`), **esta é a próxima hipótese a testar** — e o teste é subir o
   `printSettleMs` primeiro, que é grátis e reversível.

3. **O teto do hook (8 s) é menor que o do background (12 s).** O background nunca chega a
   usar a folga que ele mesmo se deu. Provavelmente inofensivo, mas os dois números foram
   escolhidos em momentos diferentes e ninguém os comparou.

4. **`pareceEtiquetaPdf` casa por palavra na URL** (`etiqueta`, `label`, `correios`,
   `sigep`, `declaracao`, `romaneio`). Um relatório com "romaneio" no nome seria tratado
   como etiqueta e recortado em 100×150 mm.

5. **Etiqueta dos Correios em folha A4 é classificada como Shopee no caminho do WMS.**
   Descoberto em 19/08/2026, rodando o código real contra uma etiqueta que falhou em
   produção (`Contrato: 9912733639 PAC CONTRATO`, produzida pelo `openhtmltopdf`):

   ```
   tamanho: 595.27 x 841.88 pt = 210x297 mm   (A4 retrato, 1 página)
   detectLabel (background.js): Shopee        <- regra "A4 retrato + 1 página"
   ehTextoCorreios(texto):      true          <- "Contrato" + "PAC"
   ```

   Os dois caminhos discordam, e o motivo é estrutural:

   - **`viewer.js` acerta.** Ele usa `labeler.js`, onde `podeCorreios` deixa o teste de
     texto derrubar o palpite "Shopee". O log de produção confirma:
     `viewer-ajustado info=pág 1: CORREIOS (recortada)`.
   - **`background.js` erra.** Reconhecendo "Shopee", ele toma o **caminho rápido** e
     nunca consulta o motor — então o teste de texto dos Correios não chega a rodar, e a
     etiqueta é recortada no retângulo da Shopee (`bottom: 398, 300x444`).

   O caminho rápido existe por um motivo real: o WMS chama `print()` logo depois, e
   esperar o motor custaria a impressão. Fazer A4-retrato-1-página passar pelo motor
   consertaria os Correios e **atrasaria toda etiqueta legítima da Shopee**.

   **Atualização de 19/08:** a matriz de estresse mostrou que **3 das 7 etiquetas reais
   dos Correios das fixtures têm exatamente essa forma** (A4, 1 página) — não é caso
   raro. O recorte "Shopee" pega o quadrante superior esquerdo, onde a etiqueta dos
   Correios costuma estar, e por coincidência geométrica o resultado costuma servir.
   Proposta de correção e a pergunta que decide se ela é necessária: ver
   [PLANO-DE-MELHORIA.md](PLANO-DE-MELHORIA.md), item P1-1.

   **Não foi mexido: é decisão da operação, não minha.** O log traz duas ocorrências de
   `crop-entrou detectada=Shopee mm=210x297` que podem ser Shopee de verdade ou Correios
   mal classificado — pelo log não dá para saber. A pergunta a responder antes de mexer:
   *as etiquetas dos Correios chegam pelo WMS, ou só pelo caminho do arquivo/link
   (`viewer.js`)?* Se só pelo viewer, não há bug em produção e nada precisa mudar.

6. ~~A senha de fábrica está no código e precisa ser trocada máquina a máquina.~~
   **Resolvido na v16.35, por decisão da operação:** a senha virou uma constante única
   (`impressora-enviagora`) e o caminho de troca saiu do popup. O motivo é bom — trocar
   senha em 60 máquinas era mais um passo manual no rollout, e senha diferente em cada
   uma vira chamado de suporte quando ninguém lembra qual é.

   O que isso custa, dito na cara: **o repositório é público, então a senha é legível por
   qualquer um.** Ela nunca foi segredo de verdade (qualquer operador abre a pasta da
   extensão e lê), e o que a trava realmente entrega continua igual: ninguém desliga a
   extensão *sem querer*, e desligamento feito por fora do popup é revertido pelo
   background. Para impedir um desligamento *deliberado*, só política corporativa —
   nenhuma extensão consegue bloquear `chrome://extensions`.

---

## Mapa dos arquivos

```
src/
  manifest.json        MV3. version, key e update_url são injetados pelo build.
  background.js        Service worker. Nível 1, roteamento, trava por senha, config remoto.
  config-padrao.js     Fonte única dos padrões + ESQUEMA de validação. Roda nos 3 contextos.
  crop-etiqueta.js     Detector geométrico do bloco 4×6. pdf-lib puro, < 3 ms.
  labeler.js           Nível 2 completo: texto, bbox de tinta, Correios, desenho.
  motor.js             Cola do labeler como content script. Fila serial de uma etiqueta.
  hook.js              MUNDO MAIN. Captura o blob e intercepta print().
  content.js           Ponte hook ↔ background. Tarjas de aviso.
  viewer.js/.html      PDF em aba própria. Caminho do file://.
  popup.js/.html       Configurações, trava por senha, estado do config remoto.
  icones/              Ícones da marca, gerados por scripts/gerar-icones.mjs.

scripts/
  build.mjs            ZIP auto-hospedado + ZIP Web Store + CRX assinado. Determinístico.
  gerar-site.mjs       Monta _site/ para o Pages. NÃO precisa da chave privada.
  gerar-chave.mjs      Par RSA. Roda uma vez na vida do projeto.
  bump.mjs             Sobe a versão em package.json e manifest juntos.
  gerar-icones.mjs     Ícones 16/32/48/128 a partir da marca. Sem dependência.
  validate.mjs         Confere manifest, defaults.json e chave antes de empacotar.
  instalar.ps1         Setup one-shot por máquina, como administrador.
  lib/zip.mjs          Escritor de ZIP, sem dependência.
  lib/crx.mjs          Empacotador CRX3 + derivação do ID.

tests/
  fixtures/            12 etiquetas reais + esperado.json. O ativo mais valioso do projeto.
  deteccao.test.mjs    Tarefa 1: as 12, nos dois sentidos, tolerância de 1 pt.
  config.test.mjs      Padrões, validação, precedência, defaults.json publicado.
  invariantes.test.mjs Guardas no fonte das 4 correções que não podem regredir.
```
