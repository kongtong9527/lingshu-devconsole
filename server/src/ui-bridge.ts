import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { UiPrompt, UiResponse, UiRequestHandler } from '@lingshu/runtime'

/**
 * $lib.ui 的 DevConsole 桥（ADR-0006）。
 *
 * 模型：run 仍是「POST /api/run → JSON RunResponse」（happy path 不变）。当插件在 run 中途
 * 调 `$lib.ui.*` 时，sharedUiHandler 把 prompt 经 SSE（GET /api/ui/stream）推给前端：
 *   - input/confirm：等前端 POST /api/ui/respond 回传答案后再 resolve（插件在 await）。
 *   - message/launchUrl：推过去即 resolve（fire-and-forget，插件不等）。
 *
 * 单用户假设：DevConsole 一次一个用户，所有活跃 SSE 连接都收到 prompt，respond 按 promptId 路由。
 * 若无连接且 input/confirm 触发，run 会挂起——dev 场景前端始终在线，故不额外处理。
 */

// 活跃 SSE 连接（底层 ServerResponse，直接 write SSE 帧）
const streams = new Set<ServerResponse>()
// 待响应的 input/confirm：promptId → resolver
const pending = new Map<string, { resolve: (v: UiResponse) => void; reject: (e: Error) => void }>()

export function addStream(res: ServerResponse): void {
  streams.add(res)
}

export function removeStream(res: ServerResponse): void {
  streams.delete(res)
}

function broadcast(payload: unknown): void {
  if (streams.size === 0) return
  const frame = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of streams) {
    try {
      res.write(frame)
    } catch {
      streams.delete(res)
    }
  }
}

/**
 * $lib.ui 的宿主处理器（注入 runPlugin → executeRun → createUiAPI）。
 * 推 prompt 到 SSE；input/confirm 等前端 respond，message/launchUrl 立即返回。
 */
export const sharedUiHandler: UiRequestHandler = async (prompt: UiPrompt): Promise<UiResponse> => {
  const promptId = randomUUID()
  // message/launchUrl：fire-and-forget，推过去即返回（与 createUiAPI 的非阻塞语义一致）
  if (prompt.kind === 'message' || prompt.kind === 'launchUrl') {
    broadcast({ promptId, prompt })
    return undefined
  }
  // input/confirm：推过去，等前端 POST /api/ui/respond 回传
  return await new Promise<UiResponse>((resolve, reject) => {
    pending.set(promptId, { resolve, reject })
    broadcast({ promptId, prompt })
  })
}

/** POST /api/ui/respond 调用：按 promptId resolve 对应的 input/confirm。 */
export function resolvePrompt(promptId: string, response: UiResponse): boolean {
  const entry = pending.get(promptId)
  if (!entry) return false
  pending.delete(promptId)
  entry.resolve(response)
  return true
}
