import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../store.js'
import ArticlePreview from '../ArticlePreview.js'
import ListPreview from '../ListPreview.js'
import ReadingPagePreview from '../ReadingPagePreview.js'
import CategoriesPreview from '../CategoriesPreview.js'
import ListingsPreview from '../ListingsPreview.js'
import ExplorePreview from '../ExplorePreview.js'
import TagsPreview from '../TagsPreview.js'
import BlockRenderer from '../BlockRenderer.js'
import CardPreview from '../CardPreview.js'
import LazyImage from '../LazyImage.js'
import { toJumpPatch } from '../index.js'
import { run as apiRun } from '../../api/client.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ArticleDetail, ReadingPage, CategoryGroup, Listing, ContentBlock, PageJumpTarget, ExploreFeed, TagIndex, ListItem } from '../../types.js'
import { caps } from '../../__tests__/fixtures.js'

// 懒播放占位测试需要 mock apiRun；其余预览不直接调用它（store 由 runWith 接管）
vi.mock('../../api/client.js', () => ({
  getPlugins: vi.fn(),
  run: vi.fn(),
  openUiStream: vi.fn(),
  respondUi: vi.fn(),
}))

const baseSelected = {
  pluginId: 'p',
  action: 'list' as const,
  target: '',
  page: '1',
  category: '',
  url: '',
  fixture: '',
}

describe('ArticlePreview', () => {
  it('渲染各 block 类型与角标', () => {
    const data: ArticleDetail = {
      title: '测试文章',
      sourceName: '测试',
      sourceUrl: '',
      coverUrl: 'http://x/cover.jpeg',
      metadata: {
        imageEncryption: {
          algorithm: 'AES-128-CBC',
          padding: 'Pkcs7',
          encoding: 'Base64 ciphertext',
          key: 'f5d965df75336270',
          iv: '97b60394abc2fbe1',
        },
      },
      blocks: [
        { type: 'text', content: '正文段落' },
        { type: 'heading', content: '小标题', level: 2 },
        { type: 'image', url: 'http://x/a.png' },
        { type: 'video', url: 'http://x/video.mp4', platform: '测试视频' },
      ],
    }
    render(<ArticlePreview data={data} onJumpJson={() => {}} />)
    expect(screen.getByText('测试文章')).toBeTruthy()
    expect(screen.getByText('正文段落')).toBeTruthy()
    expect(screen.getByText('小标题')).toBeTruthy()
    expect(screen.getByText('text')).toBeTruthy()
    expect(screen.getByText('heading')).toBeTruthy()
    expect(screen.getByText('image')).toBeTruthy()
    expect(screen.getByText('video')).toBeTruthy()
    expect(document.querySelector('video')?.controls).toBe(true)
    expect(document.querySelector('img')?.getAttribute('src')).toContain('decrypt=')
  })
})

describe('LazyImage', () => {
  it('进入视口附近前不设置真实图片地址', () => {
    let callback: IntersectionObserverCallback | undefined
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        callback = next
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    const { unmount } = render(<LazyImage src="/image.png" alt="测试图片" />)
    const image = screen.getByAltText('测试图片')
    expect(image.getAttribute('src')).toBeNull()

    act(() => {
      callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(image.getAttribute('src')).toBeNull()
    act(() => {
      callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(image.getAttribute('src')).toBe('/image.png')

    unmount()
    vi.unstubAllGlobals()
  })

  it('加载中显示 shimmer 占位，加载完成后移除', () => {
    let callback: IntersectionObserverCallback | undefined
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        callback = next
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    const { unmount } = render(<LazyImage src="/image.png" alt="测试图片" />)
    const image = screen.getByAltText('测试图片') as HTMLImageElement

    // 视口外：未进入加载态
    expect(image.classList.contains('dc-image-skeleton')).toBe(false)

    act(() => {
      callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    // 进入视口、未到终态：显示 shimmer
    expect(image.classList.contains('dc-image-skeleton')).toBe(true)

    act(() => {
      fireEvent.load(image)
    })
    // 加载完成：shimmer 移除
    expect(image.classList.contains('dc-image-skeleton')).toBe(false)

    unmount()
    vi.unstubAllGlobals()
  })

  it('点击重新加载后重新进入加载态', () => {
    let callback: IntersectionObserverCallback | undefined
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        callback = next
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    const { unmount } = render(<LazyImage src="/image.png" alt="测试图片" />)
    const image = screen.getByAltText('测试图片') as HTMLImageElement

    act(() => {
      callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    act(() => {
      fireEvent.error(image)
    })

    const reloadButton = screen.getByRole('button', { name: '重新加载' })
    act(() => {
      fireEvent.click(reloadButton)
    })

    const reloadedImage = screen.getByAltText('测试图片') as HTMLImageElement
    expect(reloadedImage.classList.contains('dc-image-skeleton')).toBe(true)

    unmount()
    vi.unstubAllGlobals()
  })
})

describe('ReadingPagePreview', () => {
  it('阅读页图片使用 metadata 中的图片传输编码', () => {
    let callback: IntersectionObserverCallback | undefined
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        callback = next
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    const data: ReadingPage = {
      title: '第 1 话',
      sourceName: 'manga_site_a',
      sourceUrl: 'https://manga_site_a.com/comics/52240/1',
      pages: ['https://c2.manga_site_a.com/comic/52240/1/1.jpg'],
      metadata: { imageTransport: { encoding: 'base64-text' } },
    }

    try {
      render(<ReadingPagePreview data={data} />)
      const image = screen.getByAltText('page 1')
      act(() => {
        callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      })
      expect(image.getAttribute('src')).toBe(
        '/api/proxy?url=' + encodeURIComponent(data.pages![0]) + '&transport=base64-text',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('有 content 时按章节内容块渲染，不走 pages 图像通道', () => {
    const data: ReadingPage = {
      title: '第 1 话',
      sourceName: 'x',
      sourceUrl: '',
      pages: ['http://x/p.jpg'],
      content: [
        { type: 'heading', content: '小标题', level: 2 },
        { type: 'text', content: '正文段落' },
      ],
    }
    const { container } = render(<ReadingPagePreview data={data} />)
    expect(screen.getByText('小标题')).toBeTruthy()
    expect(screen.getByText('正文段落')).toBeTruthy()
    // 未渲染 pages 图像通道
    expect(screen.queryByAltText('page 1')).toBeNull()
    expect(container.textContent).toContain('下一话')
  })

  it('无 content 时回退 pages 逐张成图（旧漫画插件兼容）', () => {
    let callback: IntersectionObserverCallback | undefined
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) { callback = next }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    const data: ReadingPage = {
      title: '第 1 话',
      sourceName: 'manga_site_a',
      sourceUrl: '',
      pages: ['http://c2.x/1.jpg'],
    }
    render(<ReadingPagePreview data={data} />)
    expect(screen.getByAltText('page 1')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})

describe('ListPreview', () => {
  it('列表封面使用列表项 metadata 中的图片解密参数', () => {
    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, detail: true }),
        },
      ],
      selected: baseSelected,
      listItems: [{
        id: '1',
        title: '带加密封面',
        coverUrl: 'http://x/cover.jpeg',
        url: 'http://x/detail',
        metadata: { imageEncryption: { algorithm: 'AES-128-CBC', key: 'k', iv: 'i' } },
      }],
    })
    render(<ListPreview />)
    expect(document.querySelector('img')?.getAttribute('src')).toContain('decrypt=')
  })

  it('点击卡片优先跳 detail（detail+reading 均支持）', () => {
    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, detail: true, reading: true }),
        },
      ],
      selected: baseSelected,
    })
    let called: Record<string, unknown> | null = null
    useStore.setState({ runWith: async (patch) => { called = patch } })

    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, detail: true, reading: true }),
        },
      ],
      selected: baseSelected,
      listItems: [{ id: '1', title: '卡片A', url: 'http://a' }],
    })
    render(<ListPreview />)
    fireEvent.click(screen.getByText('卡片A'))
    expect(called).toEqual({ action: 'detail', target: 'http://a' })
  })

  it('插件不支持 detail 时回退 reading', () => {
    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, reading: true }),
        },
      ],
      selected: baseSelected,
    })
    let called: Record<string, unknown> | null = null
    useStore.setState({ runWith: async (patch) => { called = patch } })

    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, reading: true }),
        },
      ],
      selected: baseSelected,
      listItems: [{ id: '1', title: '卡片B', url: 'http://b' }],
    })
    render(<ListPreview />)
    fireEvent.click(screen.getByText('卡片B'))
    expect(called).toEqual({ action: 'reading', target: 'http://b' })
  })

  it('条目带 target 时优先结构化跳转（递归列表 target.list.url）', () => {
    useStore.setState({ selected: baseSelected })
    let called: Record<string, unknown> | null = null
    useStore.setState({ runWith: async (patch) => { called = patch } })

    useStore.setState({
      selected: baseSelected,
      listItems: [{
        id: '1',
        title: '合集A',
        url: 'http://x/collection/1',
        target: { action: 'list', url: 'http://x/moviesets/chengrendongman' },
      }],
    })
    render(<ListPreview />)
    fireEvent.click(screen.getByText('合集A'))
    expect(called).toEqual({
      action: 'list', url: 'http://x/moviesets/chengrendongman', category: '', target: '', page: '1',
    })
  })

  it('列表结果自声明 filters 渲染筛选组，应用后并入 category 重跑同一 url', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: { ...baseSelected, url: 'https://x/studio/room/redhot' },
      listItems: [{ id: '1', title: '卡片A', url: 'http://a' }],
      // 只有抓到页面才知道的筛选组（video_site_c 工作室页题材滑块）：由 list 结果带回，不在跳转 target 上
      listFilters: [
        { name: '题材', key: 'category', type: 'select', items: [{ id: 'all', name: '所有题材' }, { id: 'blowjob', name: '口交' }] },
        { name: '排序', key: 'sorting', type: 'select', items: [{ id: 'newest', name: '最新' }, { id: 'rating', name: '高分' }] },
      ],
      runWith: async (patch) => { called = patch },
    })
    render(<ListPreview />)
    expect(screen.getByText('题材')).toBeTruthy()
    expect(screen.getByText('排序')).toBeTruthy()
    fireEvent.click(screen.getByText('口交'))
    fireEvent.click(screen.getByText('高分'))
    fireEvent.click(screen.getByText('应用筛选'))
    expect(called).toMatchObject({
      action: 'list',
      url: 'https://x/studio/room/redhot',
      category: 'category=blowjob&sorting=rating',
      page: '1',
    })
  })

  it('结果自声明 filters 优先于跳转携带的 filters；缺省时回退跳转携带的', () => {
    const carried = [{ name: '发布年份', key: 'year', type: 'select' as const, items: [{ id: '2026', name: '2026' }] }]
    useStore.setState({
      selected: { ...baseSelected, url: 'https://x/list', filters: carried },
      listItems: [],
      listFilters: [{ name: '题材', key: 'category', type: 'select', items: [{ id: 'all', name: '所有题材' }] }],
    })
    const first = render(<ListPreview />)
    expect(screen.getByText('题材')).toBeTruthy()
    expect(screen.queryByText('发布年份')).toBeNull()
    first.unmount()
    // 结果未声明 → 回退跳转携带的那份
    useStore.setState({ listFilters: undefined })
    render(<ListPreview />)
    expect(screen.getByText('发布年份')).toBeTruthy()
  })
})

