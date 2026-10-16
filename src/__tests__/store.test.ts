import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store.js'
import { run as apiRun } from '../api/client.js'

vi.mock('../api/client.js', () => ({
  getPlugins: vi.fn(),
  run: vi.fn(),
}))

const selected = {
  pluginId: 'p',
  action: 'list' as const,
  target: '',
  page: '1',
  category: '',
  url: '',
  fixture: '',
}

function resetStore() {
  useStore.setState({
    selected,
    result: null,
    history: [],
    view: 'json',
    loading: false,
    listItems: [],
    listPagination: undefined,
    loadingMore: false,
    browserMode: 'persistent',
  })
}

describe('DevConsole 预览历史', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(apiRun).mockReset()
  })

  it('缓存动作结果并可回退到上一个动作而不重新请求', async () => {
    vi.mocked(apiRun)
      .mockResolvedValueOnce({ ok: true, data: { items: [{ id: '1' }] }, durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, data: { title: '详情' }, durationMs: 2 })

    await useStore.getState().run()
    // list 运行后累加器为本次单页
    expect(useStore.getState().listItems).toEqual([{ id: '1' }])

    useStore.setState({ selected: { ...selected, action: 'detail', target: 'https://example.com/1' } })
    await useStore.getState().run()

    expect(useStore.getState().history).toHaveLength(2)
    expect(useStore.getState().result?.data).toEqual({ title: '详情' })

    useStore.getState().goBack()
    expect(useStore.getState().selected.action).toBe('list')
    expect(useStore.getState().result?.data).toEqual({ items: [{ id: '1' }] })
    // goBack 恢复 list 累加器为该次运行的条目
    expect(useStore.getState().listItems).toEqual([{ id: '1' }])
    expect(useStore.getState().history).toHaveLength(1)
    expect(apiRun).toHaveBeenCalledTimes(2)
  })

  it('可手动清除历史缓存但保留当前结果', async () => {
    vi.mocked(apiRun).mockResolvedValue({ ok: true, data: { items: [] }, durationMs: 1 })
    await useStore.getState().run()

    useStore.getState().clearHistory()
    expect(useStore.getState().history).toEqual([])
    expect(useStore.getState().result?.ok).toBe(true)
  })
})

describe('DevConsole 列表加载更多（分页器）', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(apiRun).mockReset()
  })

  it('page 策略：点加载更多追加下一页并推进 page', async () => {
    vi.mocked(apiRun)
      // 首次 list：第 1 页，hasMore
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'a' }], pagination: { strategy: 'page', hasMore: true, page: 1 } },
        durationMs: 1,
      })
      // 加载更多：第 2 页，无更多
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'b' }], pagination: { strategy: 'page', hasMore: false, page: 2 } },
        durationMs: 1,
      })

    await useStore.getState().run()
    expect(useStore.getState().listItems).toEqual([{ id: 'a' }])
    expect(useStore.getState().listPagination?.hasMore).toBe(true)

    await useStore.getState().loadMore()
    // 追加而非替换
    expect(useStore.getState().listItems).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(useStore.getState().listPagination?.hasMore).toBe(false)
    // 第二次请求推进到 page=2，不传 cursor
    const secondCall = vi.mocked(apiRun).mock.calls[1][0]
    expect(secondCall.options?.page).toBe('2')
    expect(secondCall.options?.cursor).toBeUndefined()
  })

  it('cursor 策略：点加载更多回传 nextCursor', async () => {
    vi.mocked(apiRun)
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'a' }], pagination: { strategy: 'cursor', hasMore: true, nextCursor: 'tok-x' } },
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'b' }], pagination: { strategy: 'cursor', hasMore: false, nextCursor: 'tok-y' } },
        durationMs: 1,
      })

    await useStore.getState().run()
    await useStore.getState().loadMore()
    expect(useStore.getState().listItems).toEqual([{ id: 'a' }, { id: 'b' }])
    const secondCall = vi.mocked(apiRun).mock.calls[1][0]
    expect(secondCall.options?.cursor).toBe('tok-x')
  })

  it('hasMore 为 false 时不发起加载更多请求', async () => {
    vi.mocked(apiRun).mockResolvedValueOnce({
      ok: true,
      data: { items: [{ id: 'a' }], pagination: { strategy: 'page', hasMore: false, page: 1 } },
      durationMs: 1,
    })
    await useStore.getState().run()
    await useStore.getState().loadMore()
    expect(apiRun).toHaveBeenCalledTimes(1)
  })

  it('无分页元数据时不发起加载更多请求', async () => {
    vi.mocked(apiRun).mockResolvedValueOnce({
      ok: true,
      data: { items: [{ id: 'a' }] },
      durationMs: 1,
    })
    await useStore.getState().run()
    await useStore.getState().loadMore()
    expect(apiRun).toHaveBeenCalledTimes(1)
  })

  it('非列表动作调用 loadMore 不生效', async () => {
    useStore.setState({ selected: { ...selected, action: 'detail', target: 'http://x' } })
    await useStore.getState().loadMore()
    expect(apiRun).not.toHaveBeenCalled()
  })
})

