// DevConsole headed 浏览器通道（桌面可见手过验证）。
//
// 为什么是 headed sidecar（背景结论，不可回退）：
// - 前端 fetch 中继不可行：DevConsole 前端 origin 是 localhost，跨源 fetch
//   无 CORS 头即被拦，读不到 body；
// - 新标签页手过沾不到 Node 重试的光：clearance 绑 TLS 指纹，跨网络栈失效；
// - 常驻无头 sidecar 已知无解：WAF 分辨自动/人手加载，隐藏自动仍 403。
// 抓取与手过必须在同一可见浏览器上下文里（桌面版「同 store 同 UA」，
// 对齐红线）：playwright-core + 本机 Chrome + 落盘 profile。

import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'

export interface BrowserFetchOptions {
  headers?: Record<string, string>
  /** 秒（iOS Bridge 同口径，缺省 30） */
  timeout?: number
  userAgent?: string
  /**
   * 通道形态：'persistent'（默认，落盘 profile 复用，常驻 Dock 一图标）|
   * 'ephemeral'（类无痕：每次操作开全新上下文，用完关上下文即焚；无待复用验证窗时
   * 连 browser 进程一起关，空闲 Dock 归零，下次按需重起）。
   * 缺省即 'persistent'（老调用零回归）。
   */
  mode?: BrowserMode
}

/** 浏览器通道形态：持久复用 vs 一次性即焚 */
export type BrowserMode = 'persistent' | 'ephemeral'

export interface BrowserFetchResult {
  status: number
  headers: Record<string, string>
  body: string
  /** 同源 cookie（宿主回填共享 jar 用，对齐 iOS refillHostJar） */
  cookies?: { name: string; value: string; domain: string; path?: string }[]
}

export interface BrowserStatus {
  available: boolean
  /** 不可用时的指引文案 */
  reason?: string
  /** 持久上下文是否已存在（clearance 可能已就绪） */
  hasContext: boolean
  /** 上下文启动时的 UA（同 UA 红线） */
  userAgent?: string
}

const DEFAULT_TIMEOUT_SEC = 30
/** 2MB 上限（对齐 iOS fetchHtml 上限，防超大页拖垮 run） */
const MAX_BODY_CHARS = 2 * 1024 * 1024

function profileDir(): string {
  const base = process.env['XDG_CACHE_HOME'] || path.join(os.homedir(), '.cache')
  return path.join(base, 'lingshu-devconsole-browser-profile')
}

/** 可注入的 chromium 加载器（单测 mock 用；默认动态 import，server 无 Chrome 时不起依赖） */
export const _internals: {
  loadChromium: () => Promise<typeof import('playwright-core')>
} = {
  loadChromium: () => import('playwright-core'),
}

let context: BrowserContext | null = null
let contextUserAgent: string | undefined
/**
 * 持久验证页（修订：只留最新一个——此前连续打开持久验证窗从不关旧页，
 * 自动验证循环起来直接攒出一排 Cloudflare 标签页；与一次性"只留一个验证窗"同构）。
 */
let persistentVerifyPages: Page[] = []
/** 串行链：同一时刻最多一抓（对齐 iOS Task 串行 + 插件侧单会话限次） */
let chain: Promise<void> = Promise.resolve()

function challengeFailure(url: string, message: string): Error {
  const err: any = new Error(message)
  err.code = 'CHALLENGE'
  err.url = url
  return err
}

function pickUserAgent(opts?: BrowserFetchOptions): string | undefined {
  if (opts?.userAgent) return opts.userAgent
  const fromHeaders = opts?.headers
    ? Object.entries(opts.headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1]
    : undefined
  return fromHeaders
}

function normalizeMode(mode?: BrowserMode): BrowserMode {
  return mode === 'ephemeral' ? 'ephemeral' : 'persistent'
}