describe('CardPreview 容器属性', () => {
  const itemWith = (root: unknown, metadata?: Record<string, unknown>): ListItem => ({
    id: '1',
    title: '卡片',
    url: 'http://x/1',
    ...(metadata ? { metadata } : {}),
    card: { version: 1 as const, root: root as never },
  })

  it('根 stack 背景/边距/圆角/左对齐 honor', () => {
    const { container } = render(<CardPreview item={itemWith({
      type: 'stack', direction: 'column', alignItems: 'start', gap: 8,
      backgroundColor: '#1A1A1A', padding: 12, borderRadius: 12,
      children: [{ type: 'text', text: '标题', maxLines: 1 }],
    } as never)} />)
    const root = container.firstElementChild?.firstElementChild as HTMLElement
    expect(root.style.background).toBe('rgb(26, 26, 26)')
    expect(root.style.padding).toBe('12px')
    expect(root.style.borderRadius).toBe('12px')
    expect(root.style.alignItems).toBe('flex-start')
  })

  it('$surface 映射预览主题表面色（卡片与页面分层）', () => {
    const { container } = render(<CardPreview item={itemWith({
      type: 'stack', direction: 'column', alignItems: 'start', gap: 8,
      backgroundColor: '$surface',
      children: [{ type: 'text', text: '标题', maxLines: 1 }],
    } as never)} />)
    const root = container.firstElementChild?.firstElementChild as HTMLElement
    expect(root.style.background).toBe('var(--pv-color-surface)')
  })

  it('无 length 的 spacer 弹性撑满（横向顶右），有 length 固定占位', () => {
    const { container } = render(<CardPreview item={itemWith({
      type: 'stack', direction: 'row', gap: 8,
      children: [
        { type: 'text', text: '左', maxLines: 1 },
        { type: 'spacer' },
        { type: 'text', text: '右', maxLines: 1 },
      ],
    } as never)} />)
    const root = container.firstElementChild?.firstElementChild as HTMLElement
    expect((root.children[1] as HTMLElement).style.flex).toBe('1 1 0%')
  })

  it('divider 全宽细线、缺省走主题边框色', () => {
    const { container } = render(<CardPreview item={itemWith({
      type: 'stack', direction: 'column', gap: 6,
      children: [
        { type: 'text', text: '行1', maxLines: 1 },
        { type: 'divider' },
        { type: 'text', text: '行2', maxLines: 1 },
      ],
    } as never)} />)
    const root = container.firstElementChild?.firstElementChild as HTMLElement
    const line = root.children[1] as HTMLElement
    expect(line.style.height).toBe('1px')
    expect(line.style.width).toBe('100%')
    expect(line.style.background).toBe('var(--pv-color-border)')
  })

  it('横向 flex 按值配比 + justify 撑满', () => {
    const { container } = render(<CardPreview item={itemWith({
      type: 'stack', direction: 'row', gap: 10, justifyContent: 'start',
      children: [
        { type: 'image', src: 'http://x/a.jpeg', aspect: '3:4', flex: 1 },
        { type: 'stack', direction: 'column', gap: 6, flex: 2, children: [{ type: 'text', text: '右', maxLines: 1 }] },
      ],
    }) as never} />)
    const root = container.firstElementChild?.firstElementChild as HTMLElement
    expect(root.style.justifyContent).toBe('flex-start')
    expect(root.style.width).toBe('100%')
    const [img, col] = Array.from(root.children) as HTMLElement[]
    expect(img.style.flex).toBe('1 1 0%')
    expect(col.style.flex).toBe('2 1 0%')
  })

  it('图片管线参数优先节点自带、缺省继承 item.metadata', () => {
    const itemEnc = { algorithm: 'AES-128-CBC', key: 'item-key-12345678', iv: 'item-iv-12345678' }
    const nodeEnc = { algorithm: 'AES-128-CBC', key: 'node-key-12345678', iv: 'node-iv-12345678' }
    const { container } = render(<CardPreview item={itemWith({
      type: 'stack', direction: 'column', gap: 8,
      children: [
        { type: 'image', src: 'http://x/inherit.jpeg', aspect: '1:1', decrypt: nodeEnc },
        { type: 'avatar', src: 'http://x/avatar.jpeg', size: 36 },
      ],
    } as never, { imageEncryption: itemEnc })} />)
    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs[0].getAttribute('src')).toContain(encodeURIComponent('node-key-12345678'))
    expect(imgs[1].getAttribute('src')).toContain(encodeURIComponent('item-key-12345678'))
  })
})

