# Plano de melhoria — análise completa antes de publicar

**Data:** 19/08/2026 · **Versão analisada:** 16.36.5 (a que está nas máquinas)

**Regra deste plano: nada chega às 60 máquinas sem o OK do Rafael.** Publicar = criar a
tag/Release, que atualiza o `updates.xml`. Commit na `main` NÃO publica nada — as máquinas
só enxergam Release. Tudo o que este documento descreve como "pronto" está na `main`,
esperando o portão da seção 6.

---

## 1. Todos os caminhos por onde uma impressão pode acontecer

Numa máquina da operação existem **dez** caminhos. Cada um com quem o cobre e o risco real:

| # | Caminho | Quem cobre | Risco hoje |
|---|---------|-----------|------------|
| 1 | **WMS → PDF em iframe → `print()` do site** (o caminho principal) | `hook.js`: fila, assentamento 400 ms, guarda de eco | É onde vive o "Falha ao imprimir". Três processamentos por etiqueta até a 16.36.5; um só a partir da correção |
| 2 | **WMS → `window.print()` da própria tela** | Bloqueado por 3 s após o nosso afterprint (`bloquearPrintDaTela`) | Folha preta se a guarda for desligada |
| 3 | **PDF blob em aba inteira** | `content.js` troca pelo ajustado | Baixo |
| 4 | **O documento aberto É o PDF** | `hook.js` seção 3 (com log desde a 16.36.4) | Baixo |
| 5 | **`file://` → PDF do disco** | `viewer.html` + `labeler.js` (é o caminho que ACERTA os Correios) | Reimpressão manual em caso de falha exige F5 |
| 6 | **Link `http(s)` de PDF** (`interceptHttpPdfs: true`) | idem viewer | `pareceEtiquetaPdf` casa "romaneio"/"declaracao" na URL — um relatório com esse nome viraria 100×150 mm |
| 7 | **Arrastar PDF no viewer** | viewer manual | Baixo |
| 8 | **Ctrl+P do operador na tela do WMS** | NÃO interceptado (agora ao menos deixa rastro: `print-beforeprint`) | Imprime a tela; é comportamento do Chrome, não defeito nosso |
| 9 | **Botão de imprimir do visualizador de PDF do Chrome** | Inalcançável — nenhum script roda dentro do PDFium | Imprime o que estiver no visualizador (se o PDF já foi trocado, sai o ajustado) |
| 10 | **Fora do Chrome** (Adobe, impressão do Windows) | Fora do alcance de qualquer extensão | Sai o original, sem ajuste |

Os caminhos 8–10 nenhuma extensão consegue interceptar — o que dá para fazer é orientação
de operação (imprimir sempre pelo WMS/viewer) e rastro no diagnóstico, que agora existe.

---

## 2. O que os testes de estresse encontraram (rodados hoje, com o código real)

Harness novo: o `background.js` **de verdade** rodando dentro do Node sobre um `chrome.*`
simulado (`tests/ajuda/chrome-falso.mjs`). Não simula o timing do Chrome; simula as
interfaces, o que basta para estressar a lógica. Cinco baterias:

### 2.1 GRAVE, já corrigido na `main`: a chave de deduplicação colidia

A 16.36.5 (publicada) deduplica pedidos idênticos pela chave `tamanho + primeiros/últimos
64 caracteres do base64`. O estresse com 20 PDFs **diferentes** do mesmo gerador derrubou
isso em minutos: **18 dos 20 foram tratados como repetição** — mesmo gerador dá o mesmo
começo, e dois PDFs com o mesmo tamanho têm o mesmo fim (o fim é o `startxref`, que só
depende do tamanho).

Colisão aqui não é desperdício: **é a etiqueta de um cliente saindo na encomenda de
outro.** Na prática exige mesmo tamanho em bytes + mesma janela de 4 s + mesmo operador —
raro, mas com 60 máquinas × centenas de etiquetas/dia, "raro" é questão de tempo.