async function launchContext(userAgent?: string): Promise<BrowserContext> {
  if (context) return context
  let chromium: typeof import('playwright-core')['chromium']
  try {
    ;({ chromium } = await _internals.loadChromium())
  } catch {
    throw new Error(
      'DevConsole 浏览器通道不可用：缺少 playwright-core 依赖（npm install），L3 站点请用 --fixture 离线验证',
    )
  }
  const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: false,
    userAgent,
  }
  const errors: string[] = []
  // 先连用户本机 Chrome（与用户手过的是同一个浏览器产品线）；再试 Chromium 系
  for (const channel of ['chrome', 'chromium'] as const) {
    try {
      context = await chromium.launchPersistentContext(profileDir(), { ...launchOpts, channel })
      contextUserAgent = userAgent
      // 用户关掉可见窗口 ≠ 退出：context 关闭后下次按需重建（profile 落盘保留 clearance）
      context.on('close', () => {
        context = null
      })
      return context
    } catch (e: any) {
      errors.push(`${channel}: ${e?.message ?? e}`)
    }
  }
  throw new Error(
    `DevConsole 浏览器通道不可用：本机未检测到可用 Chrome/Chromium（${errors.join('；')}）。` +
      '请安装 Google Chrome 后重试，或用 --fixture 离线验证解析逻辑',
  )
}

/**
 * 一次性通道的共享 headed browser（修订4）。
 *
 * 为什么不是每次 launch 全新 browser：每次 launch 都是独立浏览器进程，macOS 给
 * 每个进程一个 Dock 图标，点几次验证窗就攒一排；且验证窗与抓取分属不同进程时，
 * 验证状态永远传不过去。所以验证窗与其后一次抓取共享一个 browser（同一进程、
 * 同一 Dock 图标）+ 每次操作开全新上下文（`newContext` 即类无痕：cookie/storage
 * 全隔离，关上下文即焚）。
 * 与持久上下文完全隔离：不读/不写落盘 profile，不碰全局 context 缓存。
 * Dock 语义（修订4：双图标投诉）：两种通道各是一个浏览器进程，各占一个 Dock
 * 图标——切模式时互关对方（`openVerifyWindow` 双向清理），一次性侧无待复用验证
 * 窗时连 browser 一起关（空闲 Dock 归零）；持久侧按设计常驻（clearance 在落盘
 * profile，关了重起即回）。
 */
let ephemeralBrowser: any | null = null
let ephemeralLaunching: Promise<any> | null = null
/**
 * 程序化关闭的一次性上下文（焚窗/切模式/退出）：close 监听见此集合即跳过空闲关
 * 进程，由调用方收尾；只有用户手动关窗才走空闲关。防自关把待复用的共享 browser
 * 误杀（先关旧验证窗再建新窗时，旧窗 close 事件不得关掉刚取到的 browser）。
 */
const ownClosedCtx = new WeakSet<object>()
/** 关一次性上下文（程序化，带自关标记） */
async function closeEphemeralCtx(ctx: BrowserContext): Promise<void> {
  markOwnClosedCtx(ctx)
  await ctx.close().catch(() => undefined)
}
/** 标记程序化自关（close 监听凭此跳过空闲关进程） */
function markOwnClosedCtx(ctx: BrowserContext): void {
  try {
    ownClosedCtx.add(ctx as object)
  } catch {
    /* 非对象 mock，标记不上就走普通关 */
  }
}
/** 该上下文是否程序化自关 */
function isOwnClosedCtx(ctx: BrowserContext): boolean {
  try {
    return ownClosedCtx.has(ctx as object)
  } catch {
    return false
  }
}
/** 关持久上下文（进程随之退出，Dock 图标消失；clearance 在落盘 profile，回去重起即回） */
async function shutdownPersistent(): Promise<void> {
  const ctx = context
  context = null
  contextUserAgent = undefined
  persistentVerifyPages = []
  if (ctx) await ctx.close().catch(() => undefined)
}
/** 关一次性整侧（待复用验证窗 + 共享 browser，切回持久/退出时用） */
async function shutdownEphemeralSide(): Promise<void> {
  const pv = pendingVerify
  pendingVerify = null
  if (pv) {
    await pv.page.close().catch(() => undefined)
    await closeEphemeralCtx(pv.ctx)
  }
  const eph = ephemeralBrowser
  ephemeralBrowser = null
  if (eph) await eph.close().catch(() => undefined)
}
/** 一次性空闲即关：无待复用验证窗时关掉共享 browser（Dock 归零，下次按需重起） */
async function shutdownEphemeralIfIdle(): Promise<void> {
  if (pendingVerify) return
  await shutdownEphemeralSide()
}
/**
 * 待消费的验证上下文：`openVerifyWindowEphemeral` 建好留给用户手过验证，
 * 下一次 `fetchHtmlEphemeral` 在**同一上下文**里抓（验证状态传得过去），
 * 抓完即焚。用户手动关窗后由 close 监听清掉（下次抓取走全新上下文）。
 */