describe('CardPreview image 填充方式与定比（resizeMode / aspect，与 iOS 同构）', () => {
  // 同一份语义：resizeMode 只有 'contain' 判等命中，缺省/非法（含 JSON null）一律 cover；
  // aspect 的通用 W:H 必须为正有限数，否则一律 16:9（口径与 runtime isLegalAspect 一致）。
  const renderImage = (node: Record<string, unknown> = {}) => {
    const item: ListItem = {
      id: '1',
      title: '卡片',
      url: 'http://x/1',
      card: {
        version: 1 as const,
        root: {
          type: 'stack', direction: 'column', gap: 8,
          children: [{ type: 'image', src: 'http://x/cover.jpeg', ...node }],
        } as never,
      },
    }
    const view = render(<CardPreview item={item} />)
    const img = view.container.querySelector('img') as HTMLImageElement
    return { ...view, img, box: img.parentElement as HTMLElement }
  }

  it('缺省 resizeMode = cover：图挂 pv-card__img、object-fit 走 cover（填满盒居中裁）', () => {
    const { img } = renderImage()
    expect(img.classList.contains('pv-card__img')).toBe(true)
    expect(img.style.objectFit).toBe('cover')
  })

  it("resizeMode: 'contain' → object-fit: contain（整图入盒不裁，留白）", () => {
    const { img } = renderImage({ resizeMode: 'contain' })
    expect(img.classList.contains('pv-card__img')).toBe(true)
    expect(img.style.objectFit).toBe('contain')
  })

  it("resizeMode 非法（'stretch' / JSON null / 空串 / 数字 / 大小写不合）→ 一律回 cover，不炸卡", () => {
    for (const bad of ['stretch', null, '', 0, 1, 'COVER', 'Cover']) {
      const { img, unmount } = renderImage({ resizeMode: bad })
      expect(img.style.objectFit).toBe('cover')
      unmount()
    }
  })

  it('aspect 缺省/非法一律 16:9（0:1 曾漏成 0/1 被浏览器丢弃）', () => {
    for (const bad of [undefined, '0:1', '1:0', '0:0', 'abc', '16/9', null]) {
      const { box, unmount } = renderImage(bad === undefined ? {} : { aspect: bad })
      expect(box.style.aspectRatio).toBe('16/9')
      unmount()
    }
  })

  it('aspect 合法时按比值：通用 W:H（含小数）与枚举/circle 不走回退', () => {
    expect(renderImage({ aspect: '1.86:1' }).box.style.aspectRatio).toBe('1.86/1')
    expect(renderImage({ aspect: '4:3', resizeMode: 'contain' }).box.style.aspectRatio).toBe('4/3')
    expect(renderImage({ aspect: 'circle' }).box.style.aspectRatio).toBe('1/1')
  })

  it('CSS 契约：.pv-card__img 必须填满盒并居中（jsdom 不加载样式表，静态兜底防写侧盲区回归）', () => {
    // jsdom 不套用样式表、vitest 也不处理 css import，故直接读源文件断言：
    // 这段样式一旦丢失，图又按自身尺寸溢出、被父级从左上角裁，即本次缺陷根因。
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../styles/devconsole.css'), 'utf8')
    const rule = /\.pv-card__img\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('width: 100%')
    expect(rule).toContain('height: 100%')
    expect(rule).toContain('object-fit: cover')
    expect(rule).toContain('object-position: center')
    expect(rule).toContain('display: block')
  })
})

describe('BlockRenderer link 块', () => {
  it('link 带 target 且传入 onLinkClick 时，点击触发内部导航回调', () => {
    let clicked: { url: string; target: PageJumpTarget } | null = null
    const block: ContentBlock = {
      type: 'link',
      content: '作者：张三',
      url: 'http://s/artist/张三',
      target: { action: 'list', url: 'http://s/artist/张三' },
    }
    render(
      <BlockRenderer
        block={block}
        onJumpJson={() => {}}
        onLinkClick={(url, target) => { clicked = { url, target } }}
      />,
    )
    fireEvent.click(screen.getByText('作者：张三'))
    expect(clicked).toEqual({
      url: 'http://s/artist/张三',
      target: { action: 'list', url: 'http://s/artist/张三' },
    })
  })

  it('link 无 target 时仍渲染为外链', () => {
    const block: ContentBlock = { type: 'link', content: '原文', url: 'http://s/origin' }
    render(
      <BlockRenderer
        block={block}
        onJumpJson={() => {}}
        onLinkClick={vi.fn()}
      />,
    )
    const link = screen.getByText('原文').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('http://s/origin')
  })

  it('link 带 target 但未传 onLinkClick 时降级为外链', () => {
    const block: ContentBlock = {
      type: 'link',
      content: '作者：张三',
      url: 'http://s/artist/张三',
      target: { action: 'list', url: 'http://s/artist/张三' },
    }
    render(<BlockRenderer block={block} onJumpJson={() => {}} />)
    const link = screen.getByText('作者：张三').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('http://s/artist/张三')
  })
})

describe('BlockRenderer chapter 块', () => {
  it('传入 onChapterClick 时，点击章节触发阅读回调', () => {
    let clicked: string | null = null
    const block: ContentBlock = { type: 'chapter', content: [{ title: '第1话', url: 'http://c/1' }] }
    render(<BlockRenderer block={block} onJumpJson={() => {}} onChapterClick={(url) => { clicked = url }} />)
    fireEvent.click(screen.getByText('第1话'))
    expect(clicked).toBe('http://c/1')
  })

  it('未传 onChapterClick 时，章节渲染为外链', () => {
    const block: ContentBlock = { type: 'chapter', content: [{ title: '第2话', url: 'http://c/2' }] }
    render(<BlockRenderer block={block} onJumpJson={() => {}} />)
    const link = screen.getByText('第2话').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('http://c/2')
  })
})

