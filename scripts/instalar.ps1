<#
  IMPRESSORA ENVIAGORA - preparo da maquina
  ==========================================

  O QUE ESTE SCRIPT FAZ
    1. Libera, no registro do Windows, a instalacao desta extensao especifica fora da
       Chrome Web Store. Sem isso o Chrome recusa o CRX com "Nao e possivel adicionar
       aplicativos, extensoes e scripts de usuario deste site".
    2. Baixa a ultima versao publicada (CRX e ZIP) para C:\Impressora-Enviagora.
    3. Imprime na tela o passo que NENHUM script consegue fazer por voce.

  O QUE ELE NAO FAZ, E POR QUE
    Ele NAO instala a extensao sozinho e NAO liga o "Permitir acesso a URLs de arquivo".
    Nao e limitacao de quem escreveu: o Chrome 137+ removeu a flag --load-extension, e o
    toggle de file:// nao tem API nenhuma. Alguem precisa clicar. Sao 30 segundos por
    maquina, uma vez so.

    Force-install por politica (ExtensionInstallForcelist) resolveria a instalacao, mas
    extensao marcada como "Instalada por politica empresarial" PERDE o acesso a file://
    a cada reinicio - e os operadores abrem PDF salvo no disco. Por isso nao usamos.

  COMO RODAR
    Abra o PowerShell COMO ADMINISTRADOR (botao direito > Executar como administrador) e
    cole o bloco inteiro. Ele baixa este script e executa:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/Enviagora/impressora-enviagora/main/scripts/instalar.ps1 -OutFile "$env:TEMP\instalar-enviagora.ps1"
      & "$env:TEMP\instalar-enviagora.ps1"

    As duas primeiras linhas nao sao enfeite: sem a primeira o Windows recusa executar o
    script, e sem a segunda o PowerShell 5.1 nao consegue falar com o GitHub. Faltando
    qualquer uma delas, o erro que aparece nao aponta para a causa.

  DEPOIS DE INSTALAR - conferir se a maquina ficou certa (nao precisa de administrador):

      & "$env:TEMP\instalar-enviagora.ps1" -Conferir

    Responde em 3 linhas: politica aplicada? extensao instalada e em que versao? o
    "Permitir acesso a URLs de arquivo" esta ligado? Serve tambem meses depois, para
    achar a maquina que ficou para tras sem precisar olhar tela por tela.

  E idempotente: rodar de novo nao duplica nada e nao quebra nada.
#>

[CmdletBinding()]
param(
  # Onde a extensao fica guardada. Escolha uma pasta que ninguem vai apagar por engano.
  [string] $Destino = 'C:\Impressora-Enviagora',

  # Use -SomentePolitica para so aplicar o registro, sem baixar nada.
  [switch] $SomentePolitica,

  # Use -Conferir para so DIAGNOSTICAR uma maquina ja instalada, sem mexer em nada.
  # Nao precisa de administrador.
  [switch] $Conferir
)

$ErrorActionPreference = 'Stop'

# ID desta extensao. Vem do SHA-256 da chave publica (config/chave-publica.txt) e e o que
# faz o toggle de file:// sobreviver as atualizacoes. tests/invariantes.test.mjs confere
# que este valor continua batendo com a chave versionada.
$ID_EXTENSAO = 'kigacgfagjemjheogplplhcneolndhan'
$REPO        = 'Enviagora/impressora-enviagora'
$PAGINA      = 'https://enviagora.github.io/impressora-enviagora/'

# Onde a politica local mora. ExtensionInstallAllowlist libera SO esta extensao - nao
# abrimos a maquina para extensao de fora da loja em geral; o id e a lista inteira.
$chaveAllow  = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist'
$chaveFontes = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallSources'

