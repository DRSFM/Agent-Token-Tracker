$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$releaseDir = Join-Path $root "release"
$installerPath = Join-Path $releaseDir "Agent-Token-Tracker-Setup-$version.exe"
$backgroundDir = Join-Path $releaseDir "示例背景图"
$bundlePath = Join-Path $releaseDir "Agent-Token-Tracker-$version-installer-with-backgrounds.zip"

if (-not (Test-Path $installerPath)) {
  throw "Installer not found: $installerPath"
}

if (Test-Path $backgroundDir) {
  Remove-Item -LiteralPath $backgroundDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $backgroundDir | Out-Null
$surpriseBackgroundDir = Join-Path $root "示例背景图"
if (Test-Path $surpriseBackgroundDir) {
  Copy-Item -Path (Join-Path $surpriseBackgroundDir "*") -Destination $backgroundDir -Force
}

if (Test-Path $bundlePath) {
  Remove-Item -LiteralPath $bundlePath -Force
}

Compress-Archive -LiteralPath $installerPath, $backgroundDir -DestinationPath $bundlePath -CompressionLevel Optimal
Write-Host "Friend package created: $bundlePath"