describe('BlockRenderer video 懒播放占位', () => {
  beforeEach(() => {
    vi.mocked(apiRun).mockReset()
  })

  it('video 无 url 带 target.play 渲染播放占位；点「解析播放」调 play 动作并就地渲染播放器', async () => {
    vi.mocked(apiRun).mockResolvedValue({
      ok: true,
      data: { url: 'http://x/master.m3u8', referer: 'http://x/detail' },
      durationMs: 1,
    } as never)
    const block = {
      type: 'video',
      target: { action: 'play', url: 'http://x/comic/index/detail?video_key=a' },
      platform: 'video_site_a',
    } satisfies ContentBlock
    render(<BlockRenderer block={block} onJumpJson={vi.fn()} pluginId="p" />)

    // 占位渲染解析播放按钮
    expect(screen.getByText(/解析播放（video_site_a）/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /解析播放/ }))
    expect(apiRun).toHaveBeenCalledWith({
      pluginId: 'p',
      action: 'play',
      target: 'http://x/comic/index/detail?video_key=a',
    })

    // 解析完成（mock 立即 resolve）：就地渲染 <video>
    await act(async () => {})
    expect(document.querySelector('video')).toBeTruthy()
  })

  it('未提供 pluginId 时点「解析播放」不发起解析', () => {
    const block = {
      type: 'video',
      target: { action: 'play', url: 'http://x/detail' },
    } satisfies ContentBlock
    render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /解析播放/ }))
    expect(apiRun).not.toHaveBeenCalled()
  })

  it('video 既无 url 也无 target.play 渲染缺地址占位（不冒充能力）', () => {
    const block = { type: 'video' } as ContentBlock
    const { container } = render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    expect(container.textContent).toContain('缺少播放地址')
  })

  it('video 同时带 url 与 target.play 时优先懒解析（url 可能是入口页而非媒体直链）', async () => {
    vi.mocked(apiRun).mockResolvedValue({
      ok: true,
      data: { url: 'http://x/play.m3u8', referer: 'http://x/' },
      durationMs: 1,
    } as never)
    const block = {
      type: 'video',
      url: 'https://www.bilibili.com/video/BV1abc', // 页面地址，硬播必挂
      target: { action: 'play', url: 'https://www.bilibili.com/video/BV1abc' },
      platform: 'bilibili',
    } satisfies ContentBlock
    render(<BlockRenderer block={block} onJumpJson={vi.fn()} pluginId="p" />)

    // 不硬播 url（页面 URL），渲染懒解析占位
    expect(screen.getByText(/解析播放（bilibili）/)).toBeTruthy()
    expect(document.querySelector('video')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /解析播放/ }))
    expect(apiRun).toHaveBeenCalledWith({
      pluginId: 'p',
      action: 'play',
      target: 'https://www.bilibili.com/video/BV1abc',
    })

    // 解析完成（mock 立即 resolve）：就地渲染 <video>，避免未包裹的 state 更新警告
    await act(async () => {})
    expect(document.querySelector('video')).toBeTruthy()
  })
})

describe('BlockRenderer episodes 块', () => {
  it('渲染线路 tab 与剧集网格；未提供 pluginId 时点剧集不发起解析', () => {
    const block = {
      type: 'episodes',
      lines: [
        { name: '超清K', episodes: [{ title: '1', url: 'http://x/play/1-4-1.html' }, { title: '2', url: 'http://x/play/1-4-2.html' }] },
        { name: 'UC网盘', episodes: [{ title: '合集', url: 'http://x/play/1-3-1.html' }] },
      ],
    } satisfies ContentBlock
    render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /超清K/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /UC网盘/ })).toBeTruthy()
    // 默认线路「超清K」渲染 2 个剧集按钮（count 角标数字会撞文本，用类名断言）
    expect(document.querySelectorAll('.pv-episodes__ep')).toHaveLength(2)
    // 未提供 pluginId：点击剧集停在「选择剧集开始播放」提示，不发起 play 请求
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText(/选择剧集开始播放/)).toBeTruthy()
  })

  it('切换线路后只显示当前线路的剧集', () => {
    const block = {
      type: 'episodes',
      lines: [
        { name: '线路A', episodes: [{ title: 'A1', url: 'http://x/play/a1.html' }] },
        { name: '线路B', episodes: [{ title: 'B1', url: 'http://x/play/b1.html' }] },
      ],
    } satisfies ContentBlock
    render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    expect(screen.getByText('A1')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /线路B/ }))
    expect(screen.getByText('B1')).toBeTruthy()
    expect(screen.queryByText('A1')).toBeNull()
  })

  it('条目有 coverUrl 时走横向缩略图行，无图项纯色占位', () => {
    const block = {
      type: 'episodes',
      lines: [
        {
          name: '播放清单',
          episodes: [
            { title: '有图', url: 'http://x/play/1.html', coverUrl: 'http://x/cover/1.jpg' },
            { title: '无图', url: 'http://x/play/2.html' },
          ],
        },
      ],
    } satisfies ContentBlock
    render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    // 有图行替代文字宫格
    expect(document.querySelectorAll('.pv-episodes__row')).toHaveLength(2)
    expect(document.querySelectorAll('.pv-episodes__ep')).toHaveLength(0)
    expect(document.querySelectorAll('.pv-episodes__thumb.is-empty')).toHaveLength(1)
  })
})

describe('BlockRenderer chapter 块封面', () => {
  it('任一项有 coverUrl 时走横向缩略图行，全块无图回退文字列表', () => {
    const withCover = {
      type: 'chapter',
      content: [
        { title: '第1话', url: 'http://x/r/1', coverUrl: 'http://x/cover/1.jpg' },
        { title: '第2话', url: 'http://x/r/2' },
      ],
    } satisfies ContentBlock
    const { unmount } = render(<BlockRenderer block={withCover} onJumpJson={vi.fn()} />)
    expect(document.querySelector('.pv-chapter-list.has-cover')).toBeTruthy()
    expect(document.querySelectorAll('.pv-chapter-row')).toHaveLength(2)
    expect(document.querySelectorAll('.pv-chapter-thumb.is-empty')).toHaveLength(1)
    unmount()

    const plain = {
      type: 'chapter',
      content: [{ title: '第1话', url: 'http://x/r/1' }],
    } satisfies ContentBlock
    render(<BlockRenderer block={plain} onJumpJson={vi.fn()} />)
    expect(document.querySelector('.pv-chapter-list.has-cover')).toBeNull()
  })
})

