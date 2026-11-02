# 本地预览：http://127.0.0.1:1313
[CmdletBinding()]
param([int]$Port = 1313)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$hugo = $null
$cmd = Get-Command hugo -ErrorAction SilentlyContinue
if ($cmd) { $hugo = $cmd.Source }
elseif (Test-Path '..\.tools\hugo\hugo.exe') { $hugo = (Resolve-Path '..\.tools\hugo\hugo.exe').Path }

if (-not $hugo) {
  Write-Host "没找到 hugo。装一个，或者把 hugo.exe 放到 C:\Users\tangh\code\.tools\hugo\。" -ForegroundColor Red
  exit 1
}

if (-not $env:HUGO_CACHEDIR) { $env:HUGO_CACHEDIR = Join-Path $root '.hugo-cache' }
Write-Host "预览地址：http://127.0.0.1:$Port/   （Ctrl+C 停止）" -ForegroundColor Green
& $hugo server --port $Port --bind 127.0.0.1 --buildDrafts
