export type {
  ListItem,
  ListTag,
  BadgeText,
  CoverBadge,
  CoverBadges,
  ContentBlock,
  PageJumpTarget,
  ImageEncryption,
  ImageTransport,
  ArticleDetail,
  ReadingPage,
  PlayLine,
  EpisodeItem,
  PlayUrlResult,
  VideoQuality,
  CategoryNode,
  CategoryGroup,
  CategoryFilterType,
  CategoryFilterDisplay,
  ExploreSection,
  ExploreFeed,
  TagItem,
  TagGroup,
  TagIndex,
  TagContext,
  TagResult,
  Listing,
  PluginMeta,
  HttpRecord,
  ListResult,
  PaginationMeta,
  PagePagination,
  CursorPagination,
  SettingOption,
  SettingField,
  SettingActionResult,
  AccountField,
  AccountSchema,
  AccountLoginResult,
  UiPrompt,
  UiButton,
} from 'lingshu-runtime'
import type { PluginMeta, HttpRecord, SettingField, AccountSchema } from 'lingshu-runtime'

export interface Capabilities {
  list: boolean
  detail: boolean
  reading: boolean
  search: boolean
  categories: boolean
  listings: boolean
  explore: boolean
  /** 是否导出 getTags（标签索引页，ADR-0037） */
  tags: boolean
  /** 是否导出 fetchPlayUrl（播放页解析，ADR-0020） */
  play: boolean
  /** 是否声明了设置面（导出 getSettingsSchema） */
  settings: boolean
  /** 是否声明了账号登录面（导出 getAccountSchema） */
  account: boolean
}

export interface PluginInfo extends PluginMeta {
  capabilities: Capabilities
  /** 设置字段 schema；仅当插件导出 getSettingsSchema 时填充，供设置表单渲染 */
  settingsSchema?: SettingField[]
  /** 账号登录 schema；仅当插件导出 getAccountSchema 时填充，供登录表单渲染 */
  accountSchema?: AccountSchema
}

export type Action =
  | 'list'
  | 'detail'
  | 'reading'
  | 'play'
  | 'search'
  | 'categories'
  | 'listings'
  | 'explore'
  | 'tags'
  | 'setting-action'
  | 'login'

/** 结果面板视图（setting/account 为插件表单，独立于运行结果） */
export type ResultView = 'json' | 'preview' | 'requests' | 'settings' | 'account'

export interface RunResponse {
  ok: boolean
  data?: unknown
  error?: string
  /** 结构化错误码（CHALLENGE = 挑战页，预览区切验证态，ADR-0045） */
  code?: string
  /** 结构化错误关联 URL（挑战页地址） */
  url?: string
  stack?: string
  durationMs: number
  /** 插件运行过程中发起的 HTTP 请求记录（含失败前已发出的请求） */
  httpLog?: HttpRecord[]
}
