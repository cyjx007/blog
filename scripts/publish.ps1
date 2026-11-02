# 发布：本地构建校验 → 提交 → 推送 → 等 Cloudflare 部署完成
[CmdletBinding()]
param(
  [string]$Message,
  [switch]$NoBuild,
  [switch]$NoWatch
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$status = git status --porcelain
if (-not $status) { Write-Host "没有改动，不用发。" -ForegroundColor Yellow; exit 0 }

Write-Host "这次要发的东西：" -ForegroundColor Cyan
git status --short | ForEach-Object { Write-Host "  $_" }

# 草稿提醒：draft: true 不会出现在站上
$drafts = Select-String -Path 'content\posts\*.md' -Pattern '^draft:\s*true' -List -ErrorAction SilentlyContinue
if ($drafts) {
  Write-Host ""
  Write-Host "注意：这些还是草稿（draft: true），不会上线：" -ForegroundColor Yellow
  $drafts | ForEach-Object { Write-Host ("  " + (Split-Path -Leaf $_.Path)) }
}

# 本地先构建一遍，YAML 写错就别推了
if (-not $NoBuild) {
  $hugo = $null
  $cmd = Get-Command hugo -ErrorAction SilentlyContinue
  if ($cmd) { $hugo = $cmd.Source }
  elseif (Test-Path '..\.tools\hugo\hugo.exe') { $hugo = (Resolve-Path '..\.tools\hugo\hugo.exe').Path }
  if ($hugo) {
    Write-Host ""
    Write-Host "本地构建检查…" -ForegroundColor DarkGray
    & $hugo --gc --minify --cleanDestinationDir --logLevel warn
    if ($LASTEXITCODE -ne 0) {
      Write-Host "构建失败，先别发。看上面的报错。" -ForegroundColor Red
      exit 1
    }
  } else {
    Write-Host "没找到 hugo，跳过本地构建检查。" -ForegroundColor DarkGray
  }
}

if (-not $Message) { $Message = 'post: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }

git add -A
git commit -m $Message | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "提交失败。" -ForegroundColor Red; exit 1 }

$sha = (git rev-parse --short HEAD)
Write-Host ""
Write-Host "提交 $sha，推送中…" -ForegroundColor DarkGray
git push origin main
if ($LASTEXITCODE -ne 0) {
  # 沙箱/无凭据环境下的兜底：走工作区的 token 包装脚本
  $wrap = '..\.dsh\github\gh-git.cmd'
  if (Test-Path $wrap) { & $wrap push origin main }
  if ($LASTEXITCODE -ne 0) { Write-Host "推送失败，检查 GitHub 凭据。" -ForegroundColor Red; exit 1 }
}

if ($NoWatch) { Write-Host "已推送。" -ForegroundColor Green; exit 0 }

# 等 Cloudflare Pages 构建完
$tokenFile = '..\.dsh\cloudflare\token'
$account = 'a31376e4212bed64a04acddebb1be117'
if (-not (Test-Path $tokenFile)) {
  Write-Host "推送完成。没找到 CF token，就不等部署结果了（大约 1 分钟后上线）。" -ForegroundColor Green
  exit 0
}

$token = (Get-Content $tokenFile -Raw).Trim()
$uri = "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects/blog/deployments?per_page=1"
Write-Host "等 Cloudflare 构建（通常 30-60 秒）…" -ForegroundColor DarkGray

for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 20
    $d = $r.result[0]
    $hash = $d.deployment_trigger.metadata.commit_hash
    if ($hash -and $hash.StartsWith($sha)) {
      $stage = $d.latest_stage.status
      if ($stage -eq 'success') {
        Write-Host ""
        Write-Host "上线了 → https://blog.tanghuang.dpdns.org/" -ForegroundColor Green
        exit 0
      }
      if ($stage -eq 'failure') {
        Write-Host "构建失败了，去 Cloudflare 面板看日志：Pages → blog → 最新部署。" -ForegroundColor Red
        exit 1
      }
    }
  } catch { }
}

Write-Host "等了 5 分钟还没结果，去面板看一眼吧。" -ForegroundColor Yellow
exit 0