**Correção (na `main`, não publicada):** a chave passou a ser um hash FNV-1a do conteúdo
**inteiro** (1–2 ms por MB, sem guardar nenhum byte da etiqueta). Reteste: 20/20 saídas
distintas. Virou teste permanente (`tests/background.test.mjs`) para nunca regredir.

### 2.2 Entradas hostis: 10 de 10 respondem "sem ajuste", nunca travam

base64 vazio, lixo, PDF truncado em 10% e 90%, cabeçalho PDF com corpo de lixo, zip
fingindo ser PDF, `undefined`, `null`, número — todas respondem `{croppedBase64: null}`
em menos de 80 ms e o chamador imprime o original. É a regra de ouro funcionando.

### 2.3 Um turno de 300 etiquetas: latência e memória estáveis

12 PDFs reais das fixtures, 3 operadores, 300 pedidos: p99 = 51 ms, máximo = 77 ms,
heap de 7 → 9 MB (estável), diagnóstico respeitando o teto de 300 eventos, janela de
dedupe esvaziando corretamente após 4 s.

### 2.4 Matriz de detecção: o achado dos Correios ficou MAIOR

Rodando os dois detectores (o do WMS e o do viewer) sobre os 12 PDFs das fixtures + os 2
PDFs de produção que falharam:

- **3 das 7 etiquetas reais dos Correios são A4 de 1 página → o caminho do WMS as
  classifica como "Shopee"** e nunca consulta o motor. Não é caso raro: é quase metade
  das fixtures dos Correios.
- O recorte "Shopee" pega o quadrante superior esquerdo da folha — onde a etiqueta dos
  Correios costuma estar. **Por coincidência geométrica o resultado costuma servir**, e é
  por isso que ninguém gritou até hoje.
- O viewer (caminho do arquivo) acerta: o teste de texto derruba o palpite.
- A etiqueta J&T 76×130 e as 100×150 prontas vão ao motor corretamente.

### 2.5 Config remoto hostil e inundação do diagnóstico: passou tudo

8 payloads maliciosos/quebrados (desligar remoto, valores fora de faixa, string de 1 MB,
unicode sujo): todos rejeitados pelo esquema. 10.000 eventos de diagnóstico em 39 ms sem
bloquear nada, teto de 300 respeitado, relatório gerado em 3 ms.

### O que NÃO dá para estressar fora do navegador (e como cobrimos)

O timing real do PDFium ("Falha ao imprimir" de verdade), o motor com canvas, e o
comportamento com a impressora térmica física só existem nas estações. É para isso que
existe o protocolo da seção 5 — o teste que só a operação consegue fazer.

---

## 3. Melhorias propostas — em ordem de prioridade

### P0 — antes de qualquer publicação (bloqueiam o portão)

| O quê | Situação |
|-------|----------|
| Chave de dedupe por hash (etiqueta trocada) | **Pronta na `main`**, aguardando teu OK |
| Testes de integração permanentes do background (106 no total agora) | **Prontos na `main`** |
| Piloto do protocolo da seção 5 em 2 máquinas | **Depende de ti** |

### P1 — decisões tuas (mudam comportamento; cada uma com botão de desligar remoto)

1. **Correios A4 no caminho do WMS.** Proposta: antes do caminho rápido, farejar o texto
   do PDF no próprio background (pdf-lib, sem canvas, ~5–10 ms) — se cheirar a Correios
   ("Contrato" + SEDEX/PAC, código AA…BR), mandar ao motor em vez de recortar como Shopee.
   Custo: +5–10 ms por etiqueta A4. Risco: baixo, com chave remota para desligar.
   **Pergunta que decide se isso é necessário: as etiquetas dos Correios chegam pelo WMS,
   ou só por arquivo/link (viewer)?** No log de ontem, todas as dos Correios vieram pelo
   viewer — se for sempre assim, este item pode esperar.
