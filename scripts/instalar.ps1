<#
  IMPRESSORA ENVIAGORA — preparo da maquina
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
    a cada reinicio — e os operadores abrem PDF salvo no disco. Por isso nao usamos.

  COMO RODAR (PowerShell como ADMINISTRADOR)
      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\instalar.ps1

  E idempotente: rodar de novo nao duplica nada e nao quebra nada.
#>

[CmdletBinding()]
param(
  # Onde a extensao fica guardada. Escolha uma pasta que ninguem vai apagar por engano.
  [string] $Destino = 'C:\Impressora-Enviagora',

  # Use -SomentePolitica para so aplicar o registro, sem baixar nada.
  [switch] $SomentePolitica
)

$ErrorActionPreference = 'Stop'

# ID desta extensao. Vem do SHA-256 da chave publica (config/chave-publica.txt) e e o que
# faz o toggle de file:// sobreviver as atualizacoes. tests/invariantes.test.mjs confere
# que este valor continua batendo com a chave versionada.
$ID_EXTENSAO = 'kigacgfagjemjheogplplhcneolndhan'
$REPO        = 'Enviagora/impressora-enviagora'
$PAGINA      = 'https://enviagora.github.io/impressora-enviagora/'

function Escrever($texto, $cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }
function Titulo($texto) {
  Write-Host ''
  Write-Host "  $texto" -ForegroundColor Cyan
  Write-Host ('  ' + ('-' * $texto.Length)) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  IMPRESSORA ENVIAGORA — preparo da maquina' -ForegroundColor Green
Write-Host ''

# ── 0. Administrador? ────────────────────────────────────────────────────────
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

# ── 1. Politica local ────────────────────────────────────────────────────────
Titulo 'Liberando a instalacao no registro do Windows'

# ExtensionInstallAllowlist: SO esta extensao fica liberada. Nao abrimos a maquina para
# qualquer extensao de fora da loja — o ID e a lista inteira.
$chaveAllow  = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist'
$chaveFontes = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallSources'

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

# ── 2. Baixar a ultima versao ────────────────────────────────────────────────
Titulo 'Baixando a ultima versao publicada'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" `
                               -Headers @{ 'User-Agent' = 'impressora-enviagora' }
} catch {
  Escrever '  Nao consegui falar com o GitHub.' 'Red'
  Escrever "  ($($_.Exception.Message))" 'DarkGray'
  Escrever ''
  Escrever "  A politica JA foi aplicada — essa parte esta feita." 'Yellow'
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

# ── 3. O que so uma pessoa consegue fazer ────────────────────────────────────
Write-Host ''
Write-Host '  ================================================================' -ForegroundColor Yellow
Write-Host '   AGORA E COM VOCE — 5 passos, uns 2 minutos' -ForegroundColor Yellow
Write-Host '  ================================================================' -ForegroundColor Yellow
Write-Host ''
Escrever '   1. Abra o Chrome em:  chrome://extensions'
Escrever '   2. Se ja existir uma Impressora Enviagora antiga, clique em REMOVER.'
Escrever '   3. Ligue o "Modo do desenvolvedor" (canto superior direito).'
Escrever '   4. Clique em "Carregar sem compactacao" e escolha esta pasta:'
Escrever "         $pastaZip" 'White'
Write-Host ''
Write-Host '   5. Clique em DETALHES na extensao e ligue:' -ForegroundColor Yellow
Write-Host '         "Permitir acesso a URLs de arquivo"' -ForegroundColor White
Write-Host ''
Escrever '      Este passo 5 e o que mais deixa gente na mao. Sem ele, etiqueta salva' 'DarkYellow'
Escrever '      no computador sai SEM ajuste. Nao existe jeito de automatizar: o Chrome' 'DarkYellow'
Escrever '      nao oferece API nenhuma para esse botao.' 'DarkYellow'
Write-Host ''
Escrever '   6. Recarregue a tela do sistema com F5 e imprima uma etiqueta de teste.'
Write-Host ''

if ($baixados.ContainsKey('crx')) {
  Escrever '   Para instalar COM atualizacao automatica (se o piloto aprovou esse caminho):' 'DarkGray'
  Escrever "   arraste $($baixados['crx'])" 'DarkGray'
  Escrever '   para a janela do chrome://extensions, com o Modo do desenvolvedor ligado.' 'DarkGray'
  Write-Host ''
}

Escrever "   Ajuda e instrucoes: $PAGINA" 'DarkGray'
Write-Host ''
