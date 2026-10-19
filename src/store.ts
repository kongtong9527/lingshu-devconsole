import { create } from 'zustand'
import type { PluginInfo, Action, RunResponse, ListItem, PaginationMeta, ResultView, CategoryGroup, TagGroup, TagResult } from './types.js'
import { getPlugins, run as apiRun, type BrowserMode } from './api/client.js'
import { loadPluginSettings } from './settings.js'

/**
 * 从 RunResponse.data 中读取列表结果；非列表结果返回 null。
 * `filters`（列表页自声明筛选组）一并读出：它是「只有抓到页面才知道」的
 * 落地页筛选（如工作室页的题材滑块），ListPreview 优先用它、缺省回退跳转携带的
 * `Selected.filters`。
 */
function readListResult(
  data: unknown,
): { items: ListItem[]; pagination?: PaginationMeta; filters?: CategoryGroup[] } | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as { items?: unknown; pagination?: unknown; filters?: unknown }
  if (!Array.isArray(obj.items)) return null
  return {
    items: obj.items as ListItem[],
    pagination: obj.pagination as PaginationMeta | undefined,
    filters: Array.isArray(obj.filters) ? (obj.filters as CategoryGroup[]) : undefined,
  }
}

/**
 * 从 RunResponse.data 中读取标签索引结果；归一化两种形态：
 * Array = legacy 全量（TagGroup[]）；Object（含 groups）= 分页信封（TagResult）。
 * 非标签结果返回 null。
 */
function readTagResult(
  data: unknown,
): { groups: TagGroup[]; pagination?: PaginationMeta } | null {
  if (Array.isArray(data)) return { groups: data as TagGroup[] }
  if (!data || typeof data !== 'object') return null
  const obj = data as { groups?: unknown; pagination?: unknown }
  if (!Array.isArray(obj.groups)) return null
  return { groups: obj.groups as TagGroup[], pagination: (obj as TagResult).pagination }
}

export interface Selected {
  pluginId: string | null
  action: Action
  target: string
  page: string
  /** 筛选组合串：list/search 走 `PluginContext.category`，tags 走
   *  `TagContext.category`（标签索引页自己的筛选，如 kvs_site_a `type=album`）——同口径同编码，
   *  只是落到的 context 字段不同（起 tags 不再有独立的服务端排序字段）。 */
  category: string
  /** 页面通道：list 用任意列表页面 URL，透传进 PluginContext.url */
  url: string
  /** 列表通道标识：`Listing.channel` / `PageJumpTarget.list.channel` 原样透传进
   *  `PluginContext.channel`，插件优先按它分派（缺省回退 URL 正则）。 */
  channel?: string
  /** 落地列表页专属筛选组（型）：由 PageJumpTarget.list.filters 携带，
   *  宿主在 ListPreview 渲染筛选栏；用户组合后并入 category 再请求，不传服务端。 */
  filters?: CategoryGroup[]
  fixture: string
}

export interface HistoryEntry {
  selected: Selected
  result: RunResponse
  view: ResultView
}

type Theme = 'dark' | 'light'

interface State {
  plugins: PluginInfo[]
  selected: Selected
  result: RunResponse | null
  history: HistoryEntry[]
  view: ResultView
  loading: boolean
  /** 列表累加条目（list/search 专用）：加载更多时追加，新运行时重置为单页 */
  listItems: ListItem[]
  /** 列表页自声明筛选组：来自最近一次 list 结果的 `filters`，
   *  非空时优先于 `Selected.filters`（跳转携带的静态筛选）渲染筛选栏。 */
  listFilters?: CategoryGroup[]
  /** 最近一页的分页元数据；缺失或 hasMore:false 时不显示「加载更多」 */
  listPagination?: PaginationMeta
  loadingMore: boolean
  /** 标签累加分组（tags 专用）：分页云加载更多时追加，新运行时重置为首页 */
  tagsGroups: TagGroup[]
  /** 标签最近一页的分页元数据；缺失或 hasMore:false 时不显示「加载更多」 */
  tagsPagination?: PaginationMeta
  tagsLoadingMore: boolean
  theme: Theme
  /**
   * 下一次 run 的浏览器通道形态（联动语义）：
   * 挑战块点「一次性窗口打开」即置 'ephemeral'，run() 消费；抓到非挑战内容后自动
   * 回 'persistent'，结果仍是 CHALLENGE 则保持武装（验证窗留着，直接重试）。
   * loadMore/loadMoreTags 不消费（恒走 persistent）。
   */
  browserMode: BrowserMode
  setBrowserMode: (m: BrowserMode) => void
  loadPlugins: () => Promise<void>
  setPlugin: (id: string) => void
  setAction: (a: Action) => void
  patch: (p: Partial<Selected>) => void
  setView: (v: ResultView) => void
  goBack: () => void
  clearHistory: () => void
  run: () => Promise<void>
  runWith: (patch: Partial<Selected>) => Promise<void>
  loadMore: () => Promise<void>
  loadMoreTags: () => Promise<void>
  toggleTheme: () => void
}

