/**
 * 自动验证引擎（ADR-0047；修订：去重状态必须与挂载无关）。
 *
 * 省掉的是三次鼠标（开窗 / 盯窗 / 重试），省不掉的是窗内那一下人机验证。
 *
 * 血泪教训（2026-09 真机无限开窗）：去重计数 Ol→放在挂载期 ref 里，但 `run()`
 * 期间 `ResultPanel` 切 Skeleton 会卸载挑战块、落定后带新结果对象重挂——
 * ref 清零，每轮自动重试都从零开始，无限开窗。修复：去重状态全部搬到模块级，
 * 与挂载/重挂无关：
 * - handled 结果对象集（同一对象最多自动一次：重挂同一对象、返回旧对象都不触发）；
 * - episode 计数（同一插件+URL 最多自动一轮：自动重试又 CHALLENGE 也不触发）；
 * - 只处理当前结果（历史里多个挑战块同时挂着也不误触）。
 * 安全线（防烧声誉、防骚扰）：
 * - 只认结构化 `code==='CHALLENGE'`（文案兜底不触发，防误开窗）；
 * - 每 episode 最多自动重试一次，仍失败就停（不循环）；
 * - 轮询走 `/api/browser/verify-state` 纯本地读，零新请求（不烧窗口计数）；
 * - 用户关窗 / 超时（120s）/ 切插件 / 取消 / 结果换人 → 停，转手动；
 * - 通道形态沿用该插件偏好（上次点的哪个窗，自动开哪个）。
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { openVerifyWindow, verifyState } from '../api/client.js'
import { loadBrowserPref } from '../verify-prefs.js'
import type { RunResponse } from '../types.js'

export type AutoPhase = 'idle' | 'opening' | 'waiting' | 'retrying'

export interface AutoUi {
  phase: AutoPhase
  /** 状态行 / 转手动原因（idle + note = 上轮自动的收尾交代） */
  note?: string
}

/** 轮询间隔 2s × 60 轮 = 120s（够人手过一次 Turnstile；超时转手动） */
export const AUTO_POLL_MS = 2000
export const AUTO_WAIT_ROUNDS = 60

/** 已自动处理过的结果对象（模块级：重挂、返回旧结果都不二次触发） */
const handledResults = new WeakSet<object>()
/** episode 自动次数（模块级：`${pluginId}::${url}`，>0 即停，防重试失败循环） */
const episodeAttempts = new Map<string, number>()

function episodeKey(pluginId: string, url: string): string {
  return `${pluginId}::${url}`
}

/** 清掉该插件全部 episode（非挑战结果到 = 本段挑战结束，下次从零计） */
function clearPluginEpisodes(pluginId: string): void {
  for (const k of [...episodeAttempts.keys()]) {
    if (k.startsWith(`${pluginId}::`)) episodeAttempts.delete(k)
  }
  if (episodeAttempts.size > 200) episodeAttempts.clear()
}

/**
 * 重新武装（用户亲手把开关关了又开 = 明确要再来一次）：清掉当前结果的
 * handled 标记与 episode 计数，effect 会重新评估触发。
 */
