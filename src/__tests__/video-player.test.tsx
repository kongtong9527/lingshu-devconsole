import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import VideoPlayer from '../preview/VideoPlayer.js'

// hls.js 在 jsdom 无 MediaSource，mock 掉 HLS 类；MANIFEST_PARSED 回调由测试手动触发
type HlsListener = (event: string, data: unknown) => void
const hlsListeners: HlsListener[] = []
const hlsInstances: Array<{ currentLevel: number; listeners: HlsListener[] }> = []

vi.mock('hls.js', () => {
  class MockHls {
    static isSupported = vi.fn(() => false)
    static Events = {
      ERROR: 'hlsError',
      MANIFEST_PARSED: 'hlsManifestParsed',
    }
    currentLevel = -1
    listeners: HlsListener[] = []
    constructor() {
      hlsInstances.push(this)
    }
    on = vi.fn((event: string, cb: HlsListener) => {
      // 记录监听器，供测试模拟 MANIFEST_PARSED
      ;(this as unknown as { listeners: HlsListener[] }).listeners.push(cb)
      hlsListeners.push(cb)
    })
    loadSource = vi.fn()
    attachMedia = vi.fn()
    destroy = vi.fn()
  }
  return { default: MockHls }
})

/** 触发某个 hls 实例的 MANIFEST_PARSED（模拟 master playlist 解析出多档） */
function fireManifestParsed(levels: Array<{ height: number; bitrate: number }>) {
  const inst = hlsInstances[hlsInstances.length - 1]
  if (!inst) throw new Error('无 hls 实例')
  for (const cb of inst.listeners) cb('hlsManifestParsed', { levels })
}

describe('VideoPlayer 清晰度菜单（ADR-0029）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hlsListeners.length = 0
    hlsInstances.length = 0
  })

  it('无 qualities 且非 HLS 时不渲染清晰度菜单', () => {
    render(<VideoPlayer src="https://cdn.example.com/video.mp4" />)
    expect(screen.queryByTitle('清晰度')).toBeNull()
  })

  it('显式 qualities >1 档时渲染菜单，点档位换源重建播放器', async () => {
    const qualities = [
      { label: '1080P', url: 'https://cdn.example.com/1080.mp4' },
      { label: '720P', url: 'https://cdn.example.com/720.mp4' },
      { label: '480P', url: 'https://cdn.example.com/480.mp4' },
    ]
    render(<VideoPlayer src={qualities[0].url} qualities={qualities} />)

    // 菜单按钮显示当前档
    const btn = screen.getByTitle('清晰度')
    expect(btn.textContent).toBe('1080P')

    // 打开菜单 → 三项
    await act(async () => {
      fireEvent.click(btn)
    })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.textContent)).toEqual(['1080P', '720P', '480P'])
    expect(items[0].className).toContain('is-selected')

    // 点击 720P → video.src 变为 720 档（proxyUrl 包装）
    await act(async () => {
      fireEvent.click(items[1])
    })
    const video = document.querySelector('video')!
    expect(video.src).toContain(encodeURIComponent('https://cdn.example.com/720.mp4'))
    // 菜单选中态迁移
    const btnAfter = screen.getByTitle('清晰度')
    expect(btnAfter.textContent).toBe('720P')
  })

  it('单档 qualities 不渲染菜单（与单档视频语义一致）', () => {
    render(
      <VideoPlayer
        src="https://cdn.example.com/a.mp4"
        qualities={[{ label: 'HD', url: 'https://cdn.example.com/a.mp4' }]}
      />,
    )
    expect(screen.queryByTitle('清晰度')).toBeNull()
  })

  it('props.src 变化时重置显式档选择', async () => {
    const qualities = [
      { label: 'A', url: 'https://cdn.example.com/a.mp4' },
      { label: 'B', url: 'https://cdn.example.com/b.mp4' },
      { label: 'C', url: 'https://cdn.example.com/c.mp4' },
    ]
    const { rerender } = render(<VideoPlayer src={qualities[0].url} qualities={qualities} />)

    await act(async () => {
      fireEvent.click(screen.getByTitle('清晰度'))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('menuitem')[1])
    })
    expect(screen.getByTitle('清晰度').textContent).toBe('B')

    // 外部换源（如切换剧集到新默认档）→ 重置为新的默认档
    rerender(<VideoPlayer src={qualities[2].url} qualities={qualities} />)
    expect(screen.getByTitle('清晰度').textContent).toBe('C')
  })

  it('master playlist 多档（通路二）：hls levels 自动出菜单，点档位设 currentLevel', async () => {
    // 需 Hls.isSupported() 为 true 才走 hls.js 分支
    const HlsMock = (await import('hls.js')).default as unknown as {
      isSupported: ReturnType<typeof vi.fn>
    }
    HlsMock.isSupported.mockReturnValue(true)

    render(<VideoPlayer src="https://cdn.example.com/master.m3u8" />)

    // 模拟 master playlist 解析出 3 档（hls.js 顺序：由低到高）
    act(() => {
      fireManifestParsed([
        { height: 360, bitrate: 800000 },
        { height: 720, bitrate: 1400000 },
        { height: 1080, bitrate: 2600000 },
      ])
    })

    // 菜单按高→低展示，包含「自动」
    const btn = screen.getByTitle('清晰度')
    expect(btn.textContent).toBe('自动')
    await act(async () => {
      fireEvent.click(btn)
    })
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['自动', '1080p', '720p', '360p'])

    // 点 720p → currentLevel=1（原始索引，非展示顺序）
    await act(async () => {
      fireEvent.click(items[2])
    })
    const inst = hlsInstances[hlsInstances.length - 1]
    expect(inst.currentLevel).toBe(1)
    expect(screen.getByTitle('清晰度').textContent).toBe('720p')

    // 点「自动」→ currentLevel=-1
    await act(async () => {
      fireEvent.click(screen.getByTitle('清晰度'))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('menuitem')[0])
    })
    expect(inst.currentLevel).toBe(-1)
    expect(screen.getByTitle('清晰度').textContent).toBe('自动')
  })

  it('master playlist 单档（通路二）：不渲染清晰度菜单', async () => {
    const HlsMock = (await import('hls.js')).default as unknown as {
      isSupported: ReturnType<typeof vi.fn>
    }
    HlsMock.isSupported.mockReturnValue(true)

    render(<VideoPlayer src="https://cdn.example.com/single.m3u8" />)
    act(() => {
      fireManifestParsed([{ height: 720, bitrate: 1400000 }])
    })
    expect(screen.queryByTitle('清晰度')).toBeNull()
  })

  it('显式 qualities 优先于 master playlist 自动菜单（两通路互斥）', async () => {
    const HlsMock = (await import('hls.js')).default as unknown as {
      isSupported: ReturnType<typeof vi.fn>
    }
    HlsMock.isSupported.mockReturnValue(true)

    render(
      <VideoPlayer
        src="https://cdn.example.com/master.m3u8"
        qualities={[
          { label: '高清', url: 'https://cdn.example.com/720.mp4' },
          { label: '标清', url: 'https://cdn.example.com/360.mp4' },
        ]}
      />,
    )
    act(() => {
      fireManifestParsed([
        { height: 360, bitrate: 800000 },
        { height: 1080, bitrate: 2600000 },
      ])
    })
    // 菜单来自显式 qualities（含当前档「高清」），而非 levels
    const btn = screen.getByTitle('清晰度')
    expect(btn.textContent).toBe('高清')
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['高清', '标清'])
  })
})