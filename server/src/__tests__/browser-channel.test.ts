// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  fetchHtmlViaBrowser,
  openVerifyWindow,
  getBrowserStatus,
  getVerifyState,
  closeBrowser,
  _internals,
} from '../browser-channel.js'

const CHALLENGE_HTML =
  '<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>'

/** 假 page：goto 回 403 挑战页（原文 resolve，交插件 assertNotBlocked） */
function fakePage() {
  return {
    gotoCalls: [] as string[],
    async goto(url: string) {
      this.gotoCalls.push(url)
      return {
        status: () => 403,
        allHeaders: async () => ({ 'content-type': 'text/html', 'cf-mitigated': 'challenge' }),
      }
    },
    async content() {
      return CHALLENGE_HTML
    },
    async setExtraHTTPHeaders() {
      /* 记录即覆盖 */
    },
    async close() {
      /* 无 */
    },
    async bringToFront() {
      /* 无 */
    },
  }
}

function fakeChromium(page: ReturnType<typeof fakePage>, opts: { failChannels?: string[] } = {}) {
  return {
    launchCalls: [] as { dir: string; opts: unknown }[],
    async launchPersistentContext(dir: string, launchOpts: any) {
      this.launchCalls.push({ dir, opts: launchOpts })
      if (opts.failChannels?.includes(launchOpts.channel)) {
        throw new Error(`no ${launchOpts.channel}`)
      }
      return {
        async newPage() {
          return page
        },
        async cookies() {
          return [{ name: 'cf_clearance', value: 'abc', domain: '.x.example', path: '/' }]
        },
        async close() {
          /* 无 */
        },
        on() {
          /* 无 */
        },
      }
    },
  }
}

const realLoader = _internals.loadChromium

afterEach(async () => {
  _internals.loadChromium = realLoader
  await closeBrowser()
  vi.restoreAllMocks()
})

describe('browser-channel headed sidecar（ADR-0045）', () => {
  it('挑战页原文 resolve（403 + body 交插件判定），打 headed 标记 + 回传 cookie', async () => {
    const page = fakePage()
    const chromium = fakeChromium(page)
    _internals.loadChromium = async () => ({ chromium }) as never
    const r = await fetchHtmlViaBrowser('https://x.example/list', {
      headers: { 'User-Agent': 'UA-1', Referer: 'https://x.example/' },
    })
    expect(r.status).toBe(403)
    expect(r.body).toContain('Just a moment')
    expect(r.headers['x-lingshu-browser']).toBe('headed')
    expect(r.cookies).toEqual([{ name: 'cf_clearance', value: 'abc', domain: '.x.example', path: '/' }])
    // 同 UA 红线：插件 UA 透传进持久上下文启动参数
    expect(chromium.launchCalls[0].opts).toMatchObject({ headless: false, channel: 'chrome', userAgent: 'UA-1' })
    // profile 落盘（clearance 跨 run 有效）
    expect(chromium.launchCalls[0].dir).toContain('lingshu-devconsole-browser-profile')
  })

  it('串行：两次抓取按序进同一上下文（不并发打爆反爬）', async () => {
    const page = fakePage()
    const chromium = fakeChromium(page)
    _internals.loadChromium = async () => ({ chromium }) as never
    const [a, b] = await Promise.all([
      fetchHtmlViaBrowser('https://x.example/a'),
      fetchHtmlViaBrowser('https://x.example/b'),
    ])
    expect(a.status).toBe(403)
    expect(b.status).toBe(403)
    // 同一持久上下文只建一次
    expect(chromium.launchCalls).toHaveLength(1)
    expect(page.gotoCalls).toEqual(['https://x.example/a', 'https://x.example/b'])
  })

  it('无可用浏览器：reject 带 code=CHALLENGE（引导验证窗口，不裸奔）', async () => {
    const page = fakePage()
    const chromium = fakeChromium(page, { failChannels: ['chrome', 'chromium'] })
    _internals.loadChromium = async () => ({ chromium }) as never
    await expect(fetchHtmlViaBrowser('https://x.example/list')).rejects.toMatchObject({ code: 'CHALLENGE' })
  })

  it('缺 playwright-core：reject 指引安装（不抛模块找不到裸错）', async () => {
    _internals.loadChromium = async () => {
      throw new Error('Cannot find package')
    }
    await expect(fetchHtmlViaBrowser('https://x.example/list')).rejects.toThrow('playwright-core')
  })

  it('openVerifyWindow：导航到挑战页并前置（被动触发，不做程序化导航之外动作）', async () => {
    const page = fakePage()
    const chromium = fakeChromium(page)
    _internals.loadChromium = async () => ({ chromium }) as never
    const r = await openVerifyWindow('https://x.example/list')
    expect(r).toEqual({ opened: true, url: 'https://x.example/list' })
    expect(page.gotoCalls).toEqual(['https://x.example/list'])
  })

  it('连续打开持久验证窗不堆积：旧页即关（只留最新一个标签页）', async () => {
    const closed: boolean[] = []
    const pages: unknown[] = []
    const ctx = {
      async newPage() {
        const i = pages.length
        closed.push(false)
        const p = {
          async goto() {
            return { status: () => 200, allHeaders: async () => ({}) }
          },
          async bringToFront() {},
          async close() {
            closed[i] = true
          },
        }
        pages.push(p)
        return p
      },
      async cookies() {
        return []
      },
      async close() {},
      on() {},
    }
    _internals.loadChromium = async () =>
      ({
        chromium: {
          async launchPersistentContext() {
            return ctx
          },
        },
      }) as never
    await openVerifyWindow('https://x.example/a')
    await openVerifyWindow('https://x.example/b')
    expect(pages).toHaveLength(2)
    // 第一页已关（此前从不关，自动循环几次就一排 Cloudflare 标签页）
    expect(closed).toEqual([true, false])
  })

  it('getBrowserStatus：上下文存在性如实上报', async () => {
    expect(getBrowserStatus().hasContext).toBe(false)
    const page = fakePage()
    _internals.loadChromium = async () => ({ chromium: fakeChromium(page) }) as never
    await fetchHtmlViaBrowser('https://x.example/list')
    expect(getBrowserStatus().hasContext).toBe(true)
  })
})