2. **"romaneio"/"declaracao" na URL** (caminho 6): um PDF de romaneio aberto por link vira
   100×150. Proposta: exigir `.pdf` na URL **e** remover as duas palavras da lista, ou
   listar por domínio. Precisa de ti: existe romaneio/declaração que os operadores
   imprimem por link e que HOJE depende desse casamento de nome?
3. **Igualar os tetos** (hook 8 s < background 12 s): o background tem folga que o hook
   nunca espera. Proposta: 10 s nos dois. Risco quase zero.

### P2 — robustez e conforto (nenhum bloqueia nada)

- Coleta central de diagnóstico (mandar o log para fora da máquina automaticamente):
  decisão de dados que é tua; hoje o operador exporta com um clique.
- Botão "imprimir de novo" no viewer quando a impressão falha (hoje é F5).
- Vigiar o `printScaling: appdefault` (config v2): se o scanner dos Correios reclamar de
  etiqueta encolhida, reverter para `"none"` no config remoto — 1 h para valer.
- `centerContent` ignorado pelo labeler (anotado desde o início; ninguém sentiu).

---

## 4. O que já está na `main` e NÃO está publicado

- Chave de dedupe por hash de conteúdo inteiro (correção do 2.1).
- Harness de integração + 5 testes novos (106 passando).
- Este documento.

A 16.36.5 publicada continua sendo o que as máquinas rodam. O risco conhecido dela é o
2.1 — improvável no dia a dia, mas é O motivo para não demorar com o portão da seção 6.

---

## 5. Protocolo de teste nas estações (o roteiro que tu pediste)

**Fase A — 2 máquinas, ~30 min cada.** Uma que já deu "Falha ao imprimir" e uma boa.

1. `chrome://extensions` → IMPRESSORA ENVIAGORA → **Atualizar**. Conferir a versão no
   popup. **F5 em toda aba do WMS aberta** (sem isso os scripts velhos continuam lá).
2. Imprimir pelo WMS, **10 de cada**: Shopee · Mercado Livre · Amazon · Correios em A4 ·
   J&T · etiqueta 100×150 já pronta.
3. Uma vez: Ctrl+P na tela do WMS (esperado: nada de folha preta na impressora).
4. Abrir uma etiqueta por `file://` (PDF salvo no disco) e uma por link, com impressão.
5. Ao final da bateria: popup → **Baixar diagnóstico**. Guardar o arquivo com o nome da
   máquina e me mandar os dois.

**Critérios de aceite (eu confiro nos diagnósticos):**
- Zero "Falha ao imprimir" e zero folha preta;
- **1 `crop-entrou` por etiqueta** (não 2, não 3 — é a prova da 16.36.6 funcionando);
- `print-beforeprint`/`viewer-beforeprint` presentes em cada impressão;
- Correios: **bipar as etiquetas no scanner** — é o teste que nenhum log substitui;
- Nenhum evento `crop-erro` ou `motor-timeout`.

**Fase B — as mesmas 2 máquinas, 48 h de operação normal.** Sem roteiro: trabalho real.
Ao final, exportar os dois diagnósticos de novo.

**Fase C — publicação para as 60**, só depois do teu OK explícito sobre a Fase B.

---

## 6. Portão de publicação

```
correções na main  →  Fase A (2 máquinas, roteiro)  →  eu leio os diagnósticos
                                                     →  Fase B (48 h de operação)
                                                     →  TEU OK por escrito
                                                     →  tag → Release → updates.xml
                                                     →  60 máquinas em ~1–5 h
```

Freios que continuam disponíveis o tempo todo, sem publicar nada:
- `killSwitch: true` no `config/defaults.json` — desliga o ajuste em todas as máquinas
  em até 1 h (o Chrome volta a imprimir o PDF cru);
- `deduplicarCrop: false` / `pularJaAjustado: false` — desligam só as otimizações novas;
- `printSettleMs` — sobe a pausa antes do print se alguma máquina seguir falhando.
