/**
 * 自动验证的按插件偏好（ADR-0047，宿主侧 localStorage，与 `$lib.settings` 严格分家）。
 *
 * 存两样，不管插件运行时：
 * - 自动开关：用户在挑战块打开「自动处理验证」后，此插件 CHALLENGE 即自动
 *   开窗 + 轮询 + 通过后自动重试（最多一次，防循环烧声誉）。缺省关。
 * - 通道形态偏好：用户上次点的验证窗形态（持久 / 一次性），自动开窗沿用；
 *   缺省 persistent。从不注入插件，只决定宿主开哪个窗。
 */
import type { BrowserMode } from './api/client.js'

const AUTO_PREFIX = 'devconsole-auto-verify:'
const MODE_PREFIX = 'devconsole-browser-pref:'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* localStorage 不可用时静默忽略，不影响运行 */
  }
}

/** 该插件是否开了自动验证（缺省关） */
export function loadAutoVerify(pluginId: string): boolean {
  return read(AUTO_PREFIX + pluginId) === '1'
}

/** 开关自动验证（按插件记忆） */
export function saveAutoVerify(pluginId: string, on: boolean): void {
  write(AUTO_PREFIX + pluginId, on ? '1' : '0')
}

/** 该插件的通道形态偏好（缺省 persistent；只认 ephemeral，其余一律回 persistent） */
export function loadBrowserPref(pluginId: string): BrowserMode {
  return read(MODE_PREFIX + pluginId) === 'ephemeral' ? 'ephemeral' : 'persistent'
}

/** 记住通道形态偏好（两个验证窗按钮点击时写，自动开窗时读） */
export function saveBrowserPref(pluginId: string, mode: BrowserMode): void {
  write(MODE_PREFIX + pluginId, mode === 'ephemeral' ? 'ephemeral' : 'persistent')
}
