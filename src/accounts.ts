import type { AccountLoginResult } from './types.js'

/**
 * 插件登录结果的本地持久化（宿主侧 localStorage）。
 *
 * 与 runtime 的 `$lib.storage`（插件自管缓存）严格分家：
 * 这里只存插件 `login` 动作返回的展示信息（uid/username/message），
 * 不存账号密码。key 按 plugin id 命名空间隔离。
 */
const STORAGE_PREFIX = 'devconsole-account:'

function storageKey(pluginId: string): string {
  return STORAGE_PREFIX + pluginId
}

/** 读取某插件已保存的登录结果；无记录或解析失败返回 null */
export function loadPluginAccount(pluginId: string): AccountLoginResult | null {
  try {
    const raw = localStorage.getItem(storageKey(pluginId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as AccountLoginResult
  } catch {
    return null
  }
}

/** 写入某插件的登录结果（覆盖式） */
export function savePluginAccount(pluginId: string, result: AccountLoginResult): void {
  try {
    localStorage.setItem(storageKey(pluginId), JSON.stringify(result))
  } catch {
    /* localStorage 不可用（隐私模式）时静默忽略，不影响本次登录展示 */
  }
}

/** 清除某插件的本地登录展示 */
export function clearPluginAccount(pluginId: string): void {
  try {
    localStorage.removeItem(storageKey(pluginId))
  } catch {
    /* 同上 */
  }
}