let pendingVerify: { ctx: BrowserContext; page: Page } | null = null

async function loadChromiumOrThrow(url: string): Promise<typeof import('playwright-core')['chromium']> {
  try {
    const { chromium } = await _internals.loadChromium()
    if (typeof chromium.launch !== 'function') {
      throw new Error('当前 playwright-core 不支持 launch（一次性模式需 launch + newContext）')
    }
    return chromium
  } catch (e: any) {
    if (e?.code === 'CHALLENGE') throw e
    throw challengeFailure(
      url,
      e?.message?.includes('launch')
        ? e.message
        : 'DevConsole 浏览器通道不可用：缺少 playwright-core 依赖（npm install），L3 站点请用 --fixture 离线验证',
    )
  }
}

/** 取一次性共享 browser（懒启动，chrome → chromium 回退；断开后下次按需重建） */
async function getEphemeralBrowser(url: string): Promise<any> {
  if (ephemeralBrowser) return ephemeralBrowser
  if (ephemeralLaunching) return ephemeralLaunching
  ephemeralLaunching = (async () => {
    const chromium = await loadChromiumOrThrow(url)
    const launchErrors: string[] = []
    for (const channel of ['chrome', 'chromium'] as const) {
      try {
        const browser = await chromium.launch({ headless: false, channel } as any)
        if (typeof browser?.on === 'function') {
          browser.on('disconnected', () => {
            if (ephemeralBrowser === browser) ephemeralBrowser = null
          })
        }
        ephemeralBrowser = browser
        return browser
      } catch (e: any) {
        launchErrors.push(`${channel}: ${e?.message ?? e}`)
      }
    }
    throw challengeFailure(
      url,
      `DevConsole 一次性浏览器通道不可用（${launchErrors.join('；')}）。请安装 Google Chrome 后重试，或用 --fixture 离线验证解析逻辑`,
    )
  })()
  try {
    return await ephemeralLaunching
  } finally {
    ephemeralLaunching = null
  }
}

/** 上下文已死（用户手动关窗等）的报错特征：这类才值得丢弃后开全新上下文 */
function isStaleContextError(e: any): boolean {
  return /closed|destroyed|disconnected|has been closed/i.test(String(e?.message ?? e))
}

async function applyExtraHeaders(page: Page, headers?: Record<string, string>): Promise<void> {
  if (!headers) return
  const extra: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'user-agent') extra[k] = v
  }
  if (Object.keys(extra).length > 0) await page.setExtraHTTPHeaders(extra)
}

/**
 * 验证窗已加载内容的挑战嗅探：`page.content()` 无响应状态/响应头可依，只能看正文。
 * 与宿主共享判定表同口径，但**剔除 `challenge-platform`**：
 * Cloudflare 给正常页也注入该隐形信标脚本（anime_site_a 四 fixture 全含，2026-09 实证），
 * 无区分度，保留只会把真内容误判为挑战。真挑战页恒含 Just a moment / Attention
 * Required（`cf-error` 兜底 CF 错误页）。命中即按 403 上报，`$lib` 边界
 * （runtime `run.ts` 包 `onBrowserFetch` 处）统一判挑战抛 CHALLENGE，插件不再写判定。
 * 误伤逃生：持久验证窗（切回 persistent）与手动关窗（待复用清空）均可绕过。
 */
const VERIFY_BODY_CHALLENGE_RE = /Just a moment|Attention Required|cf-error/i

/** 目标页比对（去 hash + 去尾斜杠）：验证窗里已是目标页时零新请求直接读 */
function samePageUrl(a: string, b: string): boolean {
  const norm = (u: string): string => {
    try {
      const x = new URL(u)
      x.hash = ''
      return x.href.replace(/\/$/, '')
    } catch {
      return u
    }
  }
  return norm(a) === norm(b)
}

/**
 * 一次性抓取（修订2）：验证窗里已是目标页时零新请求直接读内容
 * （按窗口计数站点的最优解：验证打开是唯一一次请求，重试不再发请求）；
 * 读出来是挑战页则报 403 并把窗口留着（用户过完验证直接重试，不用重新开窗；
 * 留窗期间 browser 常驻，Dock 一图标）；
 * 否则开全新类无痕上下文。抓完（非保留）关上下文即焚，且无待复用时连 browser
 * 一起关（修订4：空闲 Dock 归零）。
 * UA 照透（守同 UA 红线）；cookie 直接丢弃（调用方亦不得回填）。
 */
