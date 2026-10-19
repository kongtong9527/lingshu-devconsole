import fs from 'node:fs'
import path from 'node:path'
import {
  executeRun,
  findPluginFile,
  loadPlugin,
  parsePluginMeta,
  type RunOptions,
  type PluginMeta,
  type HttpRecord,
  type SettingField,
  type AccountSchema,
  type CookieJar,
  type UiRequestHandler,
} from 'lingshu-runtime'
import { fetchHtmlViaBrowser, type BrowserMode } from './browser-channel.js'

/**
 * 插件目录解析（**不再回退 monorepo 相对路径**）：按优先级取第一个存在的目录
 *   1) 显式入参（`?dir=` / 请求体 `options.dir`）
 *   2) 环境变量 `LINGSHU_PLUGINS_DIR`（server 入口的 `--plugins-dir` 会写进它）
 *   3) `<cwd>/plugins`（母仓开发：`ln -s ../lingshu-plugins devconsole/plugins`，符号链接不入库）
 * 全都不存在即抛错并列出候选——公开仓拿到的是「说人话的报错」，不是一句找不到文件。
 */
export function pluginsDir(explicit?: string): string {
  const candidates = [explicit, process.env.LINGSHU_PLUGINS_DIR, path.resolve(process.cwd(), 'plugins')]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => path.resolve(value))
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(
    '未找到插件目录。请任选其一指定：--plugins-dir <path>、环境变量 LINGSHU_PLUGINS_DIR、' +
      '或在当前目录放 plugins/（母仓开发：ln -s ../lingshu-plugins devconsole/plugins）。' +
      `已尝试：${candidates.join('、') || '（无候选）'}`,
  )
}

/**
 * 进程内共享 cookie jar：登录 run 写入的 session cookie 跨 run 复用，
 * 后续读取 run 自动带上。按域隔离，多源同域才会串。
 */
const sharedCookieStore: CookieJar = new Map()

/** 浏览器 cookie domain 是否覆盖目标 host（前导点视为含子域） */
function cookieDomainCovers(cookieDomain: string, host: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase()
  const h = host.toLowerCase()
  return h === d || h.endsWith(`.${d}`)
}

/**
 * headed sidecar 抓到的 cookie 回填进程共享 jar（对齐 iOS refillHostJar）。
 * 只收目标站域的 cookie；展示用（后续 Node 直连仍过不了 L3，不冒充能力）。
 */
function refillSharedJar(targetUrl: string, cookies?: { name: string; value: string; domain: string; path?: string }[]): void {
  if (!cookies || cookies.length === 0) return
  let host: string
  try {
    host = new URL(targetUrl).hostname
  } catch {
    return
  }
  for (const c of cookies) {
    if (!c.name || !cookieDomainCovers(c.domain || '', host)) continue
    const domain = c.domain.replace(/^\./, '').toLowerCase()
    let jar = sharedCookieStore.get(domain)
    if (!jar) {
      jar = new Map()
      sharedCookieStore.set(domain, jar)
    }
    jar.set(c.name, { name: c.name, value: c.value, domain, path: c.path })
  }
}

export interface Capabilities {
  list: boolean
  detail: boolean
  reading: boolean
  search: boolean
  categories: boolean
  /** 是否导出 getListings（预设目录页） */
  listings: boolean
  explore: boolean
  /** 是否导出 getTags（标签索引页） */
  tags: boolean
  /** 是否导出 fetchPlayUrl（播放页解析） */
  play: boolean
  /** 是否声明了设置面（导出 getSettingsSchema） */
  settings: boolean
  /** 是否声明了账号登录面（导出 getAccountSchema） */
  account: boolean
}

export interface PluginInfo extends PluginMeta {
  capabilities: Capabilities
  /** 设置字段 schema；仅当插件导出 getSettingsSchema 时填充 */
  settingsSchema?: SettingField[]
  /** 账号登录 schema；仅当插件导出 getAccountSchema 时填充 */
  accountSchema?: AccountSchema
}