/** 一次性 page：goto 回 200 正文（新鲜上下文首抓即通） */
function fakeEphemeralPage() {
  return {
    gotoCalls: [] as string[],
    extraHeaders: {} as Record<string, string>,
    closed: false,
    /** page.content() 返回的正文（可改写为挑战页，测窗口保留） */
    body: '<html><body>ephemeral fresh</body></html>',
    currentUrl: '',
    url() {
      if (this.closed) throw new Error('Target closed')
      return this.currentUrl
    },
    async goto(url: string) {
      if (this.closed) throw new Error('Target closed')
      this.gotoCalls.push(url)
      this.currentUrl = url
      return {
        status: () => 200,
        allHeaders: async () => ({ 'content-type': 'text/html' }),
      }
    },
    async content() {
      return this.body
    },
    async setExtraHTTPHeaders(h: Record<string, string>) {
      this.extraHeaders = h
    },
    async close() {
      this.closed = true
    },
    async bringToFront() {},
  }
}

interface EphemeralTrack {
  launchCalls: unknown[]
  browsersClosed: number
  contexts: { page: ReturnType<typeof fakeEphemeralPage>; closed: boolean; closeHandlers: Array<() => void> }[]
}

/** 一次性 chromium：共享 browser（launch 一次）+ 每次 newContext 全新类无痕上下文 */
function fakeEphemeralChromium(track: EphemeralTrack) {
  const browser = {
    async newContext() {
      const page = fakeEphemeralPage()
      const rec = { page, closed: false, closeHandlers: [] as Array<() => void> }
      track.contexts.push(rec)
      return {
        async newPage() {
          return page
        },
        async close() {
          rec.closed = true
          page.closed = true
          // 贴近真 Playwright：ctx.close() 也会触发 close 监听（实现靠自关标记防误杀）
          rec.closeHandlers.splice(0).forEach((fn) => {
            try {
              fn()
            } catch {
              /* 监听内自己消化 */
            }
          })
        },
        on(ev: string, fn: () => void) {
          if (ev === 'close') rec.closeHandlers.push(fn)
        },
      }
    },
    async close() {
      track.browsersClosed += 1
    },
    on() {},
  }
  return {
    async launchPersistentContext() {
      throw new Error('ephemeral 不得走持久上下文')
    },
    async launch(opts: unknown) {
      track.launchCalls.push(opts)
      return browser
    },
  }
}

function freshEphemeralTrack(): EphemeralTrack {
  return { launchCalls: [], browsersClosed: 0, contexts: [] }
}

