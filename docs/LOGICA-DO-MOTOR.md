# A lógica do motor — como uma etiqueta é reconhecida e recortada

Este documento explica **o raciocínio**: como o código olha para um PDF e decide o que
naquela folha é a etiqueta, e como ela vira 100×150 mm. Não fala de instalação,
atualização nem de como a extensão se conecta ao WMS — isso está em
[ARQUITETURA.md](ARQUITETURA.md).

Se você só quer a resposta curta: **existem três formas de achar a etiqueta, em ordem de
confiança**. Geometria (prova), texto (prova) e tamanho da folha (palpite). O trabalho
todo é preferir prova a palpite, e nunca deixar um palpite passar por prova.

---

## O problema, dito direito

Chega um PDF. Ele pode ser:

- uma folha A4 com uma etiqueta de 10×15 colada num canto, o resto em branco;
- uma folha A4 com a etiqueta no canto **de cima**, com marcas de corte tracejadas;
- uma etiqueta que já vem exatamente em 100×150 mm;
- uma etiqueta de 76×130, ou 105×148, ou qualquer outro tamanho que a transportadora
  resolveu usar;
- uma folha A4 paisagem com a etiqueta na faixa de baixo.

A impressora térmica tem 100×150 mm e imprime **a página inteira do PDF**. Então o
trabalho é: descobrir qual retângulo daquela folha é a etiqueta, e montar uma página nova
de 100×150 mm com só aquele retângulo dentro, ampliado até preencher.

Errar o retângulo não gera erro nenhum. Gera uma etiqueta impressa pequena no meio do
papel — que foi exatamente o defeito de 19/08. **O recorte funcionou; o alvo é que estava
errado.**

---

## Nível 1 — geometria: achar a etiqueta pela estrutura do PDF

Este é o método mais confiável, e o mais interessante. Está em `crop-etiqueta.js`.

### A ideia

Um PDF não é uma imagem: é uma lista de instruções de desenho. Quem gera etiqueta quase
sempre desenha a etiqueta **dentro de um bloco reutilizável** — um *Form XObject* — e
depois cola esse bloco na folha. O bloco carrega o próprio tamanho declarado (a `BBox`).

E aqui está a chave: **a etiqueta de 4×6 polegadas é sempre um bloco de 288×432 pontos**,
não importa onde ele foi colado, em que escala, nem se veio de cabeça para baixo. O que
muda entre um layout e outro é só a **matriz** que posiciona o bloco.

Então em vez de adivinhar "a etiqueta deve estar no canto inferior esquerdo", o código
procura o bloco de 4×6 e pergunta **onde ele foi parar**.

### Como isso é feito na prática

O código lê o fluxo de instruções da página caractere a caractere, mantendo uma pilha de
matrizes — exatamente como um visualizador de PDF faria:

| Instrução | O que o código faz |
|---|---|
| `q` | empilha a matriz atual (salva o estado) |
| `Q` | desempilha (restaura o estado) |
| `cm` | multiplica a matriz atual pela nova (move/escala/gira o que vier a seguir) |
| `Do` | vai desenhar um bloco — **desce dentro dele**, levando a matriz acumulada |

Ao encontrar um bloco cuja `BBox` mede 288×432 pontos (com 6% de tolerância — cobre a
variante 296,64×421), ele pega os **quatro cantos** do bloco, aplica a matriz acumulada em
cada um, e o retângulo que envolve os quatro cantos transformados **é o recorte exato**.

Funciona com o bloco rotacionado, espelhado ou em escala estranha, porque a resposta sai
da própria matriz — não de uma suposição sobre onde a etiqueta costuma ficar.

Dois cuidados que parecem detalhe e não são:

- **Strings são puladas.** Um endereço que contenha a letra `Q` ou as letras `cm` dentro
  de um texto corromperia a pilha de matrizes se fosse lido como instrução. O scanner
  pula tudo entre `(` e `)` e entre `<` e `>`.
- **A recursão tem teto** (8 níveis). PDF malformado com referência circular travaria a
  máquina, e travar no meio de uma etiqueta é pior do que não recortar.

### As duas travas que dizem "não é comigo"

**Achou mais de um bloco 4×6?** Fica com o maior — é a folha 2-up, com duas etiquetas.

**O bloco ocupa mais de 70% da folha?** Devolve `null`, de propósito. E este é o detalhe
mais sutil do arquivo: a tolerância de 6% sobre 288×432 também alcança **283×425 pt, que
é exatamente 100×150 mm** — o tamanho da etiqueta dos Correios que já vem pronta. Sem essa
trava, uma etiqueta dos Correios inteira seria "detectada" como um bloco de 4×6 e sairia
do fluxo dos Correios sem nunca ser conferida.

> A regra por trás: **este detector só faz sentido quando existe uma etiqueta pequena
> dentro de uma folha maior.** Se o bloco é quase a folha toda, não há o que recortar.

### O que ele devolve

`{ name: 'Amazon', geo: true, left, bottom, width, height }`

