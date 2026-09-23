#!/usr/bin/env node
/**
 * DSH 管理面板（dsh-web-oneclick）—— 后端服务。
 *
 * 界面（public/ 那一页）与插件开关（plugins.js）是 DSH-X（yyh-001/DSH-X）的，
 * 由 update.bat 拉到旁边的 dsh-x\ 里，运行时引用、不复制、不修改——上游更新只需切标签。
 *
 * 与 DSH-X 的关键区别：**这里不按版本从 npm 装 dsh**。本仓库的玩法是「源码 checkout
 * + update.bat 构建」，所以「版本」收敛成唯一一条：就是这个 checkout 自己。因此：
 *   - /api/state 的 installed 永远只有一条（checkout 的 package.json 版本号）；
 *   - /api/remote 返回空版本表 → 管理页不会出现「安装 / 更新 / 卸载」入口；
 *   - 启动命令是 node --import <dsh-x 的钩子> <checkout>/apps/cli/lib/bin.js --profile ...
 *     （**必须用 --profile**：dsh 的根命令只收 [args...]，profile 不是位置参数）
 *   - 不传 --host：profile 补丁层里的 0.0.0.0（局域网开放）才不被覆盖，端口也一律以
 *     dsh 自己打印的就绪 URL 为准；
 *   - 不碰用户的 profile（不写 .npmrc / pnpm-workspace.yaml），供应链策略仍归
 *     update-profile-policies.ps1 管。
 *
 * 文件放在 harness 根目录（与 start-panel.bat、dsh-x\ 同级）；扩展名用 .mjs 是因为
 * 它也可能先落在启动器仓库根（那里没有 package.json，`.js` 会被当成 CommonJS）。
 */
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 插件开关（启停、兼容模式认失败插件）来自上游 dsh-x\plugins.js：它只依赖 profile 目录，
 * 与「版本从哪来」无关，所以源码模式照样能用。
 *
 * 这里用动态导入而不是顶层 import：dsh-x 还没拉下来时（没跑过 update.bat）顶层 import 会
 * 直接让整个面板进程崩掉，连一句「请先运行 update.bat」都说不出来。缺了就退化成空实现，
 * 插件页显示空清单、兼容模式不动手，其余功能照常。
 */
const PLUGINS_MISSING = '插件功能来自 dsh-x（管理页 UI 与插件开关），请先运行 update.bat 把它拉下来'
const pluginApi = await import('./dsh-x/plugins.js').catch(() => null)
const requirePluginApi = () => {
  throw new Error(PLUGINS_MISSING)
}
const disableRowId = (...args) => (pluginApi?.disableRowId ?? requirePluginApi)(...args)
const listPlugins = (...args) => (pluginApi?.listPlugins ?? requirePluginApi)(...args)
const setPluginEnabled = (...args) => (pluginApi?.setPluginEnabled ?? requirePluginApi)(...args)
// 兼容模式用的这三个认不出就当作「没线索」，不是错误
const ownerOfRow = (...args) => (pluginApi?.ownerOfRow ? pluginApi.ownerOfRow(...args) : '')
const parseFailedRows = (...args) => (pluginApi?.parseFailedRows ? pluginApi.parseFailedRows(...args) : [])
const pluginsNamedInFailure = (...args) => (pluginApi?.pluginsNamedInFailure ? pluginApi.pluginsNamedInFailure(...args) : [])

const ROOT = dirname(fileURLToPath(import.meta.url))
/** DSH-X 的 clone：UI（public/）、插件开关（plugins.js）、两个 Node 加载钩子都从这儿取。 */
const UI_ROOT = join(ROOT, 'dsh-x')
const PUBLIC = join(UI_ROOT, 'public')
const PANEL_VERSION = '1.0.0'
const DEFAULT_PORT = 3780
/** 配置的面板端口被别的程序占用时，往后最多试这么多个。 */
const PORT_SCAN = 20
const READY_RE = /dsh web:\s+(https?:\/\/[^\s]+)/
const START_TIMEOUT_MS = 120_000
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/
/** 计步类噪音行不进 manager.log（管理页的日志区仍然看得到）。 */
const NOISY_LOG_RE = /^(?:已安装 \d+\/\d+|已解析 \d+)/
/** 需要在日志里打码的敏感串（dsh 的凭据常出现在子进程输出里）。 */
const SECRET_RE = /\b(sk|ak)-[A-Za-z0-9_-]{8,}/g

const LOCALAPPDATA = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
const LOG_DIR = join(LOCALAPPDATA, 'DeepSeekHarness', 'logs')
const LOG_FILE = join(LOG_DIR, 'dsh-panel-manager.log')
const LOG_MAX_BYTES = 5 * 1024 * 1024
const SETTINGS_DIR = join(LOCALAPPDATA, 'DeepSeekHarness', 'panel')
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

// ---- 设置（存 %LOCALAPPDATA%\DeepSeekHarness\panel，与 DSH-X 的 %APPDATA%\DSH 隔离）--

const DEFAULT_PROFILE = 'web'
const DEFAULTS = {
  /** DSH 源码目录（空 = 自动定位：环境变量 → 脚本所在目录 → 旁边的 deepseek-harness\）。 */
  dataDir: '',
  /** 管理页自己的端口，重启面板后生效。 */
  port: DEFAULT_PORT,
  profile: DEFAULT_PROFILE,
  /** 附加给 dsh 的启动参数（原文回显，解析后拼在命令行末尾）。 */
  args: '',
  lang: '',
  theme: 'system',
  panelTransparency: 1,
  reduceMotion: false,
  hideBackground: false,
  hideBigFish: false,
  autoDisablePlugins: true,
}

function safePort(value, fallback = DEFAULT_PORT) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

function safeProfile(value) {
  const name = String(value ?? '').trim()
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : DEFAULT_PROFILE
}

function safeLang(value) {
  return value === 'zh' || value === 'en' ? value : ''
}

function safeTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function safePanelTransparency(value) {
  const level = Number(value)
  return Number.isFinite(level) && level >= 0 && level <= 1 ? level : 1
}

function safeArgs(value) {
  return String(value ?? '')
}

/** 启动参数按空格分词，双引号里的空格保号（与用户填的原文一致）。 */
function parseArgs(text) {
  const found = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = re.exec(String(text ?? '')))) found.push(match[1] ?? match[2] ?? match[3])
  return found
}

function loadSettingsSync() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

async function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch }
  await mkdir(SETTINGS_DIR, { recursive: true })
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2))
  return next
}

function homeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function profileDir() {
  return join(homeDir(), 'profiles', PROFILE_NAME)
}

/** dsh 的 profile 模板名（@deepseek-ai/dsh-app-boot 的 PROFILE_TEMPLATES），首次使用自动初始化。 */
const TEMPLATE_PROFILES = ['web', 'headless', 'acp', 'sdk', 'sdk-minimal']

/** 可切换的 profile：磁盘上已初始化的 + 模板名 + 当前值。 */
function listProfiles() {
  const names = new Set(TEMPLATE_PROFILES)
  const root = join(homeDir(), 'profiles')
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      if (existsSync(join(root, entry.name, 'package.json'))) names.add(entry.name)
    }
  } catch {
    // 还没有 profiles 目录
  }
  if (PROFILE_NAME) names.add(PROFILE_NAME)
  return [...names].sort()
}

// ---- 运行时状态 -----------------------------------------------------------

/** dsh 网页端口（start-panel.bat 的 [端口] 参数经环境变量传进来）。 */
const WEB_PORT = safePort(process.env.DSH_PANEL_WEB_PORT || 3080, 3080)
/** 源码读不到版本号时的占位：installed 不能为空，否则管理页会一直停在「正在读取版本…」。 */
const UNKNOWN_VERSION = '0.0.0-unknown'

const clients = new Set()
const logs = []
const storedAtBoot = { ...DEFAULTS, ...loadSettingsSync() }
let current = null
let server = null
let PORT = DEFAULT_PORT
/** DSH 源码 checkout：startServer() 里按「环境变量 → 设置 → 脚本所在目录」定值。 */
let REPO = ROOT
let PROFILE_NAME = safeProfile(storedAtBoot.profile)
let EXTRA_ARGS = parseArgs(storedAtBoot.args)
let LANG = safeLang(storedAtBoot.lang) || 'zh'
let THEME = safeTheme(storedAtBoot.theme)
let PANEL_TRANSPARENCY = safePanelTransparency(storedAtBoot.panelTransparency)
let REDUCE_MOTION = storedAtBoot.reduceMotion === true
let HIDE_BACKGROUND = storedAtBoot.hideBackground === true
let HIDE_BIG_FISH = storedAtBoot.hideBigFish === true
/** 最近一次启动失败的上下文（错误 + 子进程输出尾巴），兼容模式靠它认插件。 */
let lastFailure = null
/** 最近一次启动后的页面自检结果（客户端插件包是否都拉得动）。 */
let lastHealth = null
/** 最近一次按错误自动禁用的插件（管理页显示）。 */
let lastAutoFix = null
/** 一次启动尝试里最多自动禁用几个插件（避免连环禁用不可收拾）。 */
const MAX_AUTO_DISABLE = 3
/** 上游 UI 结构断言只提示一次。 */
let uiDriftChecked = false
let host = { onWake: async () => {} }

