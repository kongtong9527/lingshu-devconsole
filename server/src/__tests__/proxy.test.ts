// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createCipheriv } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { registerRoutes } from '../routes.js'
import { fetchViaProxy, DEV_UA } from '../proxy.js'

const IMAGE_ENCRYPTION = {
  algorithm: 'AES-128-CBC',
  padding: 'Pkcs7',
  encoding: 'Base64 ciphertext',
  key: 'f5d965df75336270',
  iv: '97b60394abc2fbe1',
}

function encryptImage(body: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', IMAGE_ENCRYPTION.key, IMAGE_ENCRYPTION.iv)
  return Buffer.concat([cipher.update(body), cipher.final()])
}

function buildApp(): FastifyInstance {
  const app = Fastify()
  registerRoutes(app)
  return app
}

describe('fetchViaProxy（服务函数）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('带伪装 UA + 目标站 Referer 调用 fetch，并透传 status 与白名单头', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('IMGDATA', {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'set-cookie': 'hack=1',
          'cache-control': 'max-age=60',
        },
      }),
    )
    const r = await fetchViaProxy('https://www.manga_site_f.com/a/b.png')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({
      'user-agent': DEV_UA,
      referer: 'https://www.manga_site_f.com/',
      accept: '*/*',
    })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
    expect(r.headers['cache-control']).toBe('max-age=60')
    expect(r.headers['set-cookie']).toBeUndefined()
  })

  it('fetch 抛错时向上传播（路由层转 502）', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ETIMEDOUT'))
    await expect(fetchViaProxy('https://a.com/x.png')).rejects.toThrow('ETIMEDOUT')
  })

  it('纯直通媒体（mp4 等）流式转发：透传 Range，保留 206 与 content-range（边下边播）', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('chunk-data', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-9/1000000',
          'accept-ranges': 'bytes',
        },
      }),
    )
    const r = await fetchViaProxy('https://v.example/video.mp4?token=abc', { range: 'bytes=0-' })

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ range: 'bytes=0-' })
    expect(r.status).toBe(206)
    expect(r.headers['content-type']).toBe('video/mp4')
    expect(r.headers['content-range']).toBe('bytes 0-9/1000000')
    expect(r.headers['accept-ranges']).toBe('bytes')
    // 流式返回，body 不是整包 Buffer
    const chunks: Buffer[] = []
    for await (const c of r.body as NodeJS.ReadableStream) chunks.push(Buffer.from(c as Buffer))
    expect(Buffer.concat(chunks).toString('utf8')).toBe('chunk-data')
  })

  it('按 metadata 解密 AES-128-CBC 图片并识别图片类型', async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(encryptImage(plain) as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'content-length': '32' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.jpeg', { decrypt: IMAGE_ENCRYPTION })

    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/jpeg')
    expect(r.headers['content-length']).toBeUndefined()
  })

  it('混排中的明图跳过解密直接透传（魔法头直通）', async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(plain as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )

    const r = await fetchViaProxy('https://imgpublic.example/upload/poster.jpeg', { decrypt: IMAGE_ENCRYPTION })

    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/jpeg')
  })

  it('解密 AES-128-CFB 图片（流模式，无填充）', async () => {
    const cfg = {
      algorithm: 'AES-128-CFB',
      key: 'f5d965df75336270',
      iv: '97b60394abc2fbe1',
      encoding: 'Base64 ciphertext',
    }
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    const cipher = createCipheriv('aes-128-cfb', cfg.key, cfg.iv)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(encrypted as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    const r = await fetchViaProxy('https://pic.example/image.jpeg', { decrypt: cfg })
    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/jpeg')
  })

  it('解密 AES-128-OFB 图片（流模式，无填充）', async () => {
    const cfg = {
      algorithm: 'AES-128-OFB',
      key: 'f5d965df75336270',
      iv: '97b60394abc2fbe1',
      encoding: 'Base64 ciphertext',
    }
    const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])
    const cipher = createCipheriv('aes-128-ofb', cfg.key, cfg.iv)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(encrypted as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    const r = await fetchViaProxy('https://pic.example/image.png', { decrypt: cfg })
    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/png')
  })

  it('解密 AES-256-CBC 图片（32 字节 key）', async () => {
    const cfg = {
      algorithm: 'AES-256-CBC',
      key: 'f5d965df75336270f5d965df75336270',
      iv: '97b60394abc2fbe1',
      padding: 'Pkcs7',
      encoding: 'Base64 ciphertext',
    }
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d])
    const cipher = createCipheriv('aes-256-cbc', cfg.key, cfg.iv)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(encrypted as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )
    const r = await fetchViaProxy('https://pic.example/image.jpeg', { decrypt: cfg })
    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/jpeg')
  })

  it('不支持 AES 之外 / 未知算法时抛错', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('x', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    )
    await expect(fetchViaProxy('https://pic.example/image', {
      decrypt: { algorithm: 'DES-CBC', key: 'k', iv: 'v' },
    })).rejects.toThrow('暂不支持图片加密算法')
  })

  it('解码 base64-text JPEG 响应并按文件头设置类型', async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(`data:image/jpeg;base64,${plain.toString('base64')}`, {
        status: 200,
        headers: { 'content-type': 'text/plain', 'content-length': '32' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.jpg', {
      imageTransport: { encoding: 'base64-text' },
    })

    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/jpeg')
    expect(r.headers['content-length']).toBeUndefined()
  })

  it('解码 base64-text WebP 响应并按文件头设置类型', async () => {
    const plain = Buffer.from('RIFFxxxxWEBPdata', 'ascii')
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(`base64,${plain.toString('base64')}`, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.webp', {
      imageTransport: { encoding: 'base64-text' },
    })

    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/webp')
  })

  it('解码 base64-text SVG 响应并按头部 <svg 设置类型（与 iOS 自绘光栅化对齐）', async () => {
    const plain = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- 站点导出 -->\n<svg width="10" height="10"><rect width="10" height="10"/></svg>',
      'utf8',
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(`data:image/svg+xml;base64,${plain.toString('base64')}`, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const r = await fetchViaProxy('https://static.example/static/images/kvs_black.svg', {
      imageTransport: { encoding: 'base64-text' },
    })

    expect(r.body).toEqual(plain)
    expect(r.headers['content-type']).toBe('image/svg+xml')
  })

  it('拒绝未知图片传输编码和非法 Base64 内容', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('anything', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )
    await expect(fetchViaProxy('https://pic.example/image', {
      imageTransport: { encoding: 'unknown' },
    })).rejects.toThrow('暂不支持图片传输编码')

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not-base64!', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )
    await expect(fetchViaProxy('https://pic.example/image', {
      imageTransport: { encoding: 'base64-text' },
    })).rejects.toThrow('Base64')
  })

  it('重写 HLS 清单：分片走代理，密钥直连 CDN', async () => {
    const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment-1.ts\n'
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(manifest, {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    )

    const r = await fetchViaProxy('https://video.example/live/main.m3u8?token=abc')
    const rewritten = r.body.toString('utf8')

    expect(r.headers['content-type']).toBe('application/vnd.apple.mpegurl')
    // key.bin 直连 CDN（浏览器原生可过 Cloudflare challenge）
    const keyLine = rewritten.split('\n').find(l => l.includes('KEY')) || ''
    expect(keyLine).toContain('https://video.example/live/key.bin?token=abc')
    expect(keyLine).not.toContain('/api/proxy')
    // segment 仍走服务端代理
    expect(rewritten).toMatch(/\/api\/proxy\?url=.+segment-1\.ts/)
  })

  it('HLS 重写时透传 referer 到子资源代理 URL（密钥除外）', async () => {
    const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment-1.ts\n'
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(manifest, {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    )

    const referer = 'https://manga_site_a.com'
    const r = await fetchViaProxy('https://video.example/live/main.m3u8?token=abc', { referer })
    const rewritten = r.body.toString('utf8')

    const encodedReferer = encodeURIComponent(referer)
    // KEY URI 行是直连 CDN，不含 /api/proxy
    const keyLine = rewritten.split('\n').find(l => l.includes('KEY')) || ''
    expect(keyLine).not.toContain('/api/proxy')
    expect(keyLine).toContain('https://video.example/live/key.bin?token=abc')
    // segment 行仍走代理且带 referer
    const segLine = rewritten.split('\n').find(l => l.includes('segment-1')) || ''
    expect(segLine).toContain('/api/proxy')
    expect(segLine).toContain(`&referer=${encodedReferer}`)
  })

  it('传 referer 时 fetch 的请求头使用自定义 Referer', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('data', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )
    await fetchViaProxy('https://video.example/segment.ts', { referer: 'https://manga_site_a.com' })

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({
      referer: 'https://manga_site_a.com',
    })
  })

  it('图片转换响应上游未声明缓存策略时，兜底写入 Cache-Control', async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(plain.toString('base64'), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.jpg', {
      imageTransport: { encoding: 'base64-text' },
    })

    expect(r.headers['cache-control']).toContain('max-age=')
  })

  it('上游已声明 cache-control 时不被兜底覆盖', async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(plain.toString('base64'), {
        status: 200,
        headers: { 'content-type': 'text/plain', 'cache-control': 'private, max-age=10' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.jpg', {
      imageTransport: { encoding: 'base64-text' },
    })

    expect(r.headers['cache-control']).toBe('private, max-age=10')
  })

  it('HLS 清单重写不兜底缓存（动态内容、含 token）', async () => {
    const manifest = '#EXTM3U\n#EXTINF:4,\nsegment-1.ts\n'
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(manifest, {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    )

    const r = await fetchViaProxy('https://video.example/live/main.m3u8?token=abc')

    expect(r.headers['cache-control']).toBeUndefined()
  })

  it('图片转换响应上游非 200 时不兜底缓存', async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(plain.toString('base64'), {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.jpg', {
      imageTransport: { encoding: 'base64-text' },
    })

    expect(r.status).toBe(404)
    expect(r.headers['cache-control']).toBeUndefined()
  })

  it('Cloudflare 挑战页（m3u8 + cf-mitigated 头）：不重写清单，打标记透传', async () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>'
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(challenge, {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      }),
    )

    const r = await fetchViaProxy('https://video.example/live/main.m3u8?token=abc')

    expect(r.status).toBe(403)
    expect(r.headers['x-lingshu-challenge']).toBe('cloudflare')
    expect(r.headers['cache-control']).toBeUndefined()
    expect((r.body as Buffer).toString('utf8')).toBe(challenge)
  })

  it('Cloudflare WAF block 页（无 cf-mitigated 头，按正文识别）：不解密，打标记透传', async () => {
    const block = '<html><head><title>Attention Required! | Cloudflare</title></head></html>'
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(block, {
        status: 403,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const r = await fetchViaProxy('https://pic.example/image.jpeg', { decrypt: IMAGE_ENCRYPTION })

    expect(r.status).toBe(403)
    expect(r.headers['x-lingshu-challenge']).toBe('cloudflare')
    expect((r.body as Buffer).toString('utf8')).toBe(block)
  })

  it('非 403 响应即使含挑战字样也不误判', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('#EXTM3U\n#EXTINF:4,\nsegment-1.ts\n', {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    )

    const r = await fetchViaProxy('https://video.example/live/main.m3u8')

    expect(r.headers['x-lingshu-challenge']).toBeUndefined()
    expect((r.body as Buffer).toString('utf8')).toContain('/api/proxy?url=')
  })

  it('503 + 挑战特征串同样识别（三端拉齐）', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body>cf-error under attack</body></html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const r = await fetchViaProxy('https://video.example/live/main.m3u8')

    expect(r.status).toBe(503)
    expect(r.headers['x-lingshu-challenge']).toBe('cloudflare')
  })

  it('普通 403（无头无特征串，如热链保护）不误判', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Forbidden: hotlinking denied', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    // 无变换选项：普通 403 原样透传，不打挑战标记
    const r = await fetchViaProxy('https://pic.example/image.jpeg')

    expect(r.status).toBe(403)
    expect(r.headers['x-lingshu-challenge']).toBeUndefined()
  })
})