function detectCapabilities(plugin: any): Capabilities {
  return {
    list: typeof plugin.fetchList === 'function',
    detail: typeof plugin.fetchDetail === 'function',
    reading: typeof plugin.fetchReadingPage === 'function',
    play: typeof plugin.fetchPlayUrl === 'function',
    search: typeof plugin.search === 'function',
    categories: typeof plugin.getCategories === 'function',
    listings: typeof plugin.getListings === 'function',
    explore: typeof plugin.getExplore === 'function',
    tags: typeof plugin.getTags === 'function',
    settings: typeof plugin.getSettingsSchema === 'function',
    account: typeof plugin.getAccountSchema === 'function',
  }
}

/** 扫描插件目录，返回元数据 + 能力。目录无效或单插件失败均不抛错。 */
export async function listPlugins(dir?: string): Promise<PluginInfo[]> {
  let pluginDir: string
  try {
    pluginDir = pluginsDir(dir)
  } catch (error) {
    // 保持「目录无效不抛错」契约（UI 看到空列表），但把可诊断的报错留在 server 日志里
    console.warn(`[plugins] ${(error as Error).message}`)
    return []
  }
  let files: string[]
  try {
    files = fs.readdirSync(pluginDir).filter((f) => f.endsWith('.plugin.js')).sort()
  } catch {
    return []
  }
  const result: PluginInfo[] = []
  for (const f of files) {
    const file = path.join(pluginDir, f)
    try {
      const code = fs.readFileSync(file, 'utf-8')
      const meta = parsePluginMeta(code)
      if (!meta) continue
      const { plugin } = loadPlugin(file)
      const capabilities = detectCapabilities(plugin)
      // 插件声明了设置面时，取 schema 供前端渲染表单；getSettingsSchema 抛错则忽略（不影响列表）
      let settingsSchema: SettingField[] | undefined
      if (capabilities.settings) {
        try {
          const schema = (plugin as { getSettingsSchema: () => SettingField[] }).getSettingsSchema()
          if (Array.isArray(schema)) settingsSchema = schema
        } catch {
          /* 单个插件 schema 取值失败则忽略 */
        }
      }
      // 同理取账号登录 schema（getAccountSchema 可同步或异步）
      let accountSchema: AccountSchema | undefined
      if (capabilities.account) {
        try {
          const schema = await (plugin as { getAccountSchema: () => AccountSchema | Promise<AccountSchema> }).getAccountSchema()
          if (schema && typeof schema === 'object') accountSchema = schema
        } catch {
          /* 取值失败则忽略 */
        }
      }
      result.push({ ...meta, capabilities, settingsSchema, accountSchema })
    } catch {
      // 单个插件加载失败则跳过，不影响其他
    }
  }
  return result
}

export interface RunRequest {
  pluginId: string
  action: 'list' | 'detail' | 'reading' | 'play' | 'search' | 'categories' | 'listings' | 'explore' | 'tags' | 'setting-action' | 'login'
  target?: string
  options?: {
    page?: string
    category?: string
    /** 页面通道：list 用任意列表页面 URL，透传进 PluginContext.url */
    url?: string
    /** 列表通道标识：原样透传进 PluginContext.channel */
    channel?: string
    fixture?: string
    dir?: string
    cursor?: string
    /** 标签服务端排序（tags 用，透传 getTags context.sort） */
    sort?: string
    /** 用户偏好值（注入 $lib.settings，只读、不持久） */
    settings?: Record<string, string | boolean>
    /** 宿主从登录表单收集、回传给 login 动作的输入值（声明式交互） */
    inputs?: Record<string, string>
    /**
     * 浏览器通道形态（run 级）：'persistent'（默认，落盘复用）|
     * 'ephemeral'（本次 run 内每次 getHtml 都新起即焚）。缺省即 'persistent'。
     */
    browserMode?: BrowserMode
  }
}

export interface RunResponse {
  ok: boolean
  data?: any
  error?: string
  /** 结构化错误码（插件抛 CHALLENGE 时透传，供预览区切挑战态） */
  code?: string
  /** 结构化错误关联 URL（挑战页地址，供验证窗口/在浏览器打开用） */
  url?: string
  stack?: string
  durationMs: number
  /** 插件运行过程中通过 $lib.http 发起的请求记录（含失败前已发出的请求） */
  httpLog: HttpRecord[]
}

