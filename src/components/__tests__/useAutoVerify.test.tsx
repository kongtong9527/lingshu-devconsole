/**
 * useAutoVerify 单测（修订：去重与挂载无关）。
 * client 全 mock + 短轮询注入，不碰真浏览器；store 用真的。
 * 模块级去重（handled 对象集 + episode 计数）跨用例常驻——各用例用不同 URL 隔离。
 */
import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openVerifyWindow, verifyState } from '../../api/client.js'
import { useStore } from '../../store.js'
import type { RunResponse } from '../../types.js'
import { rearmAuto, useAutoVerify } from '../useAutoVerify.js'

vi.mock('../../api/client.js', () => ({
  getPlugins: vi.fn(),
  run: vi.fn(),
  openUiStream: vi.fn(),
  respondUi: vi.fn(),
  browserStatus: vi.fn(),
  openVerifyWindow: vi.fn(),
  verifyState: vi.fn(),
}))

const openMock = vi.mocked(openVerifyWindow)
const stateMock = vi.mocked(verifyState)
const SHORT_POLL = { intervalMs: 5, rounds: 5 }

let urlSeq = 0
const freshUrl = (): string => `https://x.example/t${(urlSeq += 1)}`

const failResult = (url: string): RunResponse => ({ ok: false, code: 'CHALLENGE', url, error: 'blocked', durationMs: 0 })

function setPlugin(id: string | null): void {
  useStore.setState((s) => ({ selected: { ...s.selected, pluginId: id } }))
}

