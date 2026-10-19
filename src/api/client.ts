import type { PluginInfo, RunResponse, Action, UiPrompt } from '../types.js'

/** 浏览器通道形态：持久复用 vs 一次性即焚，缺省 persistent */
export type BrowserMode = 'persistent' | 'ephemeral'

export async function getPlugins(dir?: string): Promise<PluginInfo[]> {
  const qs = dir ? `?dir=${encodeURIComponent(dir)}` : ''
  const res = await fetch(`/api/plugins${qs}`)
  const json = await res.json()
  return json.plugins as PluginInfo[]
}

export async function run(opts: {
  pluginId: string
  action: Action
  target?: string
  options?: {
    page?: string
    category?: string
    /** 页面通道：list 用任意列表页面 URL，透传进 PluginContext.url */
    url?: string
    /** 列表通道标识：原样透传进 PluginContext.channel */
    channel?: string
    fixture?: string
    cursor?: string
    /** 用户偏好值（注入 $lib.settings，按 run 注入、只读、不持久） */
    settings?: Record<string, string | boolean>
    /** 登录表单输入值（login 动作用，声明式交互） */
    inputs?: Record<string, string>
    /**
     * 浏览器通道形态（run 级）：'persistent'（默认）| 'ephemeral'
     * （本次 run 内每次 getHtml 都新起即焚）。缺省不传即 persistent。
     */
    browserMode?: BrowserMode
  }
}): Promise<RunResponse> {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  })
  return (await res.json()) as RunResponse
}

/**
 * 打开 $lib.ui 的 SSE 流：插件在 run 中途直问用户时，prompt 经此推到前端。
 * 返回 EventSource，调用方负责在卸载时 close。EventSource 自动重连。
 */
export function openUiStream(onPrompt: (promptId: string, prompt: UiPrompt) => void): EventSource {
  const es = new EventSource('/api/ui/stream')
  es.onmessage = (ev) => {
    try {
      const { promptId, prompt } = JSON.parse(ev.data) as { promptId?: string; prompt?: UiPrompt }
      if (promptId && prompt) onPrompt(promptId, prompt)
    } catch {
      /* 忽略坏帧 */
    }
  }
  return es
}

/** 回传 $lib.ui 的 input/confirm 答案（按 promptId 路由到对应 await）。 */
export async function respondUi(promptId: string, response: string | undefined): Promise<void> {
  await fetch('/api/ui/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ promptId, response }),
  })
}

/** 浏览器通道状态（headed sidecar：可用性 + 持久上下文是否已就绪）。 */
export async function browserStatus(): Promise<{ available: boolean; reason?: string; hasContext: boolean; userAgent?: string }> {
  const res = await fetch('/api/browser/status')
  return (await res.json()) as { available: boolean; reason?: string; hasContext: boolean; userAgent?: string }
}

/**
 * 打开验证窗口（被动触发）：server 起可见 Chrome 加载挑战页，
 * 用户在窗口内人手过 Turnstile，clearance 留在落盘 profile 供后续重抓沾光。
 * opts.mode='ephemeral'：开全新即焚窗口、不落盘不沾光，须与下一次
 * ephemeral 抓取联动使用；缺省 persistent。
 */
export async function openVerifyWindow(
  url: string,
  opts?: { mode?: BrowserMode },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/browser/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts?.mode === 'ephemeral' ? { url, mode: 'ephemeral' } : { url }),
  })
  return (await res.json()) as { ok: boolean; error?: string }
}

/**
 * 读验证等待态（自动验证轮询）：服务端纯本地读（验证窗正文 / 持久
 * cookie），零新请求、不烧按窗口计数的声誉，前端每 2s 问一次即可。
 */
export async function verifyState(
  url: string,
  opts?: { mode?: BrowserMode },
): Promise<{ ok: boolean; pending?: boolean; passed?: boolean; error?: string }> {
  const qs = new URLSearchParams({ url, ...(opts?.mode === 'ephemeral' ? { mode: 'ephemeral' } : {}) })
  const res = await fetch(`/api/browser/verify-state?${qs}`)
  return (await res.json()) as { ok: boolean; pending?: boolean; passed?: boolean; error?: string }
}