async function fetchHtmlEphemeral(url: string, opts?: BrowserFetchOptions): Promise<BrowserFetchResult> {
  const timeoutSec = opts?.timeout ?? DEFAULT_TIMEOUT_SEC
  const ephemeralHeaders = { 'x-lingshu-browser': 'headed-ephemeral' }
  return exclusive(async () => {
    try {
      return await fetchHtmlEphemeralInner(url, opts, timeoutSec, ephemeralHeaders)
    } finally {
      await shutdownEphemeralIfIdle()
    }
  })
}

async function fetchHtmlEphemeralInner(
  url: string,
  opts: BrowserFetchOptions | undefined,
  timeoutSec: number,
  ephemeralHeaders: Record<string, string>,
): Promise<BrowserFetchResult> {
    const browser = await getEphemeralBrowser(url)
    // 1）复用验证窗上下文
    if (pendingVerify) {
      const { ctx, page } = pendingVerify
      pendingVerify = null
      let keep = false
      let staleFallback = false
      try {
        let current: string | undefined
        try {
          current = page.url()
        } catch {
          current = undefined
        }
        if (current && samePageUrl(current, url)) {
          // 已是目标页：直接读，一个新请求都不发
          const body = (await page.content()).slice(0, MAX_BODY_CHARS)
          if (VERIFY_BODY_CHALLENGE_RE.test(body)) {
            // 还没过验证：窗口留着等用户手过，下次重试再读
            keep = true
            return { status: 403, headers: { ...ephemeralHeaders }, body, cookies: [] }
          }
          return { status: 200, headers: { ...ephemeralHeaders }, body, cookies: [] }
        }
        // 不是目标页：同一上下文内导航（算一次新请求，尽力而为）
        await applyExtraHeaders(page, opts?.headers)
        const response = await withTimeout(
          page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutSec * 1000 }),
          timeoutSec,
          `浏览器抓取（一次性·复用验证窗） ${url}`,
        )
        const status = response?.status() ?? 200
        const rawHeaders = response ? await response.allHeaders() : {}
        const body = (await page.content()).slice(0, MAX_BODY_CHARS)
        return {
          status,
          headers: { ...rawHeaders, ...ephemeralHeaders },
          body,
          cookies: [],
        }
      } catch (e: any) {
        // 上下文已死才开全新的；导航本身的失败（超时/DNS）直接抛，不多烧一次声誉
        if (!isStaleContextError(e)) throw e
        staleFallback = true
      } finally {
        if (keep) {
          pendingVerify = { ctx, page }
        } else {
          await page.close().catch(() => undefined)
          await closeEphemeralCtx(ctx)
        }
      }
      if (!staleFallback) throw new Error('unreachable: 复用分支非 stale 必已 return/throw')
    }
    // 2）全新类无痕上下文（无验证窗可复用，或旧验证窗已死）
    const userAgent = pickUserAgent(opts)
    const ctx: BrowserContext = await browser.newContext(userAgent ? { userAgent } : {})
    try {
      const page: Page = await ctx.newPage()
      try {
        await applyExtraHeaders(page, opts?.headers)
        const response = await withTimeout(
          page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutSec * 1000 }),
          timeoutSec,
          `浏览器抓取（一次性） ${url}`,
        )
        const status = response?.status() ?? 200
        const rawHeaders = response ? await response.allHeaders() : {}
        const body = (await page.content()).slice(0, MAX_BODY_CHARS)
        // 一次性 cookie 直接丢弃（不回填共享 jar）：不可复用，回填只会让持久展示值撒谎
        return {
          status,
          headers: { ...rawHeaders, 'x-lingshu-browser': 'headed-ephemeral' },
          body,
          cookies: [],
        }
      } finally {
        await page.close().catch(() => undefined)
      }
    } finally {
      await closeEphemeralCtx(ctx)
    }
}

/**
 * 一次性验证窗口：在共享 headed browser 里开全新类无痕上下文并前置，留给用户手过
 * 确认；上下文暂存为待复用，下一次一次性抓取在同一上下文里读/抓
 * （联动语义——验证与抓取必须同一上下文，否则验证白过；
 * 修订2：已是目标页时零新请求直接读，验证没过则窗口保留）。
 * clearance 不落盘。连续打开不堆积：新窗打开前关掉上一个未消费的验证上下文。
 * 修订4：开窗前先关持久浏览器（两种通道各占一个 Dock 图标，不互关就成两个）。
 */