describe('BlockRenderer 新增块', () => {
  it('text 块带 title 时渲染标题区样式（简介等独立文本区）', () => {
    const textBlock = {
      type: 'text',
      title: '简介',
      content: '第一行\n第二行',
    } satisfies ContentBlock

    render(<BlockRenderer block={textBlock} onJumpJson={vi.fn()} />)

    // 区标题与正文同在，且换行原样保留在单个段落内（不断成多节点）
    expect(screen.getByText('简介')).toBeTruthy()
    const body = document.querySelector('.pv-text-block .pv-text')
    expect(body?.textContent).toBe('第一行\n第二行')
  })

  it('text 块无 title 时保持裸段落（旧插件零改动）', () => {
    const textBlock = {
      type: 'text',
      content: '第一行\n第二行',
    } satisfies ContentBlock

    render(<BlockRenderer block={textBlock} onJumpJson={vi.fn()} />)

    expect(document.querySelector('.pv-text-block')).toBeNull()
    expect(document.querySelector('.pv-text')?.textContent).toBe('第一行\n第二行')
  })

  it('tags 块将标签名渲染为外链', () => {
    const tagsBlock = {
      type: 'tags',
      content: [{ name: '动作', url: 'https://manga_site_a.com/tag/action' }],
    } satisfies ContentBlock

    render(<BlockRenderer block={tagsBlock} onJumpJson={vi.fn()} />)

    expect(screen.getByRole('link', { name: '动作' }).getAttribute('href')).toBe('https://manga_site_a.com/tag/action')
  })

  it('tags 块传入 onTagClick 时，点击标签触发回调（不跳外站）', () => {
    let clicked: string | null = null
    const tagsBlock = {
      type: 'tags',
      content: [{ name: '美乳巨乳', url: 'https://short_site_b.com/short/label_related_list/x?label=x' }],
    } satisfies ContentBlock

    render(
      <BlockRenderer
        block={tagsBlock}
        onJumpJson={vi.fn()}
        onTagClick={(url) => {
          clicked = url
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '美乳巨乳' }))
    expect(clicked).toBe('https://short_site_b.com/short/label_related_list/x?label=x')
    // 不应渲染为外链
    expect(screen.queryByRole('link', { name: '美乳巨乳' })).toBeNull()
  })

  it('recommendations 块渲染详情链接和代理封面', () => {
    let callback: IntersectionObserverCallback | undefined
    class MockIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        callback = next
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    const recommendationsBlock = {
      type: 'recommendations',
      content: [{
        title: '推荐作品',
        url: 'https://manga_site_a.com/comics/52241',
        coverUrl: 'https://cdn.manga_site_a.com/covers/52241.jpg',
      }],
    } satisfies ContentBlock

    try {
      render(<BlockRenderer block={recommendationsBlock} onJumpJson={vi.fn()} />)

      expect(screen.getByRole('link', { name: '推荐作品' }).getAttribute('href')).toBe('https://manga_site_a.com/comics/52241')
      const image = screen.getByAltText('推荐作品')
      expect(image.getAttribute('src')).toBeNull()
      act(() => {
        callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      })
      expect(image.getAttribute('src')).toBe(
        '/api/proxy?url=' + encodeURIComponent('https://cdn.manga_site_a.com/covers/52241.jpg'),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('recommendations 块传入 onDetailClick 时，点击推荐项触发回调（不跳外站）', () => {
    let clicked: string | null = null
    const recommendationsBlock = {
      type: 'recommendations',
      content: [{ title: '推荐A', url: 'https://short_site_b.com/short/abc' }],
    } satisfies ContentBlock

    render(
      <BlockRenderer
        block={recommendationsBlock}
        onJumpJson={vi.fn()}
        onDetailClick={(url) => {
          clicked = url
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看 推荐A' }))
    expect(clicked).toBe('https://short_site_b.com/short/abc')
    expect(screen.queryByRole('link', { name: '推荐A' })).toBeNull()
  })

  it('recommendations 块带 title 时渲染该标题作为块头', () => {
    const block = {
      type: 'recommendations',
      title: '相关推荐',
      content: [{ title: '推荐A', url: 'https://x/a' }],
    } satisfies ContentBlock

    render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '相关推荐' })).toBeTruthy()
  })

  it('recommendations 块无 title 时块头缺省渲染「推荐」', () => {
    const block = {
      type: 'recommendations',
      content: [{ title: '推荐A', url: 'https://x/a' }],
    } satisfies ContentBlock

    render(<BlockRenderer block={block} onJumpJson={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '推荐' })).toBeTruthy()
  })

  it('recommendations 块带 viewMore 时渲染「更多」，点击回调收到该 PageJumpTarget', () => {
    const received = { value: null as PageJumpTarget | null }
    const block = {
      type: 'recommendations',
      title: '相关推荐',
      content: [{ title: '推荐A', url: 'https://x/a' }],
      viewMore: { action: 'list', category: 'sort=hot' },
    } satisfies ContentBlock

    render(
      <BlockRenderer
        block={block}
        onJumpJson={vi.fn()}
        onViewMoreClick={(target: PageJumpTarget) => { received.value = target }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(received.value).toEqual({ action: 'list', category: 'sort=hot' })
  })

  it('recommendations 块无 viewMore 时不渲染「更多」（即便带 title）', () => {
    const block = {
      type: 'recommendations',
      title: '相关推荐',
      content: [{ title: '推荐A', url: 'https://x/a' }],
    } satisfies ContentBlock

    render(<BlockRenderer block={block} onJumpJson={vi.fn()} onViewMoreClick={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '相关推荐' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '更多' })).toBeNull()
  })
})

describe('CategoriesPreview', () => {
  function renderWith(data: CategoryGroup[]) {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    render(<CategoriesPreview data={data} />)
    return {
      apply: () => fireEvent.click(screen.getByText(/应用筛选/)),
      category: () => (called as unknown as { category: string }).category,
    }
  }

  it('select 与 check（allowMultiple 兼容）组合拼出 category 串', () => {
    const view = renderWith([
      { name: '地区', key: 'region', items: [{ id: 'jp', name: '日本' }] },
      { name: '类型', key: 'type', allowMultiple: true, items: [{ id: 'rexue', name: '热血' }] },
    ])
    fireEvent.click(screen.getByText('日本'))
    fireEvent.click(screen.getByText('热血'))
    view.apply()
    expect(view.category()).toBe('region=jp&type=rexue')
  })

  it('check 显式 type 渲染勾选列表；canExclude 时支持排除（- 前缀）', () => {
    const view = renderWith([
      {
        name: '标签',
        key: 'tagIds',
        type: 'check',
        canExclude: true,
        items: [{ id: '11', name: 'NTR' }, { id: '85', name: '触手' }],
      },
    ])
    fireEvent.click(screen.getByText('NTR'))
    const excludeButtons = screen.getAllByText('排除')
    fireEvent.click(excludeButtons[1]) // 排除 触手
    view.apply()
    expect(view.category()).toBe('tagIds=11,-85')
  })

  it('check + display:tags 渲染多选芯片云，点击三态循环（包含→排除→未选），编码与复选框一致', () => {
    const view = renderWith([
      {
        name: '标签',
        key: 'tagIds',
        type: 'check',
        display: 'tags',
        canExclude: true,
        items: [{ id: '11', name: 'NTR' }, { id: '85', name: '触手' }],
      },
    ])
    // 芯片形态：无复选框行、无独立排除按钮，模式标签带 标签
    expect(document.querySelectorAll('.pv-check-row').length).toBe(0)
    expect(screen.queryByText('排除')).toBeNull()
    expect(screen.getByText(/多选·标签·可排除/)).toBeTruthy()
    // 未选 → 包含
    fireEvent.click(screen.getByText('NTR'))
    // 包含 → 排除
    fireEvent.click(screen.getByText('NTR'))
    // 触手：点一次 = 包含
    fireEvent.click(screen.getByText('触手'))
    view.apply()
    expect(view.category()).toBe('tagIds=85,-11')
  })

  it('check + display:tags 无 canExclude 时点击只切换包含', () => {
    const view = renderWith([
      {
        name: '标签',
        key: 'tagIds',
        type: 'check',
        display: 'tags',
        items: [{ id: '11', name: 'NTR' }, { id: '85', name: '触手' }],
      },
    ])
    expect(screen.getByText(/多选·标签/)).toBeTruthy()
    fireEvent.click(screen.getByText('NTR'))
    fireEvent.click(screen.getByText('触手'))
    fireEvent.click(screen.getByText('NTR')) // 再点取消
    view.apply()
    expect(view.category()).toBe('tagIds=85')
  })

  it('同 key 多 check 组跨组多选并集、只输出一次（anime_site_a 7 标签组）', () => {
    const view = renderWith([
      { name: '影片属性', key: 'tags[]', type: 'check', items: [{ id: '無碼', name: '无码' }] },
      { name: '人物关系', key: 'tags[]', type: 'check', items: [{ id: '近親', name: '近亲' }] },
    ])
    fireEvent.click(screen.getByText('无码'))
    fireEvent.click(screen.getByText('近亲'))
    view.apply()
    // 同一 key 只输出一次：两组共享同一份选中数组，并集编码
    expect(view.category()).toBe('tags[]=無碼,近親')
  })

  it('分节单组渲染一个选择器、节标题分组展示，跨节多选并集一次输出', () => {
    const view = renderWith([
      {
        name: '内容标签', key: 'tags[]', type: 'check',
        sections: [
          { title: '影片属性', items: [{ id: '無碼', name: '无码' }] },
          { title: '外貌身材', items: [{ id: '巨乳', name: '巨乳' }] },
        ],
      },
    ])
    // 单 widget：组头一个，节标题各自展示，选项不串节
    expect(document.querySelectorAll('.pv-category-group').length).toBe(1)
    expect(screen.getByText(/内容标签/)).toBeTruthy()
    expect(screen.getByText('影片属性')).toBeTruthy()
    expect(screen.getByText('外貌身材')).toBeTruthy()
    fireEvent.click(screen.getByText('无码'))
    fireEvent.click(screen.getByText('巨乳'))
    view.apply()
    expect(view.category()).toBe('tags[]=無碼,巨乳')
  })

  it('text 输入框按 URL 编码拼入 category', () => {
    const view = renderWith([
      { name: '关键词', key: 'q', type: 'text', placeholder: '输入关键词' },
    ])
    fireEvent.change(screen.getByPlaceholderText('输入关键词'), { target: { value: 'hello world' } })
    view.apply()
    expect(view.category()).toBe('q=hello%20world')
  })

  it('sort 支持选项与升降序（canAscend 时带 ,asc/,desc 后缀）', () => {
    const view = renderWith([
      {
        name: '排序',
        key: 'o',
        type: 'sort',
        canAscend: true,
        items: [{ id: 'mr', name: '最新' }, { id: 'mv', name: '總排行' }],
      },
    ])
    fireEvent.click(screen.getByText('總排行'))
    fireEvent.click(screen.getByText('升序'))
    view.apply()
    expect(view.category()).toBe('o=mv,asc')
  })

  it('sort 固定顺序（canAscend=false）只输出选项 id', () => {
    const view2 = renderWith([
      {
        name: '排序',
        key: 'o',
        type: 'sort',
        canAscend: false,
        items: [{ id: 'mr', name: '最新' }],
      },
    ])
    fireEvent.click(screen.getByText('最新'))
    view2.apply()
    expect(view2.category()).toBe('o=mr')
  })

  it('未选择时应用筛选进入默认列表（空 category）', () => {
    const view = renderWith([
      { name: '地区', key: 'region', items: [{ id: 'jp', name: '日本' }] },
    ])
    view.apply()
    expect(view.category()).toBe('')
  })

  it('长组折叠（>16 条）：默认只显示前 16 条 + toggle chip，展开后全部可见且可选', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, name: `选项${i}` }))
    const view = renderWith([{ name: '大组', key: 'big', items: many }])
    // 折叠态：前 16 条可见，第 17 条被收起，toggle chip 提示 +4
    expect(screen.getByText('选项0')).toBeTruthy()
    expect(screen.getByText('选项15')).toBeTruthy()
    expect(screen.queryByText('选项16')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+4 展开' }))
    // 展开态：全部可见，选收敛组里的末项能正确编码
    expect(screen.getByText('选项19')).toBeTruthy()
    fireEvent.click(screen.getByText('选项19'))
    view.apply()
    expect(view.category()).toBe('big=k19')
  })
})

describe('ListingsPreview', () => {
  it('渲染页签；点击页签后打开对应 list（category 透传）', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      { name: '最新A漫', category: 'c=0&o=mr' },
      { name: '總排行', category: 'c=0&o=mv' },
    ]
    render(<ListingsPreview data={data} />)
    fireEvent.click(screen.getByRole('tab', { name: '總排行' }))
    fireEvent.click(screen.getByText(/打开「總排行」/))
    expect(called).toMatchObject({
      action: 'list',
      category: 'c=0&o=mv',
      page: '1',
    })
  })

  it('kind=explore 条目（listings-first）打开 = runWith explore：url 透传为探索页标识，不渲染筛选组', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      { name: '推荐', kind: 'explore' },
      { name: 'gossip头条', kind: 'explore', url: 'news' },
      { name: '全部', category: 'c=0' },
    ]
    render(<ListingsPreview data={data} />)
    // 无 url 的探索页条目 = 默认探索页（explore 空 url）
    fireEvent.click(screen.getByText(/打开「推荐」/))
    expect(called).toMatchObject({ action: 'explore', url: '' })
    // 带 url 的探索页条目：url 透传（getExplore context）
    fireEvent.click(screen.getByRole('tab', { name: 'gossip头条' }))
    fireEvent.click(screen.getByText(/打开「gossip头条」/))
    expect(called).toMatchObject({ action: 'explore', url: 'news' })
    // explore 条目不渲染目录页筛选组（feed 无筛选语义）
    expect(screen.getByText(/探索页：getExplore/)).toBeTruthy()
  })

  it('listing 带 filters 时渲染筛选组，选择后与 category 合并再打开', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      {
        name: '电影',
        category: 'tid=1',
        filters: [
          { name: '地区', key: 'area', items: [{ id: 'cn', name: '大陆' }, { id: 'hk', name: '香港' }] },
          { name: '年份', key: 'year', items: [{ id: '2026', name: '2026' }] },
        ],
      },
    ]
    render(<ListingsPreview data={data} />)
    // 筛选组渲染出来
    expect(screen.getByText('地区')).toBeTruthy()
    expect(screen.getByText('年份')).toBeTruthy()
    // 选择两个筛选后打开：category = listing.category + 筛选组合
    fireEvent.click(screen.getByText('大陆'))
    fireEvent.click(screen.getByText('2026'))
    fireEvent.click(screen.getByText(/打开「电影」/))
    expect(called).toMatchObject({
      action: 'list',
      category: 'tid=1&area=cn&year=2026',
      page: '1',
    })
  })

  it('kind=tags 条目同样渲染筛选组，选择后经 category 传给 getTags', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      {
        name: '标签',
        kind: 'tags',
        url: 'https://x/tags/',
        filters: [
          {
            name: '类型',
            key: 'type',
            type: 'select',
            items: [{ id: 'video', name: '视频' }, { id: 'album', name: '图集' }],
          },
        ],
      },
    ]
    render(<ListingsPreview data={data} />)
    // 标签索引页的页级筛选照常渲染（不再走「不消费目录页筛选」提示）
    expect(screen.getByText('类型')).toBeTruthy()
    fireEvent.click(screen.getByText('图集'))
    fireEvent.click(screen.getByText(/打开「标签」/))
    expect(called).toMatchObject({ action: 'tags', category: 'type=album', page: '1' })
  })

  it('kind=tags 条目无 filters 时不渲染筛选组（纯标签云，零控件）', () => {
    useStore.setState({ selected: baseSelected, runWith: async () => {} })
    render(<ListingsPreview data={[{ name: '标签', kind: 'tags', url: 'https://x/tags/' }]} />)
    expect(screen.getByText(/标签索引：getTags\(\) 标签云/)).toBeTruthy()
  })

  it('相同 key 的多个筛选组（摸摸分类 6 组共享 tagIds 案例）各自独立渲染、互不串组', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [{
      name: '分类',
      category: 'resource=manga',
      filters: [
        { name: '角色/职业', key: 'tagIds', type: 'select', items: [{ id: '50', name: '熟女' }, { id: '70', name: '学生' }] },
        { name: '倾向', key: 'tagIds', type: 'select', items: [{ id: '12', name: '后宫' }, { id: '38', name: '口交' }] },
      ],
    }]
    render(<ListingsPreview data={data} />)
    // 组头各自渲染（渲染 key 唯一化前，重复 key 会让多个组共享同一实例、内容串组）
    expect(screen.getByText(/角色\/职业/)).toBeTruthy()
    expect(screen.getByText(/倾向/)).toBeTruthy()
    // 每组只渲染自己的选项芯片，不互相污染
    const groups = document.querySelectorAll('.pv-category-group')
    expect(groups.length).toBe(2)
    const roleText = groups[0].textContent!
    const prefText = groups[1].textContent!
    expect(roleText).toContain('熟女')
    expect(roleText).toContain('学生')
    expect(roleText).not.toContain('后宫')
    expect(prefText).toContain('后宫')
    expect(prefText).toContain('口交')
    expect(prefText).not.toContain('熟女')
    // 共享 key 单选互斥语义保持：选两组的项，最后选择生效；且同一 key 只输出一次
    // （categoryFromState 按 key 去重、后者覆盖——不再出现 tagIds=12&tagIds=12 重复）。
    fireEvent.click(screen.getByText('熟女'))
    fireEvent.click(screen.getByText('后宫'))
    fireEvent.click(screen.getByText(/打开「分类」/))
    expect(called).toMatchObject({ action: 'list', category: 'resource=manga&tagIds=12' })
  })

  it('listing 带 filters 但未选择时打开保持原 category', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      {
        name: '电影',
        category: 'tid=1',
        filters: [{ name: '地区', key: 'area', items: [{ id: 'cn', name: '大陆' }] }],
      },
    ]
    render(<ListingsPreview data={data} />)
    fireEvent.click(screen.getByText(/打开「电影」/))
    expect(called).toMatchObject({ action: 'list', category: 'tid=1' })
  })

  it('无 category 的目录页以默认列表打开', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    render(<ListingsPreview data={[{ name: '默认' }]} />)
    fireEvent.click(screen.getByText(/打开「默认」/))
    expect(called).toMatchObject({ action: 'list', category: '' })
  })

  it('空 listings 显示空态', () => {
    const { container } = render(<ListingsPreview data={[]} />)
    expect(container.textContent).toContain('未提供 listings')
  })

  it('导航树：组内多叶子各带 filters（通用能力，非 video_site_a 现输出——其已收敛为顶层平铺），选字母打开时 url+category 都带', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const az = [{
      name: '首字母', key: 'initial', type: 'select',
      items: [{ id: '', name: '全部' }, { id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
    }] as CategoryGroup[]
    const data: Listing[] = [{
      name: '精选合集',
      kind: 'series',
      children: [
        { name: '精选合集首页', url: 'http://x/moviesets', kind: 'series', filters: az },
        { name: '动漫合集', url: 'http://x/moviesets/chengrendongman', kind: 'series' },
        { name: '排行榜合集', url: 'http://x/moviesets/rank', kind: 'series', filters: az },
        { name: '分类合集', url: 'http://x/moviesets/category', kind: 'series', filters: az },
        { name: '人物合集', url: 'http://x/moviesets/people', kind: 'series', filters: az },
        { name: '品牌合集', url: 'http://x/moviesets/brand', kind: 'series', filters: az },
      ],
    }]
    render(<ListingsPreview data={data} />)
    // 用 .pv-listing-node__leaf 精确定位「分类合集」叶子（勿用 .pv-listing-node——组节点的
    // textContent 包含所有子叶子文本，find 会先命中组节点，导致点错叶子的 A）
    const catLeaf = Array.from(document.querySelectorAll('.pv-listing-node__leaf')).find((n) =>
      (n as HTMLElement).textContent!.includes('打开「分类合集」'))
    const a = Array.from(catLeaf!.querySelectorAll('.pv-chip')).find((c) => c.textContent.trim() === 'A')!
    fireEvent.click(a)
    const open = Array.from(catLeaf!.querySelectorAll('button')).find((b) =>
      b.textContent.includes('打开「分类合集」'))
    fireEvent.click(open!)
    expect(called).toMatchObject({
      action: 'list',
      url: 'http://x/moviesets/category',
      category: 'initial=A',
    })
  })

  it('带 children 的目录页渲染导航树；点叶子用 url 页面通道打开', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      {
        name: '精选合集',
        kind: 'series',
        children: [
          { name: '精选合集首页', url: 'http://x/moviesets', kind: 'series' },
          { name: '动漫合集', url: 'http://x/moviesets/chengrendongman', kind: 'series' },
        ],
      },
    ]
    render(<ListingsPreview data={data} />)
    // 组名（页签 + 树上节点各一处）与叶子名都渲染；kind 角标出现（组 + 2 叶子 = 3）
    expect(screen.getAllByText('精选合集').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('动漫合集')).toBeTruthy()
    expect(screen.getAllByText('series').length).toBeGreaterThanOrEqual(3)
    // 只有叶子是可点击目录页（打开按钮）
    fireEvent.click(screen.getByText(/打开「动漫合集」/))
    expect(called).toMatchObject({
      action: 'list',
      url: 'http://x/moviesets/chengrendongman',
      category: '',
      page: '1',
    })
  })

  it('折叠分组后隐藏其叶子（导航树可折叠）', () => {
    useStore.setState({ selected: baseSelected })
    const data: Listing[] = [
      {
        name: '黑料gossip',
        children: [
          { name: '全部黑料', url: 'http://x/黑料gossip/推荐' },
        ],
      },
    ]
    const { unmount } = render(<ListingsPreview data={data} />)
    expect(screen.getByText(/打开「全部黑料」/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /折叠 黑料gossip/ }))
    expect(screen.queryByText(/打开「全部黑料」/)).toBeNull()
    unmount()
  })

  it('深层嵌套（children 的 children）递归渲染，叶子仍可打开', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      {
        name: '甲',
        children: [
          {
            name: '乙',
            children: [{ name: '丙叶子', category: 'c=d' }],
          },
        ],
      },
    ]
    render(<ListingsPreview data={data} />)
    fireEvent.click(screen.getByText(/打开「丙叶子」/))
    expect(called).toMatchObject({ action: 'list', category: 'c=d' })
  })
})

