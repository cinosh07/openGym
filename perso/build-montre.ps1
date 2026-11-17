# Construit l'app openGym de la montre (Garmin Connect IQ) pour ton fenix 8, avec TA clé.
# Usage :   .\perso\build-montre.ps1              construit  frontend\garmin\bin\opengym-fenix847mm.prg
#           .\perso\build-montre.ps1 -Installer   puis copie le .prg dans GARMIN\APPS de la montre branchée en USB
# « fenix847mm » est l'identifiant Connect IQ du fēnix 8 47 mm ET 51 mm (AMOLED).
# Il construit pour UNE montre : ton Gestionnaire de SDK n'a pas les fichiers des 82 montres du
# manifeste d'origine, alors on en génère une version réduite (manifest-perso.xml, jamais commitée).
param(
    [string]$Device = 'fenix847mm',
    [string]$Key    = 'D:\Sauvegardes\cles\opengym_developer_key.der',
    [switch]$Installer
)
$ErrorActionPreference = 'Stop'
$repo   = Split-Path $PSScriptRoot -Parent
$garmin = Join-Path $repo 'frontend\garmin'

# 1. Le SDK Connect IQ choisi dans le Gestionnaire de SDK.
$cfg = Join-Path $env:APPDATA 'Garmin\ConnectIQ\current-sdk.cfg'
if (-not (Test-Path $cfg)) { throw "SDK Connect IQ introuvable ($cfg) : installe-le avec le Gestionnaire de SDK Connect IQ." }
$sdk = (Get-Content $cfg -Raw).Trim()
$monkeyc = Join-Path $sdk 'bin\monkeyc.bat'
if (-not (Test-Path $monkeyc)) { throw "monkeyc introuvable dans $sdk" }
if (-not (Test-Path $Key)) { throw "Clé de développeur introuvable : $Key" }
$devDir = Join-Path $env:APPDATA "Garmin\ConnectIQ\Devices\$Device"
if (-not (Test-Path $devDir)) { throw "Fichiers de la montre '$Device' absents : Gestionnaire de SDK, onglet Devices, coche cette montre." }

# 2. Manifeste réduit à cette montre + projet Monkey C minimal (une montre couleur et tactile).
Push-Location $garmin
try {
    node (Join-Path $PSScriptRoot 'make-manifest.mjs') $garmin $Device
    if ($LASTEXITCODE -ne 0) { throw "génération du manifeste réduit échouée" }
    "project.manifest = manifest-perso.xml`nbase.excludeAnnotations = mono;sim;small;notouch;nofixui" | Set-Content -Encoding ASCII monkey-perso.jungle
    node check.mjs $sdk
    New-Item -ItemType Directory -Force bin | Out-Null
    $prg = Join-Path $garmin "bin\opengym-$Device.prg"
    # monkeyc écrit ses avertissements sur stderr : PowerShell 5.1 les prendrait pour des erreurs.
    $ErrorActionPreference = 'Continue'
    $out = & $monkeyc -f monkey-perso.jungle -d $Device -y $Key -o $prg -w 2>&1
    $ErrorActionPreference = 'Stop'
    $out | Where-Object { $_ -notmatch 'Cannot determine if container' } | ForEach-Object { "$_" }
    if (-not ($out -match 'BUILD SUCCESSFUL')) { throw "la compilation a échoué (voir plus haut)" }
} finally { Pop-Location }
"`nMontre construite : $prg ($([Math]::Round((Get-Item $prg).Length/1KB)) Ko)"

# 3. Copie sur la montre (USB, mode stockage) : GARMIN\APPS\OpenGym.prg
if ($Installer) {
    $apps = Get-PSDrive -PSProvider FileSystem | ForEach-Object { Join-Path $_.Root 'GARMIN\APPS' } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $apps) { throw "Montre non trouvée : branche-la en USB (elle doit apparaître comme un lecteur avec un dossier GARMIN\APPS)." }
    Copy-Item $prg (Join-Path $apps 'OpenGym.prg') -Force
    "Copié dans $apps\OpenGym.prg : débranche la montre proprement, elle installe l'app toute seule."
}