describe('browser-channel 一次性抓取上下文（ADR-0046，共享 browser + 验证复用）', () => {
  it('ephemeral：打 headed-ephemeral 标记 + cookie 置空 + 上下文即焚 + 空闲连进程一起关', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    const r = await fetchHtmlViaBrowser('https://x.example/list', {
      headers: { 'User-Agent': 'UA-1', Referer: 'https://x.example/' },
      mode: 'ephemeral',
    })
    expect(r.status).toBe(200)
    expect(r.body).toContain('ephemeral fresh')
    expect(r.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    expect(r.cookies).toEqual([])
    // UA 外的头照透（守转正 checklist），UA 本身进 newContext 不进 extra
    expect(track.contexts[0].page.extraHeaders).toEqual({ Referer: 'https://x.example/' })
    // 关上下文即焚；无待复用则连 browser 一起关（修订4：空闲 Dock 归零）
    expect(track.contexts[0].closed).toBe(true)
    expect(track.browsersClosed).toBe(1)
    expect(track.launchCalls[0]).toMatchObject({ headless: false, channel: 'chrome' })
    // 不碰持久缓存：hasContext 仍 false
    expect(getBrowserStatus().hasContext).toBe(false)
  })

  it('ephemeral 新鲜抓取：每次按需起 browser、抓完即关（空闲 Dock 归零，不常驻）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    for (let i = 0; i < 3; i++) {
      const r = await fetchHtmlViaBrowser('https://x.example/same', { mode: 'ephemeral' })
      expect(r.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    }
    // 无待复用不断 browser：三次各起各关，上下文各自即焚
    expect(track.launchCalls).toHaveLength(3)
    expect(track.contexts).toHaveLength(3)
    expect(track.contexts.every((c) => c.closed)).toBe(true)
    expect(track.browsersClosed).toBe(3)
    expect(getBrowserStatus().hasContext).toBe(false)
  })

  it('缺省仍走持久（零回归）：不传 mode 即 headed + 回传 cookie', async () => {
    const page = fakePage()
    const chromium = fakeChromium(page)
    _internals.loadChromium = async () => ({ chromium }) as never
    const r = await fetchHtmlViaBrowser('https://x.example/list')
    expect(r.headers['x-lingshu-browser']).toBe('headed')
    expect(r.cookies).toHaveLength(1)
  })

  it('open ephemeral + fetch 同目标页：零新请求直接读（验证打开是唯一一次请求）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    const opened = await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    expect(opened).toEqual({ opened: true, url: 'https://x.example/target' })
    expect(track.contexts).toHaveLength(1)
    const verifyPage = track.contexts[0].page
    expect(verifyPage.gotoCalls).toEqual(['https://x.example/target'])
    // 重试直接读已加载内容：不再导航，抓完即焚 + browser 关（开窗→重试只起一个进程）
    const r = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(r.status).toBe(200)
    expect(r.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    expect(verifyPage.gotoCalls).toEqual(['https://x.example/target'])
    expect(track.contexts).toHaveLength(1)
    expect(track.contexts[0].closed).toBe(true)
    expect(track.launchCalls).toHaveLength(1)
    expect(track.browsersClosed).toBe(1)
    // 再抓一次就是全新上下文（旧验证窗已消费）
    await fetchHtmlViaBrowser('https://x.example/other', { mode: 'ephemeral' })
    expect(track.contexts).toHaveLength(2)
    expect(getBrowserStatus().hasContext).toBe(false)
  })

  it('复用读到挑战页：报 403 且窗口保留（用户过完验证直接重试）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    // 验证还没过：窗口内容仍是挑战页
    track.contexts[0].page.body = '<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>'
    const first = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(first.status).toBe(403)
    expect(first.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    // 窗口保留（未焚），零新请求；留窗期间 browser 常驻（Dock 一图标）
    expect(track.contexts).toHaveLength(1)
    expect(track.contexts[0].closed).toBe(false)
    expect(track.browsersClosed).toBe(0)
    expect(track.contexts[0].page.gotoCalls).toEqual(['https://x.example/target'])
    // 用户在窗内过完验证后重试：读到正文即焚 + browser 关
    track.contexts[0].page.body = '<html><body>real list</body></html>'
    const second = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(second.status).toBe(200)
    expect(second.body).toContain('real list')
    expect(track.contexts[0].closed).toBe(true)
    expect(track.browsersClosed).toBe(1)
  })

  it('复用读到含信标的真页：challenge-platform 在正常页也有，判 200 即焚', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    // 真站回包：真标题 + Cloudflare 隐形信标脚本（anime_site_a 四 fixture 全含，2026-09 实证）
    track.contexts[0].page.body =
      '<html><head><title>anime_site_a.me - H動漫/裏番/線上看</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head><body>list</body></html>'
    const r = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(r.status).toBe(200)
    expect(track.contexts).toHaveLength(1)
    expect(track.contexts[0].closed).toBe(true)
    expect(track.browsersClosed).toBe(1)
  })

  it('复用目标不同：同一上下文内导航一次（尽力而为），抓完 browser 关', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/a', undefined, 'ephemeral')
    const r = await fetchHtmlViaBrowser('https://x.example/b', { mode: 'ephemeral' })
    expect(r.status).toBe(200)
    expect(track.contexts).toHaveLength(1)
    expect(track.contexts[0].page.gotoCalls).toEqual(['https://x.example/a', 'https://x.example/b'])
    expect(track.contexts[0].closed).toBe(true)
    expect(track.browsersClosed).toBe(1)
  })

  it('连续打开验证窗不堆积：只留最新一个（旧的即关，且自关不误杀共享 browser）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/a', undefined, 'ephemeral')
    await openVerifyWindow('https://x.example/b', undefined, 'ephemeral')
    expect(track.launchCalls).toHaveLength(1)
    expect(track.contexts).toHaveLength(2)
    expect(track.contexts[0].closed).toBe(true)
    expect(track.contexts[1].closed).toBe(false)
    expect(track.contexts[1].page.gotoCalls).toEqual(['https://x.example/b'])
    // 程序化关旧窗触发了它的 close 监听，但自关标记跳过了空闲关进程
    expect(track.browsersClosed).toBe(0)
  })

  it('验证窗已死（用户手动关窗）时抓取回退全新上下文', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    // 用户手动关掉了验证窗（close 监听在真实现里会清待复用；此处直接模拟已死上下文）
    track.contexts[0].page.closed = true
    const r = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(r.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    // 旧上下文已焚，实际内容来自全新上下文；抓完 browser 关
    expect(track.contexts).toHaveLength(2)
    expect(track.contexts[0].closed).toBe(true)
    expect(track.contexts[1].page.gotoCalls).toEqual(['https://x.example/target'])
    expect(track.contexts[1].closed).toBe(true)
    expect(track.browsersClosed).toBe(1)
  })

  it('closeBrowser 回收一次性 browser（Dock 图标不残留）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/list', undefined, 'ephemeral')
    expect(track.browsersClosed).toBe(0)
    await closeBrowser()
    expect(track.browsersClosed).toBe(1)
    expect(track.contexts[0].closed).toBe(true)
  })

  /** 双模式 mock：持久 launchPersistentContext（关可计数）+ 一次性 launch */
  function fakeDualChromium(track: EphemeralTrack & { persistentClosed: number }) {
    const eph = fakeEphemeralChromium(track)
    return {
      ...eph,
      async launchPersistentContext() {
        return {
          async newPage() {
            return fakePage()
          },
          async cookies() {
            return []
          },
          async close() {
            track.persistentClosed += 1
          },
          on() {},
        }
      },
    }
  }

  it('开一次性验证窗先关持久浏览器（切模式不双 Dock 图标）', async () => {
    const track = Object.assign(freshEphemeralTrack(), { persistentClosed: 0 })
    _internals.loadChromium = async () => ({ chromium: fakeDualChromium(track) }) as never
    // 先一次持久抓取（Dock 一图标，hasContext true）
    await fetchHtmlViaBrowser('https://x.example/list')
    expect(getBrowserStatus().hasContext).toBe(true)
    // 切一次性：持久进程被关（图标消失），验证窗独占 Dock
    await openVerifyWindow('https://x.example/list', undefined, 'ephemeral')
    expect(track.persistentClosed).toBe(1)
    expect(getBrowserStatus().hasContext).toBe(false)
    expect(track.browsersClosed).toBe(0)
    expect(track.contexts).toHaveLength(1)
  })

  it('切回持久验证窗即关一次性整侧（待复用清空 + browser 关，不双图标）', async () => {
    const track = Object.assign(freshEphemeralTrack(), { persistentClosed: 0 })
    _internals.loadChromium = async () => ({ chromium: fakeDualChromium(track) }) as never
    await openVerifyWindow('https://x.example/a', undefined, 'ephemeral')
    expect(track.contexts).toHaveLength(1)
    await openVerifyWindow('https://x.example/a')
    expect(track.contexts[0].closed).toBe(true)
    expect(track.browsersClosed).toBe(1)
    expect(getBrowserStatus().hasContext).toBe(true)
  })

  it('用户手动关验证窗：待复用清空 + 空转 browser 即关（Dock 归零，下次按需重起）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    expect(track.browsersClosed).toBe(0)
    // 模拟用户点窗口 ✕：只触发 close 事件，不走程序化关（无自关标记）
    track.contexts[0].closeHandlers.splice(0).forEach((fn) => fn())
    await new Promise((r) => setTimeout(r, 0))
    expect(track.browsersClosed).toBe(1)
    // 下次抓取走全新（browser 按需重起 + 抓完即关）
    const r = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(r.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    expect(track.launchCalls).toHaveLength(2)
    expect(track.contexts).toHaveLength(2)
    expect(track.browsersClosed).toBe(2)
  })
})