function withRun(runMock: ReturnType<typeof vi.fn>) {
  const prevRun = useStore.getState().run
  useStore.setState({ run: runMock as unknown as () => Promise<void> })
  return () => useStore.setState({ run: prevRun })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setPlugin('anime_site_a')
  useStore.setState({ browserMode: 'persistent', result: null })
  openMock.mockResolvedValue({ ok: true })
  stateMock.mockResolvedValue({ ok: true, pending: true, passed: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function hookProps(url: string, over: Record<string, unknown> = {}) {
  const result = failResult(url)
  // 贴近线上：挑战块拿到的正是 store 当前结果
  useStore.setState({ result })
  return {
    enabled: true,
    pluginId: 'anime_site_a',
    challengeUrl: url,
    resultCode: 'CHALLENGE' as string | undefined,
    resultOk: false,
    result,
    poll: SHORT_POLL,
    ...over,
  }
}

describe('useAutoVerify（自动验证引擎）', () => {
  it('开关关时不自动开窗', async () => {
    const url = freshUrl()
    const props = hookProps(url, { enabled: false })
    renderHook(() => useAutoVerify(props))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('非结构化 code（仅文案命中）不触发自动（防误开窗）', async () => {
    const url = freshUrl()
    const result: RunResponse = { ok: false, error: 'Cloudflare 拦截', durationMs: 0 }
    useStore.setState({ result })
    const props = { ...hookProps(url), resultCode: undefined, resultOk: false, result }
    renderHook(() => useAutoVerify(props))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('CHALLENGE → 按偏好开窗 → 通过即自动重试一轮', async () => {
    const url = freshUrl()
    localStorage.setItem('devconsole-browser-pref:anime_site_a', 'ephemeral')
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const props = hookProps(url)
      const { result } = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalledWith(url, { mode: 'ephemeral' }))
      expect(useStore.getState().browserMode).toBe('ephemeral')
      stateMock.mockResolvedValue({ ok: true, pending: true, passed: true })
      await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.auto.phase).toBe('idle'))
    } finally {
      restore()
    }
  })

  it('StrictMode 重跑 effect 也只开一次窗（同步占位）', async () => {
    const url = freshUrl()
    stateMock.mockResolvedValue({ ok: true, pending: true, passed: true })
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <React.StrictMode>{children}</React.StrictMode>
      )
      const props = hookProps(url)
      renderHook(() => useAutoVerify(props), { wrapper })
      await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1), { timeout: 2000 })
      // 给重跑留足时间：窗只开一次
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(openMock).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('缺省偏好走持久开窗（mode 不传即持久）', async () => {
    const url = freshUrl()
    stateMock.mockResolvedValue({ ok: true, pending: true, passed: true })
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const props = hookProps(url)
      renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalledWith(url, undefined))
      await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1))
    } finally {
      restore()
    }
  })

  it('一直没通过：轮询耗尽转手动，不重试', async () => {
    const url = freshUrl()
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const props = hookProps(url)
      const { result } = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalled())
      await waitFor(() => expect(result.current.auto.phase).toBe('idle'), { timeout: 2000 })
      expect(runMock).not.toHaveBeenCalled()
      expect(result.current.auto.note).toMatch(/超时/)
    } finally {
      restore()
    }
  })

  it('用户关窗（pending=false）：停，转手动，不重试', async () => {
    const url = freshUrl()
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      stateMock.mockResolvedValue({ ok: true, pending: false, passed: false })
      const props = hookProps(url)
      const { result } = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(result.current.auto.phase).toBe('idle'), { timeout: 2000 })
      expect(openMock).toHaveBeenCalledTimes(1)
      expect(runMock).not.toHaveBeenCalled()
      expect(result.current.auto.note).toMatch(/已关/)
    } finally {
      restore()
    }
  })

  it('开窗失败：解除武装 + 转手动，不轮询不重试', async () => {
    const url = freshUrl()
    openMock.mockResolvedValue({ ok: false, error: 'no chrome' })
    localStorage.setItem('devconsole-browser-pref:anime_site_a', 'ephemeral')
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    useStore.setState({ browserMode: 'persistent' })
    try {
      const props = hookProps(url)
      const { result } = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(result.current.auto.phase).toBe('idle'), { timeout: 2000 })
      expect(stateMock).not.toHaveBeenCalled()
      expect(runMock).not.toHaveBeenCalled()
      expect(useStore.getState().browserMode).toBe('persistent')
      expect(result.current.auto.note).toMatch(/开窗失败/)
    } finally {
      restore()
    }
  })

  it('bug1 回归：run 落定重挂同一对象，不二次开窗', async () => {
    const url = freshUrl()
    stateMock.mockResolvedValue({ ok: true, pending: false, passed: false })
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const props = hookProps(url)
      const first = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1))
      // run() 落定 = ResultPanel 切 Skeleton 卸载挑战块，再带同一对象重挂
      first.unmount()
      renderHook(() => useAutoVerify(props))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(openMock).toHaveBeenCalledTimes(1)
      expect(runMock).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('bug1 回归：自动重试又 CHALLENGE（新对象、同一 episode），不再开窗', async () => {
    const url = freshUrl()
    stateMock.mockResolvedValue({ ok: true, pending: true, passed: true })
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const { rerender } = renderHook((p: ReturnType<typeof hookProps>) => useAutoVerify(p), {
        initialProps: hookProps(url),
      })
      await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1))
      // 自动重试落定仍是 CHALLENGE：新结果对象、同一 URL
      const retryResult = failResult(url)
      useStore.setState({ result: retryResult })
      rerender({
        enabled: true,
        pluginId: 'anime_site_a',
        challengeUrl: url,
        resultCode: 'CHALLENGE',
        resultOk: false,
        result: retryResult,
        poll: SHORT_POLL,
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(openMock).toHaveBeenCalledTimes(1)
      expect(runMock).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('bug2 回归：返回已处理过的旧结果，不自动开窗', async () => {
    const url = freshUrl()
    stateMock.mockResolvedValue({ ok: true, pending: false, passed: false })
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const props = hookProps(url)
      const first = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1))
      first.unmount()
      // 返回按钮回到这个旧结果：新挂载、同一对象 → 不触发
      useStore.setState({ result: props.result })
      renderHook(() => useAutoVerify(props))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(openMock).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('亲手重开开关（rearm）后，当前结果可再自动一次', async () => {
    const url = freshUrl()
    stateMock.mockResolvedValue({ ok: true, pending: false, passed: false })
    const runMock = vi.fn().mockResolvedValue(undefined)
    const restore = withRun(runMock)
    try {
      const props = hookProps(url)
      const first = renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1))
      first.unmount()
      // 关→开：清去重标记，新挂载重新触发
      rearmAuto(props.result, 'anime_site_a', url)
      renderHook(() => useAutoVerify(props))
      await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2), { timeout: 2000 })
    } finally {
      restore()
    }
  })
})
