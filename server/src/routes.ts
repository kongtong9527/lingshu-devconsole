import type { FastifyInstance } from 'fastify'
import { listPlugins, runPlugin, type RunRequest } from './plugin-service.js'
import { validateProxyUrl, fetchViaProxy, type ImageEncryptionConfig } from './proxy.js'
import { sharedUiHandler, resolvePrompt, addStream, removeStream } from './ui-bridge.js'
import { getBrowserStatus, getVerifyState, openVerifyWindow } from './browser-channel.js'

export function registerRoutes(app: FastifyInstance) {
  app.get('/api/plugins', async (req) => {
    const dir = (req.query as { dir?: string }).dir
    return { plugins: await listPlugins(dir) }
  })

  app.post('/api/run', async (req, reply) => {
    const body = req.body as RunRequest
    if (!body?.pluginId || !body?.action) {
      reply.code(400)
      return { ok: false, error: '缺少 pluginId 或 action', durationMs: 0 }
    }
    return runPlugin(body, sharedUiHandler)
  })

  // 浏览器通道（ADR-0045）：headed sidecar 状态与验证窗口（被动触发）
  app.get('/api/browser/status', async () => getBrowserStatus())

  app.post('/api/browser/open', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: string; mode?: string }
    if (!body.url) {
      reply.code(400)
      return { ok: false, error: '缺少 url' }
    }
    // ADR-0046：mode 只认 'ephemeral'，其余（含缺省）一律 persistent（零回退）
    const mode = body.mode === 'ephemeral' ? ('ephemeral' as const) : undefined
    try {
      return { ok: true, ...(await openVerifyWindow(body.url, undefined, mode)) }
    } catch (e: any) {
      reply.code(502)
      return { ok: false, error: String(e?.message ?? e), code: e?.code, url: e?.url }
    }
  })

  // 验证等待态（ADR-0047 自动验证轮询）：纯本地读、零新请求，前端每 2s 问一次
  app.get('/api/browser/verify-state', async (req, reply) => {
    const q = (req.query ?? {}) as { url?: string; mode?: string }
    if (!q.url) {
      reply.code(400)
      return { ok: false, error: '缺少 url' }
    }
    // 与 /api/browser/open 同口径：只认 'ephemeral'，其余一律 persistent
    const mode = q.mode === 'ephemeral' ? ('ephemeral' as const) : undefined
    return { ok: true, ...(await getVerifyState(q.url, mode)) }
  })

  // $lib.ui SSE 流（ADR-0006）：前端 EventSource 连这里收插件中途发起的 prompt
  app.get('/api/ui/stream', async (req, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.flushHeaders()
    addStream(reply.raw)
    // 心跳注释行保持连接（前端忽略），防中间层超时断开
    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n')
      } catch {
        /* 连接已断 */
      }
    }, 30000)
    req.raw.on('close', () => {
      clearInterval(keepAlive)
      removeStream(reply.raw)
    })
  })

  // $lib.ui 回传答案（input/confirm）：按 promptId resolve 对应的 await
  app.post('/api/ui/respond', async (req, reply) => {
    const body = (req.body ?? {}) as { promptId?: string; response?: unknown }
    if (!body.promptId) {
      reply.code(400)
      return { ok: false, error: '缺少 promptId' }
    }
    const ok = resolvePrompt(body.promptId, body.response as string | undefined)
    return { ok }
  })

  app.get('/api/proxy', async (req, reply) => {
    const query = req.query as { url?: string; decrypt?: string; transport?: string; referer?: string }
    const raw = query.url
    const check = validateProxyUrl(raw)
    if (!check.ok) {
      reply.code(400)
      return { error: check.error }
    }
    let decrypt: ImageEncryptionConfig | undefined
    if (query.decrypt) {
      try {
        decrypt = JSON.parse(query.decrypt) as ImageEncryptionConfig
      } catch {
        reply.code(400)
        return { error: 'decrypt 参数不是有效 JSON' }
      }
    }
    try {
      const imageTransport = query.transport === undefined ? undefined : { encoding: query.transport }
      const r = await fetchViaProxy(check.url, {
        decrypt,
        imageTransport,
        referer: query.referer || undefined,
        range: typeof req.headers.range === 'string' ? req.headers.range : undefined,
      })
      reply.code(r.status)
      for (const [k, v] of Object.entries(r.headers)) reply.header(k, v)
      // Buffer（HLS 重写/图片变换）直接返回；Readable（媒体直通）由 Fastify 流式发送
      return reply.send(r.body)
    } catch (e: any) {
      reply.code(502)
      return { error: String(e?.message ?? e) }
    }
  })
}
