// DevConsole 资源代理：为前端媒体元素绕过浏览器侧 Referer/UA/混合内容限制。
// 图片可按插件 metadata 解密，HLS 清单会重写为同源代理地址。

import { createDecipheriv } from 'node:crypto'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import type { ImageTransport } from 'lingshu-runtime'
import { isChallengeProbe } from 'lingshu-runtime'

export const DEV_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const PASSTHROUGH_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'last-modified',
  // 媒体流式直通（mp4 等）：透传 Range 协商头，浏览器 video 才能边下边播
  'accept-ranges',
  'content-range',
])

// 上游未声明缓存策略时，对本地解码的稳定图片资源兜底启用浏览器磁盘缓存。
// 仅限 decrypt/imageTransport 转换场景：源 URL 通常是 {id}/{chapter}/{page}.jpg 这类不可变路径。
// HLS 清单含 token 且会被动态重写，不在此列。
const DEFAULT_IMAGE_CACHE_CONTROL = 'public, max-age=86400'

export interface ImageEncryptionConfig {
  algorithm: string
  padding?: string
  encoding?: string
  key: string
  iv: string
}

export interface ProxyOptions {
  decrypt?: ImageEncryptionConfig
  imageTransport?: ImageTransport
  referer?: string
  /** 浏览器侧 Range 头（媒体元素起播/seek 用），原样透传上游 */
  range?: string
}

export interface ProxyResult {
  status: number
  headers: Record<string, string>
  /** 纯直通（视频/分片等媒体）为流式 Readable；需变换/HLS 重写为完整 Buffer */
  body: Buffer | Readable
}

export type ProxyCheck =
  | { ok: true; url: string }
  | { ok: false; error: string }

/** 校验代理目标：必填、可解析、仅 http/https（同时阻挡 file:// 等读本地文件）。 */
export function validateProxyUrl(raw: string | undefined): ProxyCheck {
  if (!raw) return { ok: false, error: '缺少 url 参数' }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: '无效 url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: '仅支持 http/https 协议' }
  }
  return { ok: true, url: parsed.href }
}

function unpadPKCS7(data: Buffer): Buffer {
  if (data.length === 0) return data
  const padLen = data[data.length - 1]
  if (padLen < 1 || padLen > 16) return data
  for (let i = 0; i < padLen; i++) {
    if (data[data.length - 1 - i] !== padLen) return data
  }
  return data.subarray(0, data.length - padLen)
}

