import { useState } from 'react'
import type { PlayUrlResult, ImageEncryption, ImageTransport } from '../types.js'
import { run as apiRun } from '../api/client.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import VideoPlayer from './VideoPlayer.js'
import { PlayIcon } from '../icons.js'

type PlayStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: PlayUrlResult }

/**
 * 「无 url 播放占位 + 懒解析」视频块：
 * 插件在 video 块直接给最终流有困难（详情页内嵌播放器、地址经 detail_play
 * 接口动态给、时效 auth_key 需现算）时，可只声明 `target: { action:'play', url }`
 * 而不给 url。宿主渲染封面/占位 + «解析播放»，用户点播时才懒调 play 动作
 * （fetchPlayUrl）现算出流，就地渲染播放器（不切换预览、不改全局 selected）。
 */
export default function VideoLazyBlock({
  pluginId,
  playUrl,
  poster,
  platform,
  posterEncryption,
  posterTransport,
}: {
  pluginId: string | null
  /** target.play 的出流入口 URL（详情页或播放页），传给 fetchPlayUrl */
  playUrl: string
  poster?: string
  platform?: string
  posterEncryption?: ImageEncryption
  posterTransport?: ImageTransport
}) {
  const [status, setStatus] = useState<PlayStatus>({ status: 'idle' })

  function start() {
    if (!pluginId) return
    if (status.status === 'loading') return
    setStatus({ status: 'loading' })
    apiRun({ pluginId, action: 'play', target: playUrl })
      .then((res) => {
        if (res.ok && res.data && typeof (res.data as PlayUrlResult).url === 'string') {
          setStatus({ status: 'done', result: res.data as PlayUrlResult })
        } else {
          setStatus({ status: 'error', message: res.error || '播放地址解析失败' })
        }
      })
      .catch((e) => {
        setStatus({ status: 'error', message: String(e) })
      })
  }

  if (status.status === 'done') {
    return (
      <div className="pv-video-lazy">
        <VideoPlayer
          src={status.result.url}
          poster={status.result.poster || poster}
          encryption={posterEncryption}
          imageTransport={posterTransport}
          referer={status.result.referer}
          qualities={status.result.qualities}
        />
      </div>
    )
  }

  return (
    <div className="pv-video-lazy">
      {poster && (
        <LazyImage
          src={proxyUrl(poster, posterEncryption, posterTransport)}
          alt=""
          className="pv-video-lazy__poster"
        />
      )}
      <div className="pv-video-lazy__content">
        {status.status === 'loading' && (
          <div className="pv-video-lazy__hint">正在解析播放地址…</div>
        )}
        {status.status === 'error' && (
          <div className="pv-video-lazy__error">
            <span>{status.message}</span>
            <button type="button" onClick={start}>
              重试
            </button>
          </div>
        )}
        {status.status !== 'loading' && status.status !== 'error' && (
          <button
            type="button"
            className="pv-video-lazy__play"
            onClick={start}
            disabled={!pluginId}
            aria-label="解析播放"
          >
            <PlayIcon size={18} />
            {platform ? `解析播放（${platform}）` : '解析播放'}
          </button>
        )}
      </div>
    </div>
  )
}