export function rearmAuto(result: RunResponse, pluginId: string, url: string): void {
  try {
    handledResults.delete(result as object)
  } catch {
    /* 非对象结果，删不上就算 */
  }
  episodeAttempts.delete(episodeKey(pluginId, url))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function useAutoVerify(opts: {
  enabled: boolean
  pluginId: string | null
  challengeUrl: string | undefined
  resultCode: string | undefined
  resultOk: boolean
  /** 结果对象本体（去重 + 换对象即作废陈旧流程） */
  result: RunResponse
  /** 单测注入短轮询；线上走默认 */
  poll?: { intervalMs: number; rounds: number }
}): { auto: AutoUi; cancelAuto: () => void } {
  const { enabled, pluginId, challengeUrl, resultCode, resultOk, result, poll } = opts
  const run = useStore((s) => s.run)
  const [auto, setAuto] = useState<AutoUi>({ phase: 'idle' })
  const lastPluginRef = useRef<string | null>(null)
  const lastResultRef = useRef<RunResponse | null>(null)
  /** 流程令牌：切插件/换结果/取消一律作废旧流程 */
  const flowRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const alive = (flow: number): boolean => mountedRef.current && flowRef.current === flow

  const cancelAuto = (): void => {
    flowRef.current += 1
    setAuto({ phase: 'idle' })
  }

  useEffect(() => {
    if (pluginId !== lastPluginRef.current) {
      // 切插件：旧流程作废（episode 留给 clearPluginEpisodes 按结果收尾）
      lastPluginRef.current = pluginId
      flowRef.current += 1
      setAuto({ phase: 'idle' })
    }
    if (result !== lastResultRef.current) {
      // 结果换人（run 落定 / 返回旧结果）：陈旧流程作废，去重按新对象重估
      lastResultRef.current = result
      flowRef.current += 1
    }
    if (!enabled || !pluginId || !challengeUrl || resultOk || resultCode !== 'CHALLENGE') {
      if ((resultOk || resultCode !== 'CHALLENGE') && pluginId) clearPluginEpisodes(pluginId)
      return
    }
    // 只处理当前结果（历史里同时挂着多个挑战块也不误触）
    if (result !== useStore.getState().result) return
    // 模块级去重（与挂载无关）：同一对象一次，同一 episode 一轮
    try {
      if (handledResults.has(result as object)) return
    } catch {
      return
    }
    const key = episodeKey(pluginId, challengeUrl)
    if ((episodeAttempts.get(key) ?? 0) > 0) return
    try {
      handledResults.add(result as object)
    } catch {
      return
    }
    episodeAttempts.set(key, 1)
    flowRef.current += 1
    const flow = flowRef.current
    void autoFlow(flow)
    // autoFlow 闭包读最新 store（getState），不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pluginId, challengeUrl, resultCode, resultOk, result])

  async function autoFlow(flow: number): Promise<void> {
    const pid = pluginId
    const url = challengeUrl
    if (!pid || !url) return
    const mode = loadBrowserPref(pid)
    const modeOpt = mode === 'ephemeral' ? ({ mode } as const) : undefined
    const st = useStore.getState()
    // 与手动两按钮同语义：ephemeral 武装下一次 run，persistent 回位
    st.setBrowserMode(mode)
    if (alive(flow)) {
      setAuto({ phase: 'opening', note: mode === 'ephemeral' ? '自动开窗中（一次性窗口）…' : '自动开窗中…' })
    }
    let opened: { ok: boolean; error?: string }
    try {
      opened = await openVerifyWindow(url, modeOpt)
    } catch (e) {
      opened = { ok: false, error: String(e) }
    }
    if (!alive(flow)) return
    if (!opened.ok) {
      // 开窗失败即解除武装（与手动一次性失败同语义），转手动
      st.setBrowserMode('persistent')
      setAuto({ phase: 'idle', note: `自动开窗失败，转手动：${opened.error ?? '未知错误'}` })
      return
    }
    setAuto({ phase: 'waiting', note: '验证窗已开，在窗内完成验证即可（2s 看一眼，不发新请求）…' })
    const intervalMs = poll?.intervalMs ?? AUTO_POLL_MS
    const rounds = poll?.rounds ?? AUTO_WAIT_ROUNDS
    for (let i = 0; i < rounds; i++) {
      await sleep(intervalMs)
      if (!alive(flow)) return
      let s: { ok: boolean; pending?: boolean; passed?: boolean }
      try {
        s = await verifyState(url, modeOpt)
      } catch {
        continue // 网络抖动等下一轮，不转手动
      }
      if (!alive(flow)) return
      if (!s.ok || !s.pending) {
        setAuto({ phase: 'idle', note: '验证窗已关，转手动：确认后点「重试」。' })
        return
      }
      if (s.passed) break
      if (i === rounds - 1) {
        setAuto({ phase: 'idle', note: '等验证超时，转手动：确认通过后点「重试」。' })
        return
      }
    }
    // 用户中途手动切了形态 = 接管，自动停（persistent 本就是默认态，只判 ephemeral 武装丢失）
    if (mode === 'ephemeral' && useStore.getState().browserMode !== 'ephemeral') {
      if (alive(flow)) setAuto({ phase: 'idle', note: '检测到手动接管，转手动。' })
      return
    }
    if (alive(flow)) setAuto({ phase: 'retrying', note: '验证通过，自动重试中…' })
    try {
      await run()
    } finally {
      if (alive(flow)) setAuto({ phase: 'idle' })
    }
  }

  return { auto, cancelAuto }
}
