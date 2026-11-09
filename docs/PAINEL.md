# Painel de Operação: menu dos sistemas dentro da extensão

A partir desta versão a extensão se chama **Painel de Operação** e o popup tem duas abas:

| Aba | O que tem | Quem usa |
|---|---|---|
| **Menu da operação** (abre por padrão) | Atalhos para os sistemas: WMS, BI, HUB e o que o PCP publicar, com o logo de cada um | Toda a operação |
| **Impressão** | O painel de sempre, itens 1 a 9, sem nenhuma mudança | Supervisão / quem cuida da extensão |

Origem: card "EXTENSÃO - MENU OPERACIONAL" (PCP). A extensão separada Menu da Operação
(`enviagora-dev/menu-enviagora`) teria de ser instalada nas ~60 máquinas; aqui ela chega pelo canal
de atualização que a impressora já tem, sem tocar em máquina nenhuma.

## Como o menu chega às máquinas

- O menu fica no Firestore do projeto GCP `menu-enviagora` (documento `menu/atual`), com leitura pública:
  o PC da operação não faz login. Só endereços; cada sistema tem o próprio login.
- O popup abre com a cópia guardada em `chrome.storage.local` e troca pela versão atual em seguida.
  Sem internet, mostra a última recebida; sem cópia nenhuma, o menu padrão (nunca fica vazio).
- **Mudar o menu não exige versão nova da extensão.** O PCP edita e publica; vale na próxima vez que
  cada máquina abrir o popup.

## Como editar

1. Popup → aba Menu → **Editar menu** (abre `menu/admin.html` numa aba).
2. **Entrar com Google** com a conta @enviagora.com.br.
3. Editar grupos e links (nome, endereço https, descrição) → **Publicar para todas as máquinas**.

Só quem está na lista de **Administradores** (na própria tela) consegue publicar. Quem barra os outros são
as regras do Firestore, no servidor (repo `menu-enviagora`, `firestore.rules`): ver o botão não dá poder
nenhum. Toda publicação e toda mudança de admin ficam no histórico, com quem fez e quando.

A edição do menu **não** mexe em nada da impressão. Configuração de impressão continua como sempre:
`config/defaults.json` para todas as máquinas, aba Impressão para uma máquina.

## Arquivos

Tudo do menu fica em `src/menu/`. Motor, content scripts, background e `popup.js` não importam nada dele
(`tests/painel.test.mjs` trava isso).

| Arquivo | Papel |
|---|---|
| `menu/menu.js`, `menu/menu.css` | aba Menu do popup (e a fonte Satoshi no popup inteiro) |
| `menu/admin.html`, `admin.js`, `admin.css`, `estilo.css` | tela de edição (cópia da extensão Menu da Operação) |
| `menu/shared.js` | leitura, cópia local, login Google e publicação (cópia, com logos em caminho absoluto) |
| `menu/config.js` | identificadores do projeto; API key e client_id entram no build |
| `menu/logos/`, `assets/`, `fonts/` | logos dos sistemas, logo Enviagora, Satoshi |

`shared.js`, `admin.*` e `estilo.css` são cópias do repo `menu-enviagora`. Correção lá deve ser copiada para cá.

## Permissão nova: `identity`

Usada só pelo login Google da edição. **Não gera aviso de permissão**, então a atualização não desativa a
extensão nem pede aceite nas máquinas. Conferido com `chrome.management.getPermissionWarningsByManifest`
(manifest com e sem `identity` dão o mesmo aviso) e no código do Chromium (só `identity.email` tem aviso).
Antes da tag: uma máquina de teste com a versão anterior pelo CRX recebe esta pelo `updates.xml` e continua ativa.

## Antes do primeiro release com o menu

Criar duas **variáveis** do repo (Settings → Secrets and variables → Actions → Variables), não secrets, porque
são identificadores públicos:

| Variável | Valor |
|---|---|
| `MENU_OAUTH_CLIENT_ID` | `833292697952-3kv58qrdjjad9feel1cg3eosu7gve6d7.apps.googleusercontent.com` |
| `MENU_API_KEY` | com o Miguel (API key restrita do projeto `menu-enviagora`) |

Sem elas, o release aborta (`scripts/build.mjs`): uma versão em que o PCP não consegue editar não sai.
O login com o ID desta extensão (`kigacgfagjemjheogplplhcneolndhan`) já está cadastrado no OAuth e no Firebase.
