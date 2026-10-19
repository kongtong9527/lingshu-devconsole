import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import type { ImageEncryption, ImageTransport, VideoQuality } from '../types.js'
import { proxyUrl } from '../api/proxy.js'

function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url)
}

/** hls.js master playlist 解析出的清晰度档（通路二） */
interface HlsLevelOption {
  label: string
  /** hls.currentLevel 取值（-1 = 自动） */
  level: number
}

/**
 * 视频播放器。支持视频清晰度，两条通路：
 * 1. **显式 qualities**（props.qualities，多 URL 型站点）：插件声明各档独立 URL，
 *    点档位切换 activeSrc 重建播放器（换源）。
 * 2. **master playlist 自动（HLS ABR）**：hls.js 解析出多档 levels 时自动渲染
 *    清晰度菜单，点档位设 hls.currentLevel（原地切档，不重建播放器）；
 *    只有 1 档时不显示菜单（与 FluidPlayer 行为一致）。
 * 两条通路互斥：显式 qualities 优先，缺省走 hls levels。
 */
export default function VideoPlayer({
  src,
  poster,
  encryption,
  imageTransport,
  referer,
  qualities,
}: {
  src: string
  poster?: string
  encryption?: ImageEncryption
  imageTransport?: ImageTransport
  referer?: string
  qualities?: VideoQuality[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 显式通路当前播的 URL（初始 = props.src；切档换 URL）
  const [activeSrc, setActiveSrc] = useState<string>(src)
  const [hlsLevels, setHlsLevels] = useState<HlsLevelOption[]>([])
  const [hlsLevel, setHlsLevel] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)

  // props.src 变化（换剧集/线路）：重置显式档选择与 hls 档位
  useEffect(() => {
    setActiveSrc(src)
    setHlsLevels([])
    setHlsLevel(-1)
    setMenuOpen(false)
  }, [src])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const proxied = proxyUrl(activeSrc, undefined, undefined, referer)
    setError(null)
    setMenuOpen(false)

    if (!isHlsUrl(activeSrc)) {
      video.src = proxied
      return () => {
        video.removeAttribute('src')
      }
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false })
      hlsRef.current = hls
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('HLS 视频加载失败')
      })
      // master playlist 多档 → 渲染清晰度菜单（显式 qualities 优先，自动通路不重复建菜单）
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (qualities && qualities.length > 1) return
        if (data.levels.length > 1) {
          // data.levels 下标即 hls.currentLevel 取值，必须保留原始顺序（勿排序）
          setHlsLevels(
            data.levels
              .map((lv, idx) => ({
                label: lv.height ? `${lv.height}p` : `${Math.round(lv.bitrate / 1000)}kbps`,
                level: idx,
              }))
              // 展示排序（高 → 低）只动 UI 顺序，level 值仍为原始索引
              .sort((a, b) => {
                const ha = Number(a.label.replace(/p$/, ''))
                const hb = Number(b.label.replace(/p$/, ''))
                return (isNaN(hb) ? -1 : hb) - (isNaN(ha) ? -1 : ha)
              }),
          )
          setHlsLevel(hls.currentLevel)
        }
      })
      hls.loadSource(proxied)
      hls.attachMedia(video)

      return () => {
        hlsRef.current = null
        hls.destroy()
        video.removeAttribute('src')
      }
    }

    // 降级：Safari/iOS 原生 HLS
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxied
      return () => {
        video.removeAttribute('src')
      }
    }

    setError('当前浏览器不支持 HLS 视频')
  }, [activeSrc])

  function switchQuality(q: VideoQuality) {
    if (q.url === activeSrc) return
    setActiveSrc(q.url)
    setMenuOpen(false)
  }

  function switchHlsLevel(level: number) {
    if (hlsRef.current) hlsRef.current.currentLevel = level
    setHlsLevel(level)
    setMenuOpen(false)
  }

  const explicitQualities = qualities && qualities.length > 1 ? qualities : null
  const showQualityMenu = Boolean(explicitQualities || hlsLevels.length > 1)
  const menuItems = explicitQualities
    ? explicitQualities.map((q) => ({
        key: q.url,
        label: q.label,
        selected: q.url === activeSrc,
        onSelect: () => switchQuality(q),
      }))
    : hlsLevels.map((o) => ({
        key: String(o.level),
        label: o.label,
        selected: o.level === hlsLevel,
        onSelect: () => switchHlsLevel(o.level),
      }))
  // hls 通路追加「自动」档（-1）
  const hlsItems = !explicitQualities && hlsLevels.length > 1
    ? [{ key: 'auto', label: '自动', selected: hlsLevel === -1, onSelect: () => switchHlsLevel(-1) }, ...menuItems]
    : menuItems
  // 当前档 label：显式通路无匹配时回退首档（契约：顶层 url 为默认档，理应命中）；
  // hls 通路无匹配（未解析/自动）时显示「自动」
  const currentLabel = (explicitQualities ? menuItems : hlsItems).find((m) => m.selected)?.label
    ?? (explicitQualities ? menuItems[0]?.label : '自动')

  return (
    <div className="pv-video-wrap">
      {showQualityMenu && (
        <div className="pv-video-qmenu">
          <button
            type="button"
            className={`pv-video-qbtn${menuOpen ? ' is-open' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            title="清晰度"
          >
            {currentLabel ?? '自动'}
          </button>
          {menuOpen && (
            <div className="pv-video-qlist" role="menu">
              {hlsItems.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="menuitem"
                  className={`pv-video-qitem${m.selected ? ' is-selected' : ''}`}
                  onClick={m.onSelect}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={poster ? proxyUrl(poster, encryption, imageTransport, referer) : undefined}
        onError={() => setError('视频加载失败')}
        className="pv-video"
      />
      {error && <div className="pv-video-error">{error}</div>}
    </div>
  )
}