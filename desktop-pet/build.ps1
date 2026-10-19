# 小嬅桌宠 · 一键构建（Windows 10/11，PowerShell 5.1+）
# 用法：右键“使用 PowerShell 运行”，或在 desktop-pet 目录执行：  powershell -ExecutionPolicy Bypass -File build.ps1
# 参数：-Dev 以开发模式运行（不打包，改网页后刷新即可）；-SkipInstall 跳过环境检查
param([switch]$Dev, [switch]$SkipInstall, [string]$OutDir = 'D:\小嬅桌宠')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Step($s) { Write-Host "`n== $s" -ForegroundColor Cyan }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# 1. 环境：VS C++ 生成工具 + Rust（约 3–5GB，只需一次）
if (-not $SkipInstall) {
  Step '检查 Visual Studio C++ 生成工具'
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $hasVC = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
  if (-not $hasVC) {
    if (-not (Has winget)) { throw '未找到 winget。请手动安装 “Visual Studio 生成工具 2022”，勾选“使用 C++ 的桌面开发”后重试。' }
    Write-Host '正在安装 VS 生成工具（C++ 桌面开发），需要管理员确认，约 10–20 分钟…'
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements `
      --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  } else { Write-Host '已安装' }

  Step '检查 Rust'
  $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
  if (-not (Has cargo)) {
    Write-Host '正在安装 Rust（rustup）…'
    $rs = Join-Path $env:TEMP 'rustup-init.exe'
    Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $rs
    & $rs -y --default-toolchain stable --profile minimal
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
  } else { cargo --version }

  Step '检查 tauri-cli'
  $hasCli = $false
  try { cargo tauri --version | Out-Null; $hasCli = $LASTEXITCODE -eq 0 } catch { }
  if (-not $hasCli) { Write-Host '正在安装 tauri-cli（首次约 5 分钟）…'; cargo install tauri-cli --version '^2' --locked }
}
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

# 2. 同步素材：用项目根目录 assets/ 里最新的渲染器和分层图集
Step '同步 assets'
$srcAssets = Join-Path $here '..\assets'
$dst = Join-Path $here 'web\assets'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($f in 'xiaohua_layers.js', 'xiaohua_wardrobe.js', 'app-core.js', 'app-render.js', 'app-dress.js', 'app-sfx.js', 'app-bubble.js', 'app-assist.js', 'app.js') {
  $p = Join-Path $srcAssets $f
  if (Test-Path $p) { Copy-Item $p $dst -Force; Write-Host "  $f" }
  elseif (-not (Test-Path (Join-Path $dst $f))) { throw "缺少 $f：请保留 desktop-pet 与 assets 在同一个项目文件夹里" }
}
$wardrobe = Join-Path $srcAssets 'wardrobe'
if (Test-Path $wardrobe) { $wd = Join-Path $dst 'wardrobe'; if (Test-Path $wd) { Remove-Item $wd -Recurse -Force }; Copy-Item $wardrobe $wd -Recurse -Force; Write-Host '  wardrobe/' }

# 3. 构建
Set-Location (Join-Path $here 'src-tauri')
if ($Dev) { Step '开发模式运行'; cargo tauri dev; exit }
Step '构建（首次编译约 5–10 分钟）'
cargo tauri build
if ($LASTEXITCODE -ne 0) { throw '构建失败：把上面的报错发给我即可' }

$out = Join-Path $here 'src-tauri\target\release'

# 4. 复制到交付目录（默认 D:\小嬅桌宠，可用 -OutDir 修改；运行中的桌宠会先被关闭）
Step "复制到 $OutDir"
$exeDst = Join-Path $OutDir '小嬅桌宠.exe'
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exeDst } | Stop-Process -Force
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir '安装包') | Out-Null
Copy-Item "$out\xiaohua-pet.exe" $exeDst -Force
Get-ChildItem "$out\bundle" -Recurse -Include *.exe -ErrorAction SilentlyContinue | Copy-Item -Destination (Join-Path $OutDir '安装包') -Force
$note = Join-Path $here '使用说明.txt'
if (Test-Path $note) { Copy-Item $note $OutDir -Force }

Step '完成'
Write-Host "  免安装版：$exeDst"
Get-ChildItem (Join-Path $OutDir '安装包') -Filter *.exe | ForEach-Object { Write-Host "  安装包：$($_.FullName)" }
explorer.exe $OutDir