export const useStore = create<State>((set, get) => ({
  plugins: [],
  selected: {
    pluginId: null,
    action: 'categories',
    target: '',
    page: '1',
    category: '',
    url: '',
    channel: '',
    fixture: '',
  },
  result: null,
  history: [],
  view: 'json',
  loading: false,
  listItems: [],
  loadingMore: false,
  tagsGroups: [],
  tagsLoadingMore: false,
  theme: 'dark',
  browserMode: 'persistent',
  setBrowserMode: (m) => set({ browserMode: m }),

  loadPlugins: async () => {
    const plugins = await getPlugins()
    set({ plugins, selected: { ...get().selected, pluginId: plugins[0]?.id ?? null } })
  },

  setPlugin: (id) =>
    set((s) => ({
      selected: { ...s.selected, pluginId: id, action: 'categories', target: '', category: '', url: '', channel: '' },
      result: null,
      listItems: [],
      listPagination: undefined,
      listFilters: undefined,
      tagsGroups: [],
      tagsPagination: undefined,
    })),

  setAction: (a) =>
    set((s) => ({ selected: { ...s.selected, action: a }, result: null, listItems: [], listPagination: undefined, listFilters: undefined, tagsGroups: [], tagsPagination: undefined })),

  patch: (p) => set((s) => ({ selected: { ...s.selected, ...p } })),

  setView: (v) => set({ view: v }),

  goBack: () =>
    set((s) => {
      if (s.history.length < 2) return s
      const previous = s.history[s.history.length - 2]
      const list = readListResult(previous.result.data)
      const tags = readTagResult(previous.result.data)
      return {
        selected: { ...previous.selected },
        result: previous.result,
        view: previous.view,
        history: s.history.slice(0, -1),
        listItems: list ? list.items : [],
        listPagination: list ? list.pagination : undefined,
        listFilters: list ? list.filters : undefined,
        tagsGroups: tags ? tags.groups : [],
        tagsPagination: tags ? tags.pagination : undefined,
      }
    }),

  clearHistory: () => set({ history: [] }),

  run: async () => {
    const sel = get().selected
    if (!sel.pluginId) return
    // 一次性模式一次消费（不记忆）；只在 ephemeral 时透传字段（persistent 零回退）
    const mode = get().browserMode
    set({ loading: true })
    const options: { page: string; category: string; url?: string; channel?: string; fixture?: string; settings?: Record<string, string | boolean>; browserMode?: BrowserMode } = {
      page: sel.page,
      category: sel.category,
    }
    if (mode === 'ephemeral') options.browserMode = 'ephemeral'
    if (sel.url) options.url = sel.url
    if (sel.channel) options.channel = sel.channel
    if (sel.fixture) options.fixture = sel.fixture
    // 注入用户偏好（宿主侧 localStorage → $lib.settings，按 run 注入、只读、不持久）
    const settings = loadPluginSettings(sel.pluginId)
    if (Object.keys(settings).length > 0) options.settings = settings
    try {
      const result = await apiRun({
        pluginId: sel.pluginId,
        action: sel.action,
        target: sel.target || undefined,
        options,
      })
      set((s) => {
        const view = result.ok ? 'preview' : s.view
        const isListLike = sel.action === 'list' || sel.action === 'search'
        const list = isListLike && result.ok ? readListResult(result.data) : null
        const isTags = sel.action === 'tags'
        const tags = isTags && result.ok ? readTagResult(result.data) : null
        return {
          result,
          view,
          // list/search 重置累加器为新页；detail/reading 保留列表项供降级封面等回退
          listItems: list ? list.items : s.listItems,
          listPagination: list ? list.pagination : s.listPagination,
          // 筛选组按「最近一次成功结果」为准：本次结果自声明优先，未声明则保留上一份
          listFilters: list ? list.filters ?? s.listFilters : s.listFilters,
          // tags 重置累加器为首页（分页云逐页追加经 loadMoreTags）
          tagsGroups: tags ? tags.groups : s.tagsGroups,
          tagsPagination: tags ? tags.pagination : s.tagsPagination,
          history: [...s.history, { selected: { ...sel }, result, view }],
        }
      })
    } catch (e) {
      const result: RunResponse = { ok: false, error: String(e), durationMs: 0 }
      set((s) => ({
        result,
        history: [...s.history, { selected: { ...sel }, result, view: s.view }],
      }))
    } finally {
      // 一次性武装：ephemeral 管到抓到非挑战内容为止——结果仍是 CHALLENGE 时保持武装
      //（验证窗留着，用户过完验证直接重试，不用重新开窗）；其余情况回 persistent（不记忆）
      if (get().browserMode === 'ephemeral' && get().result?.code !== 'CHALLENGE') set({ browserMode: 'persistent' })
      set({ loading: false })
    }
  },

  runWith: async (patch) => {
    set((s) => ({ selected: { ...s.selected, ...patch } }))
    await get().run()
  },

  loadMore: async () => {
    const sel = get().selected
    if (sel.action !== 'list' && sel.action !== 'search') return
    const pg = get().listPagination
    if (!pg || !pg.hasMore || get().loadingMore) return

    const options: { page?: string; category?: string; url?: string; channel?: string; cursor?: string; fixture?: string; settings?: Record<string, string | boolean> } = {}
    if (sel.category) options.category = sel.category
    if (sel.url) options.url = sel.url
    if (sel.channel) options.channel = sel.channel
    if (sel.fixture) options.fixture = sel.fixture
    // 注入用户偏好（宿主侧 localStorage → $lib.settings，按 run 注入、只读、不持久）
    const settings = loadPluginSettings(sel.pluginId!)
    if (Object.keys(settings).length > 0) options.settings = settings
    if (pg.strategy === 'page') {
      options.page = String(pg.page + 1)
    } else {
      // cursor 策略：回传 nextCursor
      options.cursor = pg.nextCursor
      if (sel.page) options.page = sel.page
    }

    set({ loadingMore: true })
    try {
      const result = await apiRun({
        pluginId: sel.pluginId!,
        action: sel.action,
        target: sel.target || undefined,
        options,
      })
      set((s) => {
        const list = result.ok ? readListResult(result.data) : null
        if (!list) {
          // 出错或非列表：仅更新 result（错误展示在结果区，累加器不变）
          return { result }
        }
        return {
          result,
          listItems: [...s.listItems, ...list.items],
          listPagination: list.pagination,
        }
      })
    } catch (e) {
      const result: RunResponse = { ok: false, error: String(e), durationMs: 0 }
      set({ result })
    } finally {
      set({ loadingMore: false })
    }
  },

  loadMoreTags: async () => {
    const sel = get().selected
    if (sel.action !== 'tags') return
    const pg = get().tagsPagination
    if (!pg || !pg.hasMore || get().tagsLoadingMore) return

    const options: { page?: string; category?: string; fixture?: string; settings?: Record<string, string | boolean> } = {}
    if (sel.category) options.category = sel.category
    if (sel.fixture) options.fixture = sel.fixture
    // 注入用户偏好（宿主侧 localStorage → $lib.settings，按 run 注入、只读、不持久）
    const settings = loadPluginSettings(sel.pluginId!)
    if (Object.keys(settings).length > 0) options.settings = settings
    if (pg.strategy === 'page') {
      options.page = String(pg.page + 1)
    } else {
      return
    }

    set({ tagsLoadingMore: true })
    try {
      const result = await apiRun({
        pluginId: sel.pluginId!,
        action: 'tags',
        target: undefined,
        options,
      })
      set((s) => {
        const tags = result.ok ? readTagResult(result.data) : null
        if (!tags) {
          // 出错或非标签：仅更新 result（错误展示在结果区，累加器不变）
          return { result }
        }
        return {
          result,
          tagsGroups: [...s.tagsGroups, ...tags.groups],
          tagsPagination: tags.pagination,
        }
      })
    } catch (e) {
      const result: RunResponse = { ok: false, error: String(e), durationMs: 0 }
      set({ result })
    } finally {
      set({ tagsLoadingMore: false })
    }
  },

  toggleTheme: () =>
    set((s) => {
      const newTheme = s.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', newTheme)
      localStorage.setItem('devconsole-theme', newTheme)
      return { theme: newTheme }
    }),
}))
