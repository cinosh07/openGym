# Construit l'app openGym Android (variante « sideload », celle qui a le lien Garmin), la signe avec TA clé.
# Usage :   .\perso\build-android.ps1             construit et signe  perso\sortie\openGym-<version>-perso.apk
#           .\perso\build-android.ps1 -Installer  puis l'installe sur le téléphone branché en USB (adb)
#           .\perso\build-android.ps1 -SansWeb    saute la reconstruction du code web (rien n'a changé dedans)
# Prérequis : Node 22+, JDK 21 (celui qu'Android Studio télécharge dans %USERPROFILE%\.jdks), SDK Android.
# Ne PAS compter sur JAVA_HOME ni sur le Java du PATH : Gradle exige le JDK 21 de ce script.
param(
    [string]$Keystore     = 'D:\Sauvegardes\cles\opengym-android.keystore',
    [string]$PasswordFile = 'D:\Sauvegardes\cles\opengym-android.password.txt',
    [string]$Alias        = 'opengym',
    [switch]$SansWeb,
    [switch]$Installer
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$fe   = Join-Path $repo 'frontend'
$out  = Join-Path $PSScriptRoot 'sortie'

# 1. Les outils.
$jdk = Get-ChildItem "$env:USERPROFILE\.jdks" -Directory -Filter '*21*' -ErrorAction SilentlyContinue |
       Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $jdk) { throw "JDK 21 introuvable dans $env:USERPROFILE\.jdks : dans Android Studio, Settings > Build Tools > Gradle > Gradle JDK > Download JDK > version 21." }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $env:ANDROID_HOME)) { throw "SDK Android introuvable : $env:ANDROID_HOME" }
foreach ($f in @($Keystore, $PasswordFile)) { if (-not (Test-Path $f)) { throw "Fichier de signature introuvable : $f" } }
$bt = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object { [version]($_.Name -replace '[^\d\.].*$','') } -Descending | Select-Object -First 1
if (-not $bt) { throw "Aucun build-tools dans le SDK Android (SDK Manager > SDK Tools > Android SDK Build-Tools)." }
$zipalign  = Join-Path $bt.FullName 'zipalign.exe'
$apksigner = Join-Path $bt.FullName 'apksigner.bat'
$version   = (Get-Content (Join-Path $fe 'package.json') -Raw | ConvertFrom-Json).version
"Java : $($jdk.Name)   SDK : $env:ANDROID_HOME   build-tools : $($bt.Name)   version : $version"

# 2. Le code web en version mobile (copié dans android/ par Capacitor).
Push-Location $fe
try {
    if (-not $SansWeb) {
        if (-not (Test-Path 'node_modules')) { npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm ci a échoué' } }
        # Le script npm utilise la syntaxe Linux (VITE_MOBILE=1 ...) : on le fait lire par le Bash de Git.
        npm run build:mobile --script-shell="C:\Program Files\Git\bin\bash.exe"
        if ($LASTEXITCODE) { throw 'npm run build:mobile a échoué' }
    }
} finally { Pop-Location }

# 3. L'APK (non signé) par Gradle.
Push-Location (Join-Path $fe 'android')
try {
    $ErrorActionPreference = 'Continue'   # Gradle écrit des avertissements sur stderr
    .\gradlew.bat assembleSideloadRelease --console=plain "-Dorg.gradle.workers.max=3"
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code) { throw "Gradle a échoué (code $code)" }
} finally { Pop-Location }
$unsigned = Get-ChildItem (Join-Path $fe 'android\app\build\outputs\apk\sideload\release') -Filter '*.apk' | Select-Object -First 1
if (-not $unsigned) { throw 'APK non signé introuvable après Gradle' }

# 4. Aligner puis signer avec ta clé.
New-Item -ItemType Directory -Force $out | Out-Null
$aligned = Join-Path $out 'aligned.tmp.apk'
$final   = Join-Path $out "openGym-$version-perso.apk"
& $zipalign -f -p 4 $unsigned.FullName $aligned
if ($LASTEXITCODE) { throw 'zipalign a échoué' }
# Pas de --key-pass : le mot de passe de la clé est celui du coffre (apksigner lirait deux fois le même fichier et buterait sur la fin).
& $apksigner sign --ks $Keystore --ks-key-alias $Alias --ks-pass "file:$PasswordFile" --out $final $aligned
if ($LASTEXITCODE) { throw 'apksigner a échoué' }
Remove-Item $aligned, "$final.idsig" -ErrorAction SilentlyContinue
& $apksigner verify --print-certs $final | Select-String 'Signer #1 certificate SHA-256'
(Get-FileHash $final -Algorithm SHA256).Hash.ToLower() + "  $(Split-Path $final -Leaf)" | Set-Content -Encoding ASCII "$final.sha256"
"`nAPK prêt : $final ($([Math]::Round((Get-Item $final).Length/1MB)) Mo)"

# 5. Installation (téléphone en USB, débogage USB activé).
if ($Installer) {
    $adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
    & $adb devices
    & $adb install -r $final
    if ($LASTEXITCODE) { throw "adb install a échoué (téléphone branché ? débogage USB activé ? autorisation acceptée sur le téléphone ?)" }
    "Installé. Ouvre openGym sur le téléphone."
}
