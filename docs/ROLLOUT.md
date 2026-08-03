# Rollout — colocar nas 60 máquinas

Este documento é para ser executado por alguém que **não é da tecnologia**. Se em algum
ponto você travar, pare e chame quem mantém o repositório: não improvise.

**A decisão já foi tomada: auto-hospedado.** O motivo é operacional e não se discute — a
Chrome Web Store leva de horas a dias para revisar cada atualização, e isso é incompatível
com corrigir uma etiqueta errada no meio do turno. Aqui a correção vale em minutos.

**Antes de começar, faça o [PILOTO.md](PILOTO.md) em 2 máquinas.** Ele não decide mais nada
— só confirma que o caminho funciona no galpão de vocês antes de você repetir 60 vezes.

---

## Antes de tudo — 3 coisas que só o Rafael faz, uma vez

> **Estas três já estão feitas.** Ficam registradas aqui porque, se um dia alguém precisar
> refazer o projeto do zero — ou entender por que o repositório é público — a resposta é
> esta seção.

### 1. Deixar o repositório público

`github.com/Enviagora/impressora-enviagora` → **Settings** → desça até **Danger Zone** →
**Change repository visibility** → **Make public**.

> **Por que isso é obrigatório.** O Chrome não faz login ao procurar atualização: sem
> token, sem cookie, sem senha. Se o endereço da atualização for privado, ele leva um "não
> autorizado" e nenhuma máquina atualiza nunca. Não existe auto-update a partir de
> repositório privado — não é escolha, é como o Chrome funciona.
>
> O que fica exposto é o código da extensão, que não é segredo em cenário nenhum (qualquer
> operador abre a pasta e copia). **A chave de assinatura não vai junto** e continua
> guardada.

### 2. Guardar a chave de assinatura

O arquivo `chave-privada.pem` foi gerado uma vez e **não está no repositório de propósito**.

1. Guarde uma cópia no cofre de senhas da empresa.
2. No GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository
   secret**
   - Name: `CRX_PRIVATE_KEY`
   - Secret: o conteúdo inteiro do arquivo `.pem`, do `-----BEGIN` até o `-----END`

> **Perder essa chave é sério.** É ela que faz o Chrome reconhecer a atualização como sendo
> "da mesma extensão". Sem ela, publicar versão nova vira uma extensão diferente e alguém
> precisa passar nas 60 máquinas de novo.

### 3. Ligar o GitHub Pages

**Settings** → **Pages** → em **Source**, escolher **GitHub Actions**.

(Se você publicar uma versão antes disso, o robô tenta ligar sozinho. Conferir não custa.)

---

## O caminho — auto-hospedado

Atualização em minutos, sem revisão de ninguém, sem custo.

### 1. Publicar (só quem mantém o repositório, uma vez por versão)

```bash
npm test                        # as 12 etiquetas precisam passar
npm run bump -- patch           # ou minor / major
git commit -am "v16.35.1: <o que muda para a operação>"
git tag v16.35.1
git push origin main --tags
```

O robô do GitHub faz o resto: testa, assina, publica o Release e sobe a página. Acompanhe
em **Actions** — quando ficar verde, está no ar.

Confira abrindo: **https://enviagora.github.io/impressora-enviagora/**

### 2. Preparar cada máquina

Em cada uma das 60, uma vez só. **Não precisa de pendrive** — o comando baixa tudo.

**a)** Botão Iniciar → digite `powershell` → botão direito em **Windows PowerShell** →
**Executar como administrador**.

**b)** Cole o bloco **inteiro** e aperte Enter:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/Enviagora/impressora-enviagora/main/scripts/instalar.ps1 -OutFile "$env:TEMP\instalar-enviagora.ps1"
& "$env:TEMP\instalar-enviagora.ps1"
```

> As duas primeiras linhas não são enfeite. Sem a primeira o Windows recusa executar o
> script; sem a segunda o PowerShell 5.1 não consegue falar com o GitHub. Faltando
> qualquer uma, o erro que aparece **não aponta para a causa**.

**c)** **Feche o Chrome por completo e abra de novo.** A liberação só passa a valer depois
disso. Pular este passo faz a instalação ser recusada e parecer que o script falhou.

**d)** `chrome://extensions` → remover versão antiga se houver → ligar **Modo do
desenvolvedor** → **arrastar o `.crx`** da pasta que o script abriu (`C:\Impressora-Enviagora`).

