# 小嬅桌宠 · AI 交接文档

适用版本：**v0.6.0** ｜ 整理日期：2026-10-19 ｜ 平台：Windows 10/11 x64  
v0.6.0 的完整开发记录（四期分别做了什么、怎么验证、哪些没验证）见 `docs/v0.6.0_开发计划.md`。源码已有 git（`D:\小嬅桌宠源码\.git`），v0.6 工作在分支 `v0.6/chat-ui`。  
代码根目录：`D:\小嬅桌宠源码` ｜ 交付目录：`D:\小嬅桌宠`  
文档位置：`<root>\AI_HANDOFF.md`（Open Design 项目内副本：`小嬅桌宠_交接文档.md`）

> 这份文档写给**下一个接手代码的 AI**，不是最终用户说明书。  
> 先读本文，再读 `desktop-pet/README.md`、`docs/桌宠方案.md`、`psd/图层说明.md`。  
> 旧版 `打包说明.txt`、`dist/` 和 `小嬅桌宠_源码_v0.2.1_20261018.zip` 已过时，不要按它们判断当前状态。

---

## 0. 给接手 AI 的启动提示（可直接粘贴）

```text
你接手的是 Windows 桌宠「小嬅桌宠」v0.6.0，技术栈是 Tauri 2 + Rust + WebView2 + 原生 WebGL 网页渲染。
请先完整阅读项目根目录的 AI_HANDOFF.md，再读 desktop-pet/README.md 和 docs/桌宠方案.md。

硬约束：
1. 不要重构整体架构；先理解点击穿透、拖动松手、面板 WebView、记忆/场景数据流。
2. 不要直接改 desktop-pet/web/assets/；角色渲染源在根目录 assets/，构建时同步。
3. 改设置项必须同步 panel.html、pet.js、消费端，并考虑 sv 迁移。
4. 改代码前先跑 node --check / cargo check，改完必须实际构建并在真机冒烟。
5. 不要动用户的聊天记录、记忆和 API 密钥；测试前先备份 localStorage。

先告诉我：当前版本状态、你准备改哪几个文件、如何验证，然后再动代码。
```

---

## 1. 一句话现状

小嬅桌宠 = **Tauri 2 透明宿主 + WebView2 + 纯 WebGL 分层角色渲染 + 本地 AI 对话/记忆/场景感知**。  
窗口透明、无边框、置顶、点击穿透、可拖动、贴边探头、托盘常驻；控制面板独立窗口；已经构建、安装并在 Windows 本机实际运行验证。

当前是**可交付的 v0.6.0**，不是原型。源码可编译，安装包和免安装版都已产出。接手时优先做“验证 + 小步修改”，不要重写。

### 已实现模块

| 模块 | 当前能力 |
|---|---|
| 角色渲染 | 纯 WebGL 1，分层网格、眨眼、视线、嘴型、云朵、星星、呼吸、拖动摇摆；不使用 Live2D 运行时 |
| 互动 | 摸头 / 戳身体 / 拍云朵、连点生气、拖动摇晃、甩晕、落地、贴边吸附与探头、10 分钟睡着 |
| 自动行为 | 6–9 秒小动作、20–25 秒正式动作、视线跟随、靠近打招呼、深夜哈欠 |
| 控制面板 | 5 页：互动 / 换装 / 小助手 / 对话 / 设置；独立窗口，关闭只隐藏 |
| 气泡 | say / time / weather / chat 四种，奶油纸风格，跟随头部与摇摆 |
| 换装 | 5 套日常 + 6 套节日，共 11 套；7 个配饰槽、16 件配饰；按时间/节日自动换装 |
| 小助手 | 整点报时、免打扰、摸头顺口说、深夜劝睡、Open-Meteo 天气、喝水/休息提醒 |
| AI 对话 | OpenAI 兼容流式接口；DeepSeek / 通义 / Kimi / 智谱 / Ollama / 自定义；情绪标签驱动动作 |
| 聊天界面（v0.6.0） | 漫画对白：脚边细输入栏 + 头顶气泡回复（她始终完整可见）；侧边聊天窗：独立窗口贴在她旁边跟着走，完整记录、思考折叠、动作标签、确认卡 |
| 深度思考 / 帮你做事（v0.6.0） | 思考模型 + 思考过程展示；12 个安全工具（时间、天气、提醒、便签、网页、搜索、开程序、剪贴板、看屏幕），动电脑前问「好 / 不要」 |
| 看屏幕（v0.6.0，默认关） | 截你正在用的窗口所在显示器 → 视觉模型描述 → 聊天模型；按需 + 可选偶尔主动看；首次同意、隐私双重拦截 |
| 自动更新（v0.6.0） | tauri-plugin-updater + Gitee（地址仍是占位）；签名校验；面板「设置 → 更新」 |
| 记忆 v2 | 档案 + 事实 / 事件 / 约定；每 3 轮后台抽取、去重、上限、90 天事件过期、旧摘要迁移 |
| 桌面感知 | 前台进程 / 标题 / 全屏；会议/游戏/隐私/全屏安静；标题默认不进模型；全屏可自动隐藏 |
| 聊天记录 | 按天分组、搜索、删单条、导出/导入；面板内也能发消息 |
| 托盘/自启 | 显示隐藏、面板、聊天、置顶、开机自启、75/100/125%、退出 |
| 音效 | Web Audio 实时合成，无音频文件；音色层 + 合成人声 |

### v0.6.0 已实际验证（真机，隔离 WebView2 数据目录 + 本地假 LLM / 假视觉 / 假更新服务器）

- 聊天界面：输入栏发消息与气泡回复、远离时穿透、侧边窗贴边位置（150% DPI）与跟随、侧边窗发消息 / 收起到脚边 / 关闭、她被隐藏时聊天窗一起收、场景状态行。
- 思考 / 工具：分片 tool_calls 拼接、同一步两个工具、确认拒绝（输入栏 / 侧边窗两处）、确认超时、确认途中停止、思考过程流式 + 折叠、`__NO_TOOLS__` 自动降级、提醒到点、Rust 白名单拒绝 cmd.exe / 路径穿越 / 开始菜单外 .lnk / file: / javascript:。
- 看屏幕：首次同意、眼睛按钮、工具路径、1280×720 JPEG ≈150KB、跳过所有小嬅进程窗口、前端隐私拦截、Rust 黑名单拦截、主动看一眼并留标签；用户反馈的“点眼睛冒出空白面板”已通过去掉 SetWindowDisplayAffinity 解决（用户确认）。
- 更新：旧版本不提示、新版本可下载并通过签名校验（dry run）、签名错误拒绝、签名版本号与清单不符拒绝、她的提醒气泡、面板更新区。

### v0.5.0 时验证过的

- Web 预览：对话卡渲染、4 条消息、情绪/时间、空态、标题栏拖动、边界夹取、关闭复位、重开回脚边。
- 真机 Tauri：`PET_SETTINGS().sv = 6`、场景默认值、`XH.scene.now()` 真读前台、标题开关差异、对话流式、停止/重发。
- 桌面感知：写代码/隐私/全屏/开会四类文案；`quiet()` 为 true；无边框全屏窗口下 `full=true`，`hideFull` 时 `isVisible:false`，退出后恢复。
- 假 LLM：三连发触发记忆抽取，facts/events 落库；请求体确认 `sceneTitle` 关闭时不含标题。
- 构建/安装：0.5.0 构建成功，免安装版与安装版 ProductVersion 均为 0.5.0。
- 静态检查：`node --check` 全部通过；`cargo check` 通过，仅 `cursor_inside` dead_code 警告。

### 尚未严格验证

- v0.6.0：真实服务商（DeepSeek / 通义 / 智谱 / Kimi）的 reasoning、tool_calls、图片消息细节；确认后真的打开程序 / 网页 / 写剪贴板（测试只走拒绝路径以免动用户电脑）；真实安装更新（只做了下载 + 校验）；Gitee raw / 发行版附件对未登录下载是否有限制（仓库还没建）；真人键盘焦点与手动拖动时聊天窗跟随的流畅度（用户日常使用中未反馈问题）；多显示器下截图与聊天窗停靠。

- 实际视频播放器 / 会议软件 / 独占全屏游戏下的全屏检测（本轮用的是无边框最大化测试窗）。
- 多显示器、125%/150% DPI 下的贴边和点击穿透。
- 托盘菜单里的“开机自启”勾选（面板/注册表路径已验证，托盘勾选建议补测）。
- 长时间运行的内存/显存泄漏、显卡驱动重置、WebView2 崩溃恢复。
- NSIS 卸载时清理开机自启注册表（目前没有卸载钩子）。

---

## 2. 产品与视觉契约

- 角色「小嬅」：金棕发、黑色蝴蝶结、白衬衫 + 格子裙、白毛呢斗篷、桦树元素、小云朵；性格活泼、略害羞、偶尔小傲娇。
- 视觉基准色：奶油纸 `#FBF6EA`、暖棕描边 `#8B6A4E`、正文 `#4A3A32`、腮红/强调暖色；圆角、虚线内描边、轻阴影，不要改成高对比扁平 UI。
- 桌宠窗口固定逻辑尺寸 **300×610**；顶部约 **70px（11.475%）** 是气泡区，下面 **540px（88.525%）** 是角色画布。改比例必须同步多处，见 §6.2。
- 角色必须在透明背景上工作；点击空白区域应穿透到下方应用。v0.6.0 起聊天输入栏开着时也只拦截她身上和输入栏区域；侧边聊天窗、面板是独立窗口。
- 聊天时她必须始终完整可见（用户明确抱怨过旧对话卡挡住她）；不要再把聊天 UI 做成盖住角色的卡片。
- 默认行为原则：平时安静、不抢焦点、不挡操作；只有用户主动互动、主动聊天或开启主动搭话时才说话。
- 视觉 QA 重点：兜帽边缘、蝴蝶结、桦枝叶子、斗篷下摆不要出现透明小洞；拖动/摇摆时不露底；100% 和 125% 缩放下都要看。
- 角色设计 © 樺樺嗝。对外发布、二次分发或商用前先取得授权，README / 发布文案保留署名。