describe('toJumpPatch（PageJumpTarget → Selected patch）', () => {
  it('list：带 category', () => {
    expect(toJumpPatch({ action: 'list', category: 'region=jp' })).toEqual({
      action: 'list', url: '', category: 'region=jp', target: '', page: '1',
    })
  })
  it('list：带 url 页面通道', () => {
    expect(toJumpPatch({ action: 'list', url: 'http://x/moviesets/chengrendongman' })).toEqual({
      action: 'list', url: 'http://x/moviesets/chengrendongman', category: '', target: '', page: '1',
    })
  })
  it('list：无 category 视为空串', () => {
    expect(toJumpPatch({ action: 'list' })).toEqual({
      action: 'list', url: '', category: '', target: '', page: '1',
    })
  })
  it('list：带 channel 原样透传', () => {
    expect(toJumpPatch({ action: 'list', url: 'http://x/categories/', channel: 'category-index' } as any)).toEqual({
      action: 'list', url: 'http://x/categories/', category: '', channel: 'category-index', target: '', page: '1',
    })
  })
  it('search：query 写入 target', () => {
    expect(toJumpPatch({ action: 'search', query: '进击' })).toEqual({
      action: 'search', target: '进击', category: '', page: '1',
    })
  })
  it('detail：url 写入 target', () => {
    expect(toJumpPatch({ action: 'detail', url: 'http://x/1' })).toEqual({
      action: 'detail', target: 'http://x/1',
    })
  })
  it('reading：url 写入 target', () => {
    expect(toJumpPatch({ action: 'reading', url: 'http://x/1' })).toEqual({
      action: 'reading', target: 'http://x/1',
    })
  })
  it('categories', () => {
    expect(toJumpPatch({ action: 'categories' })).toEqual({ action: 'categories', target: '' })
  })
  it('undefined 返回 null（走 URL 回退）', () => {
    expect(toJumpPatch(undefined)).toBeNull()
  })
})

