import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChallengeError, { isChallengeResult } from '../ChallengeError.js'
import { useStore } from '../../store.js'
import { loadAutoVerify, loadBrowserPref } from '../../verify-prefs.js'
import { openVerifyWindow } from '../../api/client.js'
import type { RunResponse } from '../../types.js'

vi.mock('../../api/client.js', () => ({
  getPlugins: vi.fn(),
  run: vi.fn(),
  openUiStream: vi.fn(),
  respondUi: vi.fn(),
  browserStatus: vi.fn(),
  openVerifyWindow: vi.fn(),
  verifyState: vi.fn(),
}))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useStore.setState((s) => ({ selected: { ...s.selected, pluginId: 'anime_site_a' } }))
})

const fail = (over: Partial<RunResponse> = {}): RunResponse => ({
  ok: false,
  error: 'boom',
  durationMs: 0,
  ...over,
})

describe('isChallengeResult（挑战态判定）', () => {
  it('ok 结果永不挑战', () => {
    expect(isChallengeResult({ ok: true, durationMs: 0, data: {} })).toBe(false)
  })

  it('结构化 code=CHALLENGE 即挑战', () => {
    expect(isChallengeResult(fail({ code: 'CHALLENGE', url: 'https://x.example/' }))).toBe(true)
  })

  it('老插件裸文案命中即挑战（兜底）', () => {
    expect(
      isChallengeResult(fail({ error: 'anime_site_a: 目标站被 Cloudflare 拦截（https://x.example/）' })),
    ).toBe(true)
  })

  it('普通错误不进挑战态', () => {
    expect(isChallengeResult(fail({ error: 'GET https://x.example/ 失败: HTTP 500' }))).toBe(false)
  })
})

describe('ChallengeError（挑战态 UI，ADR-0045 Q11）', () => {
  it('标题 + 三按钮 + 挑战说明', () => {
    render(
      <ChallengeError
        result={fail({
          code: 'CHALLENGE',
          url: 'https://x.example/list',
          error: 'anime_site_a: 目标站被 Cloudflare 拦截',
        })}
      />,
    )
    expect(screen.getByText('需要验证后访问')).toBeTruthy()
    expect(screen.getByText('打开验证窗口')).toBeTruthy()
    expect(screen.getByText('在浏览器打开')).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
  })

  it('一次性按钮存在（ADR-0046）：文案 + 无 url 时同样禁用', () => {
    render(
      <ChallengeError
        result={fail({
          code: 'CHALLENGE',
          url: 'https://x.example/list',
          error: 'anime_site_a: 目标站被 Cloudflare 拦截',
        })}
      />,
    )
    expect(screen.getByText('一次性窗口打开')).toBeTruthy()
  })

  it('无 url 时验证窗口按钮禁用（不裸跳）', () => {
    render(<ChallengeError result={fail({ code: 'CHALLENGE', error: '被拦截' })} />)
    expect((screen.getByText('打开验证窗口') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('一次性窗口打开') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('重试') as HTMLButtonElement).disabled).toBe(false)
  })

  it('自动开关：按插件记忆（ADR-0047，缺省关）', () => {
    render(
      <ChallengeError
        result={fail({ code: 'CHALLENGE', url: 'https://x.example/list', error: '被拦截' })}
      />,
    )
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(loadAutoVerify('anime_site_a')).toBe(true)
    fireEvent.click(box)
    expect(loadAutoVerify('anime_site_a')).toBe(false)
  })

  it('点的哪个窗记住哪个（自动开窗沿用）', async () => {
    vi.mocked(openVerifyWindow).mockResolvedValue({ ok: true })
    render(
      <ChallengeError
        result={fail({ code: 'CHALLENGE', url: 'https://x.example/list', error: '被拦截' })}
      />,
    )
    fireEvent.click(screen.getByText('一次性窗口打开'))
    await screen.findByText(/一次性窗口已打开/)
    expect(loadBrowserPref('anime_site_a')).toBe('ephemeral')
  })
})
