// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listPlugins, runPlugin } from '../plugin-service.js'

/**
 * 插件语料**按需**：`LINGSHU_PLUGINS_DIR` → `<cwd>/plugins`（母仓开发放符号链接
 * `devconsole/plugins → ../lingshu-plugins`）。公开仓不带内容源，整组跳过——
 * 缺语料不该让 CI 变红，但母仓丢了语料也不该静默通过（见下方 `hasCorpus` 断言）。
 */
const PLUGINS = (() => {
  const candidates = [process.env.LINGSHU_PLUGINS_DIR, path.resolve(process.cwd(), 'plugins')].filter(
    (value): value is string => Boolean(value && value.trim()),
  )
  return candidates.map((value) => path.resolve(value)).find((dir) => fs.existsSync(dir)) ?? ''
})()
const hasCorpus = PLUGINS !== ''
if (!hasCorpus && process.env.LINGSHU_REQUIRE_PLUGIN_CORPUS === '1') {
  throw new Error('LINGSHU_REQUIRE_PLUGIN_CORPUS=1 但未找到插件语料（母仓 CI 用）')
}

describe.skipIf(!hasCorpus)('plugin-service', () => {
  it('列出插件并探测能力', async () => {
    const plugins = await listPlugins(PLUGINS)
    const manga_site_f = plugins.find((p) => p.id === 'manga_site_f')
    expect(manga_site_f).toBeTruthy()
    expect(manga_site_f!.capabilities.categories).toBe(true)
    expect(manga_site_f!.capabilities.reading).toBe(true)
  })

  it('manga_site_b 探测 listings 能力', async () => {
    const plugins = await listPlugins(PLUGINS)
    const manga_site_b = plugins.find((p) => p.id === 'manga_site_b')
    expect(manga_site_b).toBeTruthy()
    expect(manga_site_b!.capabilities.listings).toBe(true)
  })

  it('runPlugin 成功执行 listings（getListings，manga_site_b：探索页条目 + 1 顶层平铺目录 + 筛选栏）', async () => {
    const res = await runPlugin({
      pluginId: 'manga_site_b',
      action: 'listings',
      options: { dir: PLUGINS },
    })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    // listings-first：首项为探索页条目（iOS 不再固定显示「首页」，探索流经此条目暴露）
    const data = res.data as Array<{ name: string; category?: string; kind?: string; filters?: unknown[] }>
    expect(data[0]).toEqual({ name: '推荐', kind: 'explore' })
    // 收敛：原 13 平铺页签 → 1 个目录页，携带分类(c)/排序(o) 筛选组
    expect(data[1].name).toBe('全部')
    expect(data[1].category).toBe('c=0&o=mr')
    expect(data[1].filters?.length).toBe(2)
  })

  it('runPlugin 成功执行 categories（fixture 离线快照）', async () => {
    const fixture = path.resolve(PLUGINS, '_fixtures/manga_site_f/categories.html')
    const res = await runPlugin({
      pluginId: 'manga_site_f',
      action: 'categories',
      options: { dir: PLUGINS, fixture },
    })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
    // fixture 模式也应记录"插件试图发起的请求"，便于核对 URL / 请求头
    expect(res.httpLog.length).toBeGreaterThan(0)
    expect(res.httpLog[0].fixture).toBe(true)
    expect(res.httpLog[0].url).toBeTruthy()
    expect(res.httpLog[0].method).toBe('GET')
  })

  it('runPlugin 找不到插件时返回 ok:false', async () => {
    const res = await runPlugin({ pluginId: 'no-such', action: 'list', options: { dir: PLUGINS } })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('找不到插件')
  })

  it('fixture 越权路径被拒绝', async () => {
    const res = await runPlugin({
      pluginId: 'manga_site_f',
      action: 'categories',
      options: { dir: PLUGINS, fixture: '/etc/passwd' },
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('不在允许的目录内')
  })
})

describe('plugin-service 设置面（ADR-0004）', () => {
  /** 写一个临时插件文件并返回其目录 */
  function withTempPlugin(name: string, body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-settings-'))
    fs.writeFileSync(
      path.join(dir, name),
      `// ==Plugin==\n// id: ${name.replace(/\.plugin\.js$/, '')}\n// name: ${name.replace(/\.plugin\.js$/, '')}\n// version: 1.0.0\n// ==EndPlugin==\n${body}`,
      'utf-8',
    )
    return dir
  }

  it('listPlugins 探测 capabilities.settings 并填充 settingsSchema', async () => {
    const dir = withTempPlugin(
      'set.plugin.js',
      `module.exports = {
  async fetchList() { return { items: [] } },
  async fetchDetail(url) { return { title: 't', sourceName: 's', sourceUrl: url, blocks: [] } },
  getSettingsSchema() {
    return [
      { key: 'apiLine', label: 'API 线路', type: 'select', default: '1', options: [{ value: '1', label: '线路1' }, { value: '2', label: '线路2' }] },
      { key: 'hd', label: '高清', type: 'switch', default: false },
      { key: 'refresh', label: '刷新', type: 'action', buttonText: '刷新域名' },
    ]
  },
  async runSettingAction(key) { return { message: 'done ' + key } },
}`,
    )
    try {
      const plugins = await listPlugins(dir)
      const p = plugins.find((x) => x.id === 'set')
      expect(p).toBeTruthy()
      expect(p!.capabilities.settings).toBe(true)
      expect(p!.settingsSchema).toHaveLength(3)
      expect(p!.settingsSchema![0]).toMatchObject({ key: 'apiLine', type: 'select' })
      expect(p!.settingsSchema![0]).toHaveProperty('options')
      expect(p!.settingsSchema![2]).toMatchObject({
        key: 'refresh',
        type: 'action',
        buttonText: '刷新域名',
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runPlugin setting-action 派发到 runSettingAction，并把 settings 注入 $lib.settings', async () => {
    const dir = withTempPlugin(
      'set.plugin.js',
      `module.exports = {
  async fetchList() { return { items: [] } },
  async fetchDetail(url) { return { title: 't', sourceName: 's', sourceUrl: url, blocks: [] } },
  async runSettingAction(key) {
    var line = $lib.settings.get('apiLine')
    return { message: key + ':' + (line === undefined ? '默认' : line) }
  },
}`,
    )
    try {
      const res = await runPlugin({
        pluginId: 'set',
        action: 'setting-action',
        target: 'refreshDomain',
        options: { dir, settings: { apiLine: '4' } },
      })
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({ message: 'refreshDomain:4' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('插件未导出 runSettingAction 时 setting-action 返回 ok:false（优雅报错）', async () => {
    const dir = withTempPlugin(
      'nosa.plugin.js',
      `module.exports = {
  async fetchList() { return { items: [] } },
  async fetchDetail(url) { return { title: 't', sourceName: 's', sourceUrl: url, blocks: [] } },
}`,
    )
    try {
      const res = await runPlugin({
        pluginId: 'nosa',
        action: 'setting-action',
        target: 'x',
        options: { dir },
      })
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/不支持 runSettingAction/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
