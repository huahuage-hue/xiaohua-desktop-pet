# 小嬅桌宠 · 一键构建（Windows 10/11，PowerShell 5.1+）
# 用法：右键“使用 PowerShell 运行”，或在 desktop-pet 目录执行：  powershell -ExecutionPolicy Bypass -File build.ps1
# 参数：-Dev 以开发模式运行（不打包，改网页后刷新即可）；-SkipInstall 跳过环境检查；-NoOpen 构建完不打开资源管理器
#       -Release 额外生成自动更新要发布的文件（OutDir\发布\v版本\：安装包 + latest.json + 发布说明.txt）
#       -UpdateBase 下载地址前缀（默认走 gh-proxy 镜像，国内直连 GitHub Releases 常被墙）；-Notes 更新说明（显示在面板「更新」里）
# v0.6.0 起安装包必须用更新签名私钥签名（默认 %USERPROFILE%\.tauri\xiaohua-updater.key，不要放进源码目录）
param([switch]$Dev, [switch]$SkipInstall, [switch]$NoOpen, [switch]$Release, [string]$OutDir = 'D:\小嬅桌宠',
  [string]$UpdateBase = 'https://gh-proxy.com/https://github.com/huahuage-hue/xiaohua-desktop-pet/releases/download',
  [string]$Notes = '', [string]$Key = "$env:USERPROFILE\.tauri\xiaohua-updater.key")
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
$ver = (Get-Content (Join-Path $here 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
Step "签名私钥（v$ver）"
if (-not (Test-Path $Key)) {
  throw "没找到更新签名私钥：$Key`n  首次可运行：cargo tauri signer generate -w `"$Key`" --ci -p `"`"`n  然后把 $Key.pub 的内容填进 tauri.conf.json → plugins.updater.pubkey。`n  注意：已经装上的旧版本只认原来的公钥，私钥丢了就没法再给它们推更新。"
}
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $Key -Raw
Write-Host "  $Key"
Step '构建（首次编译约 5–10 分钟）'
cargo tauri build
if ($LASTEXITCODE -ne 0) { throw '构建失败：把上面的报错发给我即可' }
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue

$out = Join-Path $here 'src-tauri\target\release'
$setup = Join-Path $out "bundle\nsis\小嬅桌宠_${ver}_x64-setup.exe"
if (-not (Test-Path $setup)) { throw "没找到安装包：$setup" }

# 4. 复制到交付目录（默认 D:\小嬅桌宠，可用 -OutDir 修改；运行中的桌宠会先被关闭）
Step "复制到 $OutDir"
$exeDst = Join-Path $OutDir '小嬅桌宠.exe'
# 等它真正退出、松开 exe 再复制（只 Stop-Process 不等，偶尔会“文件被占用”）
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exeDst } | Stop-Process -Force -PassThru | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir '安装包') | Out-Null
Copy-Item "$out\xiaohua-pet.exe" $exeDst -Force
# 只复制这一版的安装包（bundle 目录里会留着以前各版本的旧包）
Copy-Item $setup (Join-Path $OutDir '安装包') -Force
$note = Join-Path $here '使用说明.txt'
if (Test-Path $note) { Copy-Item $note $OutDir -Force }

# 5. 自动更新发布文件：安装包换成英文名（附件名用英文更稳），配 latest.json
if ($Release) {
  Step '生成自动更新发布文件'
  $sig = "$setup.sig"
  if (-not (Test-Path $sig)) { throw "没找到签名文件：$sig（tauri.conf.json 里要开 bundle.createUpdaterArtifacts）" }
  $rel = Join-Path $OutDir "发布\v$ver"
  New-Item -ItemType Directory -Force -Path $rel | Out-Null
  $asset = "xiaohua-pet_${ver}_x64-setup.exe"
  Copy-Item $setup (Join-Path $rel $asset) -Force
  if (-not $Notes) { $Notes = "小嬅桌宠 v$ver" }
  $url = "$($UpdateBase.TrimEnd('/'))/v$ver/$asset"
  $latest = [ordered]@{
    version   = $ver
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = [ordered]@{ 'windows-x86_64' = [ordered]@{ signature = (Get-Content $sig -Raw).Trim(); url = $url } }
  }
  [IO.File]::WriteAllText((Join-Path $rel 'latest.json'), ($latest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  $guide = @"
小嬅桌宠 v$ver 发布步骤（GitHub）
1. 打开 GitHub 仓库 → Releases → Draft a new release，标签填 v$ver
2. 上传附件：$asset（需要免安装版就一并传）
3. 把 latest.json 放到仓库 master 分支根目录（覆盖旧的）并提交
4. 等一两分钟，在旧版本面板「设置 → 更新 → 检查更新」确认能看到 v$ver
清单地址：https://raw.githubusercontent.com/huahuage-hue/xiaohua-desktop-pet/master/latest.json
下载地址：$url
角色设计 © 樺樺嗝
"@
  [IO.File]::WriteAllText((Join-Path $rel '发布说明.txt'), $guide, (New-Object Text.UTF8Encoding $true))
  if ($UpdateBase -notlike 'https://*') { Write-Host '  注意：UpdateBase 不是 https 地址，自动更新会拒绝下载' -ForegroundColor Yellow }
  Write-Host "  发布文件：$rel"
}

Step '完成'
Write-Host "  免安装版：$exeDst"
Write-Host "  安装包：$(Join-Path $OutDir '安装包')\小嬅桌宠_${ver}_x64-setup.exe"
if (-not $NoOpen) { explorer.exe $OutDir }