describe('BlockRenderer 结构化 target 透传', () => {
  it('tags 块带 target 时回调收到 target', () => {
    const received = { value: null as { url: string; target?: PageJumpTarget } | null }
    const block = {
      type: 'tags',
      content: [{ name: '动作', url: 'http://x/tag', target: { action: 'search', query: 'action' } }],
    } satisfies ContentBlock
    render(
      <BlockRenderer
        block={block}
        onJumpJson={vi.fn()}
        onTagClick={(url: string, target?: PageJumpTarget) => { received.value = { url, target } }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '动作' }))
    expect(received.value?.target).toEqual({ action: 'search', query: 'action' })
  })

  it('recommendations 块带 target 时回调收到 target', () => {
    const received = { value: null as { url: string; target?: PageJumpTarget } | null }
    const block = {
      type: 'recommendations',
      content: [{ title: '推荐A', url: 'http://x/1', target: { action: 'detail', url: 'http://x/1' } }],
    } satisfies ContentBlock
    render(
      <BlockRenderer
        block={block}
        onJumpJson={vi.fn()}
        onDetailClick={(url: string, target?: PageJumpTarget) => { received.value = { url, target } }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看 推荐A' }))
    expect(received.value?.target).toEqual({ action: 'detail', url: 'http://x/1' })
  })

  it('chapter 块带 target 时回调收到 target', () => {
    const received = { value: null as { url: string; target?: PageJumpTarget } | null }
    const block = {
      type: 'chapter',
      content: [{ title: '第1话', url: 'http://c/1', target: { action: 'reading', url: 'http://c/1' } }],
    } satisfies ContentBlock
    render(
      <BlockRenderer
        block={block}
        onJumpJson={vi.fn()}
        onChapterClick={(url: string, target?: PageJumpTarget) => { received.value = { url, target } }}
      />,
    )
    fireEvent.click(screen.getByText('第1话'))
    expect(received.value?.target).toEqual({ action: 'reading', url: 'http://c/1' })
  })
})

describe('ExplorePreview', () => {
  it('渲染各分区标题与条目，点击条目跳 detail', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, detail: true, explore: true }),
        },
      ],
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const feed: ExploreFeed = [
      { title: '热门', items: [{ id: '1', title: '作品A', url: 'http://x/a' }] },
      { title: '最新', items: [{ id: '2', title: '作品B', url: 'http://x/b' }] },
    ]
    render(<ExplorePreview data={feed} />)
    expect(screen.getByText('热门')).toBeTruthy()
    expect(screen.getByText('最新')).toBeTruthy()
    fireEvent.click(screen.getByText('作品A'))
    expect(called).toEqual({ action: 'detail', target: 'http://x/a' })
  })

  it('viewMore 按钮用 PageJumpTarget 驱动跳转', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      plugins: [
        {
          id: 'p',
          name: 'P',
          version: '1',
          capabilities: caps({ list: true, detail: true, explore: true }),
        },
      ],
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const feed: ExploreFeed = [
      {
        title: '热门',
        items: [{ id: '1', title: '作品A', url: 'http://x/a' }],
        viewMore: { action: 'list', category: 'sort=hot' },
      },
    ]
    render(<ExplorePreview data={feed} />)
    fireEvent.click(screen.getByText('更多'))
    expect(called).toMatchObject({ action: 'list', category: 'sort=hot' })
  })
})