---

## 3. 路径、环境与交付物

### 3.1 关键路径

| 用途 | 路径 |
|---|---|
| 源码根 | `D:\小嬅桌宠源码` |
| 桌宠工程 | `D:\小嬅桌宠源码\desktop-pet` |
| 渲染/素材源 | `D:\小嬅桌宠源码\assets` |
| PSD / 图层 | `D:\小嬅桌宠源码\psd` |
| 工具脚本 | `D:\小嬅桌宠源码\tools` |
| 文档 | `D:\小嬅桌宠源码\docs` |
| 交付目录（免安装 + 安装包） | `D:\小嬅桌宠` |
| 安装版程序 | `%LOCALAPPDATA%\小嬅桌宠\xiaohua-pet.exe` |
| 安装版卸载器 | `%LOCALAPPDATA%\小嬅桌宠\uninstall.exe` |
| 版本备份 | `D:\小嬅桌宠源码\.backups` |
| 应用数据（密钥/窗口状态） | `%APPDATA%\com.xiaohua.desktoppet` |
| WebView2 缓存 | `%LOCALAPPDATA%\com.xiaohua.desktoppet\EBWebView` |
| 更新签名私钥 / 公钥 | `%USERPROFILE%\.tauri\xiaohua-updater.key` / `.key.pub`（不在源码里；空密码；丢了就无法给已装版本推更新，务必备份） |
| 自动更新发布文件 | `D:\小嬅桌宠\发布\v<版本>\`（`build.ps1 -Release` 生成） |

**有 git 仓库（v0.6.0 起）**：`master` 是 v0.5.0 基线，`v0.6/chat-ui` 是 v0.6 全部工作；`.gitignore` 排除 `target/ web/assets/ .backups/ dist/ *.zip psd/*（保留说明和 layers.json）.claude/`。Git 装在 `C:\Program Files\Git\cmd`（当前会话 PATH 里可能没有，需要手动加）。大改前仍建议另存源码 zip 到 `.backups`。

### 3.2 本机工具链（已验证）

| 工具 | 版本/位置 |
|---|---|
| Windows | Windows 10/11 x64 |
| Rust | `rustc 1.99.1` / `cargo 1.99.1` |
| tauri-cli | `cargo-tauri` 2.x，位于 `C:\Users\ROG\.cargo\bin` |
| Node.js | `v24.20.0`（只给测试/素材工具用，不是运行依赖） |
| WebView2 | 系统自带/安装包引导安装 |
| 浏览器（测试） | Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |

`tools/` 下的脚本只用 Node 内置模块，没有 `package.json`、没有 npm 依赖。

### 3.3 当前交付物快照

最终 0.6.0 构建（2026-10-19，分支 `v0.6/chat-ui`；没有用 `-Release`，因为更新地址还是占位）：

| 文件 | 大小 | SHA256 |
|---|---:|---|
| `D:\小嬅桌宠\小嬅桌宠.exe` | 26,801,152 | `8DE07761DA38B4DDB1049DC22ED16A70AD09DDF9AFFAC0642DB5F65AC2D6DCB9` |
| `D:\小嬅桌宠\安装包\小嬅桌宠_0.6.0_x64-setup.exe` | 23,618,873 | `7CAE96D07436E5D995ED46CBAACB183E8EBF16B98F930FA3CF76FE85385170A1` |
| `%LOCALAPPDATA%\小嬅桌宠\xiaohua-pet.exe` | — | 2026-10-19 起与 `D:\小嬅桌宠\小嬅桌宠.exe` 保持同一个文件（见 §12.2） |

`D:\小嬅桌宠\安装包\` 里还留着 0.5.0 的安装包（旧 build.ps1 会把 bundle 目录里所有旧包都复制过去，v0.6.0 起只复制当前版本）。

重建会改变哈希；以构建产物为准。  
`D:\小嬅桌宠源码\dist\`、`打包说明.txt` 和 `小嬅桌宠_源码_v0.2.1_20261018.zip` 是 v0.2.1 旧物，**不要发布、不要当版本依据**。

---

## 4. 五分钟开工

### 4.1 构建

```powershell
cd D:\小嬅桌宠源码\desktop-pet
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipInstall
```

- `-SkipInstall` 跳过 VS/Rust/tauri-cli 检查；环境已装好时用这个，构建约 1 分钟。
- 不加 `-SkipInstall` 会在缺环境时自动安装，首次约 3–5GB、20–30 分钟。
- `-Dev`：`cargo tauri dev`，改网页刷新即可。
- `-OutDir D:\某目录`：改交付目录，默认 `D:\小嬅桌宠`。
- 构建会先同步 `../assets` 的 9 个 JS 和 `assets/wardrobe/` 到 `web/assets/`，再 `cargo tauri build`，最后复制 exe、当前版本的安装包、`使用说明.txt` 到交付目录，并打开资源管理器（`-NoOpen` 不打开）。
- **v0.6.0 起必须有更新签名私钥**（`createUpdaterArtifacts: true`）：`build.ps1` 从 `-Key`（默认 `%USERPROFILE%\.tauri\xiaohua-updater.key`）读进 `TAURI_SIGNING_PRIVATE_KEY`；没有就报错并给出生成命令。换了密钥必须同步改 `tauri.conf.json → plugins.updater.pubkey`。
- `-Release [-Notes "…"] [-UpdateBase "https://gitee.com/<用户>/<仓库>/releases/download"]`：额外在 `OutDir\发布\v版本\` 生成英文名安装包 `xiaohua-pet_<版本>_x64-setup.exe`、`latest.json`、`发布说明.txt`。
- 测试构建请用 `-OutDir "$env:TEMP\xh-test-build" -NoOpen`，不要覆盖用户的 `D:\小嬅桌宠`。
- 首次编译 5–10 分钟；之后 1–2 分钟。C 盘和 D 盘都建议留 5GB 以上。crates.io 走 rsproxy 镜像，偶尔很慢：`$env:CARGO_HTTP_TIMEOUT='120'; $env:CARGO_NET_RETRY='10'; cargo fetch` 先拉依赖。

### 4.2 安装版更新（本地测试）

`build.ps1` 只更新 `D:\小嬅桌宠` 的免安装版和安装包，**不会自动覆盖 `%LOCALAPPDATA%` 的安装版**。测试安装版要手动替换或重跑 setup：

```powershell
Get-Process -Name xiaohua-pet -ErrorAction SilentlyContinue | Stop-Process -Force
Copy-Item "D:\小嬅桌宠\小嬅桌宠.exe" "$env:LOCALAPPDATA\小嬅桌宠\xiaohua-pet.exe" -Force
Start-Process "$env:LOCALAPPDATA\小嬅桌宠\xiaohua-pet.exe"
```

确认版本：

```powershell
(Get-Item "$env:LOCALAPPDATA\小嬅桌宠\xiaohua-pet.exe").VersionInfo.ProductVersion
```

> 便携版和安装版使用同一个 Tauri identifier，通常共用 WebView2 数据（设置、记忆、聊天记录）。切换测试前先导出/备份数据。

### 4.3 浏览器预览（无 Tauri 能力）

从源码根起一个静态服务器，打开桌宠外壳，**不要只 serve `desktop-pet/web`**，因为 `assets/` 路径是相对项目根的：

```powershell
cd D:\小嬅桌宠源码
node C:\Users\ROG\AppData\Local\Temp\opencode\serve.js
# 或任意静态服务器，端口 8765
```

访问：

- `http://127.0.0.1:8765/desktop-pet/web/pet.html?debug`
- `http://127.0.0.1:8765/index.html`（完整角色预览）

浏览器模式没有 Rust：点击穿透、场景采集、密钥安全、托盘、窗口拖动都不可用；聊天会走 `fetch` 回退，密钥从 `sessionStorage['xh-key-<provider>']` 取。`?debug` 会显示棋盘格、光标圆点（绿=可点、红=穿透、蓝=拖动）和 alpha 值。

---

## 5. 架构地图

### 5.1 三层

```text
Rust 宿主（src-tauri/src/main.rs）
  透明窗口 / 托盘 / 全局光标 30ms / 点击穿透开关 / 系统拖动 / 松手检测 / 贴边
  agent.rs 打开网址/程序、剪贴板 ｜ screen.rs 截图 ｜ update.rs 自动更新 ｜ chat.rs 对话 SSE ｜ scene.rs 前台窗口
        │  pet://cursor, pet://drag-move, pet://drag-end, pet://cmd, pet://chat, pet://scene, pet://update
        ▼
网页外壳（web/pet.html + pet.js）
  接收光标/场景/聊天事件；判定点击穿透；双击开漫画输入栏 / 侧边聊天窗；确认弹问；右键开面板；主动搭话；检查更新
        │  XH.pet.*                     │  pet://chatui ⇄ pet://cmd
        ▼                               ▼
渲染与业务（web/assets/*.js + chat.js / tools.js / vision.js / memory.js / scene.js）     侧边聊天窗（web/chatwin.html，只是视图）
  WebGL 分层网格 / 动作 / 气泡 / 换装 / 小助手 / 对话 + 工具循环 / 看屏幕 / 记忆 / 场景归类
```

控制面板是**另一个 WebView 窗口**（`label=panel`，加载 `panel.html`），通过 `localStorage['xh-pet']` 共享设置，通过 `pet://cmd` 通知主窗口。侧边聊天窗同理（`label=chat`），对话逻辑始终只在桌宠窗口里跑。

### 5.2 启动顺序

`pet.html` 先设 `window.XH_PET = true`，再依次加载：

1. `xiaohua_layers.js`（图集/图层）
2. `app-core.js`（常量、参数、物理、网格）
3. `app-render.js`（WebGL、材质、绘制）
4. `xiaohua_wardrobe.js` / `app-dress.js`（换装）
5. `app-sfx.js` / `app-bubble.js` / `app-assist.js`
6. `app.js`（主循环、动作、`XH.pet` API）
7. `memory.js` / `tools.js` / `chat.js` / `vision.js` / `scene.js`
8. `pet.js`（宿主桥接、漫画输入栏、侧边窗开关与同步、确认、设置、主动搭话、检查更新）

`app.js` 在 `XH_PET` 模式下把面板元素替换成空壳，面板相关代码自动变空操作。

### 5.3 窗口与点击穿透

- `tauri.conf.json`：`width:300, height:610, transparent:true, decorations:false, shadow:false, alwaysOnTop:true, skipTaskbar:true, focus:false`。
- 主窗口 `BASE_W=300, BASE_H=610`（`main.rs`）。启动时如果 window-state 记录的是旧的 300×540 比例，会自动补高并上移，角色屏幕位置不变。
- 每 30ms Rust 读全局光标，发 `pet://cursor`（物理像素，网页除以 `devicePixelRatio`）。
- 网页每 50ms 用 `gl.readPixels` 读光标处 13×13 像素的 alpha：
  - 进入可点阈值 `alpha > 0.5`，退出 `alpha < 0.35`（回差防抖），外扩 6px。
  - 可点 → `set_passthrough(false)`；透明 → `set_passthrough(true)`。
- 窗口穿透时网页收不到鼠标事件，所以鼠标位置/悬停/拖动都必须依赖 Rust 推送。
- v0.6.0：漫画输入栏开着时**不再整窗拦截**：`keep = 她身上 || inBox(输入栏)`，其余照样穿透；输入栏开着时快捷按钮不显示。键盘输入不受穿透影响（`pet_focus` 给焦点）。
- 输入栏在窗口失焦且为空时收起；回复途中失焦，则说完再收（出错时保留，方便重发）。
- 悬停快捷按钮（聊天/睡觉/面板）在鼠标靠近角色时保持可点，有 900ms 宽限，避免瞬间穿透点不到。
- 75% 大小时窗口只有 225px 宽：`@media (max-width:260px)` 缩小输入栏图标并藏起 ×。

### 5.4 拖动、松手、贴边

- 网页按住角色移动 >6px → `start_drag`；Rust 调 `window.start_dragging()` 进入系统拖动。
- Rust 每 30ms 发 `[dx,dy]`（含 0）驱动网页摇摆；松手检测必须连续 3 次读到左键松开（约 90ms），避免系统拖动模态循环误读把一次拖动切成几段。
- `start_drag` 在左键已松开时拒绝，避免松手后补发的旧事件再触发拖动。
- 松手：限制在工作区；距左右边缘 <40px 吸附，只露 60%；鼠标进入滑出，离开 1.5 秒缩回。
- 侧边聊天窗不可单独拖动：`spawn_poll` 每 30ms 调 `dock_chat`，按她的窗口位置把聊天窗贴在左 / 右侧（`CHAT_SIDE` 带 60px 回差，一侧放不下换边，底边对齐她脚边，`CHAT_OVERLAP` 压进她窗口透明边 28px）；她被隐藏时 `hide_chat` 一起收并通知网页。

### 5.5 面板、托盘、自启

- 面板 380×640，最小 340×480，可缩放，不可最大化，`always_on_top`，有关闭按钮；`CloseRequested` 被拦截为隐藏，不销毁。
- 侧边聊天窗（v0.6.0）：`chatwin_open`（async）建 / 显示 `label=chat` 窗口，340×520、最小 280×360、无边框可缩放、有阴影、置顶、不进任务栏；`CloseRequested` / `chatwin_hide` → 隐藏并发 `pet://cmd {type:'chatwin', open:false}` 给主窗口。尺寸由 window-state 记住。
- **面板和聊天窗都必须在 async 命令里创建**：Windows 上同步命令/事件回调里新建 WebView 会死锁（白屏）。托盘里创建面板放到新线程。
- 所有窗口的 `additionalBrowserArgs` 必须**完全一致**，否则无法共用 WebView2 环境，新窗口打不开。两处：
  - `tauri.conf.json` 主窗口
  - `main.rs` 的 `BROWSER_ARGS` 常量（面板、聊天窗都用它）
- 托盘：显示/隐藏、控制面板、和她聊天、置顶、开机自启、大小 75/100/125%、退出。
- 开机自启写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的「小嬅桌宠」= `"exe" --autostart`，不需要管理员，默认关闭；**登记的 exe 不存在了才**自动改成当前路径（v0.6.0 前是“路径不同就改”，导致从临时目录跑一份测试版就把用户的自启抢走——测试时注意）；带 `--autostart` 启动时跳过开场招呼。
- 窗口位置/大小由 `tauri-plugin-window-state` 保存到 `%APPDATA%\com.xiaohua.desktoppet\.window-state.json`。

### 5.6 角色渲染与换装

- 角色原图坐标 **1200×2133**，渲染网格 48×86，WebGL 1，无框架。
- `assets/xiaohua_layers.js` 是 3 页 2048² 图集 + 图层/变形器数据，由 PSD 工具生成，约 6MB；**不要手改**。
- `app-render.js` 给每层一个网格和 RIG（head/fall/hood/hem/leg/hand/braid 等），眼睛/嘴通过图层显隐、缩放、裁剪实现。
- `assets/app-dress.js` + `xiaohua_wardrobe.js`：11 套衣服（5 日常 + 6 节日）、16 件配饰、7 个槽（head/hair/neck/bag/charm/chest/face）。套装是同位置换层，配饰按 `before:` 锚点插入；图集按套装懒加载，换下释放。
- 自动换装优先级：节日 > 周末夜 > 日常；手动选衣/配饰会关掉自动。节日日期含 2026–2030 农历表（`app-dress.js` 的 `LUNAR`）。
- 各套衣服/配饰的图集在 `assets/wardrobe/`；`build.ps1` 会整体复制到 `web/assets/wardrobe/`。

### 5.7 AI 对话

- 前端：`web/chat.js`。Provider 表、系统提示词、情绪标签、流式解析、记忆注入、抽取、忘掉指令、30 秒超时、stop/retry。
- 后端：`src-tauri/src/chat.rs`。`ureq` + `rustls`，后台线程读 SSE；每段文字 `pet://chat {id, kind: delta|done|error, text}`；`chat_cancel` 通过全局 `CUR` 序号让旧线程退出。
- 密钥：Rust 存在 `%APPDATA%\com.xiaohua.desktoppet\chat.json`，**明文 JSON**；网页只能拿“已设置 + 末 4 位”。本地地址（127.0.0.1/localhost）允许不填密钥（Ollama）。
- 请求：`POST {base}/chat/completions`，`stream: !test`，`max_tokens` 160/400（测试 16），`temperature 0.8`。兼容 OpenAI 流式格式。
- 系统提示词包含：人设/风格、称呼、记忆摘要、场景提示、看不到屏幕内容的声明、长度限制、情绪标签要求、当前时间。上下文保留最近 10 轮（20 条消息）。
- 错误映射：401/403 密钥、402 余额、404 模型名、429 频率、5xx 服务端、断网/超时。出错会撤回最后一条 user 记录并显示“重发”。
- 面板发消息通过 `pet://cmd {type:'say', text}`，最终仍走 `pet.js` 的 `chatSend`。
- **v0.6.0 变化**：
  - Rust `ChatReq.messages` 改为原样转发的 JSON 值（工具消息带 `tool_calls` / `tool_call_id`，看屏幕带图片数组）；可选 `tools`、`extra`（逐键并入请求体，用于思考开关）。
  - 流里 `delta.reasoning_content` / `delta.reasoning` → `kind:'think'`；分片 `delta.tool_calls` 按 index 拼好，流结束时发一次 `kind:'tool'`（JSON 数组 `[{id,name,arguments}]`），再发 `done`。
  - 400/422 且响应提到 tool/function → 错误文本 `__NO_TOOLS__`；提到 thinking/reasoning → `__NO_THINK__`；网页记住这个模型不支持，去掉参数自动重来。
  - 回复永远走头顶 chat 气泡（`hooks.card` 不再使用）；`hooks` 把进度转给漫画输入栏和侧边窗：`user / start / think / tool / confirm / askCancel / mood / delta / end`。
  - `XH.chat.ask(c, messages, maxTokens)` → Promise<string>，非流式展示的整段请求（看屏幕用）。
  - Rust 全局只有一个 `CUR`：网页端 `request()` 记 `curId`，只有自己还是当前请求时超时 / 取消才发 `chat_cancel`（修了“旧请求超时误杀新请求”）。
  - 系统提示词：开了工具时加工具说明；开了看屏幕时加 `look_screen` 用法；“看不到屏幕”的声明随之调整。

### 5.7.1 深度思考 + 帮你做事（v0.6.0，`web/tools.js`、`src-tauri/src/agent.rs`）

- 思考：`S.think`（输入栏灯泡 / 侧边窗灯泡 / 面板，三处同步，存 `xh-pet`）；`chat.js` 的 `THINK` 表给各家默认思考模型 / 参数，`thinkModel` 覆盖；`max_tokens` 4096；思考模式不带工具；`thinkSplit()` 处理正文开头的 `<think>…</think>`。思考过程不进记录。
- 工具循环：`send()` 里 `turn()` → 有 `tool` 就 `runTools()`（逐个执行、回填 `role:'tool'`）→ 再 `turn()`，最多 `MAX_STEPS = 4`；带工具时 `max_tokens ≥ 600`；工具之后的文字另起一行。记录里助手消息带 `tools: [{n: 显示文字, ok}]`，侧边窗按它画 ✓ / ✕ 标签。
- 工具（`tools.js` 的 `DEFS`）：`get_time` `get_weather` `set_reminder` `list_reminders` `cancel_reminder` `take_note` `list_notes` `open_url` `web_search` `open_app` `read_clipboard` `write_clipboard`，以及 `visionOn` 时才给的 `look_screen`。
- 确认：`open_url / web_search / open_app / read_clipboard / write_clipboard` 执行前 `ctx.confirm(text)`；`pet.js` 的 `confirmAsk` 同时在输入栏（`#cbAsk`）和侧边窗（`.ask` 卡）显示，60 秒超时算不要；停止回复会取消所有未答确认。
- Rust 白名单：`agent_find_app`（别名表：记事本 / 计算器 / 画图 / 资源管理器 / 设置 / 任务管理器 / 截图；再模糊匹配开始菜单 .lnk/.url，跳过卸载 / 帮助类）→ `agent_launch` 只接受别名目标或 canonicalize 后在开始菜单目录里的 .lnk/.url；`agent_open_url` 只接受 http/https 且无空白 / 引号；剪贴板只读写纯文本（读最多 2 万字、写最多 5000 字）。
- 提醒：`xh-reminders`（最多 50），`tools.start(P)` 每 10 秒检查；到点走 chat 气泡（不会被待机台词顶掉），写进聊天记录；她正在回话时最多等 1 分钟；错过 12 小时内的补说。便签 `xh-notes`（最多 100）。面板「对话 → 提醒与便签」可删。

### 5.7.2 看屏幕（v0.6.0，`src-tauri/src/screen.rs`、`web/vision.js`，默认关）

- `screen_capture({block})`（async，内部 spawn_blocking）：从前台窗口沿 Z 序找第一个可见、未 cloak、非工具窗、有标题、**不是小嬅进程**（按 pid 和 exe 名 `xiaohua-pet.exe` / `小嬅桌宠.exe` 判断）的窗口 → 隐私进程 / 隐私标题 / 黑名单返回 `__PRIVATE__` → GDI BitBlt 该显示器 → 最长边 1280 → JPEG q70 → `data:image/jpeg;base64`。只在内存。
- **不要再用 `SetWindowDisplayAffinity` 排除自己的窗口**：用户那边会冒出空白控制面板（本机复现不了，但去掉后用户确认好了）。现在小嬅的窗口可能进画面，由视觉提示词让模型忽略。
- `vision.js`：`canLook(S)`（`visionOn`、场景是否隐私、视觉服务是否配置）→ 首次 `confirm` 征得同意（`xh-vision-ok`）→ 截图 → `XH.chat.ask(vcfg(S), [{role:'user', content:[text, image_url]}], 400)`；视觉服务独立配置（`visionProvider / visionModel / visionBase`），密钥按服务商共用 `chat.json`。默认智谱 `glm-4v-flash`。
- 三种触发：`look_screen` 工具；眼睛按钮 `chatSend(text, {look:true})`（先看，把描述附在这句用户消息后面再发，记录里只存原话，本轮不再提供 look_screen）；`visionAuto` 时 `proactive()` 一半概率先看（30 分钟最多一次，且必须已同意过），记录里标「看了一眼屏幕」。

### 5.7.3 自动更新（v0.6.0，`src-tauri/src/update.rs`）

- `tauri-plugin-updater` 2.14；公钥在 `tauri.conf.json → plugins.updater.pubkey`；`installMode: passive`；`dangerousInsecureTransportProtocol: true`（插件只能在配置里开），**真正的把关在 `update.rs::urls()`**：正式地址只认 https，http 只允许 `XH_UPDATE_URL` 指向 127.0.0.1 / localhost。
- `UPDATE_URLS` 现在是占位 `https://gitee.com/your-name/xiaohua-pet-release/raw/master/latest.json`，检查时直接返回“还没配置更新地址”。用户建好 Gitee 仓库后改这一行（以及 `build.ps1 -UpdateBase`）。
- `update_check` → `{available, current, version, notes, date}`，并把 `Update` 存进 `Pending`；`update_install {dry}`：dry 只下载 + 校验签名，否则保存窗口状态后 `download_and_install`（Windows 上会退出并跑安装包，装完重开）。进度事件 `pet://update {kind: progress|verified|installing}`。
- 插件会校验**签名里的版本号**和清单 `version` 一致（防篡改）；测试用旧包冒充新版本要 `cargo tauri signer sign --app-version <版本>` 重新签。
- 网页：`pet.js` 启动 60 秒后 + 每 24 小时 `checkUpdate()`（`autoUpdate`，默认开），每个版本只提醒一次（`xh-update-seen`）；面板「设置 → 更新」检查 / 立即更新 / 进度条 / 更新说明。

### 5.8 记忆 v2

- 文件：`web/memory.js`，key `xh-memory-v2`；旧 `xh-memory` 一段式摘要在首次读取时迁移成 facts（最多 12 条），然后删除旧 key。
- 结构：

```json
{
  "v": 2,
  "profile": {
    "name": "", "birthday": "", "city": "", "job": "",
    "likes": [], "dislikes": [], "taboos": []
  },
  "facts":    [{ "id": "...", "text": "...", "tags": [], "w": 1, "created": 0, "lastUsed": 0 }],
  "events":   [{ "id": "...", "text": "...", "date": "YYYY-MM-DD", "w": 1, "created": 0, "lastUsed": 0 }],
  "promises": [{ "id": "...", "text": "...", "done": false, "w": 1, "created": 0, "lastUsed": 0 }],
  "forgotten": ["..."],
  "updatedAt": 0
}
```

- 上限：facts 50、events 30、promises 20；events 90 天过期；`forgotten` 最多 30 条，用于阻止已忘内容再次被抽回。
- 去重：完全相同，或一方包含另一方且较短串 ≥6 字；命中则 `w++`、更新 `lastUsed`。
- 抽取：用户主动对话每完成 3 轮，后台发一次独立请求（system 里含「整理长期记忆」），要求严格 JSON；`max_tokens 700`；失败静默，下次再试。
- 注入：档案全量 + 按当前话题相关度 top 8 facts + 近 3 条 events + 未完成 promises；`digest()` 总长截到 1100 字。
- 忘掉：本机正则识别「忘掉…」「不要记得…」「把关于…的记忆删掉」；单独一句「忘掉」现在会反问要忘哪件事，不会清空全部。命中后写入 `forgotten` 并删条目/档案字段。
- 面板：档案表单、facts/events/promises 分类、编辑、删除、置顶 facts、完成 promises、导出/导入、清空全部。
- 敏感信息：提示词要求不记录密码/账号/身份证/银行卡/详细住址/财务/疾病诊断，但**不是硬过滤**；localStorage 明文，导出 JSON 也会带出。不要把它当隐私保险箱。

### 5.9 桌面场景感知（方案 B）

- Rust `scene.rs` 每 2 秒读前台窗口：`GetForegroundWindow` → 标题（最多 200 字）→ PID → 进程路径/文件名 → 窗口矩形 vs 所在显示器矩形判断全屏。
- `scene_watch(on)` 用 `WATCH` + `GEN` 管理线程；重复开启会换代停旧线程。当前实现是**每 2 秒无条件 emit**，不是只在变化时 emit。
- 前端 `scene.js` 归类：`coding / video / game / meeting / office / browser / private / other / self`。
- `private` 包含密码管理器、微信、QQ、Telegram 等；`meeting` 包含 Zoom/Teams/飞书/钉钉等；`game` 包含 Steam/原神/英雄联盟等；`coding` 包含 VS Code/Cursor/IDE/终端等。
- 浏览器按标题细分：YouTube/B站/Netflix → video；腾讯会议/Zoom → meeting；原神/Steam → game。
- `quiet()`：会议 / 游戏 / 隐私 / 命中 `sceneBlock` / 全屏且 `quietFull` 时 true；只阻止**主动搭话**，不阻止用户手动发消息。
- `hint()`：给模型一句“用户现在似乎在写代码”；`sceneTitle` 开启时才附标题，且 `safeTitle()` 去掉 URL、邮箱、6 位以上数字，截 48 字；关闭时标题绝不进入请求。
- `hideFull`：全屏且聊天（输入栏 / 侧边窗）没开时调 `pet_show(false)` 隐藏，退出全屏恢复；`autoHidden` 防止和用户手动隐藏互相打架。
- `scene.rs` 的 `proc_name(pid)` / `window_title(hwnd)` 已抽成 `pub(crate)`，`screen.rs` 复用。
- 面板「对话 → 桌面感知」：总开关、标题开关、全屏安静、全屏自动隐藏、进程黑名单（逗号/空格分隔的进程名片段）。
- 面板自己获得焦点时，`scene_now` 可能读到面板自身（`self`/“正在和小嬅互动”）；测试时不要把这个当成 bug。

### 5.10 小助手、气泡、音效

- `app-assist.js`：每 15 秒检查；整点报时（免打扰时段）、天气（Open-Meteo，30 分钟缓存，8 秒超时，失败静默）、摸头顺口说、喝水/休息提醒、深夜劝睡；台词排队最多 20 秒。
- `app-bubble.js`：4 种气泡，锚点用 `R.headScreen()`，随头部/摇摆轻转；chat 类型支持打字机和思考点。
- `app-sfx.js`：Web Audio 实时合成；两层声音；深夜 23–6 点减半；同一音效 0.4 秒内不重复；`--autoplay-policy=no-user-gesture-required` 让不点击也能出声（两处 browser args 必须一致）。

---

## 6. 数据、设置与迁移

### 6.1 localStorage / 文件

| 内容 | 位置 | 说明 |
|---|---|---|
| 桌宠设置 | localStorage `xh-pet` | 核心/小助手/场景/对话/看屏幕/更新设置合并；`sv` 当前 7 |
| 聊天记录 | localStorage `xh-chat-log` | 最近 200 条，每条 `{role, content, mood?, t, tools?}`；`tools` = `[{n, ok}]` 她这轮做过的事（v0.6.0） |
| 提醒 | localStorage `xh-reminders` | `[{id, at, text, created}]`，最多 50（v0.6.0） |
| 便签 | localStorage `xh-notes` | `[{id, t, text}]`，最多 100（v0.6.0） |
| 看屏幕已同意 | localStorage `xh-vision-ok` | `'1'`；面板「重新征求同意」会删掉（v0.6.0） |
| 已提醒过的新版本 | localStorage `xh-update-seen` | 版本号字符串（v0.6.0） |
| 记忆 v2 | localStorage `xh-memory-v2` | 见 §5.8 |
| 旧记忆 | localStorage `xh-memory` | 只用于迁移，迁移后删除 |
| 新手引导已看 | localStorage `xh-onboarded` | `'1'` 后不再播开场引导 |
| 面板上次标签 | sessionStorage `xh-tab` | 只影响体验 |
| 浏览器预览密钥 | sessionStorage `xh-key-<provider>` | 仅非 Tauri 回退；不持久 |
| API 密钥 | `%APPDATA%\com.xiaohua.desktoppet\chat.json` | 明文 JSON，provider → key |
| 窗口位置/大小 | `%APPDATA%\com.xiaohua.desktoppet\.window-state.json` | window-state 插件 |
| WebView2 缓存 | `%LOCALAPPDATA%\com.xiaohua.desktoppet\EBWebView` | 怪问题可整体删除重试 |
| 开机自启 | `HKCU\...\Run\小嬅桌宠` | 默认不存在 |
| 导出文件 | 用户选择的位置 | 聊天导出含 log + memory；记忆导出含 memory |

> `xh-chat-ping` 出现在面板旧代码的 storage 监听里，但当前没有写入点，属于遗留兼容，不要依赖它。

### 6.2 设置默认值（`xh-pet` 的有效默认）

```json
{
  "sv": 7,
  "idleFreq": 2,
  "bubbles": true,
  "follow": true,
  "props": true,
  "react": true,
  "scale": 100,
  "top": true,
  "sfx": true,
  "vol": 25,
  "voice": true,
  "swing": 2,
  "outfit": "classic",
  "acc": {},
  "autoDress": true,
  "festival": true,

  "chime": true,
  "quietFrom": 23,
  "quietTo": 7,
  "weather": false,
  "city": null,
  "askTap": true,
  "remind": false,
  "remindMin": 45,
  "bedtime": true,

  "sceneOn": true,
  "sceneTitle": false,
  "quietFull": true,
  "hideFull": false,
  "sceneBlock": "",

  "chatOn": false,
  "provider": "deepseek",
  "base": "",
  "model": "",
  "persona": "self",
  "len": "s",
  "nickname": "",
  "proactive": 2,

  "chatMode": "comic",
  "think": false,
  "thinkModel": "",
  "agentOn": true,

  "visionOn": false,
  "visionProvider": "zhipu",
  "visionModel": "",
  "visionBase": "",
  "visionAuto": false,

  "autoUpdate": true
}
```

- `base`/`model` 为空时会按 provider 默认值解析（DeepSeek `https://api.deepseek.com/v1` / `deepseek-chat`；Ollama `http://127.0.0.1:11434/v1` / `qwen2.5:7b`）。
- `proactive`：0 关，1 低（45–90 分钟），2 中（20–40 分钟），3 高（8–20 分钟），再乘场景系数（coding/office/video 0.85、browser 0.95、other 1.15）。
- `scale` 与托盘大小：75/100/125；改窗口尺寸会走 `set_scale`，不要只改 CSS。
- 默认值来源：`DEF_CHAT`（`chat.js`，含 chatMode/think/thinkModel/agentOn）、`XH.DEF_VISION`（`vision.js`）、`autoUpdate` 直接写在 `pet.js` / `panel.html` 的 `DEF` 里。
- 设置迁移在 `pet.js` 和 `panel.html` 各有一份 `load()`；当前最后一块是 `sv < 7`（补 `chatMode`）。新字段只要有默认值，`{...DEF, ...s}` 会自动补上；**要改已有字段的默认值时**两处都加 `sv < 8` 块并把 sv 升到 8。

### 6.3 聊天导出格式

面板「聊天记录 → 导出」：

```json
{
  "v": 2,
  "exportedAt": 1700000000000,
  "log": [{ "role": "user", "content": "...", "t": 0 }],
  "memory": { "v": 2, "profile": {}, "facts": [], "events": [], "promises": [], "forgotten": [] }
}
```

导入时接受 `{log, memory}`；记忆单独导出是 `{v:2, exportedAt, memory}`，`XH.memory.importData()` 也接受裸 memory 对象。

---

## 7. IPC / 事件 / 命令

### 7.1 Rust → 网页

| 事件 | 载荷 | 用途 |
|---|---|---|
| `pet://cursor` | `{x, y, inside}` | 物理像素光标位置；网页除以 DPR |
| `pet://drag-move` | `[dx, dy]` | 物理像素窗口位移，含 0 |
| `pet://drag-end` | 无 | 松手，播落地/贴边后状态 |
| `pet://cmd` | `{type: ...}` | 面板/托盘/侧边窗 → 桌宠：play/sleep/settings/onboard/chat/say/time/weather/chime/sfx；v0.6.0 新增 chatsync/stop/retry/bar/chatwin{open}/confirm{id,ok}/think{on}/look{text} |
| `pet://autostart` | `bool` | 面板/托盘自启状态同步 |
| `pet://chat` | `{id, kind, text}` | 流式对话：delta/think/tool/done/error/cancel（tool 的 text 是 JSON 数组） |
| `pet://scene` | `{title, proc, full}` | 前台场景，约每 2 秒 |
| `pet://update` | `{kind: progress\|verified\|installing, got?, total?, size?}` | 更新下载进度（v0.6.0） |
| `pet://chatui`（桌宠 → 侧边窗，网页 emitTo） | `{k: sync\|user\|start\|mood\|delta\|think\|tool\|ask\|askdone\|busy\|scene\|vision\|tip\|end, …}` | 侧边聊天窗的全部进度（v0.6.0） |

### 7.2 网页 → Rust（`invoke`）

| 命令 | 参数 | 说明 |
|---|---|---|
| `set_passthrough` | `{ignore}` | 点击穿透开关 |
| `start_drag` | 无 | 系统拖动；左键已松开时返回错误 |
| `open_panel` | 无 | 打开/聚焦面板（async） |
| `set_scale` | `{pct}` | 50–150 之间夹取，实际托盘用 75/100/125 |
| `set_top` | `{on}` | 置顶 |
| `move_home` | 无 | 回主屏右下角 |
| `toggle_pet` | 无 | 显示/隐藏切换 |
| `pet_show` | `{on}` | 明确显示/隐藏（全屏自动隐藏用） |
| `pet_focus` | `{on}` | 对话打开时抢键盘焦点 |
| `quit_app` | 无 | 保存窗口状态并退出 |
| `autostart_get` / `autostart_set{on}` / `launched_autostart` | | 自启 |
| `chat_send{req}` / `chat_cancel` / `chat_key_set{provider,key}` / `chat_key_info{provider}` | | 对话/密钥 |
| `scene_now` / `scene_watch{on}` | | 场景采集 |
| `chatwin_open`（async）/ `chatwin_hide` | | 侧边聊天窗显示 / 隐藏（v0.6.0） |
| `agent_find_app{name}` → `{name, target}` / `agent_launch{target}` / `agent_open_url{url}` / `agent_clip_get` / `agent_clip_set{text}` | | 帮你做事（v0.6.0，均有白名单校验） |
| `screen_capture{block}` → `{image, w, h, proc}` | | 看屏幕截图（v0.6.0，隐私时报 `__PRIVATE__`） |
| `update_check` → `{available, current, version, notes, date}` / `update_install{dry}` | | 自动更新（v0.6.0） |

应用自定义命令不需要额外 capability；用到插件（window-state 等）才看 `src-tauri/capabilities/default.json`（v0.6.0 起 windows 含 `main / panel / chat`）。新增命令要注册进 `main.rs` 的 `invoke_handler`。updater 插件只在 Rust 里用，没开放给网页。

---

## 8. 文件地图（哪些能改，哪些不能）

```text
<root>/
  AI_HANDOFF.md                    本文
  index.html                       浏览器角色预览（引用 assets/）
  assets/                          渲染源（真正的源）
    app-core.js                    常量、参数、物理、网格
    app-render.js                  WebGL、图层、摇摆矩阵
    app.js                         动作库、待机、交互、XH.pet API
    app-dress.js                   换装/节日/自动换装
    app-assist.js                  报时/天气/提醒/劝睡
    app-bubble.js                  气泡
    app-sfx.js                     Web Audio 音效
    xiaohua_layers.js              生成图集，约 6MB，勿手改
    xiaohua_wardrobe.js            生成换装数据，勿手改
    xiaohua_web.js                 网页预览入口辅助（index.html 用）
    xiaohua_ref.png                角色参考图
    wardrobe/                      套装/配饰图集与缩略图
  desktop-pet/
    build.ps1                      同步素材 + cargo tauri build + 复制产物
    README.md                      功能/实现细节（改代码前读）
    使用说明.txt                   最终用户说明（构建时复制到交付目录）
    web/
      pet.html                     透明舞台 + 漫画输入栏（含确认行）
      pet.js                       宿主桥接、穿透、拖动、输入栏 / 侧边窗、确认、设置、主动搭话、检查更新
      chatwin.html                 侧边聊天窗（单文件，只是视图）
      panel.html                   控制面板（单文件，5 页）
      chat.js                      AI 传输、提示词、情绪、思考 / 工具循环、记忆抽取、忘掉
      tools.js                     工具定义 / 执行 / 确认、提醒、便签
      vision.js                    看屏幕（视觉模型、同意、隐私判断）
      memory.js                    记忆 v2
      scene.js                     场景归类/安静/提示
      assets/                      构建时从 ../assets 同步，勿手改
    src-tauri/
      Cargo.toml                   版本、依赖、release profile
      tauri.conf.json              窗口/打包/版本/更新公钥
      capabilities/default.json    main + panel + chat 权限
      src/main.rs                  托盘、光标、穿透、拖动、贴边、窗口、聊天窗停靠
      src/autostart.rs             注册表自启
      src/chat.rs                  SSE / 密钥 / 思考 / 工具调用分片
      src/agent.rs                 打开网址 / 开始菜单程序、剪贴板
      src/screen.rs                看屏幕截图
      src/update.rs                自动更新（UPDATE_URLS 在这里）
      src/scene.rs                 前台窗口/全屏采集
      icons/                       图标
      gen/                         自动生成 schema，勿手改
      target/                      编译产物，不要打包
  tools/                           图层/换装素材工具（Node，无依赖）
  psd/                             角色源（PSD、layers、raw、说明）
  docs/                            方案与 Live2D 文档
  .backups/                        历史 exe/setup 备份
  dist/                            v0.2.1 旧产物，勿用
  打包说明.txt                      v0.2.1 旧说明，勿用
  使用说明.txt                      给最终用户
```

**最小交接集合**：`AI_HANDOFF.md` + `desktop-pet/` + `assets/`（至少 JS + wardrobe）+ `docs/` + `使用说明.txt`。  
**做美术/图层才需要**：`psd/`（很大）、`tools/`、`assets/xiaohua_ref.png`。  
**不要打包**：`src-tauri/target/`、`.backups/`、`dist/`、`psd/raw/`（除非需要中间图）。

---

## 9. 常见改动配方

### 9.1 加一个设置开关

1. `web/panel.html` 的 `DEF` 加默认值；加 UI（复选 `data-k`，分段用 `seg()`）。
2. `web/pet.js` 的 `DEF` 加同样默认值；在 `load()` 的 `sv` 迁移块里补旧数据默认值。
3. 消费端：
   - 渲染/动作/音量 → `assets/app.js` 的 `XH.pet.set()`；
   - 小助手 → `assets/app-assist.js` 的 `XH.DEF_ASSIST` + 逻辑；
   - 场景 → `web/scene.js` 的 `DEF_SCENE` + `set()`；
   - 对话 → `web/chat.js` 的 `DEF_CHAT` + `cfg()`；
   - 看屏幕 → `web/vision.js` 的 `DEF_VISION`；
   - 侧边聊天窗需要知道的 → `pet.js` 的 `sync()` / `toWin()` + `chatwin.html` 的 `onUi()`。
4. `panel.html` 的 `save()` 会自动写 `xh-pet` 并 `pet://cmd settings`，一般不用改。
5. 只是新增字段：有默认值就够了。要改已有字段默认值：两处加 `sv < 8` 块并把 `sv` 升到 8；面板和桌宠都要改。
6. 验证：面板改 → 桌宠立即生效；重启后保持；旧数据升级不丢。

### 9.2 加一个 AI 服务商

`web/chat.js` 的 `PROVIDERS` 加 `{name, base, model, nokey?}`；面板下拉自动出现。只要接口兼容 OpenAI `/chat/completions` 流式格式，Rust 不用改。

### 9.3 加动作 / 台词

在 `assets/app.js`：动作库、`play()`、`toast()`、`say()`、`XH.pet.emote()` 的标签映射。改完跑 `build.ps1`（或 `-Dev`）同步到 `web/assets/`。

### 9.4 加场景类别

- 进程表/标题表/NAME 在 `web/scene.js`；
- `quiet()` 决定是否主动搭话；
- 面板 `explain()` 文案；
- 侧边聊天窗标题下的“你在写代码”文案在 `pet.js` 的 `CHIP` / `sceneLabel()`。
- 看屏幕的隐私拦截要同步：`scene.js` 的 `private` 表（前端）和 `screen.rs` 的 `PRIVATE_PROC / PRIVATE_TITLE`（Rust）。
- 不要默认把新类别加入 `private`，否则会误安静。

### 9.5 改角色图层

读 `psd/图层说明.md`，然后：

```powershell
cd D:\小嬅桌宠源码
node tools/align.js
node tools/build_layers.js
```

会重写 `psd/layers/`、`psd/layers.json`、`psd/xiaohua_layers.psd`、`psd/composite_check.png`、`assets/xiaohua_layers.js`。  
注意：`build_layers.js` 末尾会写 `%TEMP%\opencode\owner.png`，目录不存在会失败，先建好；图层顺序/来源在 `tools/layer_defs.js`；不要手改生成物。

### 9.6 重新生成换装

- `tools/gen.js` / `gen_worn.js` 调 Seedream 5.0 生成原图（需要外部服务，仓库不保存密钥）；
- `tools/extract_worn.js` 差分拆层；
- `tools/build_wardrobe.js` 打包图集并写 `xiaohua_wardrobe.js`；
- 生成后务必在 100% / 125% 下检查兜帽、蝴蝶结、叶子、下摆，历史版本多次出现小洞/细缝。
- 不要为了修一个洞盲目降低全局阈值：v0.4.2 玉兔耳朵单独用 14，v0.4.3 补封 12 处空洞，v0.4.4 专门补呆毛根部；先看 `README` 的版本记录。

### 9.7 升版本号

同步以下位置（缺一处会出现“面板/安装包/文档版本不一致”）：

1. `desktop-pet/src-tauri/Cargo.toml` `version`
2. `desktop-pet/src-tauri/tauri.conf.json` `version`
3. `desktop-pet/src-tauri/Cargo.lock` 根包 `xiaohua-pet` 的 `version`（`cargo build` 会更新，构建后确认）
4. `desktop-pet/web/panel.html` 页脚
5. `desktop-pet/README.md` 标题、安装包名、changelog
6. `使用说明.txt`（根目录）
7. `desktop-pet/使用说明.txt`（构建会复制到交付目录）
8. `docs/小嬅_四季服装设计_Live2D方案.md` 第 13 节（有功能变更时）
9. 本文开头的适用版本、§3.3 交付物快照

`build.ps1` 不硬编码版本，从 `tauri.conf.json` 读，setup 文件名来自 tauri bundle。**发给用户的新版本号必须大于已装版本**，自动更新才会提示。

### 9.8 加一个工具（让她多会做一件事）

1. `web/tools.js`：`DEFS` 里加 `fn(name, 描述, 参数)`，`NAME` 里加显示名，`exec()` 里加 `case`，返回 `ok(给模型的结果, 给人看的标签)` / `no(...)`。
2. 会动电脑或把内容发出去的，执行前 `await ctx.confirm('要我……吗？')`，不同意返回 `refused(...)`。
3. 需要系统能力时在 `agent.rs` 加命令并注册，**在 Rust 里做白名单校验**，别信模型给的参数。
4. 改 `chat.js` 的 `TOOL_LINE` 让模型知道有这个能力。
5. 假 LLM 里加一个触发分支（见 §10.4），真机测确认 / 拒绝 / 出错三条路。

---

## 10. 测试与调试

### 10.1 静态检查

```powershell
cd D:\小嬅桌宠源码\desktop-pet\web
node --check chat.js
node --check memory.js
node --check scene.js
node --check pet.js
node --check tools.js
node --check vision.js
node --check assets\app.js

cd D:\小嬅桌宠源码\desktop-pet
cargo check --manifest-path src-tauri\Cargo.toml
```

预期：JS 无输出；`cargo check` 无警告（v0.6.0 已删掉 `cursor_inside`）。  
`panel.html`、`chatwin.html`、`pet.html` 的内联脚本也要检查：提取 `<script>` 内容后 `node --check`，历史上 v0.4.1 就是同名 `const auto` 导致整页点不动。  
`build.ps1` 是带 BOM 的 UTF-8（PowerShell 5.1 读中文需要），改它请用编辑器 / Edit，别用会去掉 BOM 的写法；也别用 .NET 相对路径写文件（进程当前目录和 PowerShell 位置不同，曾在源码根写出空的 `tauri.conf.json`）。

### 10.2 无头浏览器（UI/对话卡）

用 Edge/Chrome headless + CDP：

- 启动：`msedge.exe --headless=new --remote-debugging-port=<port> --user-data-dir=<临时目录> about:blank`
- 连接 `http://127.0.0.1:<port>/json`，取页面 WebSocket。
- 必须 `Network.setCacheDisabled {cacheDisabled:true}`，否则改完 JS 仍加载旧缓存。
- 设置 300×610、DPR 2 的 device metrics，再导航到 `http://127.0.0.1:8765/desktop-pet/web/pet.html`。
- 通过 `Runtime.evaluate` 操作 `PET_SETTINGS()`、`PET_CHAT`、`XH.chat`、`XH.memory`、`XH.scene`。
- 截图用 `Page.captureScreenshot`。
- 拖动可用 `Input.dispatchMouseEvent`：mousePressed → 多次 mouseMoved（buttons:1）→ mouseReleased；验证 `left/top`、边界夹取、关闭复位。
- 无头测试不要发真实 API 请求：把 `XH.chat.send` 替换成假流，或指向本地假 LLM。

### 10.3 真机 CDP

**推荐（v0.6.0 起这样测）：隔离数据目录，不碰用户真实数据，也不用退出用户正在用的那只**：

```powershell
cd D:\小嬅桌宠源码\desktop-pet
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipInstall -NoOpen -OutDir "$env:TEMP\xh-test-build"
Copy-Item "$env:APPDATA\com.xiaohua.desktoppet\.window-state.json" <备份路径>   # window-state 是共用的
$env:WEBVIEW2_USER_DATA_FOLDER = '<临时目录>\wv2-test'       # 独立 localStorage（设置、聊天、记忆都是空的）
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
$env:XH_UPDATE_URL = 'http://127.0.0.1:8765/.backups/upd-test/latest.json'   # 只在测更新时设
Start-Process "$env:TEMP\xh-test-build\小嬅桌宠.exe"
```

仍然共用的东西（测完要检查 / 还原）：`.window-state.json`、密钥 `chat.json`、开机自启注册表（v0.6.0 已不会被副本改写，但旧版会）、剪贴板、真实屏幕。隔离实例里先写测试设置（`chatOn`、`provider:'custom'`、`base:'http://127.0.0.1:9999/v1'`、`model:'fake'`、`proactive:0`），再 reload。

直接测用户那只（旧方法，需先完全退出正在运行的桌宠）：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
Start-Process "$env:LOCALAPPDATA\小嬅桌宠\xiaohua-pet.exe"
```

访问 `http://127.0.0.1:9223/json`，应能看到：

- `http://tauri.localhost/pet.html`
- `http://tauri.localhost/panel.html`（打开面板后）
- `http://tauri.localhost/chatwin.html`（打开过侧边聊天窗后）

可用的页面全局：

- `PET_SETTINGS()` → 当前设置对象
- `PET_CHAT.open()/close()/send(text, opt)/openBar()/closeBar()/openSide()/closeSide()/state()/answer(id, ok)/setThink(on)` → 聊天（`state().ask` 是待回答的确认）
- `PET_UPDATE()` → 立刻检查一次更新
- `XH.tools.reminders / notes`、`XH.vision.canLook(S) / look(S, q, confirm) / resetConsent()`
- `__TAURI__.window.Window.getByLabel('chat')` 的 `outerPosition / outerSize / isVisible` 可读窗口位置（只读权限默认有）
- `XH.scene.state / hint() / quiet() / explain(evt, cfg)`
- `XH.memory.load()/digest(q)/stats()/forget(kw)`
- `XH.chat.loadLog()/busy()`
- `__TAURI__.core.invoke('open_panel')`、`__TAURI__.event.emit('pet://scene', payload)`

场景测试：

```js
await __TAURI__.core.invoke('scene_watch', { on: false });
await __TAURI__.event.emit('pet://scene', { proc: 'Code.exe', title: 'app.js', full: false });
// 检查 XH.scene.state / quiet() / 面板文案
await __TAURI__.core.invoke('scene_watch', { on: true });
```

**测试前先备份** `xh-pet`、`xh-chat-log`、`xh-memory-v2`、`xh-onboarded`；测试后还原并 reload。真机 localStorage 是用户真实数据，不要留下测试消息/记忆/假设置。

### 10.4 本地假 LLM

面板「对话」选「自定义」：base `http://127.0.0.1:9999/v1`，model `fake`，密钥留空（本地地址允许）。  
服务端契约：

- 普通回复：SSE `data: {"choices":[{"delta":{"content":"[开心]..."}}]}`，最后 `data: [DONE]`。
- 测试连接（`stream:false`）：返回普通 JSON `{choices:[{message:{content:"好"}}]}`。
- 记忆抽取：system 含「整理长期记忆」时，把 JSON 当作流式 content 返回，例如 `{"facts":["用户喜欢咖啡"]}`；不要包 Markdown 代码块。
- 记录请求体可验证 `sceneTitle` 关闭时标题未进入 messages。

本机旧临时脚本在 `C:\Users\ROG\AppData\Local\Temp\opencode\fake-llm.js`，但临时目录可能被清理；没有就按上面的契约自建。最小实现示例（Node，无依赖）：

```js
const http = require('http');
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const j = JSON.parse(b || '{}');
    const mem = JSON.stringify(j.messages || []).includes('整理长期记忆');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (j.stream === false) {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ choices: [{ message: { content: '好' } }] }));
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    const parts = mem ? ['{"facts":["用户喜欢咖啡"]}'] : ['[开心]', '我在呢，', '慢慢说就好～'];
    let i = 0;
    const t = setInterval(() => {
      if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
      else { clearInterval(t); res.write('data: [DONE]\n\n'); res.end(); }
    }, 120);
  });
}).listen(9999, '127.0.0.1');
```

三连发同一个人消息可触发记忆抽取（每 3 轮一次）；抽取是后台请求，注意看服务端日志和 `xh-memory-v2`。

v0.6.0 测试还需要假服务支持（按需加分支）：

- 思考：`model === 'fake-think'` 或请求体有 `enable_thinking` 时，先流若干 `{"delta":{"reasoning_content":"…"}}` 再流正文。
- 工具：请求带 `tools` 且用户消息命中关键词时，流 `{"delta":{"tool_calls":[{index, id, type:'function', function:{name, arguments}}]}}`；`arguments` 可拆成多片测拼接；最后一条消息是 `role:'tool'` 时回正文总结。注意别让关键词匹配到工具结果 / 视觉描述里的字（曾因描述里有“打开”触发 open_app）。
- 不支持工具：`model === 'notools'` 且带 `tools` 时回 400 `{"error":{"message":"tools is not supported"}}`。
- 视觉：消息里有 `image_url` 时只记录 `data:image/jpeg;base64,` 头和长度（**截的是真屏幕，不要落盘、不要查看**），流一段描述。
- 更新：静态服务器放 `latest.json`（`version / notes / pub_date / platforms['windows-x86_64'] = {signature, url}`），安装包用 `cargo tauri signer sign --app-version <清单版本> <文件>` 签；测试只用 `update_install {dry:true}`。

这次会话用的完整脚本（静态服务 :8765 + 假 LLM :9999 + CDP 小工具）在会话临时目录里，可能已被清理；按上面契约重写即可。

### 10.5 十分钟冒烟清单

1. 启动：角色出现，开场招呼有声；无控制台红色报错。
2. 鼠标靠近角色变抓手；点空白能点到下方窗口（穿透）。
3. 摸头、戳身体、连点 3 次生气；拖动摇晃、松手落地。
4. 拖到左右边缘吸附，鼠标靠近探头，离开 1.5 秒缩回。
5. 右键角色开面板；5 页都能切；关闭再开正常。
6. 设置改音量/大小/置顶/动作频率，立即生效；重启保留。
7. 面板「对话」测试连接；双击开漫画输入栏，发一句气泡能流式回复；停止、重发、Esc 收起；点对话框按钮开侧边窗，拖动她时聊天窗跟着走，收起到脚边 / 关闭正常。
7a. 灯泡开深度思考，侧边窗能看到思考过程；说「十分钟后提醒我喝水」能设提醒；说「打开记事本」出现确认，点「不要」不打开。
7b. 看屏幕：面板「看一眼试试」首次征求同意、能返回描述；眼睛按钮不冒出别的窗口；前台是微信等隐私应用时拒绝。
7c. 面板「设置 → 更新」检查更新：占位地址时提示“还没配置”，配好后能看到版本和说明。
8. 连发 3 轮，检查记忆页出现 facts/events；编辑/置顶/删除/导出正常；说「忘掉 …」能删。
9. 场景：开/关总开关；标题开关关闭时请求体无标题；隐私/会议/全屏时主动搭话被抑制；全屏自动隐藏能恢复。
10. 托盘左键隐藏/显示，右键各项可点；75/100/125% 生效；退出重开位置保留。
11. 开自启 → 注册表出现；带 `--autostart` 启动不打招呼；关自启 → 消失。
12. 安装版：ProductVersion 与当前版本一致；聊天/记忆/设置与便携版一致（同 identifier）。

---

## 11. 已知问题、技术债与风险

| 优先级 | 事项 | 说明 |
|---|---|---|
| 高 | 实际独占全屏检测 | 目前只用无边框最大化窗验证；视频播放器/游戏可能用独占全屏或特殊窗口矩形，需实测后调整 `scene.rs` |
| 高 | 卸载清理自启 | NSIS 卸载钩子未删 `HKCU\...\Run\小嬅桌宠`；用户需先关自启再卸载 |
| 高 | 无自动化测试 | 目前只有手动 + CDP 脚本；建议先给 `memory.js` / `scene.js` / `tagParser` 加 Node 单测 |
| 中 | 托盘自启勾选 | 面板/注册表已验证；托盘菜单勾选建议实际点一遍 |
| 中 | 多显示器 / DPI | 贴边/穿透用物理像素；125%/150% 下需复测坐标换算 |
| 中 | 记忆隐私 | 敏感信息只靠提示词约束；localStorage/导出明文；不要承诺“绝对不会记” |
| 中 | 记忆抽取成本 | 每 3 轮额外一次请求，增加 token；忙碌/抽取中会跳过；用户无感知 |
| 高 | 更新地址未配置 | `update.rs` 的 `UPDATE_URLS` 和 `build.ps1 -UpdateBase` 还是 `your-name/xiaohua-pet-release` 占位；用户建好 Gitee 公开仓库后要改，并实测 Gitee raw / 附件对未登录下载是否可用（不行就加备用地址） |
| 高 | 更新签名私钥 | 只在 `%USERPROFILE%\.tauri\xiaohua-updater.key`，没有别的备份；丢了就要换公钥，已装版本收不到更新 |
| 中 | 真实服务商格式 | reasoning / tool_calls / 图片消息只按 OpenAI 兼容格式实现；DeepSeek / 通义 / 智谱 / Kimi 需各测一次，出问题多半在 `THINK` 表、`extra` 参数或视觉模型名 |
| 中 | 工具的真实执行 | 打开程序 / 网页 / 写剪贴板只测了查找和拒绝路径；「设置」「截图」用的是 ms-settings: / ms-screenclip: 协议 |
| 中 | 截图包含小嬅自己 | 去掉 SetWindowDisplayAffinity 后她的窗口可能在截图里，靠提示词让视觉模型忽略 |
| 中 | 输入栏宽度 | 75% 大小时输入框只剩 ~70px，已缩图标、藏 ×；更多按钮请放侧边窗 |
| 中 | 场景标题 | 开启后标题会进模型请求；`safeTitle` 只做基础脱敏，仍需用户知情 |
| 中 | 面板前置 | 面板置顶，可能挡住桌宠；面板获得焦点时场景会读到 `self` |
| 低 | 代码签名 / SmartScreen | 未签名 exe 会被拦；发布前考虑证书 |
| 低 | macOS | 透明窗口、松手判定、托盘都未适配 |
| 低 | 旧文档/旧包 | `dist/`、`打包说明.txt`、`小嬅桌宠_源码_v0.2.1_20261018.zip` 已过时 |

其他实现注意：

- 全局只有一个 `CUR` 对话序号；新请求/取消会让旧线程退出（旧请求在网页端会等到 30 秒超时才收尾）。不要把对话、记忆抽取、看屏幕当成独立并发通道——它们是串行用的。
- `chat_cancel` 是全局的；网页端已用 `curId` 防止旧请求误杀新请求，新增调用点也要走 `request()`。
- 记忆抽取失败静默，不会提示用户；不要让它阻塞正常聊天。
- 场景线程每 2 秒 emit，面板 / 聊天窗也会收到；隐藏时仍在跑。
- 主动搭话只走气泡（会写进记录，侧边窗靠 storage 事件刷新）；输入栏或侧边窗开着时不会主动搭话。
- 全屏自动隐藏只在聊天关闭时生效。
- 侧边窗收到 `xh-chat-log` 的 storage 事件会整页重画，所以刚说完那 2 秒内忽略（否则思考折叠块会丢、用户消息会重复）。
- `web/assets/` 是构建产物，手改必丢。
- 中文源码/文档统一 UTF-8 无 BOM。不要用 `Set-Content -NoNewline` 写 JSON（历史上曾把 `tauri.conf.json` 写成空文件）；用编辑器或 Node/`[IO.File]::WriteAllText`，写完 `ConvertFrom-Json` 校验。

---

## 12. 发布与回滚

### 12.1 发布

1. 改代码，跑静态检查和真机冒烟。
2. 升版本号（§9.7），更新 `README` / `使用说明` 变更。
3. 备份当前 exe/setup 到 `.backups\pre-v<版本>-<时间>\`。
4. `powershell -ExecutionPolicy Bypass -File build.ps1 -SkipInstall -Release -Notes "这版更新了什么" -UpdateBase "https://gitee.com/<用户>/<仓库>/releases/download"`。
5. 确认 `D:\小嬅桌宠\小嬅桌宠.exe`、`安装包\小嬅桌宠_<版本>_x64-setup.exe`、`发布\v<版本>\` 都更新；计算 SHA256。
6. 手动替换安装版并核对 ProductVersion，或运行 setup。
7. 自动更新发布（照 `发布\v<版本>\发布说明.txt`）：Gitee 发行版标签 `v<版本>` 上传 `xiaohua-pet_<版本>_x64-setup.exe` → 把 `latest.json` 提交到仓库 master 根目录 → 用旧版面板「检查更新」确认。
8. 发布时排除 `target/`、`.backups/`、`dist/`、`psd/raw/`、视频项目、临时截图；发布说明保留「角色设计 © 樺樺嗝」（用户已确认取得授权）。

### 12.2 回滚

- v0.5.0 原版：`.backups\pre-v0.6-chatui-*\小嬅桌宠.exe`（SHA256 `28D026E9…`）；v0.5.0 源码：`.backups\src-v0.5.0-20261019-035100.zip`，git `master` 分支。
- v0.6 各阶段测试版：`.backups\pre-v0.6-agent-*`、`pre-v0.6-vision-*`、`pre-v0.6-noaffinity-*`、`pre-v0.6.0-release-*`（每个是替换前那一版）。
- 更早：`.backups\pre-v0.5.0-install-20261019-105945\`（0.4.4 exe + setup）。
- **两份 exe 都要更新**：开机自启指向 `D:\小嬅桌宠\小嬅桌宠.exe`，但桌面和开始菜单的快捷方式指向安装版 `%LOCALAPPDATA%\小嬅桌宠\xiaohua-pet.exe`。只更新 D 盘那份时，用户点快捷方式会跑出旧版（2026-10-19 出过一次：重启后点桌面图标跑的是 0.5.0）。每次交付：先退出所有实例，两处都覆盖成同一个文件，再启动。旧 0.5.0 安装版备份在 `.backups\installed-0.5.0-*`。「设置 → 应用」里显示的版本号来自安装时的注册表，手动覆盖 exe 不会变。
- 回滚：退出桌宠 → 复制备份 exe 到交付目录和 `%LOCALAPPDATA%\小嬅桌宠\xiaohua-pet.exe` → 启动核对 ProductVersion。
- 设置/记忆/聊天记录不会随 exe 回滚；如果新版本改了数据结构，回滚前先导出数据。

### 12.3 发布前必须确认

- 面板能打开，5 页能切。
- 点击穿透、拖动、贴边正常。
- 对话能流式回复；停止/重发正常。
- 记忆能抽取、编辑、忘掉。
- 场景开关/标题隐私/全屏安静/自动隐藏正常。
- 安装版和便携版版本一致；自启路径正确。
- 聊天两种界面、深度思考、至少一个工具的确认流程、看屏幕（如果用户开着）正常。
- `latest.json` 的版本号、下载地址、签名正确；签名是用 `%USERPROFILE%\.tauri\xiaohua-updater.key` 签的。
- 没有把密钥（API 密钥和更新签名私钥）、聊天记录、测试截图打进发布包。

---

## 13. 版权与隐私

- 角色「小嬅」由主播 **樺樺嗝** 原创设计；对外发布、二次分发、商用前先取得授权，README/发布文案保留「角色设计 © 樺樺嗝」。
- 对话内容、记忆、聊天记录会发给用户配置的模型服务商；密钥明文存在本机；没有遥测/统计上传。
- 场景感知只读前台进程名、标题、窗口矩形；不截图、不读内容、不写盘。标题默认不进模型，开启后也只经 `safeTitle` 脱敏。
- 看屏幕（v0.6.0，默认关、首次征求同意）会把整块显示器的截图发给用户选的视觉服务商；只在内存，不写盘；隐私应用 / 标题 / 黑名单前端和 Rust 双重拦截。测试时不要查看或保存截图内容。
- 读剪贴板会把内容发给模型，所以每次都要用户点「好」。
- 不要在没有用户同意的情况下导出/上传 `chat.json`、`xh-chat-log`、`xh-memory-v2`。

---

## 14. 交接检查表（给下一个 AI）

接手后先做这些，不要直接改功能：

- [ ] 读本文、`README.md`、`docs/桌宠方案.md`、`psd/图层说明.md`
- [ ] 确认源码根、交付目录、安装版路径和当前版本
- [ ] 备份 `xh-pet` / `xh-chat-log` / `xh-memory-v2` / `xh-onboarded`
- [ ] 跑 `node --check` 和 `cargo check`
- [ ] 用 `build.ps1 -SkipInstall` 复现一次构建
- [ ] 启动真机，按 §10.5 冒烟
- [ ] 用假 LLM 验证对话/记忆，不碰真实付费接口
- [ ] 写下准备改的文件、数据迁移方案、验证步骤，再动手

最后更新本文的版本、日期、验证结论和已知问题。
