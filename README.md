# dsh-web-oneclick

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的 Windows 一键脚本与局域网/公网开放配置。双击即用，不用记命令。

> 适用对象：从源码运行 DSH（`git clone` + `pnpm install` + `pnpm run build`）的 Windows 用户。中文 Windows（GBK 控制台）实测通过。

## 包含内容

| 文件 | 作用 |
| --- | --- |
| `start.bat` | 一键启动 Web GUI：自动清理端口占用（僵留实例直接结束再启动，按端口动态解析 PID、不假定进程名），探测本地代理并让 Node 全局 fetch 走代理（dsh-codex 等境外插件需要），探测并显示局域网访问地址，自动打开浏览器，同时把控制台输出持久化到 `%LOCALAPPDATA%\DeepSeekHarness\logs` |
| `start-web.ps1` | Web 启动与日志助手：控制台和 UTF-8 日志双写，记录启动/退出时间与退出码，维护 `dsh-web-latest.txt` 并保留最近 20 份日志 |
| `start-tui.bat` | 一键启动终端 TUI（dsh-TUI 插件，Claude Code 风格全屏交互终端）：`start-tui.bat --resume` 恢复上次会话；同样自动接入本地代理 |
| `update.bat` | 一键更新：探测本地代理 → 切换到兼容的 DSH 标签 → `pnpm install` → 清理并构建 → 更新社区插件（web 与 dsh-tui 两个 profile，含 dsh-codex、dsh-reasoning-effort） → 更新 Mnemon CLI。首次运行找不到 DSH 源码时自动转为安装：`git clone` → 复制一键脚本进仓库根目录 → 构建 |
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

已经按官方文档装好 DSH 源码环境（确认 `pnpm dsh web` 能正常启动）的：把本仓库所有 `.bat` 和 `.ps1` 复制到 deepseek-harness **仓库根目录**（和 `package.json` 同级）即可，`update.bat` 会直接更新当前仓库。

每次通过 `start.bat` 启动都会在 `%LOCALAPPDATA%\DeepSeekHarness\logs` 创建 `dsh-web-YYYYMMDD-HHmmss.log`，`dsh-web-latest.txt` 指向最近一份；最多保留 20 份。日志可能包含本机路径、错误详情和插件输出，不要直接公开分享完整文件。

注意：批处理文件必须是 **GBK 编码 + CRLF 换行** 才能在中文 Windows 的 cmd 里正常工作（本仓库已按此分发，直接下载 ZIP 或 clone 即可；不要另存为 UTF-8，详见下方 FAQ）。

## update.bat 细节

- **代理**：默认探测本地 HTTP 代理 `127.0.0.1:10808` → `10809`（v2rayN 默认端口），也可以手动指定：`update.bat 7890`（Clash 默认端口）。代理环境变量只在脚本进程内生效。
- **首次运行自动安装**：当前目录不是 DSH 仓库、且 `deepseek-harness\` 子目录也没有源码时，`update.bat` 会自动 `git clone` 安装并构建（全新安装只构建本体，社区插件与 Mnemon 按下方说明另行安装）；已克隆过则自动进入 `deepseek-harness\` 目录执行更新。
- **社区插件自动更新**：默认更新 web profile 的 `@linxin666/dsh-web-all`、`dsh-mnemon`、`dsh-codex` 和 dsh-tui profile 的 `@deepseek-harness-tui/dsh-tui`（见下方“社区插件”）。`dsh-codex` 若使用 `link:`、`file:` 或 Git 来源，脚本会保留该本地／开发补丁，不会改回 npm；没装插件时这一步会报警告但不影响本体更新。
- **Mnemon CLI 自动更新**：仅当你的 web profile 装了 `dsh-mnemon` 记忆插件才有意义；CLI 本体装在 `%LOCALAPPDATA%\Programs\mnemon`。

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

## 许可证

[MIT](LICENSE)