function errMsg(error) {
  return error instanceof Error ? error.message : String(error)
}

function redact(text) {
  return String(text ?? '').replace(SECRET_RE, '$1-***')
}

// ---- DSH 源码 checkout ----------------------------------------------------

function looksLikeDshRepo(dir) {
  return Boolean(dir)
    && existsSync(join(dir, 'package.json'))
    && existsSync(join(dir, 'apps', 'cli', 'package.json'))
}

/** 环境变量（start-panel.bat 定位好的）→ 设置里存过的 → 脚本所在目录 → 旁边的 deepseek-harness\。 */
function resolveSourceRepo(stored) {
  const candidates = [process.env.DSH_PANEL_REPO, stored.dataDir, ROOT, join(ROOT, 'deepseek-harness')]
  for (const item of candidates) {
    if (!item) continue
    const dir = resolve(String(item))
    if (looksLikeDshRepo(dir)) return dir
  }
  return resolve(String(process.env.DSH_PANEL_REPO || stored.dataDir || ROOT))
}

function cliBinPath() {
  return join(REPO, 'apps', 'cli', 'lib', 'bin.js')
}

/** checkout 的版本号：先看 apps/cli（就是 npm 上 @deepseek-ai/dsh 的那个包），再看根 package.json。 */
function readSourceVersion() {
  for (const file of [join(REPO, 'apps', 'cli', 'package.json'), join(REPO, 'package.json')]) {
    try {
      const version = String(JSON.parse(readFileSync(file, 'utf8')).version || '')
      if (VERSION_RE.test(version)) return version
    } catch {
      // 文件不在或读坏了就退到下一个来源
    }
  }
  return ''
}

function sourceVersion() {
  return readSourceVersion() || UNKNOWN_VERSION
}

function uiVersion() {
  try {
    return String(JSON.parse(readFileSync(join(UI_ROOT, 'package.json'), 'utf8')).version || '')
  } catch {
    return ''
  }
}

// ---- 日志 ----------------------------------------------------------------

/** 重要日志追加到 manager.log（进度类噪音行丢弃，超过 5MB 轮转一次，导出日志读它）。 */
function persistLog(text) {
  if (NOISY_LOG_RE.test(text)) return
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`)
  } catch {
    // 目录/轮转问题不阻塞启动流程
  }
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${text}\n`)
  } catch {
    // 落盘失败不阻塞
  }
}

function pushLog(line) {
  const text = redact(String(line).replace(/\s+$/, ''))
  if (!text) return
  logs.push(text)
  if (logs.length > 400) logs.splice(0, logs.length - 400)
  persistLog(text)
  // 控制台也留一份：start-panel.ps1 会把控制台输出落到 logs\dsh-panel-*.log，
  // 这样面板的日志和 dsh 的输出跟 start.bat 那套一样，事后都能翻到。
  console.log(text)
  emit('log', { line: text })
}

function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(payload)
}

// ---- dsh 子进程 ----------------------------------------------------------

/**
 * dsh 子进程的加载钩子：启动加速 + 会话事件词汇兼容。
 *
 * 钩子代码仍在上游 dsh-x\ 里（跟着我们钉的提交走），由同目录的 panel-hooks-register.mjs
 * 注册、panel-hooks.mjs 转交——那一层负责把源码 checkout 的模块路径映射回上游认得的
 * 包名标记，否则这两个钩子按 npm 安装布局写的匹配条件在源码模式下全部空转。 */
const HOOKS = [join(ROOT, 'panel-hooks-register.mjs')].filter((file) => existsSync(file))

/** 探一下本机某个端口有没有服务（用来兜底发现本地代理，不做真正的代理校验）。 */
function probeLocalPort(port, timeoutMs = 400) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (ok) => {
      socket.destroy()
      done(ok)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}

/**
 * 面板若不是由 start-panel.bat 拉起来的（比如从别的入口、或直接 node 跑），进程里就没有
 * 代理环境变量，dsh-codex 一类境外插件会连不上——这里按 10808 → 10809 兜一层。
 */
async function ensureChildProxy(env) {
  if (env.DSH_PROXY || env.HTTP_PROXY || env.HTTPS_PROXY || env.http_proxy || env.https_proxy) return
  for (const port of [10808, 10809]) {
    if (!(await probeLocalPort(port))) continue
    const proxy = `http://127.0.0.1:${port}`
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
    env.NODE_USE_ENV_PROXY = '1'
    if (!env.NO_PROXY) env.NO_PROXY = 'localhost,127.0.0.1,api.deepseek.com'
    pushLog(`[面板] 探测到本地代理 ${proxy}，已注入 dsh 子进程`)
    return
  }
}

/**
 * dsh 网页端口被僵留实例占着（上次没退干净的 dsh）时先清掉它再启动。
 *
 * 用仓库里已经维护着的 clear-port.ps1，而不是在这里重写一套 netstat/taskkill；位置与
 * start.bat 的用法一致（按端口动态解析 PID，不假定进程名）。**只在真要起 dsh 之前清**，
 * 所以不会误伤正在运行的面板实例和它管着的 dsh。
 */
async function ensureWebPortFree() {
  if (!(await probeLocalPort(WEB_PORT, 600))) return
  const script = join(ROOT, 'clear-port.ps1')
  if (!existsSync(script)) {
    pushLog(`端口 ${WEB_PORT} 被占用，但找不到 clear-port.ps1，直接尝试启动`)
    return
  }
  pushLog(`端口 ${WEB_PORT} 被占用，先按端口清理（clear-port.ps1）…`)
  await new Promise((done) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(WEB_PORT)],
      { windowsHide: true, timeout: 60_000 },
      (error) => {
        // 脚本自己的输出大概率是 GBK，读回来只会是乱码：成功了不转述，失败才说一句
        if (error) pushLog(`清理端口 ${WEB_PORT} 没成功：${errMsg(error)}（若 dsh 起不来，请手动结束占用该端口的进程）`)
        done()
      },
    )
  })
}

async function dshEnv() {
  const env = {
    ...process.env,
    DSH_HOME: homeDir(),
    DSH_PROFILE: PROFILE_NAME,
    // 浏览器里堆积的 cookie 会顶爆默认 16KB 的请求头上限（HTTP 431）；app 走系统证书库，
    // 否则挂了代理 / TUN（mihomo 之类）做 TLS 中间人时请求会以 transport failed 收场。
    NODE_OPTIONS: [
      '--use-system-ca',
      process.env.NODE_OPTIONS,
      '--max-http-header-size=131072',
    ].filter(Boolean).join(' '),
  }
  await ensureChildProxy(env)
  return env
}

/**
 * dsh 的启动参数。
 *
 * profile 用 `--profile` 显式给：根命令只收 [args...]，位置参数只有在名字恰好是 `web`
 * 时才命中子命令，换成别的 profile 会直接报 `--profile <name> is required`。
 * 不传 `--host`：CLI 本来就拒绝 0.0.0.0，而 profile 补丁层里的字面 host 才是局域网
 * 开放的关键——传什么都不如不传，让用户的补丁说了算。端口以 dsh 打印的就绪 URL 为准。
 */
function dshArgs() {
  return [
    ...HOOKS.flatMap((file) => ['--import', pathToFileURL(file).href]),
    cliBinPath(),
    '--profile', PROFILE_NAME,
    '--port', String(WEB_PORT),
    '--no-open',
    ...EXTRA_ARGS,
  ]
}

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 已经没了
  }
}

function attachProcess(version, child) {
  current = { version, child, status: 'starting', url: null, tail: [], exit: null }
  const proc = current
  const onChunk = (buf) => {
    const text = buf.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        proc.tail.push(line)
        if (proc.tail.length > 200) proc.tail.shift()
      }
      pushLog(line)
      const match = line.match(READY_RE)
      if (match && proc.status === 'starting') {
        proc.url = match[1]
        proc.status = 'running'
        void emitState()
      }
    }
  }
  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)
  child.on('exit', (code, signal) => {
    proc.exit = { code, signal }
    pushLog(`已退出 code=${code ?? '-'} signal=${signal ?? '-'}`)
    if (current?.child === child) {
      current = null
      lastHealth = null
    }
    void emitState()
  })
  return proc
}

async function waitUntilReady(proc, label) {
  const started = Date.now()
  while (proc.status === 'starting') {
    if (current !== proc) throw new Error(`${label} 启动失败`)
    if (Date.now() - started > START_TIMEOUT_MS) {
      killTree(proc.child.pid)
      throw new Error(`${label} 启动超时（${Math.round(START_TIMEOUT_MS / 1000)} 秒）`)
    }
    await new Promise((done) => setTimeout(done, 200))
  }
  if (!proc.url) throw new Error(`${label} 启动失败`)
  return { url: proc.url }
}