describe('DevConsole 页面通道 url 透传（ADR-0025）', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(apiRun).mockReset()
  })

  it('run() 把 Selected.url 透传给 API options.url', async () => {
    const url = 'http://x/moviesets/chengrendongman'
    vi.mocked(apiRun).mockResolvedValueOnce({
      ok: true,
      data: { items: [{ id: 'a' }] },
      durationMs: 1,
    })

    useStore.setState({ selected: { ...selected, action: 'list', url } })
    await useStore.getState().run()

    const call = vi.mocked(apiRun).mock.calls[0][0]
    expect(call.options?.url).toBe(url)
  })

  it('loadMore() 对页面通道列表同样透传 url 与下一页 page', async () => {
    const url = 'http://x/moviesets/chengrendongman/2'
    vi.mocked(apiRun)
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'a' }], pagination: { strategy: 'page', hasMore: true, page: 1 } },
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'b' }], pagination: { strategy: 'page', hasMore: false, page: 2 } },
        durationMs: 1,
      })

    useStore.setState({ selected: { ...selected, action: 'list', url } })
    await useStore.getState().run()
    await useStore.getState().loadMore()

    const secondCall = vi.mocked(apiRun).mock.calls[1][0]
    expect(secondCall.options?.url).toBe(url)
    expect(secondCall.options?.page).toBe('2')
  })
})

describe('DevConsole 一次性浏览器通道（ADR-0046，武装到非挑战为止）', () => {
  beforeEach(() => {
    resetStore()
    useStore.setState({ browserMode: 'persistent' })
    vi.mocked(apiRun).mockReset()
  })

  it('缺省 persistent：run() 不传 browserMode 字段（零回归）', async () => {
    vi.mocked(apiRun).mockResolvedValueOnce({ ok: true, data: { items: [] }, durationMs: 1 })
    await useStore.getState().run()
    const call = vi.mocked(apiRun).mock.calls[0][0]
    expect(call.options?.browserMode).toBeUndefined()
    expect(useStore.getState().browserMode).toBe('persistent')
  })

  it('ephemeral：抓到内容后自动回 persistent', async () => {
    vi.mocked(apiRun).mockResolvedValue({ ok: true, data: { items: [] }, durationMs: 1 })
    useStore.getState().setBrowserMode('ephemeral')
    await useStore.getState().run()
    const first = vi.mocked(apiRun).mock.calls[0][0]
    expect(first.options?.browserMode).toBe('ephemeral')
    expect(useStore.getState().browserMode).toBe('persistent')
    await useStore.getState().run()
    const second = vi.mocked(apiRun).mock.calls[1][0]
    expect(second.options?.browserMode).toBeUndefined()
  })

  it('ephemeral：结果仍是 CHALLENGE 时保持武装（验证窗留着，直接重试）', async () => {
    vi.mocked(apiRun)
      .mockResolvedValueOnce({ ok: false, error: '拦截', code: 'CHALLENGE', url: 'https://x.example/', durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, data: { items: [] }, durationMs: 1 })
    useStore.getState().setBrowserMode('ephemeral')
    await useStore.getState().run()
    // 仍是挑战：武装保留
    expect(useStore.getState().browserMode).toBe('ephemeral')
    await useStore.getState().run()
    const second = vi.mocked(apiRun).mock.calls[1][0]
    expect(second.options?.browserMode).toBe('ephemeral')
    // 抓到内容：解除武装
    expect(useStore.getState().browserMode).toBe('persistent')
  })
})

describe('DevConsole 插件设置透传（ADR-0004）', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(apiRun).mockReset()
    localStorage.clear()
  })

  it('run() 把 localStorage 中的插件设置注入 options.settings', async () => {
    localStorage.setItem('devconsole-settings:p', JSON.stringify({ apiLine: '2', hd: true }))
    vi.mocked(apiRun).mockResolvedValueOnce({ ok: true, data: { items: [] }, durationMs: 1 })

    await useStore.getState().run()

    const call = vi.mocked(apiRun).mock.calls[0][0]
    expect(call.options?.settings).toEqual({ apiLine: '2', hd: true })
  })

  it('无设置值时不传 settings 字段', async () => {
    vi.mocked(apiRun).mockResolvedValueOnce({ ok: true, data: { items: [] }, durationMs: 1 })

    await useStore.getState().run()

    const call = vi.mocked(apiRun).mock.calls[0][0]
    expect(call.options?.settings).toBeUndefined()
  })

  it('loadMore 同样透传当前插件设置', async () => {
    localStorage.setItem('devconsole-settings:p', JSON.stringify({ apiLine: '3' }))
    vi.mocked(apiRun)
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'a' }], pagination: { strategy: 'page', hasMore: true, page: 1 } },
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [{ id: 'b' }], pagination: { strategy: 'page', hasMore: false, page: 2 } },
        durationMs: 1,
      })

    await useStore.getState().run()
    await useStore.getState().loadMore()

    const secondCall = vi.mocked(apiRun).mock.calls[1][0]
    expect(secondCall.options?.settings).toEqual({ apiLine: '3' })
  })
})