function decryptImage(body: Buffer, config: ImageEncryptionConfig): Buffer {
  const algorithm = config.algorithm?.toUpperCase()

  // AES 族：AES-{128|192|256}-{ECB|CBC|CFB|OFB}
  const aesMatch = algorithm?.match(/^AES-(128|192|256)-(ECB|CBC|CFB|OFB)$/)
  if (!aesMatch) {
    throw new Error(`暂不支持图片加密算法: ${config.algorithm}`)
  }

  const bits = Number(aesMatch[1])
  const mode = aesMatch[2] as 'ECB' | 'CBC' | 'CFB' | 'OFB'
  const keyLen = bits / 8

  if (config.encoding && config.encoding.toLowerCase() !== 'base64 ciphertext') {
    throw new Error(`暂不支持图片密文编码: ${config.encoding}`)
  }

  const key = Buffer.from(config.key, 'utf8')
  if (key.length !== keyLen) {
    throw new Error(`AES-${bits} 的 key 必须是 ${keyLen} 字节，收到 ${key.length} 字节`)
  }

  // ECB：无 IV
  if (mode === 'ECB') {
    const decipher = createDecipheriv(`aes-${bits}-ecb`, key, null as any)
    decipher.setAutoPadding(false)
    let decrypted: Buffer = Buffer.concat([decipher.update(body), decipher.final()])

    const padding = config.padding?.toLowerCase()
    if (!padding || padding === 'nopadding') {
      decrypted = unpadPKCS7(decrypted)
    }
    return decrypted
  }

  // CBC / CFB / OFB：需要 IV（CryptoJS 不足一个完整 IV 时以零字节补齐到 16）
  const iv = Buffer.from(config.iv, 'utf8')
  if (iv.length === 0 || iv.length > 16) {
    throw new Error(`AES-${bits}-${mode} 的 iv 需为 1-16 字节，收到 ${iv.length} 字节`)
  }
  const paddedIv = iv.length === 16 ? iv : Buffer.concat([iv, Buffer.alloc(16 - iv.length)])

  const decipher = createDecipheriv(`aes-${bits}-${mode.toLowerCase()}`, key, paddedIv)

  if (mode === 'CBC') {
    // CBC：PKCS7 自动填充（保持现有行为）
    if (config.padding && config.padding.toLowerCase() !== 'pkcs7') {
      throw new Error(`暂不支持图片填充方式: ${config.padding}`)
    }
    return Buffer.concat([decipher.update(body), decipher.final()])
  }

  // CFB / OFB：流模式，无填充
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

/**
 * 文件头识别（与 iOS `ImageLoader.looksLikeImage` 同构）。
 * SVG 不是魔法头，按头部 `<svg` 判（先剥 BOM/前言）——iOS 侧 SVG 由自绘光栅化处理
 * （见 ios/docs/image-pipeline.md），两侧都认它才不会出现「一边能显示、一边失败」。
 */
function detectImageType(body: Buffer): string | undefined {
  if (isSvg(body)) return 'image/svg+xml'
  if (body.length >= 3 && body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (body.length >= 6 && ['GIF87a', 'GIF89a'].includes(body.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

/** SVG 判定：剥掉 BOM / 空白 / `<?xml …?>` / 注释 / `<!DOCTYPE …>` 后以 `<svg` 开头。 */
function isSvg(body: Buffer): boolean {
  const head = body.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  const withoutProlog = head
    .replace(/^<\?xml[\s\S]*?\?>\s*/, '')
    .replace(/^<!--[\s\S]*?-->\s*/, '')
    .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
  return /^<svg[\s>:/]/i.test(withoutProlog)
}

function decodeBase64Image(body: Buffer, transport: ImageTransport): { body: Buffer; contentType: string } {
  if (transport.encoding !== 'base64-text') {
    throw new Error(`暂不支持图片传输编码: ${transport.encoding}`)
  }

  let payload = body.toString('utf8').trim()
  payload = payload.replace(/^data:[^,]*;base64,/i, '').replace(/^base64,/i, '')
  if (!payload || payload.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    throw new Error('图片响应不是合法 Base64')
  }

  const decoded = Buffer.from(payload, 'base64')
  const contentType = detectImageType(decoded)
  if (!contentType) throw new Error('Base64 图片文件头未知或非法')
  return { body: decoded, contentType }
}

function isHlsPlaylist(url: string, contentType: string | undefined, body: Buffer): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url) || /mpegurl/i.test(contentType || '') || body.subarray(0, 7).toString('utf8') === '#EXTM3U'
}

/**
 * Cloudflare 拦截识别（/ 三端拉齐）。
 * 语义委托共享表（403/503 + `cf-mitigated` 头或前 4KB 特征串），本函数只做
 * Node Headers/Buffer 到共享探针的适配，保持原签名（存量测试与调用点零改）。
 * 命中时调用方必须跳过一切内容变换（HLS 重写/图片解密/缓存兜底），否则挑战 HTML 会被当成
 * 媒体缓存下来（如 movie_site_a 的 `<pre></pre>` 事故），并打标记头供前端展示可操作的提示。
 */
export function isChallengeResponse(status: number, upstreamHeaders: Headers, body: Buffer): boolean {
  const headers: Record<string, string> = {}
  upstreamHeaders.forEach((v, k) => {
    headers[k] = v
  })
  return isChallengeProbe({ status, headers, body: body.subarray(0, 4096).toString('utf8') })
}

function proxiedResourceUrl(url: string, referer?: string): string {
  const encoded = encodeURIComponent(url)
  return referer
    ? `/api/proxy?url=${encoded}&referer=${encodeURIComponent(referer)}`
    : `/api/proxy?url=${encoded}`
}

function resolveHlsUri(uri: string, baseUrl: string): string {
  const base = new URL(baseUrl)
  const resolved = new URL(uri, base)
  // 部分鉴权服务把 token 放在清单 URL 查询参数中，分片使用相对路径时需要继承它。
  if (!resolved.search && base.search && !/[?#]/.test(uri)) resolved.search = base.search
  return resolved.href
}

function rewriteHlsPlaylist(body: string, baseUrl: string, referer?: string): string {
  return body.split(/\r?\n/).map((line) => {
    if (!line.trim() || line.startsWith('#')) {
      // EXT-X-KEY 的 URI（key.bin）让浏览器直连 CDN，
      // 因为服务端 Node.js fetch 无法通过 Cloudflare JS challenge。
      if (line.includes('URI=')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${resolveHlsUri(uri, baseUrl)}"`)
      }
      return line
    }
    return proxiedResourceUrl(resolveHlsUri(line.trim(), baseUrl), referer)
  }).join('\n')
}

/**
 * 检测并剥离图片 URL 的保留 query `__s=<num>`。
 * `__s` 一律从回源 URL 去掉(否则上游 404);仅当值为 >1 的整数时返回 scrambleNum 触发解扰。
 * 非整数 / <=1 时直通(但仍剥参)。
 */
function extractScrambleParam(url: string): { url: string; scrambleNum?: number } {
  const parsed = new URL(url)
  const raw = parsed.searchParams.get('__s')
  if (raw === null) return { url }
  parsed.searchParams.delete('__s')
  const num = Number(raw)
  if (Number.isInteger(num) && num > 1) {
    return { url: parsed.href, scrambleNum: num }
  }
  return { url: parsed.href }
}

/**
 * 通用"横切倒序"图像变换(/ 逐字复刻 manga_site_b.js modifyImage):
 * 把服务器已打乱的图还原。给定图高 H 与整数 num(num>1):
 *   blockSize = ⌊H/num⌋, r = H % num
 *   num 个块——第 i 块(i = 0..num-2)高 blockSize;末块(i = num-1)高 blockSize + r(吃余数)。
 *   块 i 行区间 = [i*blockSize, i*blockSize + 高度),连续且恰好覆盖 [0, H)。
 *   重组:输出从 y=0 起依次放 末块、块 num-2、…、块 0(最高的末块贴到最顶部),倒序重排。
 * 变换通用,不含任何站点逻辑;按原格式重新编码。
 */
async function reverseStripes(body: Buffer, num: number): Promise<Buffer> {
  if (num <= 1) return body
  const meta = await sharp(body).metadata()
  const width = meta.width
  const height = meta.height
  if (!width || !height) return body

  const blockSize = Math.floor(height / num)
  if (blockSize <= 0) return body // 图比 num 还矮,无法切,直通
  const remainder = height % num

  // 块 i 的高度:末块吃余数 blockSize + r,其余 blockSize。
  const blockHeight = (i: number) => (i === num - 1 ? blockSize + remainder : blockSize)
  const blockTop = (i: number) => i * blockSize

  // 倒序重组:输出从 y=0 起依次贴 块 num-1、num-2、…、0(末块贴到最顶部)。
  const layers: { input: Buffer; top: number; left: number }[] = []
  let destTop = 0
  for (let i = num - 1; i >= 0; i--) {
    const strip = await sharp(body)
      .extract({ left: 0, top: blockTop(i), width, height: blockHeight(i) })
      .toBuffer()
    layers.push({ input: strip, top: destTop, left: 0 })
    destTop += blockHeight(i)
  }

  const channels = meta.channels && [1, 2, 3, 4].includes(meta.channels) ? meta.channels : 4
  const background = channels >= 4 ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 0, g: 0, b: 0 }
  const format = meta.format ?? 'jpeg'

  return sharp({ create: { width, height, channels, background } })
    .composite(layers)
    .toFormat(format)
    .toBuffer()
}

/** 调用上游：带伪装浏览器 UA + 目标站 Referer + 客户端提示头。网络故障时抛错（路由层转 502）。 */
export async function fetchViaProxy(url: string, options: ProxyOptions = {}): Promise<ProxyResult> {
  // 检测/剥离图片 URL 的保留 query __s,否则上游 404。
  const { url: upstreamUrl, scrambleNum } = extractScrambleParam(url)
  const origin = new URL(upstreamUrl).origin
  const upstream = await fetch(upstreamUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': DEV_UA,
      referer: options.referer || origin + '/',
      accept: '*/*',
      ...(options.range ? { range: options.range } : {}),
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'sec-ch-ua': '"Google Chrome";v="126", "Chromium";v="126", "Not?A_Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-ch-ua-platform-version': '"14.5.0"',
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-bitness': '"64"',
      'sec-ch-ua-model': '""',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
    },
  })
  const headers: Record<string, string> = {}
  upstream.headers.forEach((v, k) => {
    if (PASSTHROUGH_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v
  })
  const contentType = headers['content-type']
  const hasScramble = (scrambleNum ?? 0) > 1
  // 只有需要「读完再变换」的响应才缓冲：HLS 清单重写 / 图片解密 / base64 传输 / 解扰。
  // 纯直通（mp4、HLS 分片、普通图片）保持流式，避免大媒体全量下载后才返回首字节。
  const urlLooksHls = /\.m3u8(?:$|[?#])/i.test(upstreamUrl)
  const typeLooksHls = /mpegurl/i.test(contentType || '')
  const needsBuffer =
    Boolean(options.decrypt || options.imageTransport) || hasScramble || urlLooksHls || typeLooksHls
  const body = needsBuffer ? Buffer.from(await upstream.arrayBuffer()) : null

  const isHls = body !== null && isHlsPlaylist(upstreamUrl, contentType, body)
  const transformed = Boolean(options.decrypt || options.imageTransport) || isHls || hasScramble

  if (body === null) {
    // 纯直通（视频 mp4 / HLS 分片 / 普通图片等）：流式转发，边下边播，
    // 不把大媒体全量 buffer 后再吐（否则 <video> 要等整个文件下载完才能起播）。
    return {
      status: upstream.status,
      headers,
      body: upstream.body ? Readable.fromWeb(upstream.body as never) : Buffer.alloc(0),
    }
  }

  let out: Buffer = body
  if (isChallengeResponse(upstream.status, upstream.headers, body)) {
    // 挑战页原样透传：不重写、不解密、不补缓存头，并打标记（路由层原样转发该头）。
    headers['x-lingshu-challenge'] = 'cloudflare'
    delete headers['content-length']
    return { status: upstream.status, headers, body: out }
  }
  if (isHls) {
    out = Buffer.from(rewriteHlsPlaylist(out.toString('utf8'), upstream.url || upstreamUrl, options.referer), 'utf8')
    headers['content-type'] = 'application/vnd.apple.mpegurl'
  } else if (options.decrypt) {
    // 明图直通（镜像站内解密器的明图判断，如 video_site_g 视频海报）：
    // 混排中个别 URL 本就是明图（无鉴权参数的 CDN 图），解密会得到乱码；
    // 响应体已有图片魔法头时跳过解密直接透传。
    if (!detectImageType(out)) {
      out = decryptImage(out, options.decrypt)
    }
    headers['content-type'] = detectImageType(out) || 'application/octet-stream'
  } else if (options.imageTransport) {
    const decoded = decodeBase64Image(out, options.imageTransport)
    out = decoded.body
    headers['content-type'] = decoded.contentType
  }

  // 解扰变换在 decrypt / base64 传输解码之后,作用于最终解码出的图像字节。
  if (hasScramble) {
    out = await reverseStripes(out, scrambleNum!)
    headers['content-type'] = detectImageType(out) || headers['content-type'] || 'application/octet-stream'
  }

  if (transformed) {
    delete headers['content-length']
    // 图片解码类响应（decrypt/imageTransport/__s 解扰）：上游未声明缓存策略时补兜底强缓存。
    // HLS 清单 URL 常带鉴权 token，不能缓存。
    if (
      !isHls &&
      (Boolean(options.decrypt || options.imageTransport) || hasScramble) &&
      upstream.status === 200 &&
      !headers['cache-control'] &&
      !headers['expires']
    ) {
      headers['cache-control'] = DEFAULT_IMAGE_CACHE_CONTROL
    }
  }
  return { status: upstream.status, headers, body: out }
}