function Escrever($texto, $cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }
function Titulo($texto) {
  Write-Host ''
  Write-Host "  $texto" -ForegroundColor Cyan
  Write-Host ('  ' + ('-' * $texto.Length)) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  IMPRESSORA ENVIAGORA - preparo da maquina' -ForegroundColor Green
Write-Host ''

# -- Modo conferencia ------------------------------------------------------------
# Responde "esta maquina esta certa?" sem depender de ninguem olhar tela por tela. Nao
# escreve nada e nao precisa de administrador - da para rodar em qualquer maquina, a
# qualquer momento, inclusive meses depois para achar a que ficou para tras.
if ($Conferir) {
  Titulo 'Conferindo esta maquina'
  $problemas = 0

  # 1) a politica foi aplicada?
  $liberado = $null
  try { $liberado = (Get-ItemProperty -Path $chaveAllow -ErrorAction Stop).'1' } catch { }
  if ($liberado -eq $ID_EXTENSAO) {
    Escrever '  [ok]    politica de instalacao aplicada' 'Green'
  } else {
    Escrever '  [FALTA] politica de instalacao NAO aplicada' 'Red'
    Escrever '          rode este script como administrador, sem -Conferir' 'DarkGray'
    $problemas++
  }

  # 2) a extensao esta instalada em algum perfil do Chrome?
  $achou = $false
  $perfis = Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data" -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }
  foreach ($perfil in $perfis) {
    foreach ($nomeArq in @('Secure Preferences', 'Preferences')) {
      $arq = Join-Path $perfil.FullName $nomeArq
      if (-not (Test-Path $arq)) { continue }
      try {
        $prefs = Get-Content $arq -Raw -ErrorAction Stop | ConvertFrom-Json
        $ext = $prefs.extensions.settings.$ID_EXTENSAO
        if ($ext) {
          $achou = $true
          $versao = $ext.manifest.version
          Escrever "  [ok]    instalada no perfil '$($perfil.Name)' - versao $versao" 'Green'

          # 3) o toggle de file:// - o passo que nenhum script consegue LIGAR, mas da
          #    para ler. O nome da chave ja mudou entre versoes do Chrome, entao tentamos
          #    as tres conhecidas. NAO achar nenhuma nao e o mesmo que estar desligado:
          #    nesse caso dizemos que nao deu para confirmar, em vez de dar alarme falso.
          #    Ferramenta de diagnostico que grita errado deixa de ser consultada.
          $fileAccess = $null
          foreach ($chave in @('newAllowFileAccess', 'allow_file_access', 'allowFileAccess')) {
            if ($ext.PSObject.Properties.Name -contains $chave) { $fileAccess = $ext.$chave; break }
          }

          if ($fileAccess -eq $true) {
            Escrever '  [ok]    "Permitir acesso a URLs de arquivo" LIGADO' 'Green'
          } elseif ($fileAccess -eq $false) {
            Escrever '  [FALTA] "Permitir acesso a URLs de arquivo" DESLIGADO' 'Red'
            Escrever '          chrome://extensions > Detalhes > ligue a chave' 'DarkGray'
            Escrever '          sem isso, etiqueta salva no disco sai SEM ajuste' 'DarkGray'
            $problemas++
          } else {
            Escrever '  [ver]   nao consegui ler o "Permitir acesso a URLs de arquivo"' 'Yellow'
            Escrever '          confira na mao: chrome://extensions > Detalhes' 'DarkGray'
          }
        }
      } catch { }
    }
  }
  if (-not $achou) {
    Escrever '  [FALTA] a extensao nao esta instalada em nenhum perfil do Chrome' 'Red'
    $problemas++
  }

  Write-Host ''
  if ($problemas -eq 0) {
    Escrever '  Maquina OK. Ela vai receber as atualizacoes sozinha.' 'Green'
  } else {
    Escrever "  $problemas ponto(s) pendente(s) - veja acima." 'Yellow'
  }
  Escrever '  (o Chrome precisa estar FECHADO para a leitura do perfil ser confiavel)' 'DarkGray'
  Write-Host ''
  exit $problemas
}

# -- 0. Administrador? ------------------------------------------------------------
$identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal  = New-Object Security.Principal.WindowsPrincipal($identidade)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Escrever '  PARE. Este script precisa rodar como ADMINISTRADOR.' 'Red'
  Escrever ''
  Escrever '  Feche esta janela. Clique com o botao direito no PowerShell e escolha'
  Escrever '  "Executar como administrador". Depois rode o script de novo.'
  Write-Host ''
  exit 1
}

# -- 1. Politica local ------------------------------------------------------------
Titulo 'Liberando a instalacao no registro do Windows'

New-Item -Path $chaveAllow  -Force | Out-Null
New-Item -Path $chaveFontes -Force | Out-Null

Set-ItemProperty -Path $chaveAllow -Name '1' -Value $ID_EXTENSAO -Type String
Escrever "  extensao liberada: $ID_EXTENSAO" 'Green'

# De onde o Chrome aceita receber o CRX. Sao os tres caminhos possiveis: a pagina de
# download, o Release do GitHub, e o arquivo local (quando alguem arrasta o .crx).
$fontes = @(
  'https://enviagora.github.io/*',
  'https://github.com/*',
  'https://objects.githubusercontent.com/*',
  'file:///*'
)
for ($i = 0; $i -lt $fontes.Count; $i++) {
  Set-ItemProperty -Path $chaveFontes -Name ([string]($i + 1)) -Value $fontes[$i] -Type String
}
Escrever "  fontes liberadas: $($fontes.Count)" 'Green'

if ($SomentePolitica) {
  Write-Host ''
  Escrever '  Politica aplicada. Reinicie o Chrome para valer.' 'Yellow'
  Write-Host ''
  exit 0
}

# -- 2. Baixar a ultima versao ------------------------------------------------------------
Titulo 'Baixando a ultima versao publicada'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" `
                               -Headers @{ 'User-Agent' = 'impressora-enviagora' }
} catch {
  Escrever '  Nao consegui falar com o GitHub.' 'Red'
  Escrever "  ($($_.Exception.Message))" 'DarkGray'
  Escrever ''
  Escrever "  A politica JA foi aplicada - essa parte esta feita." 'Yellow'
  Escrever "  Baixe a extensao na mao em: $PAGINA"
  Write-Host ''
  exit 1
}

$versao = $release.tag_name -replace '^v', ''
Escrever "  versao encontrada: $versao" 'Green'

