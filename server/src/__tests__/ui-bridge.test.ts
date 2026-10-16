import { describe, it, expect } from 'vitest'
import type { ServerResponse } from 'node:http'
import { sharedUiHandler, resolvePrompt, addStream, removeStream } from '../ui-bridge.js'
import type { UiPrompt } from '@lingshu/runtime'

/** 伪造 SSE 连接：只捕获 write 的帧（addStream 只用 .write） */
function makeStream(): { res: ServerResponse; frames: string[] } {
  const frames: string[] = []
  const res = { write: (c: string) => { frames.push(c); return true } } as unknown as ServerResponse
  return { res, frames }
}

/** 解析一帧 `data: {...}\n\n` */
function parseFrame(frame: string): { promptId: string; prompt: UiPrompt } {
  const m = frame.match(/^data: (.*)\n\n$/)
  return JSON.parse(m![1])
}

function delay(ms: number): Promise<string> {
  return new Promise((r) => setTimeout(() => r('pending'), ms))
}

describe('ui-bridge（$lib.ui 的 DevConsole 桥, ADR-0006）', () => {
  it('input：推 SSE 后挂起，resolvePrompt 后返回答案', async () => {
    const { res, frames } = makeStream()
    addStream(res)
    const pending = sharedUiHandler({ kind: 'input', title: '验证码', image: 'data:image/png;base64,AA' })
    // broadcast 在 Promise executor 内同步执行，故帧已写出
    expect(frames).toHaveLength(1)
    const { promptId, prompt } = parseFrame(frames[0])
    expect(prompt.kind).toBe('input')

    // resolvePrompt 前确实挂起（与 10ms 延时赛跑，应仍是 pending）
    const before = await Promise.race([pending.then(() => 'done'), delay(10)])
    expect(before).toBe('pending')

    // 模拟前端 POST /api/ui/respond 回传 → 解封
    expect(resolvePrompt(promptId, 'Z9X8')).toBe(true)
    expect(await pending).toBe('Z9X8')
    removeStream(res)
  })

  it('message：fire-and-forget，推帧后立即返回 undefined', async () => {
    const { res, frames } = makeStream()
    addStream(res)
    const r = await sharedUiHandler({ kind: 'message', text: '签到成功' })
    expect(r).toBeUndefined()
    expect(frames).toHaveLength(1)
    expect(parseFrame(frames[0]).prompt.kind).toBe('message')
    removeStream(res)
  })

  it('launchUrl：fire-and-forget，推帧后立即返回 undefined', async () => {
    const { res, frames } = makeStream()
    addStream(res)
    const r = await sharedUiHandler({ kind: 'launchUrl', url: 'https://example.com/buy' })
    expect(r).toBeUndefined()
    const { prompt } = parseFrame(frames[0])
    expect(prompt.kind).toBe('launchUrl')
    removeStream(res)
  })

  it('无连接时 message 不抛错（broadcast no-op）', () => {
    // 不 addStream；message 是 fire-and-forget，broadcast 无接收方应静默
    expect(() => sharedUiHandler({ kind: 'message', text: 'hi' })).not.toThrow()
  })

  it('resolvePrompt 未知 promptId 返回 false', () => {
    expect(resolvePrompt('not-a-real-id', 'x')).toBe(false)
  })
})