async function openVerifyWindowEphemeral(url: string, userAgent?: string): Promise<{ opened: boolean; url: string }> {
  return exclusive(async () => {
    // 切到一次性即关持久（Dock 不双图标；clearance 在落盘 profile，回去重起即回）
    await shutdownPersistent()
    const browser = await getEphemeralBrowser(url)
    // 防堆积：关掉上一个还没被消费的验证上下文（只留一个验证窗）
    if (pendingVerify) {
      const prev = pendingVerify
      pendingVerify = null
      await prev.page.close().catch(() => undefined)
      await closeEphemeralCtx(prev.ctx)
    }
    try {
      const ctx: BrowserContext = await browser.newContext(userAgent ? { userAgent } : {})
      // 用户手动关窗 = 放弃验证：清掉待复用，下次抓取走全新上下文；browser 空转则
      // 直接关进程（Dock 归零）。程序化自关（焚窗/切模式）带标记，不走空闲关。
      ctx.on('close', () => {
        if (pendingVerify?.ctx === ctx) pendingVerify = null
        if (isOwnClosedCtx(ctx)) return
        void shutdownEphemeralIfIdle()
      })
      const page: Page = await ctx.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.bringToFront().catch(() => undefined)
      pendingVerify = { ctx, page }
      return { opened: true, url }
    } catch (e: any) {
      throw challengeFailure(url, e?.message ?? String(e))
    }
  })
}