New-Item -Path $Destino -ItemType Directory -Force | Out-Null

$baixados = @{}
foreach ($nome in @("impressora-enviagora-$versao.crx", "impressora-enviagora-$versao.zip")) {
  $asset = $release.assets | Where-Object { $_.name -eq $nome }
  if (-not $asset) { Escrever "  aviso: $nome nao esta neste release" 'Yellow'; continue }

  $caminho = Join-Path $Destino $nome
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $caminho -UseBasicParsing
  $tamanho = [math]::Round((Get-Item $caminho).Length / 1KB)
  Escrever "  baixado: $nome ($tamanho KB)" 'Green'
  $baixados[$nome.Split('.')[-1]] = $caminho
}

# Descompacta o ZIP, que e o caminho de instalacao que funciona em qualquer maquina.
$pastaZip = Join-Path $Destino "extensao-$versao"
if ($baixados.ContainsKey('zip')) {
  if (Test-Path $pastaZip) { Remove-Item $pastaZip -Recurse -Force }
  Expand-Archive -Path $baixados['zip'] -DestinationPath $pastaZip -Force
  Escrever "  descompactado em: $pastaZip" 'Green'
}

# -- 3. O que so uma pessoa consegue fazer ------------------------------------
Write-Host ''
Write-Host '  ================================================================' -ForegroundColor Yellow
Write-Host '   AGORA E COM VOCE - uns 2 minutos' -ForegroundColor Yellow
Write-Host '  ================================================================' -ForegroundColor Yellow
Write-Host ''
Write-Host '   0. FECHE O CHROME COMPLETAMENTE e abra de novo.' -ForegroundColor Yellow
Escrever '      A liberacao no registro so passa a valer quando o Chrome reinicia.' 'DarkYellow'
Escrever '      Pulando este passo, a instalacao e recusada e parece que o script falhou.' 'DarkYellow'
Write-Host ''

if ($baixados.ContainsKey('crx')) {
  Escrever '   1. Abra o Chrome em:  chrome://extensions'
  Escrever '   2. Se ja existir uma Impressora Enviagora antiga, clique em REMOVER.'
  Escrever '   3. Ligue o "Modo do desenvolvedor" (canto superior direito).'
  Escrever '   4. Abra o Explorador de Arquivos nesta pasta:'
  Escrever "         $Destino" 'White'
  Escrever '      e ARRASTE este arquivo para dentro da janela do chrome://extensions:'
  Escrever "         $(Split-Path -Leaf $baixados['crx'])" 'White'
  Escrever '      Confirme em "Adicionar extensao".'
  Write-Host ''
  Escrever '      Arraste da PASTA, nao da barra de downloads do Chrome - arrastar da' 'DarkYellow'
  Escrever '      barrinha falha com CRX_FILE_NOT_READABLE, que quer dizer apenas que o' 'DarkYellow'
  Escrever '      Chrome nao conseguiu abrir o arquivo.' 'DarkYellow'
  Write-Host ''
  Write-Host '   5. Clique em DETALHES na extensao e ligue:' -ForegroundColor Yellow
  Write-Host '         "Permitir acesso a URLs de arquivo"' -ForegroundColor White
  Write-Host ''
  Escrever '      Este passo e o que mais deixa gente na mao. Sem ele, etiqueta salva no' 'DarkYellow'
  Escrever '      computador sai SEM ajuste. Nao existe jeito de automatizar: o Chrome nao' 'DarkYellow'
  Escrever '      oferece API nenhuma para esse botao.' 'DarkYellow'
  Write-Host ''
  Escrever '   6. Recarregue a tela do sistema com F5 e imprima uma etiqueta de teste.'
  Write-Host ''
  Escrever '   INSTALANDO ASSIM, ELA SE ATUALIZA SOZINHA daqui para a frente.' 'Green'
} else {
  Escrever '   O .crx nao veio neste release. Instale pela pasta descompactada:' 'Yellow'
  Escrever "         $pastaZip" 'White'
  Escrever '   chrome://extensions > Modo do desenvolvedor > Carregar sem compactacao.'
  Escrever '   ATENCAO: instalada assim, ela NAO se atualiza sozinha.' 'Yellow'
}

Write-Host ''
if ($baixados.ContainsKey('zip')) {
  Escrever '   Plano B, so se o Chrome recusar o .crx mesmo depois do passo 0:' 'DarkGray'
  Escrever "   chrome://extensions > Carregar sem compactacao > $pastaZip" 'DarkGray'
  Escrever '   Instalada assim ela NAO se atualiza sozinha - avise a TI se precisar usar.' 'DarkGray'
  Write-Host ''
}

Escrever "   Ajuda e instrucoes: $PAGINA" 'DarkGray'
Write-Host ''

# Abre a pasta para o operador arrastar o .crx de onde deve. Arrastar da barra de
# downloads do Chrome e o erro mais comum aqui, e da CRX_FILE_NOT_READABLE.
try {
  Start-Process explorer.exe $Destino
  Escrever '   (abri a pasta para voce - o arquivo a arrastar esta ali)' 'DarkGray'
  Write-Host ''
} catch { }