O `geo: true` é um recado para quem chamou: *este palpite veio da geometria, e pode ser
derrubado por um sinal mais específico.* Ele importa no nível seguinte.

---

## Nível 2 — texto e tinta: o caminho dos Correios

> **Desligado por padrão desde a v16.36.8.** Este nível é o mais caro do projeto — 0,4 a
> 1 segundo por etiqueta — e o custo cai sobre **toda** etiqueta que chega ao motor, não
> só sobre as dos Correios: para saber *se* uma etiqueta é dos Correios, é preciso
> renderizá-la e varrê-la primeiro. A operação passou a resolver os Correios por fora e
> esse tempo deixou de se pagar.
>
> O recurso continua inteiro na extensão. Liga no **item 5 do popup**, máquina a máquina
> (o ajuste do operador ganha do padrão da empresa), ou em todas de uma vez pelo
> `correiosFit` no config remoto. Enquanto estiver desligado, a etiqueta dos Correios em
> folha A4 volta a cair no palpite "Shopee" — o defeito descrito no Nível 3.
>
> O resto desta seção descreve o que acontece **quando ele está ligado**.

Está em `labeler.js`, e só roda no motor (precisa de `pdf.js` e de um canvas). Tem duas
perguntas independentes.

### Pergunta 1: isto é dos Correios?

Lê o texto da página e procura três sinais — qualquer um basta:

1. **Código de rastreio** no formato `AA 999 999 999 BR`;
2. a palavra **"correios"**;
3. **"contrato"** junto com **SEDEX / PAC / carta registrada / impresso**.

Um detalhe importante: os Correios podem **derrubar a Amazon detectada por geometria**,
mas não a Amazon detectada pela regra antiga. O motivo é hierarquia de prova — o texto
"Contrato: 9912733639 PAC" é um sinal muito mais específico do que "existe um bloco de
4×6 polegadas nesta folha".

E há a trava inversa: se o texto tem **"shopee"** ou **"SHP:"** junto com uma detecção,
o teste dos Correios não vale. Etiqueta da Shopee às vezes menciona os Correios como
transportadora — e isso não a torna uma etiqueta dos Correios.

### Pergunta 2: onde exatamente está a tinta?

Aqui o código **desiste de entender o PDF e vai olhar**. Renderiza a página num canvas em
dobro do tamanho e varre pixel a pixel procurando qualquer coisa que não seja branco
(limiar 245 de 255):

```
para cada pixel:
    se R < 245 ou G < 245 ou B < 245:
        expande a caixa: minX, minY, maxX, maxY
```

O retângulo que sobra é a área realmente impressa, convertida de volta para coordenadas
do PDF e com uma folguinha em volta (`correiosPadMm`, 0,5 mm).

Isso é força bruta e é de propósito: **funciona com qualquer layout**, de qualquer
transportadora, sem saber nada sobre ele. É o que atende Correios, J&T e o que vier.

Duas guardas:

- Se a caixa achada é menor que **15% da folha** em qualquer dimensão, é descartada —
  provavelmente é um carimbo ou um número solto, não a etiqueta.
- Se a página estiver toda em branco, devolve `box: null` e o fluxo segue sem recorte.

---

## Nível 3 — tamanho da folha: o palpite

Quando a geometria não achou nada, sobram três regras baseadas só nas dimensões:

| Formato da folha | Páginas | Veredito | Recorte |
|---|---|---|---|
| A4 retrato | mais de 1 | Amazon | (0, 0) 300×430 |
| A4 retrato | exatamente 1 | **Shopee** | (0, 398) 300×444 |
| A4 paisagem | qualquer | Mercado Livre | (0, 154) 300×410 |
| qualquer outro | — | desconhecida → vai para o motor | — |

Estas regras recortam um retângulo **fixo**. Elas não olham para onde a etiqueta está: elas
assumem. Funcionam porque o layout daquelas transportadoras é estável.

### A regra do meio é a única sem prova nenhuma por trás

"A4 retrato de 1 página" descreve uma etiqueta da Shopee. Descreve **também** uma etiqueta
dos Correios impressa em folha A4 — e 3 das 7 etiquetas reais dos Correios das nossas
fixtures são exatamente assim.

Foi isso que causou o defeito de 19/08. A etiqueta dos Correios ocupava só um pedaço do
retângulo fixo `(0,398)-(300,842)`; o que foi ampliado até 100×150 mm foi **o retângulo**,
e a etiqueta veio junto, na proporção dela: 64 mm de largura numa etiqueta de 100 mm.

Por isso essa regra — e só ela — é marcada no código com `palpite: true`. Quem recebe essa
marca sabe que não pode confiar sem conferir.

---

## Como os três níveis se combinam

