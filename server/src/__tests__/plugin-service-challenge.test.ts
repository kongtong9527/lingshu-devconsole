// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runPlugin } from '../plugin-service.js'
import { _internals, closeBrowser } from '../browser-channel.js'

const realLoader = _internals.loadChromium

afterEach(async () => {
  _internals.loadChromium = realLoader
  await closeBrowser()
})

/** 写合成插件到临时目录（runPlugin 按 id 精确匹配 <id>.plugin.js） */
function writePlugin(id: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-svc-'))
  fs.writeFileSync(
    path.join(dir, `${id}.plugin.js`),
    `// ==Plugin==\n// id: ${id}\n// name: ${id}\n// version: 0.0.1\n// ==EndPlugin==\n${body}`,
  )
  return dir
}

const DETAIL_STUB = `async function fetchDetail(url) { return { title: url, content: [] } }`

describe('plugin-service 浏览器通道与结构化错误', () => {
  it('插件抛 CHALLENGE：code/url 透传到 RunResponse（预览区切挑战态用）', async () => {
    const dir = writePlugin(
      'challenge-codec',
      `${DETAIL_STUB}
async function fetchList() {
  const e = new Error('anime_site_a: 目标站被 Cloudflare 拦截（https://x.example/，HTTP 403 挑战/block 页）')
  e.code = 'CHALLENGE'
  e.url = 'https://x.example/'
  throw e
}
module.exports = { fetchList, fetchDetail }`,
    )
    // 直连被插件短路（无网络），浏览器通道不会被调用
    const res = await runPlugin({ pluginId: 'challenge-codec', action: 'list', options: { dir } })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('CHALLENGE')
    expect(res.url).toBe('https://x.example/')
    expect(res.error).toContain('Cloudflare')
  })

  it('插件调 browser.getHtml：走 headed 注入并记 BROWSER 日志', async () => {
    const page = {
      async goto() {
        return { status: () => 200, allHeaders: async () => ({ 'content-type': 'text/html' }) }
      },
      async content() {
        return '<html><body> headed list </body></html>'
      },
      async setExtraHTTPHeaders() {},
      async close() {},
      async bringToFront() {},
    }
    _internals.loadChromium = async () =>
      ({
        chromium: {
          async launchPersistentContext() {
            return {
              async newPage() {
                return page
              },
              async cookies() {
                return []
              },
              async close() {},
              on() {},
            }
          },
        },
      }) as never
    const dir = writePlugin(
      'challenge-headed',
      `${DETAIL_STUB}
async function fetchList() {
  const via = await $lib.browser.getHtml('https://x.example/list', { headers: {} })
  return { items: [{ title: via.body }] }
}
module.exports = { fetchList, fetchDetail }`,
    )
    const res = await runPlugin({ pluginId: 'challenge-headed', action: 'list', options: { dir } })
    expect(res.ok).toBe(true)
    expect((res.data.items as { title: string }[])[0].title).toContain('headed list')
    const methods = res.httpLog.map((r) => r.method)
    expect(methods).toContain('BROWSER')
    const browserRecord = res.httpLog.find((r) => r.method === 'BROWSER')!
    expect(browserRecord.status).toBe(200)
    expect(browserRecord.responseHeaders['x-lingshu-browser']).toBe('headed')
  })

  it('browserMode=ephemeral：本次 run 内 getHtml 走一次性（headed-ephemeral），缺省仍持久', async () => {
    const persistentPage = {
      async goto() {
        return { status: () => 200, allHeaders: async () => ({}) }
      },
      async content() {
        return '<html><body>persistent</body></html>'
      },
      async setExtraHTTPHeaders() {},
      async close() {},
      async bringToFront() {},
    }
    const ephemeralPage = {
      async goto() {
        return { status: () => 200, allHeaders: async () => ({}) }
      },
      async content() {
        return '<html><body>ephemeral</body></html>'
      },
      async setExtraHTTPHeaders() {},
      async close() {},
      async bringToFront() {},
    }
    _internals.loadChromium = async () =>
      ({
        chromium: {
          async launchPersistentContext() {
            return {
              async newPage() {
                return persistentPage
              },
              async cookies() {
                return []
              },
              async close() {},
              on() {},
            }
          },
          async launch() {
            return {
              async newContext() {
                return {
                  async newPage() {
                    return ephemeralPage
                  },
                  async close() {},
                  on() {},
                }
              },
              async close() {},
            }
          },
        },
      }) as never
    const dir = writePlugin(
      'challenge-mode',
      `${DETAIL_STUB}
async function fetchList() {
  const via = await $lib.browser.getHtml('https://x.example/list', { headers: {} })
  return { items: [{ title: via.body }] }
}
module.exports = { fetchList, fetchDetail }`,
    )
    const ephemeralRes = await runPlugin({ pluginId: 'challenge-mode', action: 'list', options: { dir, browserMode: 'ephemeral' } })
    expect(ephemeralRes.ok).toBe(true)
    expect((ephemeralRes.data.items as { title: string }[])[0].title).toContain('ephemeral')
    expect(ephemeralRes.httpLog.find((r) => r.method === 'BROWSER')!.responseHeaders['x-lingshu-browser']).toBe('headed-ephemeral')
    // 持久不受污染：缺省 run 仍走 headed
    const persistentRes = await runPlugin({ pluginId: 'challenge-mode', action: 'list', options: { dir } })
    expect((persistentRes.data.items as { title: string }[])[0].title).toContain('persistent')
    expect(persistentRes.httpLog.find((r) => r.method === 'BROWSER')!.responseHeaders['x-lingshu-browser']).toBe('headed')
  })
})
