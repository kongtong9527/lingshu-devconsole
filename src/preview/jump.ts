import type { Selected } from '../store.js'
import type { PageJumpTarget } from '../types.js'

/** 卡片节点 target（与 runtime CardTarget 同形，any 容差未知动作） */
export type CardNodeTarget = { action: string; [k: string]: unknown } | undefined

/**
 * 把结构化 PageJumpTarget 转成 runWith 的 Selected patch；无 target 返回 null（走 URL 回退）。
 * 独立模块以避免 PreviewDispatcher 与各预览组件之间的循环依赖。
 */
export function toJumpPatch(target: PageJumpTarget | undefined): Partial<Selected> | null {
  if (!target) return null
  switch (target.action) {
    case 'list': {
      // 页面通道：带 url 用 url（宿主优先 url），缺省回退 category。
      // filters（落地列表页筛选组）透传给 ListPreview 渲染筛选栏（Q11-a）。
      // channel 有才透传进 PluginContext.channel，插件优先按它分派。
      const patch: Partial<Selected> = {
        action: 'list',
        url: target.url ?? '',
        category: target.category ?? '',
        target: '',
        page: '1',
      }
      if (target.filters !== undefined) patch.filters = target.filters
      const channel = (target as { channel?: string }).channel
      if (channel) patch.channel = channel
      return patch
    }
    case 'search':
      return { action: 'search', target: target.query, category: '', page: '1' }
    case 'detail':
      return { action: 'detail', target: target.url }
    case 'play':
      return { action: 'play', target: target.url }
    case 'reading':
      return { action: 'reading', target: target.url }
    case 'categories':
      return { action: 'categories', target: '' }
  }
  return null
}

/** 节点 target 是否预览留桩（invoke 通用调用在预览内禁用+warn，不发请求；写侧验证走 runtime/iOS） */
export function isInvokeStub(target: CardNodeTarget): boolean {
  return !!target && (target as { action?: string }).action === 'invoke'
}

/** 节点 target 是否纯展示拦截（noop 拦截冒泡、不导航） */
export function isNoopTarget(target: CardNodeTarget): boolean {
  return !!target && (target as { action?: string }).action === 'noop'
}
