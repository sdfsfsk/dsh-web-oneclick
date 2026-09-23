/**
 * 加载钩子的注册入口（--import 的目标）。
 *
 * 为什么需要这个只有几行的文件：Node 只在模块**调用 module.register()** 时才把它的导出当
 * 加载钩子用；光用一个「导出 load 的模块」去 --import 是无效的（v24 实测：钩子一次都不会
 * 被调用）。上游 dsh-x 的 perf\register.mjs、compat\register.mjs 也是同一个原因才存在。
 */
import { register } from 'node:module'

register('./panel-hooks.mjs', import.meta.url)