describe('browser-channel 验证等待态（ADR-0047，纯本地读、零新请求）', () => {
  it('ephemeral 无验证窗：pending=false（轮询该停）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await expect(getVerifyState('https://x.example/t', 'ephemeral')).resolves.toEqual({
      pending: false,
      passed: false,
    })
    // 只读不启动 browser
    expect(track.launchCalls).toHaveLength(0)
  })

  it('ephemeral 验证窗内容正常：pending + passed（自动可重试）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    await expect(getVerifyState('https://x.example/target', 'ephemeral')).resolves.toEqual({
      pending: true,
      passed: true,
    })
    // 只读不导航、不消费验证窗
    expect(track.contexts[0].page.gotoCalls).toEqual(['https://x.example/target'])
    expect(track.contexts[0].closed).toBe(false)
  })

  it('ephemeral 窗内仍是挑战页：pending + passed=false（继续等）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    track.contexts[0].page.body = '<html><head><title>Just a moment...</title></head><body>验证中</body></html>'
    await expect(getVerifyState('https://x.example/target', 'ephemeral')).resolves.toEqual({
      pending: true,
      passed: false,
    })
  })

  it('ephemeral 验证窗已死：pending=false + 清待复用（按手动关窗处理）', async () => {
    const track = freshEphemeralTrack()
    _internals.loadChromium = async () => ({ chromium: fakeEphemeralChromium(track) }) as never
    await openVerifyWindow('https://x.example/target', undefined, 'ephemeral')
    // 页面已死：content 抛错（真 Playwright 关窗后读 DOM 即如此）
    track.contexts[0].page.closed = true
    const throwing = track.contexts[0].page
    throwing.content = async () => {
      throw new Error('Target closed')
    }
    await expect(getVerifyState('https://x.example/target', 'ephemeral')).resolves.toEqual({
      pending: false,
      passed: false,
    })
    // 待复用已清：下次抓取走全新上下文
    const r = await fetchHtmlViaBrowser('https://x.example/target', { mode: 'ephemeral' })
    expect(r.headers['x-lingshu-browser']).toBe('headed-ephemeral')
    expect(track.contexts).toHaveLength(2)
  })

  it('persistent 无上下文：pending=false', async () => {
    const page = fakePage()
    _internals.loadChromium = async () => ({ chromium: fakeChromium(page) }) as never
    await expect(getVerifyState('https://x.example/list')).resolves.toEqual({
      pending: false,
      passed: false,
    })
    expect(getBrowserStatus().hasContext).toBe(false)
  })

  it('persistent 有 clearance：pending + passed（该域 cf_clearance）', async () => {
    const page = fakePage()
    _internals.loadChromium = async () => ({ chromium: fakeChromium(page) }) as never
    await fetchHtmlViaBrowser('https://x.example/list')
    // fakeChromium 回传 .x.example 的 cf_clearance
    await expect(getVerifyState('https://x.example/list')).resolves.toEqual({
      pending: true,
      passed: true,
    })
  })

  it('persistent 无 clearance/域不对：pending + passed=false（继续等，超时转手动）', async () => {
    const page = fakePage()
    _internals.loadChromium = async () => ({ chromium: fakeChromium(page) }) as never
    await fetchHtmlViaBrowser('https://x.example/list')
    await expect(getVerifyState('https://other.example/list')).resolves.toEqual({
      pending: true,
      passed: false,
    })
  })
})