describe('图片切片解扰 (__s / reverseStripes)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // 造一张宽 width、按 bands 自上而下分带填色的 PNG(每带等高或末带任意高)。独立于被测实现。
  async function makeBandedPng(width: number, bands: { h: number; color: [number, number, number] }[]): Promise<Buffer> {
    const channels = 3
    const height = bands.reduce((s, b) => s + b.h, 0)
    const raw = Buffer.alloc(width * height * channels)
    let y = 0
    for (const b of bands) {
      for (let r = 0; r < b.h; r++) {
        for (let x = 0; x < width; x++) {
          const off = ((y + r) * width + x) * channels
          raw[off] = b.color[0]
          raw[off + 1] = b.color[1]
          raw[off + 2] = b.color[2]
        }
      }
      y += b.h
    }
    return sharp(raw, { raw: { width, height, channels } }).png().toBuffer()
  }

  // 取原始 RGB 像素(去 alpha),用于像素级比较。
  async function rawRgb(buf: Buffer): Promise<Buffer> {
    return sharp(buf).removeAlpha().raw().toBuffer()
  }

  const RED: [number, number, number] = [255, 0, 0]
  const GREEN: [number, number, number] = [0, 255, 0]
  const BLUE: [number, number, number] = [0, 0, 255]
  const WHITE: [number, number, number] = [255, 255, 255]

  it('__s 被从回源 URL 剥离,其余 query 保留', async () => {
    const png = await makeBandedPng(16, [{ h: 50, color: RED }])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(png as unknown as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } }),
    )

    await fetchViaProxy('https://pic.example/a.jpg?keep=1&__s=10')

    const fetchedUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(fetchedUrl).not.toContain('__s')
    expect(fetchedUrl).toContain('keep=1')
  })

  it('余数为 0 时按 manga_site_b.js 算法倒序重组(手算期望)', async () => {
    // H=99,num=3,blockSize=33,余数 0。三块等高:块0=红[0,33)、块1=绿[33,66)、块2=蓝[66,99)。
    // 倒序重组 → 输出[0,33)=块2蓝、[33,66)=块1绿、[66,99)=块0红。
    const input = await makeBandedPng(16, [
      { h: 33, color: RED },
      { h: 33, color: GREEN },
      { h: 33, color: BLUE },
    ])
    const expected = await makeBandedPng(16, [
      { h: 33, color: BLUE },
      { h: 33, color: GREEN },
      { h: 33, color: RED },
    ])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(input as unknown as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } }),
    )

    const r = await fetchViaProxy('https://pic.example/p.jpg?__s=3')

    expect(r.headers['content-type']).toBe('image/png')
    // __s=3 走解扰变换，body 必为完整 Buffer
    expect(await rawRgb(r.body as Buffer)).toEqual(await rawRgb(expected))
  })

  it('余数非 0 时末块(bs+r)整体贴到顶部(手算期望,与"余数留底"区分)', async () => {
    // H=100,num=3,blockSize=33,余数 1。输入 红33/绿33/蓝33/白1:
    //   块0=红[0,33)、块1=绿[33,66)、块2=蓝[66,99)+白[99,100)(末块高 34,吃余数)。
    // 倒序重组(末块贴顶):
    //   输出[0,34)=块2 → 蓝33+白1;输出[34,67)=块1 → 绿33;输出[67,100)=块0 → 红33。
    // 即期望 = 蓝33 / 白1 / 绿33 / 红33(原本最底的白行落到输出第 33 行,而非留在底部)。
    const input = await makeBandedPng(16, [
      { h: 33, color: RED },
      { h: 33, color: GREEN },
      { h: 33, color: BLUE },
      { h: 1, color: WHITE },
    ])
    const expected = await makeBandedPng(16, [
      { h: 33, color: BLUE },
      { h: 1, color: WHITE },
      { h: 33, color: GREEN },
      { h: 33, color: RED },
    ])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(input as unknown as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } }),
    )

    const r = await fetchViaProxy('https://pic.example/p.jpg?__s=3')

    // __s=3 走解扰变换，body 必为完整 Buffer
    expect(await rawRgb(r.body as Buffer)).toEqual(await rawRgb(expected))
  })

  it('num <= 1 时直通不变换(但 __s 仍剥离)', async () => {
    const png = await makeBandedPng(16, [
      { h: 30, color: RED },
      { h: 30, color: GREEN },
    ])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(png as unknown as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } }),
    )

    const r = await fetchViaProxy('https://pic.example/p.jpg?__s=1')

    // 字节级未变(未重新编码)——直通流式返回，读流对比
    const chunks: Buffer[] = []
    for await (const c of r.body as NodeJS.ReadableStream) chunks.push(Buffer.from(c as Buffer))
    expect(Buffer.concat(chunks)).toEqual(png)
    // __s 仍从回源 URL 剥离
    expect(vi.mocked(fetch).mock.calls[0][0] as string).not.toContain('__s')
  })
})

describe('GET /api/proxy（路由）', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn())
    app = buildApp()
    await app.ready()
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await app.close()
  })

  it('缺 url → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/proxy' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBeTruthy()
  })

  it('file:// 协议 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('file:///etc/passwd'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('成功：透传上游 status 与 content-type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('IMG', { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('https://a.com/x.jpg'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body).toBe('IMG')
  })

  it('transport=base64-text 路由参数会转换上游图片响应', async () => {
    const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(plain.toString('base64'), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('https://a.com/x.png') + '&transport=base64-text',
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(Buffer.from(res.rawPayload)).toEqual(plain)
  })

  it('上游故障 → 502', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('boom'))
    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('https://a.com/x.jpg'),
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBeTruthy()
  })

  it('referer 查询参数透传给 fetchViaProxy', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('IMG', { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    await app.inject({
      method: 'GET',
      url: '/api/proxy?url=' + encodeURIComponent('https://a.com/x.jpg') + '&referer=' + encodeURIComponent('https://referer.test'),
    })

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ referer: 'https://referer.test' })
  })
})
