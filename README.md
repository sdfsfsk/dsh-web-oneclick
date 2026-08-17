# dsh-web-oneclick

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的 Windows 一键脚本与局域网/公网开放配置。双击即用，不用记命令。

> 适用对象：从源码运行 DSH（`git clone` + `pnpm install` + `pnpm run build`）的 Windows 用户。中文 Windows（GBK 控制台）实测通过。

## 包含内容

| 文件 | 作用 |
| --- | --- |
| `install.bat` | 一键安装：走本地代理 `git clone` deepseek-harness 源码到当前目录 → 把一键脚本复制进仓库根目录 → `pnpm install` + `pnpm run build` |
| `start.bat` | 一键启动 Web GUI：自动清理端口占用（僵留实例直接结束再启动，按端口动态解析 PID、不假定进程名），探测并显示局域网访问地址，自动打开浏览器 |
| `start-tui.bat` | 一键启动终端 TUI（dsh-TUI 插件，Claude Code 风格全屏交互终端）：`start-tui.bat --resume` 恢复上次会话 |
| `update.bat` | 一键更新：探测本地代理 → `git pull --ff-only` → `pnpm install` → `pnpm run build` → 更新社区插件（web 与 dsh-tui 两个 profile） → 更新 Mnemon CLI |
| `update-mnemon.ps1` | Mnemon CLI 更新助手（查最新 release、SHA256 校验、解压安装），由 update.bat 调用 |
| `get-lan-ip.ps1` | 局域网 IP 探测助手，由 start.bat 调用 |
| `link-skins.ps1` | 多 profile 皮肤兼容：把 web profile 的独立皮肤包 junction 进全局模块回退目录，修复 dsh-tui 等 profile 应用皮肤后无法启动的问题 |
| `clear-port.ps1` | 端口清理助手，由 start.bat 调用：结束占用启动端口的监听进程并确认释放（按端口动态解析 PID，不假定进程名） |
| `examples/cordis.patch.yml` | 局域网开放补丁（把 dsh web 绑定到 0.0.0.0），手机/平板访问的关键 |

## 快速开始

1. 下载本仓库（ZIP 或 clone），双击 `install.bat`：自动探测本地代理（10808 → 10809，也可 `install.bat 7890` 手动指定），克隆 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码到 `deepseek-harness/` 目录，复制一键脚本进仓库根目录，并完成 `pnpm install` + `pnpm run build`。
2. 进入 `deepseek-harness/` 目录，双击 `start.bat` 启动；想更新时双击 `update.bat`。

已经按官方文档装好 DSH 源码环境（确认 `pnpm dsh web` 能正常启动）的，跳过 `install.bat`：把本仓库所有 `.bat` 和 `.ps1` 复制到 deepseek-harness **仓库根目录**（和 `package.json` 同级）即可。

注意：批处理文件必须是 **GBK 编码 + CRLF 换行** 才能在中文 Windows 的 cmd 里正常工作（本仓库已按此分发，直接下载 ZIP 或 clone 即可；不要另存为 UTF-8，详见下方 FAQ）。

## update.bat 细节

- **代理**：默认探测本地 HTTP 代理 `127.0.0.1:10808` → `10809`（v2rayN 默认端口），也可以手动指定：`update.bat 7890`（Clash 默认端口）。代理环境变量只在脚本进程内生效。`install.bat` 的代理探测逻辑与此相同。
- **社区插件自动更新**：默认更新 web profile 的 `@linxin666/dsh-web-ui-all`、`dsh-mnemon` 和 dsh-tui profile 的 `@deepseek-harness-tui/dsh-tui`（见下方"社区插件"）。没装插件时这一步会报警告但不影响本体更新；装别的插件就自己改这两行。
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
pnpm dsh plugin --profile web add @linxin666/dsh-web-ui-all

rem Mnemon 记忆系统（另外还需要装 Mnemon CLI 本体，见下）
pnpm dsh plugin --profile web add dsh-mnemon

rem dsh-TUI 终端界面（Claude Code 风格，装进独立的 dsh-tui profile）
pnpm dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
```

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

**双击 bat 闪退/报一堆"不是内部或外部命令"？**
文件编码或换行被改了。cmd 需要 GBK 编码 + CRLF 换行；UTF-8 的中文会在 GBK 控制台里乱码并吃掉相邻引号，LF 换行会让 `if (...)` 多行块和 `goto` 标签解析错乱。用本仓库原始分发的文件，不要用编辑器"另存为 UTF-8"。

**bat 里调用 pnpm 后脚本直接结束？**
Windows 上 pnpm 是 `pnpm.CMD` 批处理包装器，bat 里调用必须加 `call`（如 `call pnpm install`），否则控制流不返回。

**pnpm 11 装到的插件版本偏旧？**
pnpm 11 的发布年龄门禁会静默隔离刚发布的版本。在对应 profile 的 `pnpm-workspace.yaml`（`%USERPROFILE%\.dsh\profiles\<profile>\`）加：

```yaml
minimumReleaseAgeExclude:
  - '@linxin666/*'
  - 'dsh-mnemon'
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

**dsh-tui 等其他 profile 报 ERR_MODULE_NOT_FOUND / Cannot find package '@linxin666/dsh-client-ui-skin-xxx'？**
皮肤中心把"当前应用的独立皮肤"以包名写进**全局**补丁层（`%USERPROFILE%\.dsh\cordis.patch.yml`），所有 profile 启动时都会加载它；没装皮肤包的 profile 就会启动失败。注意不要把皮肤包直接装进那些 profile——它们会被当作 bundle 挂载，与全局插入产生 `duplicate loader entry id` 冲突。正确解法是跑一遍 `link-skins.ps1`：把皮肤包以 junction 形式放进启动器的全局模块回退目录（`profiles/node_modules`），能解析、不挂载、不冲突，且皮肤更新后无需重跑。

## 许可证

[MIT](LICENSE)
