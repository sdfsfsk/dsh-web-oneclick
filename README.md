# dsh-web-oneclick

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的 Windows 一键脚本与局域网/公网开放配置。双击即用，不用记命令。

> 适用对象：从源码运行 DSH（`git clone` + `pnpm install` + `pnpm run build`）的 Windows 用户。中文 Windows（GBK 控制台）实测通过。

## 包含内容

| 文件 | 作用 |
| --- | --- |
| `start.bat` | 一键启动 Web GUI：自动清理端口占用（僵留实例直接结束再启动，按端口动态解析 PID、不假定进程名），探测本地代理并让 Node 全局 fetch 走代理（dsh-codex 等境外插件需要），探测并显示局域网访问地址，自动打开浏览器，同时把控制台输出持久化到 `%LOCALAPPDATA%\DeepSeekHarness\logs` |
| `start-web.ps1` | Web 启动与日志助手：控制台和 UTF-8 日志双写，记录启动/退出时间与退出码，维护 `dsh-web-latest.txt` 并保留最近 20 份日志 |
| `configure-codex-models.bat` | Web/TUI 共用的模型缓存配置：保留自定义 `DSH_CODEX_MODELS_CACHE`，否则按 `CODEX_HOME` 或用户目录定位 Codex 模型缓存，并显示当前来源 |
| `start-tui.bat` | 一键启动终端 TUI（dsh-TUI 插件，Claude Code 风格全屏交互终端）：`start-tui.bat --resume` 恢复上次会话；同样自动接入本地代理 |
| `start-panel.bat` | 一键启动**管理面板**（带网页界面的启动器）：定位 DSH 源码、检查 `dsh-x\`（管理页 UI）与构建产物、探代理，把面板起在 `127.0.0.1:3780`（被占自动顺延）并打开一个**无边框原生窗口**（和 DSH-X 同款）。**不自动启动 dsh**——点卡片里的 ▶ 才启动（网页端口默认 3080，可 `start-panel.bat 3080` 指定）；界面来自上游 DSH-X，后端是本仓库的 `panel-server.mjs`（见下方「管理面板」） |
| `start-panel.ps1` | 面板的启动与日志助手：控制台 + UTF-8 日志双写 `logs\dsh-panel-*.log`、维护 `dsh-panel-latest.txt`、保留最近 20 份 |
| `panel-server.mjs` | 面板后端（源码模式）：驱动本 checkout 的 dsh（`node apps/cli/lib/bin.js --profile … --port …`），提供管理页需要的全部接口；插件页与兼容模式复用 `dsh-x\plugins.js`；「更新」图标 = 跑 `update.bat` 并解析它的输出做进度 |
| `panel-window\` | 面板窗口壳的 Rust 源码（tao + wry）：无边框窗口 + WebView2，页面自画标题栏与最小化/最大化/关闭，尺寸 1100×760 逻辑像素。`build-panel-window.ps1` 编译它 |
| `build-panel-window.ps1` | 编译窗口壳 → `panel-window.exe`（没装 Rust 就跳过并警告：面板退回浏览器独立窗口） |
| `panel-hooks.mjs`、`panel-hooks-register.mjs` | 上游两个加载钩子的「源码布局适配层」（启动加速、会话事件词汇兼容）：只把源码路径映射回上游认得的包名标记，补丁逻辑仍是 `dsh-x\` 里那份 |
| `update-panel.ps1` | 面板界面的上游（`dsh-x\`）拉取 / 切换助手：clone 或切到钉死的提交（`set DSHX_REF=…` 可换成标签 / 分支 / 提交号），并断言面板依赖的上游锚点还在 |
| `update.bat` | 一键更新：探测本地代理 → 切换到 `DSH_REF`（默认上游最新发布标签，可用 `set DSH_REF=…` 换） → `pnpm install` → 清理并构建 → 拉取/切换管理面板的界面（`dsh-x`） → 编译面板窗口壳 → 更新社区插件（web 与 dsh-tui 两个 profile，含 dsh-codex、dsh-reasoning-effort） → 更新 Mnemon CLI。首次运行找不到 DSH 源码时自动转为安装：`git clone` → 复制一键脚本进仓库根目录 → 构建 |
| `login-codex.bat` | 一键令牌登录 dsh-codex（设备码方式）：自动探测本地代理并注入 `NODE_USE_ENV_PROXY`，先检查登录状态（已登录且凭据有效则直接退出，不重复授权），未登录时终端显示授权网址和码，浏览器打开输入即可。登录前需把梯子切到**全局代理**模式，登录成功后可切回 |
| `update-codex.ps1` | dsh-codex 更新助手：npm 安装正常更新；检测到 `link:`、`file:` 或 Git 来源时保留本地补丁，不覆盖开发 checkout |
| `update-profile-policies.ps1` | profile 供应链策略助手：只为脚本明确更新的社区插件及其 `@morlay/*` 依赖添加发布时间门禁排除项，保留其他未知包的 pnpm 保护 |
| `update-mnemon.ps1` | Mnemon CLI 更新助手（查最新 release、SHA256 校验、解压安装），由 update.bat 调用 |
| `get-lan-ip.ps1` | 局域网 IP 探测助手，由 start.bat 调用 |
| `link-skins.ps1` | 旧版皮肤链接清理（善后工具）：皮肤中心 v2 起皮肤已内置进 skin-center 包，旧版遗留的 `dsh-client-ui-skin-*` 死链接会导致 `ERR_MODULE_NOT_FOUND` 启动崩溃，本脚本扫描并删除这些死链接 |
| `clear-port.ps1` | 端口清理助手，由 start.bat 调用：结束占用启动端口的监听进程并确认释放（按端口动态解析 PID，不假定进程名） |
| `fix-node-pty-attach-console.ps1` | Windows `node-pty@1.1.0` 兼容修补：ConPTY 清理无法 `AttachConsole` 时回退到 shell PID，避免辅助子进程未捕获异常；每次启动幂等检查，插件更新覆盖后会自动重补 |
| `examples/cordis.patch.yml` | 局域网开放补丁（把 dsh web 绑定到 0.0.0.0），手机/平板访问的关键 |

## 快速开始

1. 下载本仓库（ZIP 或 clone），双击 `update.bat`：自动探测本地代理（10808 → 10809，也可 `update.bat 7890` 手动指定），首次运行会自动克隆 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码到 `deepseek-harness/` 目录，复制一键脚本进仓库根目录，并完成 `pnpm install` + `pnpm run build`。
2. 进入 `deepseek-harness/` 目录，双击 `start.bat` 启动；以后想更新时双击其中的 `update.bat`。
3. 想用**带管理页界面**的启动器：双击 `start-panel.bat`（面板起在 `http://127.0.0.1:3780/`，并自动把 dsh 拉起来）。`update.bat` 会顺带把面板的界面（`dsh-x\`）拉下来、把 `panel-server.mjs`、`panel-hooks*.mjs` 一起复制进 DSH 仓库根目录。

已经按官方文档装好 DSH 源码环境（确认 `pnpm dsh web` 能正常启动）的：把本仓库所有 `.bat`、`.ps1` 和 `.mjs` 复制到 deepseek-harness **仓库根目录**（和 `package.json` 同级）即可，`update.bat` 会直接更新当前仓库。

每次通过 `start.bat` 启动都会在 `%LOCALAPPDATA%\DeepSeekHarness\logs` 创建 `dsh-web-YYYYMMDD-HHmmss.log`，`dsh-web-latest.txt` 指向最近一份；最多保留 20 份。日志可能包含本机路径、错误详情和插件输出，不要直接公开分享完整文件。

注意：批处理文件必须是 **GBK 编码 + CRLF 换行** 才能在中文 Windows 的 cmd 里正常工作（本仓库已按此分发，直接下载 ZIP 或 clone 即可；不要另存为 UTF-8，详见下方 FAQ）。

## update.bat 细节

- **代理**：默认探测本地 HTTP 代理 `127.0.0.1:10808` → `10809`（v2rayN 默认端口），也可以手动指定：`update.bat 7890`（Clash 默认端口）。代理环境变量只在脚本进程内生效。
- **首次运行自动安装**：当前目录不是 DSH 仓库、且 `deepseek-harness\` 子目录也没有源码时，`update.bat` 会自动 `git clone` 安装并构建（全新安装只构建本体，社区插件与 Mnemon 按下方说明另行安装）；已克隆过则自动进入 `deepseek-harness\` 目录执行更新。
- **社区插件自动更新**：默认更新 web profile 的 `@linxin666/dsh-web-all`、`dsh-mnemon`、`dsh-codex` 和 dsh-tui profile 的 `@deepseek-harness-tui/dsh-tui`（见下方“社区插件”）。`dsh-codex` 若使用 `link:`、`file:` 或 Git 来源，脚本会保留该本地／开发补丁，不会改回 npm；没装插件时这一步会报警告但不影响本体更新。
- **Mnemon CLI 自动更新**：仅当你的 web profile 装了 `dsh-mnemon` 记忆插件才有意义；CLI 本体装在 `%LOCALAPPDATA%\Programs\mnemon`。

## 管理面板（可选）

`start-panel.bat` 把 [DSH-X](https://github.com/yyh-001/DSH-X) 那套管理页界面搬了过来：**界面是上游的，后端是本仓库的**——UI 从 `dsh-x\public\` 按钉死的上游提交读取，`panel-server.mjs` 驱动的是**你这份源码 checkout**，不按版本从 npm 装 dsh。所以管理页上没有「安装 / 更新 / 卸载版本」：版本就是你的 checkout，更新与重建仍走 `update.bat`。

- **面板地址** `http://127.0.0.1:3780/`（面板自己的端口，管理页「设置」里可改，重启面板生效；端口被占会自动顺延，真的装了 DSH-X 也不会打架）。打开启动器**只把界面摆出来，不自动拉起 dsh**（和上游 DSH-X 一样）：点卡片里的 ▶ 才启动（网页端口默认 3080，`start-panel.bat 3080` 可指定）并自动打开 dsh 网页；想照旧自动拉起：`set DSH_PANEL_AUTO_START=1`。
- **原生窗口（和 DSH-X 一模一样）**：面板页装在一个自建的无边框窗口里（`panel-window\` 用 Rust + tao/wry 编译，与上游同一套库）——**没有系统标题栏**，标题栏、最小化/最大化/关闭都由页面自己画（就是 `?window=1` 那套），尺寸 1100×760 逻辑像素、居中、可拉伸，和 DSH-X 的窗口一致。dsh 网页仍走浏览器的「应用模式」窗口（那一页没有自画标题栏，放进无边框窗口会连关闭按钮都没有）。
  - 关窗口（✕ / Alt+F4）**只是关窗口**：面板和 dsh 继续在控制台里跑着；再双击一次 `start-panel.bat` 就能把窗口叫回来（已关就重开，还开着就叫到最前）。要彻底退出：关掉那个控制台窗口（或 Ctrl+C）。
  - 编译需要 Rust（`cargo`）：`update.bat` 会自动编（首次要下依赖、编 wry/tao，慢几分钟；之后增量一两秒）。没装 Rust 或编译失败也不影响使用——面板退回浏览器的独立窗口，日志里会说明。想强制用浏览器标签页：`set DSH_PANEL_WINDOW=system`。
- **「更新」图标按钮**：在版本卡片里、▶ 左边那个图标（上游本来只在「有新版本可装」时才露出来，这里让它一直在）。点击 = 跑 `update.bat`——DSH 源码切到钉的版本（默认上游最新发布标签）并重建、更新社区插件、拉/切面板 UI。它会**先停掉 dsh，跑完自动重新拉起**（失败就保持停止），全过程输出进「日志」页。
  - **进度是真的**：卡片下方那根进度条读 update.bat 的实时输出——pnpm 的解析依赖数（「已解析 N 个依赖」）、构建时每个包的完成数（「已构建 N 个包」）、编译窗口壳的 crate 数（「已编译 N 个 crate」）；`done` 是累计值，所以条子只前进不后退。`pnpm run build` 里 tsc/tsdown 那段几分钟没有可数输出，此时文案改报当前步骤 + 已用时长（如「正在更新… pnpm run build（已 1 分 7 秒）」），并让条子缓慢兜底前进，不会看起来像卡住。
  - 命令行上的差别只有一处：面板用 `DSH_UPDATE_NONINTERACTIVE=1` 调 update.bat，后者因此跳过所有 `pause`（想手动模拟：`set DSH_UPDATE_NONINTERACTIVE=1` 后再双击 update.bat）。
- **插件页**照旧列 `~/.dsh/profiles/<profile>` 里装的插件并一键开关（写 `cordis.patch.yml`，与 dshmarket 同一套机制）；**兼容模式**在 dsh 起不来时按报错自动禁用出问题的插件行再重试。设置页里的「版本目录」在这个模式下就是「DSH 源码目录」。
- **日志**：面板与 dsh 的输出都进 `%LOCALAPPDATA%\DeepSeekHarness\logs\dsh-panel-YYYYMMDD-HHmmss.log`（`dsh-panel-latest.txt` 指向最近一份，最多留 20 份），管理页里也能看和导出。
- **上游界面版本**：`update-panel.ps1` 把 `dsh-x\` 钉在一个上游提交上（**刻意钉死**，与 `DSH_REF` 同一思路）。换版本：`set DSHX_REF=v0.1.13`（标签 / 分支 / 提交号都认）后再跑 `update.bat`。上游界面结构若变了，启动时会在日志里给出提示，界面覆盖层找不到锚点就自动跳过。
- **两个上游加载钩子**：启动加速与会话事件词汇兼容本来按 npm 布局匹配模块路径，源码模式下会全部空转；`panel-hooks*.mjs` 只做「源码路径 → 上游认得的标记」这一步映射，补丁逻辑仍是上游那份（见 FAQ 里 worker 那半份的说明）。
- 面板的界面文件（`public/` 那一大堆图）不落库：`update.bat` 会把上游 clone 到 `dsh-x\`（已加进 `.gitignore`）。

## 局域网开放（手机访问）

DSH 官方出于安全考虑在 CLI 里禁止了 `--host 0.0.0.0`，而 webserver 配置又只认 `127.0.0.1` / `0.0.0.0` 两个字面值——命令行没法开放局域网。解法是 profile 补丁层：

1. 用 dsh 跑过一次 `web` 后，打开 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`；
2. 把 [examples/cordis.patch.yml](examples/cordis.patch.yml) 里的补丁项追加进去；
3. 重启 dsh web。绑定通配地址时 `/api` 信任栅栏会自动把本机所有局域网 IPv4 加入白名单。

配套检查：

- Windows 防火墙放行端口（管理员 cmd 执行一次）：`netsh advfirewall firewall add rule name="DSH Web GUI 3080" dir=in action=allow protocol=TCP localport=3080`
- 本机继续用 `http://127.0.0.1:3080`，手机用 `http://<局域网IP>:3080`。

> ⚠️ **安全提示**：0.0.0.0 意味着同网络设备都能打开你的 Web GUI。桌面版界面没有登录认证，虽然改设置/写凭据等特权接口被官方钉死在仅本机可用，但同网设备仍能使用会话和工具执行。只在可信网络开启；公共 Wi-Fi 下删掉补丁重启即可恢复。

## 手机的正确用法：配对，不是直接开桌面版

**不要用手机浏览器直接打开桌面版界面**——桌面版启动时依赖的特权接口（读取设置、发现模型等）仅本机回环可用，手机打开会永远卡在"正在加载工作区"。这是官方的安全设计，不是 bug。

正确姿势（需要 [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) 的移动端远程插件）：

1. 电脑浏览器打开 `http://127.0.0.1:3080`，点侧边栏底部的手机图标；
2. 生成二维码，手机扫码（或复制链接）进入**移动端专用界面**；
3. 公网使用：面板里开启 cloudflared 隧道即可（quick tunnel 不透传 SSE，会自动降级轮询，消息晚几秒但能用）。

## 社区插件

```bat
rem 皮肤+功能全家桶（任务看板/Git 图谱/皮肤中心/移动端远程/SSH 面板等）
pnpm dsh plugin --profile web add @linxin666/dsh-web-all

rem Mnemon 记忆系统（另外还需要装 Mnemon CLI 本体，见下）
pnpm dsh plugin --profile web add dsh-mnemon

rem dsh-TUI 终端界面（Claude Code 风格，装进独立的 dsh-tui profile）
pnpm dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui

rem dsh-codex（ChatGPT 订阅登录用 Codex 模型，无需 OpenAI API key；境外服务，需代理，见下）
pnpm dsh plugin --profile web add dsh-codex

rem dsh-reasoning-effort（输入框下方的推理强度滑块 + 模型入口；git 源，仓库自带编译产物，
rem pnpm 拦构建脚本不影响；未发 npm，只能用 github: 地址装）
pnpm dsh plugin --profile web add github:HanaAyane/dsh-reasoning-effort#main
```

本地开发／补丁版 `dsh-codex` 可先在插件 checkout 中运行 `pnpm install && pnpm run build`，再安装链接：

```bat
pnpm dsh plugin --profile web add link:H:\path\to\dsh-codex
```

此后 `update.bat` 会识别 profile 中的非 npm 来源并保留该链接；要恢复 npm 正式版，执行 `pnpm dsh plugin --profile web add dsh-codex`。

装完 dsh-TUI 后用 `start-tui.bat` 启动（等价于 `dsh --profile dsh-tui`），`--resume` 恢复上次会话。

> ⚠️ **社区面板里的 dsh-TUI 安装命令用的是 GitHub 仓库地址，不要用**——该仓库的
> `files` 字段不含 `scripts/`，git 安装方式会因 prepare 脚本缺失而构建失败。npm
> 注册表包自带编译产物，请用上面的命令。若版本被 pnpm 11 年龄门禁拦住，把
> `'@deepseek-harness-tui/dsh-tui'` 加进 dsh-tui profile 的 `minimumReleaseAgeExclude`。

Mnemon CLI（Windows，插件自动发现该路径，无需配 PATH）：

```powershell
$version = '0.2.3'
Invoke-WebRequest "https://github.com/mnemon-dev/mnemon/releases/download/v$version/mnemon_${version}_windows_amd64.zip" -OutFile "$env:TEMP\mnemon.zip"
Expand-Archive "$env:TEMP\mnemon.zip" -DestinationPath "$env:LOCALAPPDATA\Programs\mnemon" -Force
```

## 排障 FAQ

**DSH 突然退出，日志在哪里？**
通过 `start.bat` 启动时看 `%LOCALAPPDATA%\DeepSeekHarness\logs\dsh-web-latest.txt`，再打开它指向的 `.log`。日志尾部正常会有 `[stop] ... exitCode=...`；若该行缺失，通常表示启动窗口、PowerShell wrapper 或整台机器被强制结束。Windows 原生崩溃还可检查事件查看器和 `%LOCALAPPDATA%\CrashDumps`。

**日志出现 `node-pty` / `AttachConsole failed`？**
这是 `node-pty@1.1.0` 在 Windows 清理 ConPTY 进程树时的已知问题（见 [DSH-better-sidebar #140](https://github.com/omdsh-dev/DSH-better-sidebar/issues/140)）：辅助子进程附加不到伪控制台时会抛出未捕获异常。`start.bat` 会在每次启动前幂等修补 `lib` 与 `src` agent，让失败降级为仅清理 shell PID；社区插件更新覆盖 `node_modules` 后，下次启动会自动重新应用。

**双击 bat 闪退/报一堆"不是内部或外部命令"？**
文件编码或换行被改了。cmd 需要 GBK 编码 + CRLF 换行；UTF-8 的中文会在 GBK 控制台里乱码并吃掉相邻引号，LF 换行会让 `if (...)` 多行块和 `goto` 标签解析错乱。用本仓库原始分发的文件，不要用编辑器"另存为 UTF-8"。

**bat 里调用 pnpm 后脚本直接结束？**
Windows 上 pnpm 是 `pnpm.CMD` 批处理包装器，bat 里调用必须加 `call`（如 `call pnpm install`），否则控制流不返回。

**pnpm 11 报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`？**
`update.bat` 会调用 `update-profile-policies.ps1`，仅为它明确维护的社区插件作用域配置发布时间门禁排除项；其他未知包仍受保护。手动维护 profile 时，可在对应 `pnpm-workspace.yaml`（`%USERPROFILE%\.dsh\profiles\<profile>\`）加入：

```yaml
minimumReleaseAgeExclude:
  - '@linxin666/*'
  - '@morlay/*'
  - 'dsh-mnemon'
  - 'dsh-codex'
  - '@deepseek-harness-tui/dsh-tui'
```

**cloudflared 隧道不可用 / 提示缺二进制？**
pnpm 10+ 默认拦截依赖的构建脚本，cloudflared 的二进制下载被拦。在 profile 的 `pnpm-workspace.yaml` 加：

```yaml
allowBuilds:
  cloudflared: true
```

然后到 profile 目录执行 `pnpm rebuild cloudflared`；或者直接从 [cloudflared releases](https://github.com/cloudflare/cloudflared/releases/latest) 下载 `cloudflared-windows-amd64.exe` 放到 `%USERPROFILE%\.dsh\profiles\web\node_modules\cloudflared\bin\cloudflared.exe`。

**手机能打开页面但加载不出工作区？**
你打开的是桌面版界面（见"手机的正确用法"）。去电脑端配对面板扫码，用移动端界面。

**端口被占用 / 重复启动报 EADDRINUSE？**
不需要手动处理：`start.bat` 启动前会调用 `clear-port.ps1` 自动结束占用端口的监听进程（僵留的 dsh web 实例等），再全新启动。清理是按端口动态解析 PID 的，不假定任何进程名。

**报 ERR_MODULE_NOT_FOUND / Cannot find package '@linxin666/dsh-client-ui-skin-xxx'，dsh web 直接起不来？**
这是皮肤中心 v1 → v2 升级遗留问题：v2 起皮肤已全部内置进 `@linxin666/dsh-client-ui-skin-center`（纯资产目录，不再有独立皮肤包），而旧版留下的两类痕迹会拖垮启动图——
1. profile `node_modules` 里的 `dsh-client-ui-skin-*` 符号链接指向已不存在的 `dsh-skins/skins/*`（死链）；
2. 全局补丁层 `%USERPROFILE%\.dsh\cordis.patch.yml` 里的 `dsh-skin managed` 段仍引用这些死包名。

修复：先跑一遍 `link-skins.ps1` 删除全部死链接，再备份并编辑 `%USERPROFILE%\.dsh\cordis.patch.yml`，把 `# --- dsh-skin managed ... # --- end dsh-skin managed ---` 整段删掉（没有其他补丁项的话整个文件写成 `[]`）。重启后新版皮肤中心会在 设置 → 皮肤中心 里提供全部内置皮肤，重新应用即可；新机制不再改写补丁层、不再需要 junction，其他 profile 也不会再受影响。

**dsh-codex 怎么登录？**
双击 `login-codex.bat`（设备码方式，最稳）：终端会显示一个授权网址和一串码，浏览器打开网址输入码即可。**登录前请先把梯子（v2rayN 等）切到"全局代理"模式**——授权页 `auth.openai.com` 走 Cloudflare，"绕过大陆"类规则会把它误判为直连，用大陆 IP 访问会报 `unsupported_country_region_territory`。**网页显示登录成功后就可以切回普通模式了**：凭据已落盘（`~/.dsh/.openai-codex-auth.json`，token 自动刷新），浏览器不再参与；之后日常使用只要梯子应用保持运行，`start.bat` / `start-tui.bat` 会自动把本地代理注入 dsh 进程，无需全局模式。注意不要在 dsh web 设置面板里点"使用 ChatGPT 登录"——那条浏览器回调路径（localhost:1455）在部分环境下接不住回调，设备码方式没有这个问题。

**dsh-codex 连不上 / 模型请求失败？**
dsh-codex 走的是 ChatGPT 后端（境外服务），而插件和 pi-ai 都裸用 Node 全局 `fetch()`，**不读** `HTTP(S)_PROXY` 环境变量。解法已内置进 `start.bat` / `start-tui.bat`：利用 Node 24.5+ 的 `NODE_USE_ENV_PROXY=1` 让内置 undici fetch 遵循代理环境变量，脚本会自动探测 `127.0.0.1:10808 → 10809` 并设置，同时用 `NO_PROXY=localhost,127.0.0.1,api.deepseek.com` 把回环和 DeepSeek API 排除在代理之外。代理不在默认端口时先 `set DSH_PROXY=http://127.0.0.1:7890` 再运行脚本。两个注意点：Node 版本需 ≥ 24.5（`node -v` 确认）；在 dsh 设置面板里登录即可（面板运行在已被脚本注入代理环境的 dsh web 进程里），若要用 `dsh plugin exec dsh-openai-codex login` 命令行登录，需先手动 `set NODE_USE_ENV_PROXY=1` 和 `set HTTPS_PROXY=...`。

**Codex 已经能用 GPT-6，DSH 却找不到新模型？**

旧版 dsh-codex 只使用随包模型名单。本启动器会把 Codex 模型缓存路径传给支持缓存发现的插件版本：优先保留 `DSH_CODEX_MODELS_CACHE`，否则使用 `%CODEX_HOME%\models_cache.json`，未设置 `CODEX_HOME` 时使用 `%USERPROFILE%\.codex\models_cache.json`。Web/TUI 启动时都会打印来源；缓存不存在时继续使用插件随包目录。

先更新并打开一次 Codex CLI/Desktop，使其刷新模型缓存，再更新并构建 dsh-codex。使用 `link:` 的开发版本需要在对应 checkout 中更新代码并运行 `pnpm install`、`pnpm run build`；`update.bat` 会保留本地链接，因此不会替你拉取或编译它。重启 DSH 后，在 **设置 → OpenAI Codex** 中启用新模型；原有的模型勾选会保留。只有支持缓存发现的插件版本才会读取该环境变量，单独更新启动器不能补齐旧插件的模型目录。

自定义缓存文件可在启动前执行：

```bat
set "DSH_CODEX_MODELS_CACHE=D:\Codex Data\models_cache.json"
start.bat
```

启动器不修改 Codex 登录凭据或缓存。从一键脚本目录启动已安装的 `deepseek-harness` 子目录时，Web 启动器会使用入口旁的最新版助手，并显式传入 DSH 源码目录，避免继续执行子目录里旧的助手脚本。

**管理面板提示「缺少管理页 UI（dsh-x\public\index.html）」？**
面板的界面来自上游 DSH-X，由 `update-panel.ps1` 拉到脚本旁边的 `dsh-x\`。双击一次 `update.bat` 即可（那是它的第 7 步）；只想单独拉：`powershell -NoProfile -ExecutionPolicy Bypass -File update-panel.ps1`。若 `dsh-x\` 里有过人工改动，脚本会保留现状、跳过版本切换。

**管理页里点「更新 / 卸载」，或者想让面板自己更新？**
源码模式没有这些入口：卸载按钮被界面覆盖层藏掉，更新按钮本来就不会出现；万一被点到，接口会明确回一句「版本由 update.bat 管理」。面板也不自更新——升级面板本体就是更新本仓库（`git pull` 后重跑 `update.bat`）。

**面板和 start.bat 能同时用吗？**
端口只有一份，两个入口会互相顶掉：面板在启动 dsh 之前会按端口清掉僵留实例（复用 `clear-port.ps1`），所以先跑 `start.bat` 占着 3080、再双击 `start-panel.bat`，会把那个实例结束掉、换成面板管的那个；反过来面板正在跑时点 `start.bat`，也会把面板管的 dsh 结束（面板的状态会跟着变成已停止）。同一时间只用一个入口最省心。

**面板上出现了「安装 / 卸载」这类用不了的按钮，或者日志里说「上游 UI 结构可能有变」？**
说明上游 DSH-X 的界面改了结构（比如换了元素 id / 文案），我们的覆盖层没能完全接上。日志里会点名找不到的锚点；把界面钉回上一个确认过的版本即可：`set DSHX_REF=v0.1.13` 后再跑 `update.bat`（标签、分支、提交号都认）。覆盖层本身是「找不到就跳过」的，不会把页面改坏。

**为什么面板日志里只有 `[compat] 会话事件兼容: 事件词汇表` 这一半？**
上游这份兼容补丁有两处：主线程那份（`dsh-session` 等模块的词汇表）由 `panel-hooks*.mjs` 映射后生效；worker 线程那份是内联在打包文件里的，靠 `NODE_OPTIONS=--require` 拦 fs 读取、按包名匹配 `dsh-session-persistence-jsonl`，源码布局下够不到，因此在源码模式里不生效。它的作用只是让「插件写了自定义事件类型的旧会话」还能被读出来，不影响启动和正常使用。

**面板窗口为什么没有系统标题栏？我想让它回到浏览器标签页。**
面板页装在自建的**无边框原生窗口**里（`panel-window\`，Rust + tao/wry，和 DSH-X 同一套库）：没有系统标题栏，标题栏与最小化/最大化/关闭都由页面自己画，尺寸 1100×760 逻辑像素。想回到普通浏览器窗口：`set DSH_PANEL_WINDOW=system` 后再运行 `start-panel.bat`（写进用户环境变量可以长期生效）；此时退回浏览器的「应用模式」窗口，没有 Edge/Chrome 时再退回系统默认浏览器，日志里都会写一条说明。dsh 网页本身一直走浏览器的应用模式窗口（那一页没有自画标题栏）。

**关掉面板窗口后，dsh 还在跑吗？怎么再打开窗口？**
✕ / Alt+F4 **只是关窗口**：面板和 dsh 继续在控制台里跑（日志也照写）。再双击一次 `start-panel.bat` 就会把窗口叫回来——已经关了会重开一个，还开着就把它叫到最前。要彻底退出：关掉那个控制台窗口（或 Ctrl+C），dsh 会一起停。

**日志说「没找到 panel-window.exe」/「窗口壳编译失败」？**
窗口壳要 Rust 工具链（`cargo`）编译：`update.bat` 的第 8 步会做（首次要下依赖、编 wry/tao，慢几分钟；之后增量一两秒），也可以单独跑 `build-panel-window.ps1`。没装 Rust 或编译失败都不影响使用——面板会退回浏览器的独立窗口，功能一样。

**点「更新」图标后会做什么？会不会打断我正在干的活？**
它跑的就是 `update.bat`（DSH 源码切到钉的版本并重建 + 更新社区插件 + 拉/切面板 UI），所以会**先停掉 dsh**——正在跑的会话会被中断；成功后自动把 dsh 重新拉起，失败就保持在停止状态，完整输出都在「日志」页里。整个过程几分钟，期间卡片里的按钮是禁用的，进度条读的是 update.bat 的真实输出（解析依赖数 / 已构建的包数 / 已编译的 crate 数），没有可数输出的阶段会报「当前步骤 + 已用时长」。另外：更新日志里 pnpm 的个别符号（如 ✓）可能显示成乱码，那是 cmd（GBK）与 node（UTF-8）的输出编码差异，不影响更新结果。

## 许可证

[MIT](LICENSE)
