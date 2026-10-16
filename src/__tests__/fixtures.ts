// 测试夹具工厂（test-only；文件名不含 .test/.spec，vitest 不收集本文件）。
import type { Capabilities } from '../types.js'

/**
 * 测试用插件能力集：默认全关，只写要开的那几项。
 *
 * 用途：`Capabilities` 是宿主能力清单，随能力增加字段（listings / explore / tags …），
 * 逐处手写「十一个字段的字面量」会漏字段——而 vitest 不做类型检查、漏了照样跑绿
 * （2026-10：`tags` 字段在 8 处夹具里静默缺失，靠 `tsc --noEmit` 才暴露）。
 * 集中到本函数后，宿主新增能力只需改这里一处。
 */
export function caps(on: Partial<Capabilities> = {}): Capabilities {
  return {
    list: false,
    detail: false,
    reading: false,
    search: false,
    categories: false,
    listings: false,
    explore: false,
    tags: false,
    play: false,
    settings: false,
    account: false,
    ...on,
  }
}
