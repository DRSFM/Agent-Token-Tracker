$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root "release"
$unpackedDir = Join-Path $releaseDir "win-unpacked"
$readme = Join-Path $unpackedDir "README-使用说明.txt"
$zip = Join-Path $releaseDir "Agent-Token-Tracker-win-x64-portable.zip"

if (!(Test-Path -LiteralPath $unpackedDir)) {
  throw "Missing win-unpacked directory. Run electron-builder --win dir first."
}

@"
Agent Token Tracker 使用说明

1. 解压整个 zip，不要只单独拖出 exe。
2. 双击 Agent Token Tracker.exe 启动。
3. 本工具只读取本机 Claude Code / Codex 的本地会话日志，用来估算 token 使用量。
4. 数据不会上传到网络，也不需要 OpenAI / Anthropic API Key。
5. 如果 Windows 提示“未知发布者”，这是因为当前版本未做代码签名。点击“更多信息”后仍可运行。
6. 如果没有数据显示，请确认本机使用过 Claude Code 或 Codex，并在设置页点击“重新扫描”。
"@ | Set-Content -LiteralPath $readme -Encoding UTF8

if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $unpackedDir "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Portable package created: $zip"

