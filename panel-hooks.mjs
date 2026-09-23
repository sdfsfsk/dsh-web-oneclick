/**
 * 上游加载钩子的「源码布局适配层」。
 *
 * 由同目录的 panel-hooks-register.mjs 用 module.register() 注册（Node 只认这种注册方式，
 * 光 --import 一个导出了 load 的模块是无效的）。
 *
 * dsh-x\ 里的两个加载钩子（perf\ 启动加速、compat\ 会话事件词汇兼容）是给**npm 安装布局**
 * 写的：它们按 `url.includes('dsh-session/lib/index.js')` 这种包名路径匹配模块。而我们的
 * dsh 是源码 checkout，模块 URL 经 pnpm 的 junction realpath 之后是
 * `packages/core/session/lib/index.js` —— 名字里根本没有 `dsh-session/`，于是两个钩子
 * 在源码模式下全都空转（DSH_PERF_DEBUG=1 时日志里一条 [perf] / [compat] 都没有）。
 *
 * 这层只做一件事：把源码路径映射回上游认得的标记串，再把改源码的活儿原样交给上游的钩子
 * —— 补丁逻辑一个字都不复制，上游换代（或 DSH 换代改了锚点）就跟上游走。
 *
 * 映射不中或 dsh-x 不在时一律放行：退化成「没有启动加速 / 没有事件词汇兼容」，不影响启动。
 * 覆盖不到 worker 线程那份内联词汇表（它是靠 NODE_OPTIONS=--require 的 CJS 补丁拦 fs
 * 读取的，同样按包名匹配，源码布局下够不到——见 README 的 FAQ）。
 */

/** 源码布局 → 上游钩子认得的标记串 → 用哪个钩子。 */
const ROUTES = [
  ['/packages/client/modules/lib/index.js', 'dsh-client-modules/lib/index.js', 'perf'],
  ['/packages/core/session/lib/index.js', 'dsh-session/lib/index.js', 'compat'],
  ['/packages/session/session-format-v0-to-v1/lib/index.js', 'dsh-session-format-v0-to-v1/lib/index.js', 'compat'],
]

const hooks = {}
try {
  hooks.perf = await import('./dsh-x/perf/patch-hooks.mjs')
  hooks.compat = await import('./dsh-x/compat/session-events.mjs')
} catch (error) {
  // dsh-x 没拉下来（面板自己会提示跑 update.bat）：这层就什么都不做
  if (process.env.DSH_PERF_DEBUG === '1') {
    console.error(`[panel-hooks] 上游钩子没加载，本次不做加速/兼容适配：${error?.message || error}`)
  }
}

export async function load(url, context, nextLoad) {
  for (const [fragment, marker, name] of ROUTES) {
    if (!String(url).includes(fragment)) continue
    const hook = hooks[name]
    if (typeof hook?.load !== 'function') break
    // 上游钩子内部会 `await nextLoad(url, context)`，它传的是我们给的标记串；这个闭包忽略
    // 参数、用真实 URL 去加载，改完（或没改）再交回去——加载的仍是那个真实模块。
    return hook.load(marker, context, () => nextLoad(url, context))
  }
  return nextLoad(url, context)
}