> Arraste **da pasta**, nunca da barra de downloads do Chrome. Da barrinha falha com
> `CRX_FILE_NOT_READABLE`, que quer dizer só "não achei o arquivo".

**e)** **Detalhes** → ligar **Permitir acesso a URLs de arquivo**. Este é o passo que
nenhum script consegue dar, e o que mais deixa gente na mão.

**f)** Conferir se ficou tudo certo (não precisa de administrador):

```powershell
& "$env:TEMP\instalar-enviagora.ps1" -Conferir
```

Ele responde em três linhas: política aplicada? extensão instalada e em que versão? o
`file://` está ligado? Serve também meses depois, para achar a máquina que ficou para trás
sem olhar tela por tela.

**g)** `F5` na tela do sistema e imprima uma etiqueta de teste. E uma dos Correios.

> Não há senha para trocar. A senha é a mesma nas 60 máquinas — `impressora-enviagora` —
> e serve só para ninguém desligar a extensão sem querer.

Vá marcando na [planilha de controle](#planilha-de-controle) no fim deste documento.

### 3. Da segunda versão em diante

**Nada.** As máquinas atualizam sozinhas em algumas horas. Você não volta nelas.

---

## Plano B — Chrome Web Store "não listada"

**Só se o piloto mostrar que o caminho acima não funciona nessas máquinas.** A desvantagem
que fez ele ser preterido continua valendo: cada atualização espera revisão do Google, de
horas a dias.

Custa US$ 5 uma vez. Em troca: auto-update nativo, zero configuração nas máquinas, e como a
instalação é normal, o "Permitir acesso a URLs de arquivo" funciona e persiste.

O preço é a revisão do Google a cada atualização — horas a dias.

> **Isso incomoda menos do que parece**, e o motivo é a seção "Mudar uma configuração"
> logo abaixo: margem, texto de cabeçalho e a parada de emergência valem em **1 hora** sem
> passar por revisão nenhuma. Só mudança de lógica precisa de versão nova.

### 1. Criar a conta de desenvolvedor

1. https://chrome.google.com/webstore/devconsole
2. Entrar com uma conta **da empresa**, não pessoal — quem sair da empresa não pode levar a
   extensão junto.
3. Pagar os US$ 5 (uma vez, para sempre).

### 2. Enviar a extensão

1. Baixe o arquivo `impressora-enviagora-<versão>-webstore.zip` do Release mais recente.
   **É esse mesmo, o que termina em `-webstore`.** O outro ZIP tem configuração de
   auto-hospedagem que a loja recusa.
2. No console: **Novo item** → subir o ZIP.
3. Preencher: descrição, ícone, uma captura de tela.
4. Em **Visibilidade**, escolher **Não listada**. A extensão fica acessível só por link
   direto e não aparece em busca.
5. Enviar para revisão.
6. Quando aprovar, guarde o link. **É esse link que vai para a operação.**

### 3. Preparar cada máquina

Bem mais simples que o caminho auto-hospedado:

1. Abrir o link da loja.
2. Clicar em **Usar no Chrome**.
3. `chrome://extensions` → **Detalhes** → ligar **Permitir acesso a URLs de arquivo**.
4. Imprimir uma etiqueta de teste. E uma dos Correios.

### 4. Da segunda versão em diante

Subir o novo `-webstore.zip` no console e esperar a revisão. As máquinas atualizam sozinhas
depois que o Google aprovar.

---

## Mudar uma configuração

**Este é o caminho que você mais vai usar.** Serve para margem, texto do cabeçalho, escala,
deslocamento — qualquer parâmetro. **Não** publica versão nova e **não** passa por revisão.

1. No GitHub, abra `config/defaults.json`.
2. Clique no lápis (editar).
3. Mude o valor.
4. **Suba o `configVersion` em 1.** Se esquecer, o robô reclama.
5. Commit direto na `main`.

Em até **1 hora** as 60 máquinas pegam. Para conferir numa máquina específica: abrir a
extensão, item 9 — mostra qual `configVersion` aquela máquina está usando. O botão "Buscar
configuração agora" força na hora.

> **Um cuidado só:** não aumente a **margem dos Correios**. Ela precisa ficar em 1 mm. Com
> margem maior a etiqueta ganha borda branca e o leitor dos Correios não bipa. O sistema
> recusa valores acima de 3 mm justamente por isso.

---

## Emergência — parar tudo

Se um ajuste quebrou a operação e as etiquetas estão saindo erradas nas 60 máquinas:

1. No GitHub, abra `config/defaults.json`.
2. Troque `"killSwitch": false` por `"killSwitch": true`.
3. Suba o `configVersion` em 1.
4. Commit na `main`.

Em até 1 hora as máquinas param de ajustar e voltam a imprimir o PDF original, do jeito que
era antes da extensão existir. **Ninguém fica sem imprimir.** Uma tarja laranja aparece no
topo da tela avisando que a pausa é central e que ninguém precisa mexer na máquina.

Para tirar a pausa: volte para `false`, suba o `configVersion`, commit.

Se for urgente numa máquina específica, o operador pode abrir a extensão → item 9 →
"Buscar configuração agora", e ela pega na hora.

---

## Quando algo dá errado

| O operador diz | O que é | O que fazer |
|---|---|---|
| "a etiqueta sai sem ajuste" | quase sempre é o `file://` | `chrome://extensions` → Detalhes → ligar "Permitir acesso a URLs de arquivo" |
| "apareceu uma tarja **vermelha**" | alguém desligou nessa máquina | abrir a extensão e ligar de volta (senha: `impressora-enviagora`) |
| "apareceu uma tarja **laranja**" | pausa central, de propósito | não mexer; sai sozinha |
| "a etiqueta sai cortada na borda" | faixa não imprimível da impressora | extensão → item 6 → margem de segurança de 0 para 1 ou 2 mm. **Não** mexer na dos Correios |
| "o leitor dos Correios não bipa" | margem lateral demais | conferir se a margem dos Correios está em 1 mm |
| "não atualiza" | Pages, Release, ou instalou pelo ZIP | rode `-Conferir` nessa máquina; depois confira se o último Actions ficou verde |
| "CRX_FILE_NOT_READABLE" | o Chrome não achou o arquivo | arraste da pasta, não da barra de downloads; confira se o arquivo tem ~630 KB |
| "não é possível adicionar extensões deste site" | falta a política, ou o Chrome não foi reiniciado | rode o preparo como administrador e **feche e reabra o Chrome** |
| "sai errado só de vez em quando" | pode ser máquina desatualizada | extensão → item 9 → conferir a `configVersion` e comparar com as outras |

---

## Planilha de controle

Imprima e vá marcando. Máquina não marcada é máquina que ninguém conferiu.

```
  #   Máquina          Instalou   file://   Teste     Correios   Quem / data
 ---  ---------------  --------  --------  --------  ---------  --------------
  1   ______________     [  ]      [  ]      [  ]       [  ]     ____________
  2   ______________     [  ]      [  ]      [  ]       [  ]     ____________
  3   ______________     [  ]      [  ]      [  ]       [  ]     ____________
 ...
 60   ______________     [  ]      [  ]      [  ]       [  ]     ____________

  file://  = "Permitir acesso a URLs de arquivo" ligado
  Teste    = imprimiu uma etiqueta normal e saiu certa
  Correios = imprimiu uma dos Correios e o leitor bipou
```