/** fixture 白名单根（懒解析：import 期不抛错，缺目录的报错留给调用点）。 */
function allowedRoots(): string[] {
  const base = pluginsDir()
  return [base, path.join(base, '_fixtures'), process.cwd()]
}

/** fixture 路径校验：必须位于允许的目录内，防止越权读取。 */
function resolveFixture(fixture: string): string {
  const abs = path.resolve(fixture)
  const allowed = allowedRoots().some((root) => abs === root || abs.startsWith(root + path.sep))
  if (!allowed) {
    throw new Error(`fixture 路径不在允许的目录内: ${abs}`)
  }
  return abs
}

// 单条请求/响应体传输到前端的最大字符数，超出截断并标注原始长度。
// HTML 页面常达数十至数百 KB，全量回传会让 DevConsole 卡顿，截断后仍足够调试结构。
const MAX_BODY_CHARS = 8192

function truncateBody(body: string | undefined): string | undefined {
  if (body === undefined) return undefined
  if (body.length <= MAX_BODY_CHARS) return body
  return `${body.slice(0, MAX_BODY_CHARS)}\n…[已截断，原始长度 ${body.length} 字符]`
}

/** 裁剪请求记录：保留全部 URL / 请求头 / 响应头，仅对请求体 / 响应体做长度限制。 */
function trimRecord(record: HttpRecord): HttpRecord {
  return {
    ...record,
    requestBody: truncateBody(record.requestBody),
    responseBody: truncateBody(record.responseBody),
  }
}

/** 运行插件动作，永不抛错，统一返回 RunResponse。 */
export async function runPlugin(req: RunRequest, onUiRequest?: UiRequestHandler): Promise<RunResponse> {
  const start = Date.now()
  let dir: string
  try {
    dir = pluginsDir(req.options?.dir)
  } catch (error) {
    return { ok: false, error: (error as Error).message, durationMs: Date.now() - start } as RunResponse
  }
  const file = findPluginFile(dir, req.pluginId)
  if (!file) {
    return {
      ok: false,
      error: `找不到插件 "${req.pluginId}"（目录: ${dir}）`,
      durationMs: Date.now() - start,
      httpLog: [],
    }
  }

  const httpLog: HttpRecord[] = []
  try {
    const opts: RunOptions = { dir, onRequest: (r) => httpLog.push(trimRecord(r)), cookieStore: sharedCookieStore }
    // headed 浏览器通道注入（薄注入）：`--fixture` 优先（run.ts 内短路），
    // 在线 run 才走到这里；插件侧零改（anime_site_a request() 直连优先 + 恰 1 次重抓直接吃到）。
    opts.onBrowserFetch = async (url, browserOpts) => {
      // run 级 browserMode 透传（插件零改）；ephemeral 不回填共享 jar
      const mode: BrowserMode = req.options?.browserMode === 'ephemeral' ? 'ephemeral' : 'persistent'
      const via = await fetchHtmlViaBrowser(url, { ...browserOpts, mode })
      if (mode !== 'ephemeral') refillSharedJar(url, via.cookies)
      return { status: via.status, headers: via.headers, body: via.body }
    }
    if (req.options?.page) opts.page = req.options.page
    if (req.options?.category) opts.category = req.options.category
    if (req.options?.url) opts.url = req.options.url
    if (req.options?.channel) opts.channel = req.options.channel
    if (req.options?.cursor) opts.cursor = req.options.cursor
    if (req.options?.fixture) opts.fixture = resolveFixture(req.options.fixture)
    if (req.options?.settings) opts.settings = req.options.settings
    if (req.options?.inputs) opts.inputs = req.options.inputs
    if (onUiRequest) opts.onUiRequest = onUiRequest
    const data = await executeRun(file, req.action, req.target, opts)
    return { ok: true, data, durationMs: Date.now() - start, httpLog }
  } catch (err: any) {
    // 即便插件抛错，也返回插件在失败前已发起的请求，便于定位是网络还是解析问题；
    // 结构化 code/url 透传（CHALLENGE → 预览区切挑战态）。
    return {
      ok: false,
      error: err.message,
      code: typeof err.code === 'string' ? err.code : undefined,
      url: typeof err.url === 'string' ? err.url : undefined,
      stack: err.stack,
      durationMs: Date.now() - start,
      httpLog,
    }
  }
}
