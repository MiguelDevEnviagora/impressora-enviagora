# Rollout — colocar nas 60 máquinas

Este documento é para ser executado por alguém que **não é da tecnologia**. Se em algum
ponto você travar, pare e chame quem mantém o repositório: não improvise.

**Antes de começar, o [PILOTO.md](PILOTO.md) precisa estar feito.** Ele testa em 2 máquinas
qual das duas trilhas abaixo funciona no galpão. Sem isso você vai descobrir o problema na
máquina 37.

---

## Antes de tudo — 3 coisas que só o Rafael faz, uma vez

Sem elas nada aqui funciona. São 5 minutos no site do GitHub.

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

## Trilha A — auto-hospedado

**Use esta trilha se o piloto deu ✅.**

Atualização instantânea, sem revisão de ninguém, sem custo.

### A1. Publicar a primeira versão

Quem mantém o repositório roda, na pasta do projeto:

```bash
npm test              # as 12 etiquetas precisam passar
git tag v16.34.0
git push origin main --tags
```

Pronto. O robô do GitHub cuida do resto: testa, assina, publica o Release e sobe a página.
Acompanhe em **Actions** — quando ficar verde, está no ar.

Confira abrindo: **https://enviagora.github.io/impressora-enviagora/**

### A2. Preparar cada máquina

Em cada uma das 60, uma vez só. Leve num pendrive o arquivo `scripts/instalar.ps1`.

1. Botão direito no **PowerShell** → **Executar como administrador**
2. Digite:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\instalar.ps1
   ```
3. O script libera a instalação, baixa a última versão e mostra na tela o que fazer.
4. **Siga o que ele imprimiu.** Os passos 1 a 6 estão lá.
5. **Não pule o "Permitir acesso a URLs de arquivo".**
6. Abra a extensão e **troque a senha** (item 7). A de fábrica é `enviagora`.
7. Imprima uma etiqueta de teste. E uma dos Correios.

Vá marcando na [planilha de controle](#planilha-de-controle) no fim deste documento.

### A3. Da segunda versão em diante

Nada. As máquinas atualizam sozinhas em algumas horas.

---

## Trilha B — Chrome Web Store "não listada"

**Use esta trilha se o piloto deu ❌.**

Custa US$ 5 uma vez. Em troca: auto-update nativo, zero configuração nas máquinas, e como a
instalação é normal, o "Permitir acesso a URLs de arquivo" funciona e persiste.

O preço é a revisão do Google a cada atualização — horas a dias.

> **Isso incomoda menos do que parece**, e o motivo é a seção "Mudar uma configuração"
> logo abaixo: margem, texto de cabeçalho e a parada de emergência valem em **1 hora** sem
> passar por revisão nenhuma. Só mudança de lógica precisa de versão nova.

### B1. Criar a conta de desenvolvedor

1. https://chrome.google.com/webstore/devconsole
2. Entrar com uma conta **da empresa**, não pessoal — quem sair da empresa não pode levar a
   extensão junto.
3. Pagar os US$ 5 (uma vez, para sempre).

### B2. Enviar a extensão

1. Baixe o arquivo `impressora-enviagora-<versão>-webstore.zip` do Release mais recente.
   **É esse mesmo, o que termina em `-webstore`.** O outro ZIP tem configuração de
   auto-hospedagem que a loja recusa.
2. No console: **Novo item** → subir o ZIP.
3. Preencher: descrição, ícone, uma captura de tela.
4. Em **Visibilidade**, escolher **Não listada**. A extensão fica acessível só por link
   direto e não aparece em busca.
5. Enviar para revisão.
6. Quando aprovar, guarde o link. **É esse link que vai para a operação.**

### B3. Preparar cada máquina

Bem mais simples que a trilha A:

1. Abrir o link da loja.
2. Clicar em **Usar no Chrome**.
3. `chrome://extensions` → **Detalhes** → ligar **Permitir acesso a URLs de arquivo**.
4. Abrir a extensão e **trocar a senha** (item 7).
5. Imprimir uma etiqueta de teste. E uma dos Correios.

### B4. Da segunda versão em diante

Subir o novo `-webstore.zip` no console e esperar a revisão. As máquinas atualizam sozinhas
depois que o Google aprovar.

---

## Mudar uma configuração (as duas trilhas)

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
| "apareceu uma tarja **vermelha**" | alguém desligou nessa máquina | abrir a extensão e ligar de volta (vai pedir a senha) |
| "apareceu uma tarja **laranja**" | pausa central, de propósito | não mexer; sai sozinha |
| "a etiqueta sai cortada na borda" | faixa não imprimível da impressora | extensão → item 6 → margem de segurança de 0 para 1 ou 2 mm. **Não** mexer na dos Correios |
| "o leitor dos Correios não bipa" | margem lateral demais | conferir se a margem dos Correios está em 1 mm |
| "não atualiza" | Pages ou Release | conferir se o repositório está público e se o último Actions ficou verde |
| "sai errado só de vez em quando" | pode ser máquina desatualizada | extensão → item 9 → conferir a `configVersion` e comparar com as outras |

---

## Planilha de controle

Imprima e vá marcando. Máquina não marcada é máquina que ninguém conferiu.

```
  #   Máquina          Instalou   file://   Senha    Teste     Correios   Quem / data
 ---  ---------------  --------  --------  -------  --------  ---------  --------------
  1   ______________     [  ]      [  ]     [  ]      [  ]       [  ]     ____________
  2   ______________     [  ]      [  ]     [  ]      [  ]       [  ]     ____________
  3   ______________     [  ]      [  ]     [  ]      [  ]       [  ]     ____________
 ...
 60   ______________     [  ]      [  ]     [  ]      [  ]       [  ]     ____________

  file://  = "Permitir acesso a URLs de arquivo" ligado
  Senha    = trocou a senha de fábrica no item 7
  Teste    = imprimiu uma etiqueta normal e saiu certa
  Correios = imprimiu uma dos Correios e o leitor bipou
```
