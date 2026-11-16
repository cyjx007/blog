# 写一封新信：生成 content/posts/<标题>.md 并用编辑器打开
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Title,
  [Parameter(Position = 1)][string[]]$Tags,
  [string]$Salutation,
  [switch]$Draft,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Title) { $Title = Read-Host "这封信叫什么（标题）" }
$Title = $Title.Trim()
if (-not $Title) { Write-Host "没标题就不写了。" -ForegroundColor Yellow; exit 1 }

# 文件名 = 标题（去掉非法字符，空格换连字符）
$name = $Title
foreach ($ch in [System.IO.Path]::GetInvalidFileNameChars()) { $name = $name.Replace([string]$ch, '') }
$name = ($name -replace '\s+', '-').Trim('-')
if (-not $name) { Write-Host "这个标题没法当文件名，换一个。" -ForegroundColor Yellow; exit 1 }

$dir = Join-Path $root 'content\posts'
$file = Join-Path $dir "$name.md"
if (Test-Path $file) { Write-Host "已经有一封同名的了：$file" -ForegroundColor Yellow; exit 1 }

$date = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
# YAML 双引号字符串里反斜杠是转义符：标题里的 \ 必须先翻倍，否则 "C:\backup" 会变成退格符
$esc = { param($s) $s.Replace('\', '\\').Replace('"', '\"') }

$tagLine = '[]'
if ($Tags) {
  $clean = @()
  foreach ($t in $Tags) {
    foreach ($piece in ([string]$t -split ',')) {
      $p = $piece.Trim()
      if ($p) { $clean += $p }
    }
  }
  if ($clean.Count -gt 0) {
    $tagLine = '[' + (($clean | ForEach-Object { '"' + (& $esc $_) + '"' }) -join ', ') + ']'
  }
}

$lines = @(
  '---',
  ('title: "' + (& $esc $Title) + '"'),
  ('date: ' + $date),
  ('draft: ' + $(if ($Draft) { 'true' } else { 'false' })),
  ('slug: "' + (& $esc $name) + '"')
)
if ($Salutation) { $lines += ('salutation: "' + (& $esc $Salutation) + '"') }
$lines += ('tags: ' + $tagLine)
$lines += 'categories: []'
$lines += '---'
$lines += ''
$lines += '正文从这里开始。空一行就是新的一段。'
$lines += ''
$lines += '## 小标题'
$lines += ''
$lines += '写完记得存盘。超过 600 字会自动叠三折。'
$lines += ''

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, ($lines -join "`r`n"), $utf8)

Write-Host ""
Write-Host "写好了：content/posts/$name.md" -ForegroundColor Green
Write-Host "地址会是：https://blog-efv.pages.dev/posts/$name/"
if ($Draft) { Write-Host "（draft: true，发之前要改成 false 才会出现在站上）" -ForegroundColor Yellow }
Write-Host ""
Write-Host "下一步：写完存盘 → 双击「发布.cmd」，或者跑 .\scripts\publish.ps1" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoOpen) {
  $code = Get-Command code -ErrorAction SilentlyContinue
  if ($code) {
    Start-Process -FilePath $code.Source -ArgumentList "`"$file`""
  } else {
    Start-Process -FilePath 'notepad.exe' -ArgumentList "`"$file`""
  }
}
