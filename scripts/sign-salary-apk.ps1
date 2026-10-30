param(
    [Parameter(Mandatory=$true)][string]$KeyStore,
    [Parameter(Mandatory=$true)][string]$Alias,
    [string]$UnsignedApk = 'review/native-repairs-8.2.38/Time-Is-Money-8.2.38-unsigned-review.apk',
    [string]$InstalledApk = 'review/connected-device/com.pattan.presentator-base.apk',
    [string]$OutputApk = 'review/native-repairs-8.2.38/Time-Is-Money-8.2.38-signed-review.apk'
)
$ErrorActionPreference = 'Stop'
if (-not $env:TIM_SIGN_STORE_PASSWORD) { throw 'Set TIM_SIGN_STORE_PASSWORD privately before signing. Do not put passwords in commands or source files.' }
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$signer = Join-Path $sdkRoot 'build-tools/36.0.0/apksigner.bat'
$aligner = Join-Path $sdkRoot 'build-tools/36.0.0/zipalign.exe'
$keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
foreach ($item in @($KeyStore,$UnsignedApk,$InstalledApk,$signer,$aligner,$keytool)) { if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "Required file is unavailable: $item" } }
if (Test-Path -LiteralPath $OutputApk) { throw 'The signed output already exists; verify it before replacing it.' }
function Read-ApkCertificate([string]$File) {
    $details = & $signer verify --print-certs $File 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'The reference APK has an invalid signature.' }
    $found = [regex]::Matches(($details -join "`n"), 'Signer #\d+ certificate SHA-256 digest: ([A-Fa-f0-9]{64})')
    if ($found.Count -ne 1) { throw 'Expected exactly one APK signing certificate.' }
    return $found[0].Groups[1].Value.ToLowerInvariant()
}
$original = Read-ApkCertificate $InstalledApk
$directory = Split-Path ([IO.Path]::GetFullPath($OutputApk))
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$token = [guid]::NewGuid().ToString('N')
$certificate = Join-Path $directory ("public-certificate-$token.der")
$aligned = Join-Path $directory ("aligned-$token.apk")
$signed = Join-Path $directory ("signed-$token.apk")
try {
    & $keytool -exportcert -keystore $KeyStore -alias $Alias -storepass:env TIM_SIGN_STORE_PASSWORD -file $certificate 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the signing certificate. Check the keystore, alias and password.' }
    $keyCertificate = (Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($keyCertificate -ne $original) { throw 'Signing certificate mismatch: this key cannot update the installed app safely. Nothing was signed or installed.' }
    & $aligner -P 16 -f 4 $UnsignedApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    $keyPassword = if ($env:TIM_SIGN_KEY_PASSWORD) { 'env:TIM_SIGN_KEY_PASSWORD' } else { 'env:TIM_SIGN_STORE_PASSWORD' }
    & $signer sign --ks $KeyStore --ks-key-alias $Alias --ks-pass env:TIM_SIGN_STORE_PASSWORD --key-pass $keyPassword --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    if ((Read-ApkCertificate $signed) -ne $original) { throw 'The signed APK does not match the installed certificate.' }
    Move-Item -LiteralPath $signed -Destination $OutputApk
    [ordered]@{ apk=[IO.Path]::GetFullPath($OutputApk); sha256=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToLowerInvariant(); certificateSha256=$original; compatibleCertificate=$true; installed=$false; published=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'signing-review.json') -Encoding utf8
    Write-Output 'Compatible signed APK verified and ready for review. Publication and installation still require approval.'
} finally {
    foreach ($temporary in @($certificate,$aligned,$signed)) { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