function withTimeout<T>(promise: Promise<T>, seconds: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}超时（${seconds}s）`)), seconds * 1000)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

/** 串行执行（排队，不并发打爆反爬） */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  // 链条本身永不断（任务失败不影响后排），调用方拿原结果
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function getBrowserStatus(): BrowserStatus {
  return {
    available: true,
    hasContext: context !== null,
    userAgent: contextUserAgent,
  }
}

/**
 * 打开验证窗口（被动触发，同构：用户点了「打开验证窗口」才起）。
 * - persistent（默认）：在持久上下文里开页并前置，用户人手过 Turnstile；clearance
 *   留在落盘 profile，后续重抓即沾光。验证期间不做任何程序化导航（防连带封首页）。
 *   连续打开不堆积（只留最新一个验证页，旧的即关）。
 * - ephemeral：在共享 headed browser 里开全新类无痕上下文并前置，
 *   留给下一次 ephemeral 抓取复用（同一上下文，抓完即焚）；clearance 不落盘。
 *   须与下一次 ephemeral 抓取联动使用（Q9），连续打开不堆积（只留一个验证窗）。
 */
export async function openVerifyWindow(
  url: string,
  userAgent?: string,
  mode?: BrowserMode,
): Promise<{ opened: boolean; url: string }> {
  if (normalizeMode(mode) === 'ephemeral') return openVerifyWindowEphemeral(url, userAgent)
  // 切回持久即关一次性整侧（Dock 不双图标；未消费的验证窗一起清）
  const ctx = await exclusive(async () => {
    await shutdownEphemeralSide()
    return launchContext(userAgent)
  }).catch((e: any) => {
    throw challengeFailure(url, e?.message ?? String(e))
  })
  // 防堆积：只留最新一个持久验证页（旧的不关就是一排标签页，实证）
  for (const p of persistentVerifyPages.splice(0)) await p.close().catch(() => undefined)
  const page: Page = await ctx.newPage()
  persistentVerifyPages.push(page)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.bringToFront().catch(() => undefined)
  return { opened: true, url }
}

/**
 * 经 headed 上下文抓取 HTML（`$lib.browser.getHtml` 的 DevConsole 实现）。
 * - 403/503 挑战页原文也 resolve（挑战识别与抛错在 `$lib` 边界统一做——runtime
 *   `run.ts` 包 `onBrowserFetch` 处，与 `$lib.http.get` 同表；插件不再写判定）；
 * - 仅网络异常/浏览器不可用时 reject（不可用时带 code=CHALLENGE，引导验证窗口）。
 * - mode='ephemeral'：优先复用待验证上下文（有则同一上下文抓、抓完即焚），
 *   否则开全新类无痕上下文；打 `headed-ephemeral` 标记、cookie 置空；无待复用时连
 *   browser 一起关（空闲 Dock 归零），开窗时先关持久（切模式不双图标）；
 *   缺省 'persistent'（老行为，打 `headed` + 回传 cookie，常驻）。
 */
export async function fetchHtmlViaBrowser(url: string, opts?: BrowserFetchOptions): Promise<BrowserFetchResult> {
  if (normalizeMode(opts?.mode) === 'ephemeral') return fetchHtmlEphemeral(url, opts)
  const timeoutSec = opts?.timeout ?? DEFAULT_TIMEOUT_SEC
  return exclusive(async () => {
    let ctx: BrowserContext
    try {
      ctx = await launchContext(pickUserAgent(opts))
    } catch (e: any) {
      throw challengeFailure(url, e?.message ?? String(e))
    }
    const page: Page = await ctx.newPage()
    try {
      if (opts?.headers) {
        const extra: Record<string, string> = {}
        for (const [k, v] of Object.entries(opts.headers)) {
          if (k.toLowerCase() !== 'user-agent') extra[k] = v
        }
        if (Object.keys(extra).length > 0) await page.setExtraHTTPHeaders(extra)
      }
      const response = await withTimeout(
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutSec * 1000 }),
        timeoutSec,
        `浏览器抓取 ${url}`,
      )
      const status = response?.status() ?? 200
      const rawHeaders = response ? await response.allHeaders() : {}
      const body = (await page.content()).slice(0, MAX_BODY_CHARS)
      // 回填候选 cookie（调用方按目标域过滤后写入共享 jar，对齐 iOS refillHostJar）
      const jar = await ctx.cookies().catch(() => [])
      return {
        status,
        headers: { ...rawHeaders, 'x-lingshu-browser': 'headed' },
        body,
        cookies: jar.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
      }
    } finally {
      await page.close().catch(() => undefined)
    }
  })
}

/** 关闭浏览器通道（测试/退出用）：一次性整侧 + 持久上下文全关；profile 落盘保留 */
export async function closeBrowser(): Promise<void> {
  await shutdownEphemeralSide()
  await shutdownPersistent()
}

/** 验证窗等待态（自动验证轮询用，全是本地读、零新请求） */
export interface VerifyState {
  /** 是否还有可等的验证窗（false = 用户关了/进程没了，轮询该停） */
  pending: boolean
  /** 验证是否已过（true = 下一次抓取/重试大概率直接通） */
  passed: boolean
}

/** cookie 域匹配（Cloudflare clearance 按站存，userDataDir 级共享时按域认领） */
function cookieDomainMatch(cookieDomain: string, host: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase()
  const h = host.toLowerCase()
  return h === d || h.endsWith(`.${d}`)
}

/**
 * 读验证等待态：给自动验证轮询用，**只读本地、不发任何新请求**
 * （page.content()/cookies() 都是进程内读，不烧按窗口计数的声誉）。
 * - ephemeral：有待复用验证窗才 pending；正文无挑战特征即 passed（与抓取嗅探同串）。
 * - persistent：持久上下文存在才 pending；该域有 `cf_clearance` 即 passed
 *   （Cloudflare 标准 cookie 名，非 CF 站恒为 false、走超时转手动）。
 * 串行链之外调用（读操作不导航，与抓并发也安全；轮询卡在 exclusive 后面反而误事）。
 */
export async function getVerifyState(url: string, mode?: BrowserMode): Promise<VerifyState> {
  if (normalizeMode(mode) === 'ephemeral') {
    const pv = pendingVerify
    if (!pv) return { pending: false, passed: false }
    try {
      const body = (await pv.page.content()).slice(0, MAX_BODY_CHARS)
      return { pending: true, passed: !VERIFY_BODY_CHALLENGE_RE.test(body) }
    } catch {
      // 窗口已死按手动关窗处理：清待复用（browser 空转由 close 监听收）
      if (pendingVerify?.ctx === pv.ctx) pendingVerify = null
      return { pending: false, passed: false }
    }
  }
  const ctx = context
  if (!ctx) return { pending: false, passed: false }
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return { pending: true, passed: false }
  }
  const jar = await ctx.cookies().catch(() => [])
  const passed = jar.some((c) => /cf_clearance/i.test(c.name) && cookieDomainMatch(c.domain, host))
  return { pending: true, passed }
}