/** 起一个 dsh 子进程并等到它打印就绪 URL；失败时把输出尾巴留下来当证据。 */
async function bootOnce(label) {
  if (!looksLikeDshRepo(REPO)) {
    throw new Error(`找不到 DSH 源码目录：${REPO}；请先运行 update.bat 安装并构建，或在设置页里选对目录`)
  }
  if (!existsSync(cliBinPath())) {
    throw new Error(`DSH 源码还没构建出 apps/cli/lib/bin.js（${REPO}）；请先运行 update.bat（pnpm install + pnpm run build）`)
  }
  await mkdir(homeDir(), { recursive: true })
  await ensureWebPortFree()
  pushLog(`启动源码版 dsh · profile ${PROFILE_NAME} · 端口 ${WEB_PORT} · ${REPO}`)
  const child = spawn(process.execPath, dshArgs(), {
    cwd: REPO,
    env: await dshEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const proc = attachProcess(label, child)
  await emitState()
  try {
    const result = await waitUntilReady(proc, label)
    lastHealth = null
    await emitState()
    void selfCheckPage(result.url, label)
    return result
  } catch (error) {
    const failure = {
      at: Date.now(),
      version: label,
      message: errMsg(error),
      exit: proc.exit,
      tail: (proc.tail || []).slice(-120),
    }
    lastFailure = failure
    try {
      error.failure = failure
    } catch {
      // 非 Error 对象就算了
    }
    throw error
  }
}

async function startNow() {
  const label = sourceVersion()
  if (current && current.status === 'running' && current.url) return { url: current.url }
  if (current && current.status === 'starting') return waitUntilReady(current, label)
  if (current) await stop()
  return bootOnce(label)
}

/**
 * 兼容模式：启动输出点名了某个插件行加载失败时，把该行写进 profile 的 cordis.patch.yml。
 * 只信任错误的原始输出，官方组件不动。
 * @returns 是否改动了配置（改动后上层立刻重试启动）。
 */
async function autoDisableFailedPlugins(error, already) {
  const settings = await loadSettings()
  if (settings.autoDisablePlugins === false) return false
  const failure = error?.failure || lastFailure
  const text = `${failure?.message || ''}\n${(failure?.tail || []).join('\n')}`

  const tryDisable = async (id, name, note) => {
    try {
      const result = disableRowId(profileDir(), id)
      if (!result.changed) return false
      pushLog(`[兼容] ${note}，已写入 cordis.patch.yml 禁用「${id}」，重试启动…`)
      already.add(id)
      lastAutoFix = {
        at: Date.now(),
        version: failure?.version || null,
        plugins: [...(lastAutoFix?.plugins || []), { name, id }],
      }
      await emitState()
      return true
    } catch (inner) {
      pushLog(`[兼容] 自动禁用「${id}」失败：${errMsg(inner)}`)
      return false
    }
  }

  // 一、报错直接点名了某个加载行
  for (const row of parseFailedRows(text)) {
    if (already.has(row.id)) continue
    if (/^@deepseek-ai\//.test(row.pkg)) continue
    const owner = ownerOfRow(profileDir(), row.id)
    if (owner && /^@deepseek-ai\//.test(owner)) continue
    if (await tryDisable(row.id, row.pkg, `${row.pkg} 的加载行「${row.id}」加载失败`)) return true
  }

  // 二、形状解析没命中时换个方向：拿已装插件的名字去报错里找（根因常藏在 cause 里）
  for (const plugin of pluginsNamedInFailure(profileDir(), text)) {
    const id = plugin.ids.find((rowId) => !already.has(rowId))
    if (!id) continue
    if (await tryDisable(id, plugin.name, `报错点名了 ${plugin.name}`)) return true
  }
  return false
}

let startChain = Promise.resolve()

/** 启动（带兼容模式重试）；面板上点一下 ▶ 和启动时自动拉起都走这里。 */
async function start() {
  const run = startChain.then(async () => {
    if (updateRun?.running) throw new Error('正在跑 update.bat，等它跑完再启动 dsh')
    lastAutoFix = null
    const autoDisabled = new Set()
    let lastError
    for (;;) {
      try {
        return await startNow()
      } catch (error) {
        lastError = error
        pushLog(`启动失败：${errMsg(error)}`)
        if (autoDisabled.size < MAX_AUTO_DISABLE && await autoDisableFailedPlugins(error, autoDisabled)) continue
        break
      }
    }
    throw lastError
  })
  startChain = run.then(() => {}, () => {})
  return run
}

async function stop(version) {
  const proc = current
  if (!proc) return
  if (typeof version === 'string' && version && version !== proc.version) {
    throw new Error(`正在运行的是 ${proc.version}`)
  }
  proc.status = 'stopping'
  await emitState()
  const closed = new Promise((done) => proc.child.once('close', done))
  killTree(proc.child.pid)
  await Promise.race([closed, new Promise((done) => setTimeout(done, 5000))])
  if (current?.child === proc.child) current = null
  await emitState()
}

/** 管理页里的「重启」是 stop + start 两步；这里给 —— 唤起已有面板时顺手把 dsh 拉起来用。 */
async function launchInstalled() {
  if (current?.status === 'running' && current.url) return { version: sourceVersion(), url: current.url }
  const result = await start()
  return { version: sourceVersion(), url: result.url }
}

// ---- 自动更新（等同双击 update.bat） ---------------------------------------

/** update.bat 与面板脚本放在同一目录（update.bat 会把自己复制进 DSH 仓库根目录）。 */
const UPDATE_SCRIPT = join(ROOT, 'update.bat')
/** 最近一次更新的状态；管理页右上角的「自动更新」按钮读它。 */
let updateRun = null

function updateSnapshot() {
  return updateRun ? { ...updateRun } : null
}

/**
 * 管理页的进度条读 `installProgress`（上游那套：`phase` + `done`/`total`）。
 *
 * 我们喂的是 update.bat 的真实输出：
 *   - pnpm 的 `Progress: resolved N`（解析依赖）；
 *   - 构建时每个包一行 `✔ [包名] Build complete in Xms`（数得出来）；
 *   - 编译窗口壳时 cargo 的 `Compiling …`。
 * `done` 是这三类计数累加出来的**单调**值，所以进度条只前进不后退；`kind`/`count` 给文案用
 * （「已解析 N 个依赖」/「已构建 N 个包」），`step` 是没有计数可报的阶段显示的步骤名。
 */
let updateProgress = null

function setUpdateProgress(progress) {
  updateProgress = progress
  emit('progress', progress ?? { phase: 'idle' })
  void emitState()
}

/** 累计工作单元数（进度条的驱动值，单调）。 */
let updateUnits = 0
/** 当前这次 pnpm 报的解析数（每次调用从 1 重新开始，所以按增量累加）。 */
let lastResolved = 0
/** 当前阶段的计数单位与数量，以及没有计数可报时的步骤名。 */
let updateKind = ''
let updateCount = 0
let updateStep = ''
/** 当前步骤的开始时间、最近一次拿到真实计数的时间（算已用时长 / 判断要不要兜底）。 */
let updateStepStartedAt = 0
let updateCountedAt = 0
/** 兜底爬行累计（上限见 UPDATE_CREEP_MAX）。 */
let updateCreep = 0
/**
 * 兜底爬行的上限：DSH 是源码构建，`pnpm run build` 的客户端那一段（tsc + tsdown）要跑好几分钟
 * 且一行可数输出都没有，进度条会僵在那儿——用户看到的就是「卡住了」。这里最多补这么多单位
 * （在曲线上约合 60%），让条子一直有动静；**数字只报真实计数**，不谎报。
 */
const UPDATE_CREEP_MAX = 160
let updateCreepTimer = null

function pushUpdateProgress() {
  setUpdateProgress({
    // 借上游「按计数画曲线」那条路径（92*(1-e^(-done/220))）：单调、平滑、不会回跳
    phase: 'resolve',
    done: updateUnits,
    kind: updateKind,
    count: updateCount,
    step: updateStep,
    // 当前步骤已用时长（秒）：文案里带上它，长时间没计数的阶段也看得出在动
    elapsed: updateStepStartedAt ? Math.round((Date.now() - updateStepStartedAt) / 1000) : 0,
  })
}

/** 每 2 秒看一眼：这一阶段没有真实计数在流，就补一个兜底单位让进度条缓慢前进。 */
function startUpdateCreep() {
  stopUpdateCreep()
  updateCreepTimer = setInterval(() => {
    if (!updateRun?.running) {
      stopUpdateCreep()
      return
    }
    if (Date.now() - updateCountedAt < 4000) return
    if (updateCreep >= UPDATE_CREEP_MAX) return
    updateCreep += 1
    updateUnits += 1
    pushUpdateProgress()
  }, 2000)
}

function stopUpdateCreep() {
  if (updateCreepTimer) {
    clearInterval(updateCreepTimer)
    updateCreepTimer = null
  }
}

/**
 * cmd 的输出是控制台编码（中文 Windows 上是 GBK），跟 dsh 子进程那份 UTF-8 不一样；
 * 用流式解码器，免得一个汉字被拆到两个 chunk 里变成乱码。
 */
function consoleDecoder() {
  try {
    return new TextDecoder('gbk')
  } catch {
    return new TextDecoder('utf-8')
  }
}

/** 从 update.bat 的输出里认出可数的进度，喂给上面的进度条。 */
function trackUpdateProgress(line) {
  // 每个 [update] 步骤 = 新阶段：清掉上一个阶段的计数，文案退化成步骤名 + 已用时长
  const step = /^\[update\]\s*(.+)$/.exec(line.trim())
  if (step) {
    updateKind = ''
    updateCount = 0
    lastResolved = 0
    updateStep = step[1].replace(/\.\.\.$/, '').replace(/（[^）]*）$/, '')
    updateStepStartedAt = Date.now()
    updateCountedAt = Date.now()
    pushUpdateProgress()
    return
  }
  // pnpm：Progress: resolved 242, reused 15, downloaded 0, added 0, done
  const resolved = /Progress:\s*resolved\s+(\d+)/.exec(line)
  if (resolved) {
    const current = Number(resolved[1])
    if (current > lastResolved) {
      updateUnits += current - lastResolved
      lastResolved = current
    }
    updateKind = 'resolve'
    updateCount = current
    updateCountedAt = Date.now()
    pushUpdateProgress()
    return
  }
  // 构建：每建完一个包一行「✔ [包名] Build complete in Xms」
  // （✔ 经 GBK 解码会变乱码，所以只认后面那段 ASCII）
  if (line.includes('Build complete')) {
    updateUnits += 1
    updateKind = 'build'
    updateCount += 1
    updateCountedAt = Date.now()
    pushUpdateProgress()
    return
  }
  // 窗口壳的 cargo 构建：Compiling foo v1.2.3
  if (/^\s*Compiling\s+\S/.test(line)) {
    updateUnits += 1
    updateKind = 'crate'
    updateCount += 1
    updateCountedAt = Date.now()
    pushUpdateProgress()
  }
}

/**
 * 跑一次 update.bat：DSH 源码切到钉的标签并重建 + 更新社区插件 + 拉/切面板 UI。
 *
 * 与双击的差别只有两点：带 DSH_UPDATE_NONINTERACTIVE=1（update.bat 因而跳过所有 pause），
 * 以及**更新前先停掉 dsh、成功后按原状拉回来**——重建期间跑着的实例引用的是旧产物。
 * 输出全部进面板日志（管理页的「日志」页能实时看到），进度走 installProgress 那条通道，
 * 状态走 /api/state 的 update 字段。
 */
async function runUpdate() {
  if (updateRun?.running) throw new Error('已经在更新了，等它跑完再点')
  if (!existsSync(UPDATE_SCRIPT)) {
    throw new Error(`找不到 update.bat（${UPDATE_SCRIPT}）：它要和 panel-server.mjs 放在同一目录`)
  }
  const wasRunning = Boolean(current)
  if (current) await stop()
  updateRun = { running: true, startedAt: Date.now(), finishedAt: null, code: null, restarted: false }
  updateUnits = 0
  lastResolved = 0
  updateKind = ''
  updateCount = 0
  updateStep = '准备中'
  updateStepStartedAt = Date.now()
  updateCountedAt = Date.now()
  updateCreep = 0
  pushUpdateProgress()
  startUpdateCreep()
  pushLog(`开始更新：${UPDATE_SCRIPT}（等同双击 update.bat；跑着的 dsh 已先停止）`)

  const env = { ...process.env, DSH_UPDATE_NONINTERACTIVE: '1' }
  await ensureChildProxy(env)
  const child = spawn('cmd.exe', ['/c', UPDATE_SCRIPT], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const decoder = consoleDecoder()
  const onChunk = (buf) => {
    for (const line of decoder.decode(buf, { stream: true }).split(/\r?\n/)) {
      if (!line.trim()) continue
      pushLog(line)
      trackUpdateProgress(line)
    }
  }
  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)
  child.on('error', (error) => pushLog(`更新脚本没能启动：${errMsg(error)}`))
  child.on('exit', (code) => {
    const ok = code === 0
    updateRun = { running: false, startedAt: updateRun?.startedAt ?? Date.now(), finishedAt: Date.now(), code: code ?? -1, restarted: false }
    stopUpdateCreep()
    setUpdateProgress(null)
    pushLog(ok ? '更新完成（update.bat 退出码 0）' : `更新失败：update.bat 退出码 ${code ?? '-'}，上面的输出就是现场`)
    if (ok && wasRunning) {
      start()
        .then(({ url }) => {
          updateRun = { ...updateRun, restarted: true }
          pushLog(`更新后 dsh 已重新拉起：${url}`)
          openPage(url, DSH_WINDOW_SIZE)
        })
        .catch((error) => pushLog(`更新完成，但 dsh 没能重新起来：${errMsg(error)}（可在管理页点 ▶ 重试）`))
        .finally(() => { void emitState() })
    }
    void emitState()
  })
  return { ok: true }
}

// ---- 状态与自检 -----------------------------------------------------------

/**
 * 管理页读的状态。installed / versions 收敛成唯一一条：这个源码 checkout。
 * `managed: false` 表示「不是启动器装在版本目录里的东西」——源码模式只有这一种。
 */
async function snapshot() {
  const version = sourceVersion()
  const status = current?.status || 'stopped'
  const url = current?.url || null
  return {
    // 跑 update.bat 时借上游这个字段表达「忙着呢」：管理页会禁掉启动/停止这些按钮
    installing: updateRun?.running ? version : null,
    installed: [version],
    versions: [{ version, managed: false, status, url }],
    running: current ? { version, status, url } : null,
    autoFix: lastAutoFix,
    health: lastHealth,
    dataDir: REPO,
    // 界面就是靠这个（配合 installing）画那条进度条的
    progress: updateProgress,
    // 面板自己加的字段（上游 UI 不读）：右上角「自动更新」按钮的状态
    update: updateSnapshot(),
  }
}

async function emitState() {
  const snap = await snapshot()
  emit('state', snap)
  return snap
}

/**
 * 页面自检：按浏览器的方式抓一次 app 页面（token 换 cookie），把页面引用的所有客户端
 * 插件包请求一遍。dsh 进程活着不等于页面打得开——这一步用来区分「实例有问题」和
 * 「你看的是旧页面」。
 */
export async function checkWebPage(origin, token) {
  const base = String(origin).replace(/\/+$/, '')
  const first = await fetch(`${base}/?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  })
  const cookie = (first.headers.getSetCookie?.() || []).map((item) => item.split(';')[0]).join('; ')
  const headers = cookie ? { cookie } : {}
  const page = await fetch(`${base}/`, { headers, signal: AbortSignal.timeout(15000) })
  const html = await page.text()
  const urls = [...new Set([...html.matchAll(/\/plugins\/[^"'\s<>)]+/g)].map((match) => match[0].replaceAll('&amp;', '&')))]
  const failed = []
  let ok = 0
  for (const url of urls) {
    try {
      const res = await fetch(`${base}${url}`, { headers, signal: AbortSignal.timeout(30000) })
      await res.arrayBuffer()
      if (res.status === 200) ok += 1
      else failed.push({ url, status: res.status })
    } catch (error) {
      failed.push({ url, status: 0, error: errMsg(error) })
    }
  }
  return { origin: base, total: urls.length, ok, failed }
}

/** 启动成功后异步自检并把结论写进状态（失败不影响运行中的实例）。 */
async function selfCheckPage(url, version) {
  const match = /^http:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost):(\d+)\/\?token=(\S+)/.exec(String(url || ''))
  if (!match) return
  try {
    const result = await checkWebPage(`http://127.0.0.1:${match[1]}`, match[2])
    lastHealth = {
      at: Date.now(),
      version,
      url,
      total: result.total,
      ok: result.ok,
      failed: result.failed.slice(0, 8),
    }
    if (result.failed.length) {
      pushLog(`页面自检：${result.ok}/${result.total} 个客户端插件包正常，${result.failed.length} 个失败`)
      for (const item of result.failed.slice(0, 5)) pushLog(`[自检] HTTP ${item.status || '-'} ${item.url.slice(0, 160)}`)
    } else {
      pushLog(`页面自检：${result.total} 个客户端插件包全部正常`)
    }
    await emitState()
  } catch (error) {
    pushLog(`页面自检没跑成：${errMsg(error)}`)
  }
}

// ---- 本机安全栅栏与打开页面 ------------------------------------------------

/** 允许当作「本机」的主机名——打开本机页面、判断请求来源都用它。 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 严格解析成本机 http(s) 地址；不是就抛错（前缀正则挡不住 `/?&calc` 这种尾巴）。 */
function assertLocalUrl(target) {
  let parsed
  try {
    parsed = new URL(String(target))
  } catch {
    throw new Error('只能打开本机地址')
  }
  const hostname = parsed.hostname.toLowerCase() === '0.0.0.0' ? '127.0.0.1' : parsed.hostname.toLowerCase()
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(hostname)) throw new Error('只能打开本机地址')
  parsed.hostname = hostname
  return parsed.href
}

/**
 * 交给系统默认程序打开。
 *
 * Windows 走 `cmd /c start`，而 cmd 会把这行**再解析一遍**：URL 里的 `&` 是语句分隔符、
 * `|<>^()%"` 各有含义，于是 `http://127.0.0.1:1/?&calc` 能跑起任意命令。所以这里只放行
 * cmd 会原样看待的字符——本机地址够用，其余一律拒绝，比在字符串上做转义可靠。
 */
const CMD_SAFE_URL = /^[A-Za-z0-9\-._~:/?#\[\]@$'*,;=+]+$/

function openExternal(target) {
  const url = String(target)
  if (process.platform === 'win32') {
    if (!CMD_SAFE_URL.test(url)) throw new Error('地址里含不能安全打开的字符')
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true })
    return
  }
  execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
}

/**
 * 面板自己的窗口：原生壳 panel-window.exe（tao + wry，与 DSH-X 同款库）——无边框、页面自己
 * 画标题栏和最小化/最大化/关闭，尺寸 1100x760 逻辑像素，和 DSH-X 一模一样。
 *
 * 壳子由本进程拉起（不像上游那样反过来拉 node），所以控制台日志仍在 node 这边；壳子会盯着
 * 本进程的 pid，本进程一退它跟着退。壳子不存在时（没编译 / 没跑过 update.bat）依次退回
 * 浏览器应用模式窗口、系统默认浏览器。
 */
const WINDOW_HOST_ARGS = { width: '1100', height: '760', title: 'DSH 面板' }
/** 最近拉起的窗口壳；null = 没在跑（✕ 关掉窗口后会回到 null）。 */
let windowHost = null
/** 面板要求「把窗口叫到前面」；壳子轮询 /api/window 读它，读走即清。 */
let windowShowRequested = false

/** 窗口壳的可执行文件：部署位置优先，其次仓库里的构建产物（开发时直接跑也能用）。 */
function windowHostExe() {
  const candidates = [
    process.env.DSH_PANEL_WINDOW_EXE,
    join(ROOT, 'panel-window.exe'),
    join(ROOT, 'panel-window', 'target', 'release', 'panel-window.exe'),
  ]
  return candidates.find((file) => file && existsSync(file)) || ''
}

function spawnWindowHost(url) {
  const exe = windowHostExe()
  if (!exe) return false
  let child
  try {
    child = spawn(exe, [
      '--url', url,
      '--parent-pid', String(process.pid),
      '--title', WINDOW_HOST_ARGS.title,
      '--width', WINDOW_HOST_ARGS.width,
      '--height', WINDOW_HOST_ARGS.height,
    ], { stdio: 'ignore' })
  } catch (error) {
    pushLog(`面板窗口启动失败：${errMsg(error)}`)
    return false
  }
  windowHost = child
  pushLog(`面板窗口已打开（${exe}）`)
  child.on('error', (error) => pushLog(`面板窗口出错：${errMsg(error)}`))
  child.on('exit', (code) => {
    if (windowHost === child) windowHost = null
    // 关窗口 ≠ 退出：面板和 dsh 都还在跑，再双击一次 start-panel.bat 就能把窗口叫回来
    pushLog(`面板窗口已关闭（退出码 ${code ?? '-'}）；面板与 dsh 仍在运行，再双击 start-panel.bat 可把窗口叫回来`)
  })
  return true
}

/**
 * 保证面板有一个窗口：没有（或已被 ✕ 关掉）就新开一个，活着就置位「叫到前面」。
 * 重复双击 start-panel.bat 走的就是这里。
 */
function ensurePanelWindow() {
  if (process.env.DSH_PANEL_NO_OPEN === '1') return
  const url = `http://127.0.0.1:${PORT}/?window=1`
  if (process.env.DSH_PANEL_WINDOW === 'system') {
    openExternal(assertLocalUrl(`http://127.0.0.1:${PORT}/`))
    return
  }
  if (windowHost && windowHost.exitCode === null) {
    windowShowRequested = true
    return
  }
  if (spawnWindowHost(url)) return
  // 没有原生壳：退回浏览器应用模式窗口（那条路没有生命周期可管，只能开一个算一个）
  if (!appWindowFallbackLogged) {
    appWindowFallbackLogged = true
    pushLog('[面板] 没找到 panel-window.exe（跑一次 update.bat 会编译它），面板改用浏览器的独立窗口打开')
  }
  openLocalUrl(`http://127.0.0.1:${PORT}/`, PANEL_WINDOW_SIZE)
}

/**
 * 浏览器自己的「应用模式」：没有地址栏、没有标签页的独立窗口。给 dsh 网页用——那一页没有
 * 自画的标题栏，放进无边框窗口会连关闭按钮都没有。Edge 是 Windows 10/11 自带的，Chrome 备用。
 */
const APP_WINDOW_BROWSERS = [
  ['ProgramFiles(x86)', 'Microsoft/Edge/Application/msedge.exe'],
  ['ProgramFiles', 'Microsoft/Edge/Application/msedge.exe'],
  ['LOCALAPPDATA', 'Microsoft/Edge/Application/msedge.exe'],
  ['ProgramFiles', 'Google/Chrome/Application/chrome.exe'],
  ['ProgramFiles(x86)', 'Google/Chrome/Application/chrome.exe'],
  ['LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe'],
].map(([key, tail]) => (process.env[key] ? join(process.env[key], tail) : '')).filter(Boolean)

const PANEL_WINDOW_SIZE = '1120,760'
const DSH_WINDOW_SIZE = '1440,900'
let appWindowFallbackLogged = false

function openAppWindow(url, size) {
  const browser = APP_WINDOW_BROWSERS.find((path) => existsSync(path))
  if (!browser) {
    if (!appWindowFallbackLogged) {
      appWindowFallbackLogged = true
      pushLog('[面板] 没找到 Edge / Chrome，独立窗口开不了，改用系统默认浏览器打开（想固定成独立窗口就装一个 Edge）')
    }
    return false
  }
  execFile(browser, [
    `--app=${url}`,
    `--window-size=${size}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { windowsHide: true })
  return true
}

/** 打开一个本机页面：应用模式窗口 → 系统浏览器；地址只允许本机。 */
function openLocalUrl(target, size = PANEL_WINDOW_SIZE) {
  const url = assertLocalUrl(target)
  if (process.env.DSH_PANEL_WINDOW !== 'system' && openAppWindow(url, size)) return
  openExternal(url)
}

/**
 * 请求是不是来自本机。带 Origin 的只有浏览器：别的网页往 127.0.0.1 发跨站 POST 时会带上
 * 自己的 Origin（file:// 页面则是 `null`），而这个管理页没有任何鉴权，不挡的话任意网页
 * 都能让面板起进程、开关插件、开链接。本机脚本 / curl 不带 Origin。
 */
function sameSiteRequest(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) && (!parsed.port || Number(parsed.port) === PORT)
  } catch {
    return false
  }
}

/** Host 头是不是我们自己（DNS rebinding 的请求里写的是攻击者的域名）。 */
function isLocalHostHeader(value) {
  if (!value) return true
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(value).trim().toLowerCase())
  if (!match) return false
  if (!LOCAL_HOSTS.has(match[1])) return false
  return !match[2] || Number(match[2]) === PORT
}

/** 弹系统「选择文件夹」对话框，返回选中的绝对路径（取消/失败就返回空串）。 */
function pickDirectory() {
  if (process.platform !== 'win32') throw new Error('只有 Windows 支持目录选择')
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '选择 DSH 源码目录（含 apps\\cli 的那个 checkout）'",
    '$d.ShowNewFolderButton = $false',
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join('; ')
  return new Promise((done, fail) => {
    execFile(
      'powershell',
      ['-STA', '-NoProfile', '-Command', script],
      { windowsHide: true, timeout: 5 * 60 * 1000, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          fail(error)
          return
        }
        done(String(stdout || '').trim())
      },
    )
  })
}

// ---- 管理页 UI -----------------------------------------------------------

/**
 * 上游 UI 里「另一个启动器」的痕迹（服务器侧改写）：标题与左上角品牌名。
 * 只在文本完全对得上时才改，上游改了写法就自动跳过、露出原样，不改坏页面。
 */
const UI_TEXT_PATCHES = [
  ['<title>DSH-X</title>', '<title>DSH 面板</title>'],
  ['<div class="brand">DSH-X</div>', '<div class="brand">DSH 面板</div>'],
]

/**
 * 注入的覆盖层（上游 index.html 一个字都不改，git switch 才不会被本地改动挡住）：
 *   - 藏掉三项源码模式下没有意义的东西：卸载按钮、开机自启、插件市场；
 *   - 把「版本目录」改说成「DSH 源码目录」（文案由页面脚本动态写入，所以包一层函数）；
 *   - 顺带断言我们依赖的锚点还在，上游 UI 结构变了就写一条日志，不静默。
 */
const UI_OVERRIDE = `
<style>
  /* 源码模式：这三项归 DSH-X 的「按版本安装」逻辑管，本仓库没有对应物。
     label.toggle 这个选择器对得上上游两代设置页（老版 label.toggle，新版 label.toggle.set-row）。 */
  #remove,
  label.toggle:has(#autoStart),
  label.toggle:has(#seedMarket),
  .set-row:has(#autoStart),
  .set-row:has(#seedMarket) { display: none !important; }
</style>
<script>
(() => {
  const LABEL = 'DSH 源码目录'
  const DESC = '本仓库的玩法是源码 checkout + update.bat 构建，这里就是那个目录。'
  const OLD_DESC = 'dsh 各版本各自一个目录，互不干扰。'
  const HINT = '插件与 profile 仍在 ~/.dsh；源码的更新与重建交给 update.bat（本面板不装版本）。'

  /** 按可见文字改文案：上游两代 UI 的标签/说明文字一致，但外层 class 与 i18n 属性不同。 */
  function rename(selector, from, to) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.textContent.trim() === from) el.textContent = to
    }
  }

  function fix() {
    rename('span', '版本目录', LABEL)
    rename('span', OLD_DESC, DESC)
    const hint = document.getElementById('dataDirHint')
    if (hint) hint.textContent = HINT
    document.title = 'DSH 面板'
    const brand = document.querySelector('.brand')
    if (brand) brand.textContent = 'DSH 面板'
    paintUpdateIcon()
  }

  // 「设置」页的分类副标题是 t() 动态写进去的（切分类时不会经过 render），所以连 t 一起
  // 包一层：只把「版本目录」这一处措辞换掉，中文和英文文案都处理。
  const REPLACEMENTS = [
    ['配置管理页端口和版本目录。', '配置管理页端口和 DSH 源码目录。'],
    ['Configure the manager port and version directory.', 'Configure the manager port and the DSH source directory.'],
  ]
  const originalT = window.t
  if (typeof originalT === 'function') {
    window.t = function (zh, vars) {
      let text = String(originalT(zh, vars))
      for (const [from, to] of REPLACEMENTS) text = text.split(from).join(to)
      return text
    }
  }

  // 「更新」图标按钮：就用版本卡片里那个（上游本来只在「有新版本可装」时才露出来，
  // 位置正好在 ▶ 左边）。点击 = 跑 update.bat（DSH 源码 + 社区插件 + 面板界面一起更新）。
  // 上游给它挂的 onclick 是「下载新版安装包」，这里整个换掉。
  const updateIconEl = document.getElementById('update')
  let updating = false
  /** 最近一次从 /api/state 读到的进度（文案要用，见下面的 progressHint 包装）。 */
  let lastProgress = null

  function paintUpdateIcon() {
    if (!updateIconEl) return
    // 上游每次 render 都会按「有没有新版本」重新藏起来，所以每次渲染后都要重新露出来
    updateIconEl.hidden = false
    updateIconEl.classList.toggle('loading', updating)
    if (updating) updateIconEl.disabled = true
    updateIconEl.title = updating
      ? '正在跑 update.bat，进度见「日志」页'
      : '自动更新：等同双击 update.bat（DSH 源码、社区插件与面板界面一起更新）'
    updateIconEl.setAttribute('aria-label', updating ? '更新中' : '自动更新')
    // 更新期间上游会给主按钮也加一个转圈（它以为在装版本），两个圈一起转很怪：只留更新图标这个
    if (updating) {
      const mainBtn = document.getElementById('main')
      if (mainBtn) mainBtn.classList.remove('loading')
    }
  }

  /** 轮询更新状态；announce 为真（就是这次点了按钮）时才弹结论提示。 */
  async function pollUpdate(announce) {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      const data = await res.json()
      const info = data.update || null
      if (info && info.running) {
        updating = true
        paintUpdateIcon()
        window.setTimeout(() => pollUpdate(announce), 2000)
        return
      }
      const wasUpdating = updating
      updating = false
      paintUpdateIcon()
      if (!announce || !wasUpdating || !info || typeof window.notify !== 'function') return
      if (info.code === 0) {
        window.notify('更新完成' + (info.restarted ? '，dsh 已重新拉起' : '') + '；详细输出见「日志」页。', '更新完成')
      } else {
        window.notify('update.bat 退出码 ' + info.code + '，详细输出见「日志」页。', '更新失败')
      }
    } catch (error) {
      // 面板可能正在重启：隔一会儿再看
      window.setTimeout(() => pollUpdate(announce), 3000)
    }
  }

  if (updateIconEl) {
    updateIconEl.onclick = async () => {
      if (updating) return
      const ok = window.confirm('现在更新？\\n\\n等同双击 update.bat：DSH 源码切到钉的版本并重建、更新社区插件与面板界面。\\n过程中 dsh 会先被停掉，结束后自动重新拉起。')
      if (!ok) return
      updating = true
      paintUpdateIcon()
      try {
        const res = await fetch('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || ('HTTP ' + res.status))
        }
        pollUpdate(true)
      } catch (error) {
        updating = false
        paintUpdateIcon()
        if (typeof window.notify === 'function') window.notify(String((error && error.message) || error), '更新失败')
      }
    }
    // 页面也可能是更新过程中被打开的：先同步一次状态，但不要弹结论
    pollUpdate(false)
  }

  // 自动更新跑起来时，上游给的文案是「正在安装」——那是「按版本装 dsh」的口吻。这里换成
  // 「正在更新… 已解析 N 个依赖 / 已构建 N 个包」，数字全是 update.bat 的真实输出。
  // updateRunning 与进度都从页面自己的 state 里读：包一层 applyState 就能拿到。
  let updateRunning = false
  const originalApplyState = window.applyState
  if (typeof originalApplyState === 'function') {
    window.applyState = function (data) {
      try {
        const info = data && data.update
        updateRunning = Boolean(info && info.running)
        if (data) lastProgress = data.progress || null
        if (info) {
          updating = updateRunning
          paintUpdateIcon()
        }
      } catch (error) { /* 状态里没有我们的字段就算了 */ }
      return originalApplyState.apply(this, arguments)
    }
  }
  const originalProgressHint = window.progressHint
  if (typeof originalProgressHint === 'function') {
    window.progressHint = function (prefix) {
      if (!updateRunning) return originalProgressHint.call(this, prefix)
      const en = document.documentElement.lang === 'en'
      const head = en ? 'Updating' : '正在更新'
      const info = lastProgress || {}
      const count = Number(info.count) || 0
      const secs = Number(info.elapsed) || 0
      // 有真实计数就报计数；没有就报当前步骤 + 已用时长，让长时间没输出的阶段也看得出在动
      // （用字符串拼接而不是模板串：这段代码本身待在一个模板串里，见 UI_OVERRIDE）
      if (info.kind === 'resolve' && count) {
        return en ? head + '… resolved ' + count + ' dependencies' : head + '… 已解析 ' + count + ' 个依赖'
      }
      if (info.kind === 'build' && count) {
        return en ? head + '… built ' + count + ' packages' : head + '… 已构建 ' + count + ' 个包'
      }
      if (info.kind === 'crate' && count) {
        return en ? head + '… compiled ' + count + ' crates' : head + '… 已编译 ' + count + ' 个 crate'
      }
      if (!info.step) return head + '…'
      if (secs < 5) return head + '… ' + info.step
      const span = en
        ? (secs >= 60 ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's' : secs + 's')
        : (secs >= 60 ? Math.floor(secs / 60) + ' 分 ' + (secs % 60) + ' 秒' : secs + ' 秒')
      return head + '… ' + info.step + (en ? ' (' + span + ')' : '（已 ' + span + '）')
    }
  }

  // 页面脚本里这几个是顶层函数声明（经典脚本，挂在 window 上），包一层就在它写完文案后纠偏。
  // 上游换代时函数名变了也没关系：typeof 检查会让它安静跳过，fix() 自己还会再跑一次。
  for (const name of ['fillSettings', 'applyLang', 'render']) {
    const original = window[name]
    if (typeof original !== 'function') continue
    window[name] = function () {
      const result = original.apply(this, arguments)
      try { fix() } catch (error) { /* 改文案失败不影响页面 */ }
      return result
    }
  }
  fix()
  document.addEventListener('DOMContentLoaded', fix)
})()
</script>
`

/** 上游 UI 里我们必须依赖的锚点；缺了说明上游结构变了，管理页可能露出发不出去的按钮。 */
const UI_ANCHORS = ['id="remove"', 'id="dataDirHint"', '__APP_VERSION__', '/api/state']

function checkUiAnchors(html) {
  if (uiDriftChecked) return
  uiDriftChecked = true
  const missing = UI_ANCHORS.filter((anchor) => !html.includes(anchor))
  if (!missing.length) return
  pushLog(`[面板] 上游 UI 结构可能有变（index.html 里找不到：${missing.join(' / ')}）；若管理页出现异常的按钮，可先把 DSHX_REF 钉回旧标签`)
}

function renderIndexHtml(raw) {
  // 断言要在替换**之前**做：__APP_VERSION__ 这类标记一换就找不到了
  checkUiAnchors(raw)
  let body = raw
  for (const [from, to] of UI_TEXT_PATCHES) body = body.replaceAll(from, to)
  body = body
    .replaceAll('__APP_VERSION__', PANEL_VERSION)
    .replaceAll('__APP_LANG__', LANG)
    .replaceAll('__APP_THEME__', THEME)
    .replaceAll('__APP_PANEL_TRANSPARENCY__', String(PANEL_TRANSPARENCY))
    .replaceAll('__APP_REDUCE_MOTION__', String(REDUCE_MOTION))
    .replaceAll('__APP_HIDE_BACKGROUND__', String(HIDE_BACKGROUND))
    .replaceAll('__APP_HIDE_BIG_FISH__', String(HIDE_BIG_FISH))
  return body.includes('</body>') ? body.replace('</body>', `${UI_OVERRIDE}</body>`) : body + UI_OVERRIDE
}

function mime(path) {
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.ico')) return 'image/x-icon'
  return 'text/html'
}

function isTextFile(file) {
  return /\.(html|css|js|svg|json|txt|map)$/i.test(file)
}

// ---- HTTP ----------------------------------------------------------------

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, {
    'content-type': type,
    'content-length': payload.length,
    'cache-control': 'no-store',
    connection: 'close',
  })
  res.end(payload)
}

async function exportLogs() {
  const chunks = []
  for (const path of [`${LOG_FILE}.1`, LOG_FILE]) {
    try {
      chunks.push(await readFile(path, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return redact(chunks.length ? chunks.join('') : logs.join('\n'))
}

async function publicSettings() {
  const stored = await loadSettings()
  return {
    dataDir: REPO,
    dshHome: homeDir(),
    // port 是配置值（重启面板后生效），listenPort 是当前真正在监听的端口
    port: safePort(stored.port),
    listenPort: PORT,
    portDefault: DEFAULT_PORT,
    // 这两项归 DSH-X 的安装器管，本仓库没有对应物：给常量，免得管理页走「未能修改」的提示
    autoStart: false,
    seedMarket: false,
    autoDisablePlugins: stored.autoDisablePlugins !== false,
    profile: PROFILE_NAME,
    profiles: listProfiles(),
    // 回显用户填的原文（带引号），不能回显解析后的数组，否则含空格的值再存一次就被拆开了
    args: stored.args ?? '',
    lang: LANG,
    theme: THEME,
    panelTransparency: PANEL_TRANSPARENCY,
    reduceMotion: REDUCE_MOTION,
    hideBackground: HIDE_BACKGROUND,
    hideBigFish: HIDE_BIG_FISH,
  }
}

async function saveManagerSettings(body) {
  if ('dataDir' in body) {
    const dir = resolve(String(body.dataDir || ''))
    if (dir !== REPO) {
      if (current) throw new Error('请先停止 dsh 再改源码目录')
      if (!looksLikeDshRepo(dir)) throw new Error(`这不是 DSH 源码目录（缺少 apps\\cli）：${dir}`)
      REPO = dir
      pushLog(`DSH 源码目录改为 ${REPO}`)
    }
  }
  const stored = await saveSettings({
    dataDir: REPO,
    ...('port' in body ? { port: safePort(body.port) } : {}),
    ...('profile' in body ? { profile: safeProfile(body.profile) } : {}),
    ...('args' in body ? { args: safeArgs(body.args) } : {}),
    ...('lang' in body ? { lang: safeLang(body.lang) } : {}),
    ...('theme' in body ? { theme: safeTheme(body.theme) } : {}),
    ...('panelTransparency' in body ? { panelTransparency: safePanelTransparency(body.panelTransparency) } : {}),
    ...('reduceMotion' in body ? { reduceMotion: body.reduceMotion === true } : {}),
    ...('hideBackground' in body ? { hideBackground: body.hideBackground === true } : {}),
    ...('hideBigFish' in body ? { hideBigFish: body.hideBigFish === true } : {}),
    ...('autoDisablePlugins' in body ? { autoDisablePlugins: body.autoDisablePlugins !== false } : {}),
  })
  // profile 立即生效：插件页、启动参数都读这个变量（已经在跑的 dsh 不受影响）
  if (safeLang(stored.lang)) LANG = safeLang(stored.lang)
  THEME = safeTheme(stored.theme)
  PANEL_TRANSPARENCY = safePanelTransparency(stored.panelTransparency)
  REDUCE_MOTION = stored.reduceMotion === true
  HIDE_BACKGROUND = stored.hideBackground === true
  HIDE_BIG_FISH = stored.hideBigFish === true
  EXTRA_ARGS = parseArgs(stored.args)
  if (stored.profile && stored.profile !== PROFILE_NAME) {
    pushLog(`启动 profile 改为 ${stored.profile}`)
    PROFILE_NAME = stored.profile
  }
  await emitState()
  return publicSettings()
}

/** 插件页数据：一份读不到就给一份空清单，别让整页塌掉。 */
function pluginSnapshot() {
  try {
    return { ...listPlugins(profileDir()), profile: PROFILE_NAME, autoFix: lastAutoFix }
  } catch (error) {
    pushLog(`读取插件清单失败：${errMsg(error)}`)
    return { profileDir: profileDir(), patchPath: '', plugins: [], disables: [], profile: PROFILE_NAME, autoFix: lastAutoFix }
  }
}

/** 面板自己不装版本、不卸载、不自更新——这三件事都归 update.bat 管的源码 checkout。 */
const SOURCE_MODE_REFUSAL = '这是源码版 DSH：版本由 update.bat 管理（切 git 标签 + 构建），本面板不提供安装 / 卸载 / 自更新'
/** 上面那句话对应的接口：UI 不同代里能点到它们的前提不同，一律明确拒绝，别给 404。 */
const REFUSED_PATHS = new Set(['/api/install', '/api/uninstall', '/api/self/download', '/api/self/install'])

async function handleApi(req, res, url) {
  // 身份标记：端口被占用时用来分辨「自己的另一个实例」和「别人的程序」
  if (url.pathname === '/api/ping') {
    send(res, 200, { app: 'dsh-panel', version: PANEL_VERSION, port: PORT })
    return
  }
  // 改状态的请求只认本机来源（浏览器会带 Origin，本机程序不会）
  if (req.method !== 'GET' && !sameSiteRequest(req)) {
    send(res, 403, { error: '跨站请求被拒绝' })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/remote') {
    // 源码模式没有「可安装的远程版本」：空版本表让管理页收起安装 / 更新入口
    send(res, 200, { package: '@deepseek-ai/dsh', source: REPO, tags: {}, versions: [], latest: null })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/self') {
    const ui = uiVersion()
    send(res, 200, { current: ui ? `${PANEL_VERSION} · UI ${ui}` : PANEL_VERSION, latest: null, update: false, url: '' })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/changelog') {
    send(res, 200, { blocks: [], url: '' })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/window') {
    // 窗口壳轮询这里：重复双击 start-panel.bat 时把窗口从最小化/背后叫回来。读走即清，
    // 免得壳子反复把自己抢到前面。
    const show = windowShowRequested
    windowShowRequested = false
    send(res, 200, `show=${show ? 1 : 0}\n`, 'text/plain; charset=utf-8')
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/pending') {
    // 上游 UI 会问一次「有没有待处理的更新」：源码模式的更新归 update.bat，永远没有
    send(res, 200, { update: null })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    send(res, 200, await publicSettings())
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/logs/export') {
    res.setHeader('content-disposition', 'attachment; filename="dsh-panel-logs.txt"')
    send(res, 200, await exportLogs(), 'text/plain; charset=utf-8')
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    send(res, 200, await snapshot())
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    send(res, 200, pluginSnapshot())
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    res.write(`event: log\ndata: ${JSON.stringify({ lines: logs.slice(-120) })}\n\n`)
    res.write(`event: state\ndata: ${JSON.stringify(await snapshot())}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  const body = req.method === 'POST' ? await readJson(req) : {}
  if (req.method === 'POST' && url.pathname === '/api/start') {
    send(res, 200, await start())
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/launch') {
    send(res, 200, await launchInstalled())
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    await stop(body.version)
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    send(res, 200, await saveManagerSettings(body))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/plugins/toggle') {
    const name = String(body.name || '')
    const enabled = body.enabled !== false
    const result = setPluginEnabled(profileDir(), name, enabled)
    pushLog(`插件 ${name} → ${enabled ? '启用' : '禁用'}${result.changed ? '' : '（无变化）'}`)
    send(res, 200, { ok: true, changed: result.changed, ...pluginSnapshot() })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/wake') {
    await host.onWake?.()
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/pick-dir') {
    try {
      send(res, 200, { path: await pickDirectory() })
    } catch (error) {
      pushLog(`目录选择失败: ${errMsg(error)}`)
      send(res, 200, { path: '', error: errMsg(error) })
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/open') {
    openLocalUrl(body.url)
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/update') {
    // 等同双击 update.bat：跑起来就返回，进度看 /api/state 的 update 字段和日志页
    send(res, 200, await runUpdate())
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/pending/skip') {
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && REFUSED_PATHS.has(url.pathname)) {
    send(res, 400, { error: SOURCE_MODE_REFUSAL })
    return
  }
  send(res, 404, { error: 'not found' })
}

/** 探端口上是不是我们自己的管理页——用 /api/ping 的身份标记区分「自己的实例」和「别人的程序」。 */
async function probeManager(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { cache: 'no-store', signal: AbortSignal.timeout(800) })
    if (!res.ok) return false
    const data = await res.json()
    return data?.app === 'dsh-panel'
  } catch {
    return false
  }
}

export async function startServer() {
  if (server) return `http://127.0.0.1:${PORT}`
  const stored = await loadSettings()
  // 设置页改过端口 / profile 的话，这里拿到的就是新值（环境变量仍然优先，便于测试）
  PORT = process.env.DSH_PANEL_PORT ? safePort(process.env.DSH_PANEL_PORT) : safePort(stored.port)
  PROFILE_NAME = safeProfile(stored.profile)
  EXTRA_ARGS = parseArgs(stored.args)
  LANG = safeLang(stored.lang) || 'zh'
  THEME = safeTheme(stored.theme)
  PANEL_TRANSPARENCY = safePanelTransparency(stored.panelTransparency)
  REDUCE_MOTION = stored.reduceMotion === true
  HIDE_BACKGROUND = stored.hideBackground === true
  HIDE_BIG_FISH = stored.hideBigFish === true
  REPO = resolveSourceRepo(stored)

  const handler = async (req, res) => {
    try {
      // Host 必须是本机：恶意域名解析到 127.0.0.1（DNS rebinding）时浏览器带的是那个域名，
      // 会被当同源，GET 接口（含 dsh 的 token、日志）就能被读走
      if (!isLocalHostHeader(req.headers.host)) {
        send(res, 403, 'forbidden', 'text/plain; charset=utf-8')
        return
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url)
        return
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const path = join(PUBLIC, file)
      if (!path.startsWith(PUBLIC) || !existsSync(path)) {
        send(res, 404, 'not found', 'text/plain; charset=utf-8')
        return
      }
      const type = mime(path)
      if (isTextFile(file)) {
        let text = await readFile(path, 'utf8')
        if (file === 'index.html') text = renderIndexHtml(text)
        send(res, 200, text, `${type}; charset=utf-8`)
        return
      }
      send(res, 200, await readFile(path), type)
    } catch (error) {
      pushLog(`错误: ${errMsg(error)}`)
      send(res, 500, { error: errMsg(error) })
    }
  }

  // 端口顺延：配置的端口被**别的程序**占了就往后试；被自己的另一个实例占着则抛 EALREADY，
  // 让 main() 去把那个实例唤醒——双击图标不该起出第二个面板。
  const preferred = PORT
  let lastError = null
  for (let offset = 0; offset < PORT_SCAN; offset += 1) {
    const candidate = preferred + offset
    if (candidate > 65535) break
    const attempt = createServer({ maxHeaderSize: 128 * 1024 }, handler)
    try {
      await new Promise((done, fail) => {
        attempt.once('error', fail)
        attempt.listen(candidate, '127.0.0.1', () => {
          attempt.off('error', fail)
          done()
        })
      })
    } catch (error) {
      attempt.close()
      if (error?.code !== 'EADDRINUSE') throw error
      lastError = error
      if (await probeManager(candidate)) {
        const busy = new Error(`管理页已经在 ${candidate} 端口上跑着`)
        busy.code = 'EALREADY'
        busy.port = candidate
        throw busy
      }
      pushLog(`端口 ${candidate} 被别的程序占用，试下一个`)
      continue
    }
    attempt.on('error', (error) => pushLog(`管理服务出错: ${errMsg(error)}`))
    server = attempt
    PORT = candidate
    if (offset > 0) pushLog(`管理页改用端口 ${PORT}（${preferred} 起被占用）`)
    pushLog(`DSH 面板 http://127.0.0.1:${PORT}`)
    pushLog(`DSH 源码目录 ${REPO}（版本 ${sourceVersion()}）`)
    pushLog(`DSH_HOME ${homeDir()} · profile ${PROFILE_NAME} · dsh 网页端口 ${WEB_PORT}`)
    if (!existsSync(PUBLIC)) pushLog('[面板] 缺 dsh-x\\public（管理页 UI），请先运行 update.bat')
    return `http://127.0.0.1:${PORT}`
  }
  throw lastError ?? new Error('没有可用端口')
}

export async function stopAll() {
  if (current) killTree(current.child.pid)
  current = null
  for (const res of clients) {
    try {
      res.end()
    } catch {
      // 已经断了
    }
  }
  clients.clear()
  const httpServer = server
  server = null
  if (!httpServer) return
  if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections()
  await Promise.race([
    new Promise((done) => httpServer.close(() => done())),
    new Promise((done) => setTimeout(done, 1500)),
  ])
}

/**
 * 退出前通知所有开着的管理页，让它们自己收摊——否则面板退了，浏览器里还留着一个
 * 连不上后端的死页面。
 */
export function notifyShutdown() {
  return new Promise((done) => {
    for (const res of clients) {
      try {
        res.write('event: bye\ndata: {}\n\n')
      } catch {
        // 这个页面已经断了
      }
    }
    setTimeout(() => {
      for (const res of clients) {
        try {
          res.end()
        } catch {
          // 已经断了
        }
      }
      clients.clear()
      done()
    }, 150)
  })
}

export async function shutdown() {
  await Promise.race([stopAll(), new Promise((done) => setTimeout(done, 2000))])
  await notifyShutdown()
}

export function setHost(next) {
  host = { ...host, ...next }
}

// ---- 启动入口（DSH-X 的 start.js 那份角色） --------------------------------

/**
 * 打开一个页面：默认开成独立窗口（面板走原生壳，见 ensurePanelWindow）；DSH_PANEL_NO_OPEN=1
 * 时一律不弹任何窗口（无人值守或远程会话用得上）。地址只允许本机，断言在 openLocalUrl 里。
 */
function openPage(target, size = PANEL_WINDOW_SIZE) {
  if (process.env.DSH_PANEL_NO_OPEN === '1') return
  try {
    openLocalUrl(target, size)
  } catch (error) {
    pushLog(`打开页面失败：${errMsg(error)}`)
  }
}

/**
 * 面板已经在跑、又双击了一次 start-panel.bat：让那个实例把窗口叫回来（✕ 关过就重开一个，
 * 还活着就叫到前面）。**不**顺手启动 dsh——跑不跑由用户在界面上点，和上游 DSH-X 一致。
 */
async function wakeExisting(port) {
  const base = `http://127.0.0.1:${port}/`
  try {
    const res = await fetch(`${base}api/wake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) pushLog(`唤醒已有面板失败 HTTP ${res.status}`)
  } catch (error) {
    pushLog(`唤醒已有面板失败：${errMsg(error)}`)
  }
}

async function main() {
  if (!existsSync(PUBLIC)) {
    console.error(`[面板] 找不到管理页 UI：${PUBLIC}`)
    console.error('[面板] 先双击 update.bat（或单独跑 update-panel.ps1）把 dsh-x 拉下来。')
    process.exit(2)
  }
  try {
    await startServer()
  } catch (error) {
    // 端口被自己的另一个实例占着：唤醒它、把页面叫出来，然后退出（不起第二个面板）
    if (error?.code === 'EALREADY') {
      const port = error.port || PORT
      pushLog(`管理页已经在 ${port} 端口上跑着，通知它把页面叫出来`)
      await wakeExisting(port)
      return
    }
    throw error
  }
  setHost({ onWake: () => ensurePanelWindow() })
  // 打开启动器只把界面摆出来，**不**自动拉起 dsh：跑不跑、什么时候跑，由用户在界面上点
  // （上游 DSH-X 也是这个行为）。想照旧自动拉起 + 开 dsh 网页：set DSH_PANEL_AUTO_START=1
  ensurePanelWindow()
  if (process.env.DSH_PANEL_AUTO_START === '1') {
    try {
      const { url } = await start()
      openPage(url, DSH_WINDOW_SIZE)
    } catch (error) {
      pushLog(`自动启动 dsh 失败：${errMsg(error)}（可以在管理页上手动点 ▶ 重试）`)
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      shutdown().finally(() => process.exit(0))
    })
  }
}

if (/panel-server\.mjs$/i.test(process.argv[1] || '')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}