```
PDF chega
   │
   ├─ já tem a nossa marca?  ──sim──▶  devolve sem mexer (não recorta duas vezes)
   │
   ├─ NÍVEL 1: existe bloco de 4×6 na folha, ocupando menos de 70% dela?
   │      sim ──▶ recorte = onde a matriz colou o bloco        [PROVA]
   │
   ├─ NÍVEL 3: o tamanho da folha bate com alguma regra?
   │      Amazon / Mercado Livre  ──▶ recorte fixo             [regra estável]
   │      Shopee (A4, 1 página)   ──▶ PALPITE
   │            │
   │            ├─ Correios DESLIGADO (padrão) ──▶ recorte fixo, sem ida ao motor
   │            └─ Correios LIGADO ──▶ confere no motor antes:
   │                                     é Correios? recorta a tinta   [PROVA]
   │                                     é Shopee?   mantém o fixo
   │                                     mudo/lento? mantém o fixo
   │
   └─ nada bateu ──▶ motor: recorte pela tinta                 [PROVA]
                       └─ motor indisponível ──▶ ajuste padrão, sem recorte
```

Lendo de cima para baixo: **prova primeiro, palpite depois, e palpite sempre passa por
prova quando dá tempo.**

O "quando dá tempo" é literal. O motor conferindo um palpite tem teto de **2 segundos**, e
o motor no caminho normal tem **8**. Se estourar, o recorte antigo vale. A regra de ouro do
projeto inteiro: **atrasar a impressão é pior do que recortar torto, e recortar torto é
pior do que não recortar** — mas nada disso pode virar etiqueta que não sai.

---

## Da etiqueta encontrada até o papel

Achado o retângulo, `desenhar()` monta a página de 100×150 mm. Duas estratégias:

### Modo normal

Reserva o espaço do cabeçalho e do rodapé, e encaixa a etiqueta no que sobrou, mantendo a
proporção (`Math.min` entre a escala que caberia na largura e a que caberia na altura —
o menor manda, senão estoura de um lado). Centraliza.

### Modo "preencher a largura" — só Correios (`correiosFillFirst`)

Aqui a prioridade inverte: **a largura manda**. A etiqueta é escalada para ocupar a
largura toda menos 1 mm de margem, e o texto usa a sobra vertical. Se não sobrar espaço
suficiente para cabeçalho e rodapé, cai no modo normal.

O motivo é operacional, não estético: **borda branca lateral faz o leitor dos Correios não
bipar o código de barras.** Foi o bug da v16.32. Por isso a margem dos Correios tem teto
de 3 mm no esquema de configuração, e por isso o piso de margem de impressão
(`printSafeMarginMm`) **nunca** se aplica a esse caminho.

### O carimbo final

Cabeçalho no topo, e no rodapé data/hora e o nome do operador — daí vem o `OPERADOR:` que
aparece na etiqueta. O nome é capturado da tela do WMS.

Por último o PDF de saída recebe:

- as caixas de página travadas exatamente em 100×150 (`MediaBox`, `CropBox`, `TrimBox`,
  `BleedBox` — todas iguais, senão o Chrome escolhe uma e a escala muda);
- a preferência de escala de impressão;
- a palavra-chave **`ENVIAGORA_OK`**.

Essa palavra-chave é o que faz o sistema reconhecer a própria saída. Sem ela, uma etiqueta
já ajustada que voltasse ao início seria recortada de novo — recorte sobre recorte.

---

## As três coisas que dão errado, e o que cada uma parece

| Sintoma | Causa | Onde mexer |
|---|---|---|
| Etiqueta **pequena** dentro do papel | recorte com alvo errado: um retângulo fixo maior do que a etiqueta | ligar `correiosFit` (item 5 do popup) |
| Etiqueta com **borda branca** e o leitor não bipa | margem grande demais no caminho dos Correios | `correiosMarginMm` (teto de 3 mm) |
| Etiqueta **cortada** | a caixa de tinta pegou menos do que devia, ou a escala encolheu | `correiosPadMm`, `printScaling` |

---

## Por que a lógica está duplicada em dois lugares

`background.js` (nível 1, service worker) e `labeler.js` (motor, na página) fazem coisas
parecidas. Isso é deliberado.

O service worker **não tem canvas**. Não consegue renderizar página nem medir tinta. O que
ele tem é `pdf-lib` puro — geometria e regras de tamanho, e nada mais. É rápido e sempre
está disponível.

O motor tem canvas, mas é injetado na página do WMS e **pode não estar lá**: página ainda
carregando, site com política restritiva, aba recém-aberta. Ele é mais capaz e menos
garantido.

Por isso a divisão: o rápido e garantido resolve o caso comum; o capaz e incerto resolve o
caso difícil, com teto de tempo e queda limpa. **Quando o motor não responde, sai o recorte
do nível 1 — nunca uma falha.**

---

## Onde cada coisa mora

| Arquivo | O que faz |
|---|---|
| `crop-etiqueta.js` | detector geométrico: acha o bloco 4×6 e onde ele foi colado |
| `labeler.js` | texto dos Correios, medição de tinta, e a montagem da página 10×15 |
| `background.js` | orquestra: decide prova ou palpite, chama o motor, cuida do tempo |
| `motor.js` | roda `labeler.js` dentro da página, um de cada vez |