describe('TagsPreview', () => {
  it('kind=tags 条目打开 = runWith tags，不渲染筛选组', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: Listing[] = [
      { name: '標籤', url: 'https://www.kvs_site_b.net/tags/', kind: 'tags' },
    ]
    render(<ListingsPreview data={data} />)
    fireEvent.click(screen.getByText(/打开「標籤」/))
    expect(called).toMatchObject({ action: 'tags' })
    expect(screen.getByText(/标签索引：getTags/)).toBeTruthy()
  })

  it('渲染首字分组与标签 chip，点击标签进列表（target 优先）', () => {
    let called: Record<string, unknown> | null = null
    useStore.setState({
      selected: baseSelected,
      runWith: async (patch) => { called = patch },
    })
    const data: TagIndex = [
      {
        title: '黑',
        tags: [
          { name: '黑絲', url: 'https://www.kvs_site_b.net/tags/hei-si/', count: 229, target: { action: 'list', url: 'https://www.kvs_site_b.net/tags/hei-si/' } },
          { name: '黑襪', url: 'https://www.kvs_site_b.net/tags/hei-wa/', count: 35 },
        ],
      },
    ]
    render(<TagsPreview data={data} />)
    expect(screen.getByText('黑')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /打开标签 黑絲/ }))
    expect(called).toMatchObject({ action: 'list', url: 'https://www.kvs_site_b.net/tags/hei-si/' })
  })

  it('空索引渲染空态', () => {
    useStore.setState({ selected: baseSelected, runWith: async () => {} })
    render(<TagsPreview data={[]} />)
    expect(screen.getByText(/无标签索引内容/)).toBeTruthy()
  })
})
