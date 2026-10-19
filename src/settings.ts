/**
 * 插件设置值的本地持久化（用户偏好，宿主侧 localStorage）。
 *
 * 与 runtime 的 `$lib.storage`（插件自管的文件持久缓存）严格分家：
 * - 本层只存「用户在设置表单里填的值」，每次 run 由 store 注入为 `$lib.settings`；
 * - 插件运行时的缓存走 `$lib.storage`，不经过这里。
 *
 * key 按 plugin id 命名空间隔离，值结构 `Record<fieldKey, string|boolean>`。
 */
const STORAGE_PREFIX = 'devconsole-settings:'

export type SettingValue = string | boolean

function key(pluginId: string): string {
  return STORAGE_PREFIX + pluginId
}

/** 读取某插件的所有设置值；无记录或解析失败返回空对象 */
export function loadPluginSettings(pluginId: string): Record<string, SettingValue> {
  try {
    const raw = localStorage.getItem(key(pluginId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, SettingValue>
  } catch {
    return {}
  }
}

/** 写入某插件的全部设置值（覆盖式） */
export function savePluginSettings(pluginId: string, values: Record<string, SettingValue>): void {
  try {
    localStorage.setItem(key(pluginId), JSON.stringify(values))
  } catch {
    /* localStorage 不可用（隐私模式）时静默忽略，不影响运行 */
  }
}

/** 更新单个字段值 */
export function updatePluginSetting(
  pluginId: string,
  fieldKey: string,
  value: SettingValue,
): Record<string, SettingValue> {
  const next = { ...loadPluginSettings(pluginId), [fieldKey]: value }
  savePluginSettings(pluginId, next)
  return next
}
