import { useState } from 'react'
import type { PlayLine, PlayUrlResult, ImageEncryption, ImageTransport } from '../types.js'
import { run as apiRun } from '../api/client.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import VideoPlayer from './VideoPlayer.js'

type PlayStatus =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: PlayUrlResult }

/**
 * 「线路 × 剧集」块：
 * 渲染线路 tab + 剧集网格；点选剧集时懒调 `play` 动作（fetchPlayUrl），
 * 就地渲染播放器（不切换预览、不改全局 selected）。解析结果按播放页 URL
 * 缓存在组件内（详情预览存活期 = 会话级缓存，重新 run detail 即清空）。
 */
export default function EpisodesBlock({
  pluginId,
  lines,
  poster,
  posterEncryption,
  posterTransport,
}: {
  pluginId: string | null
  lines: PlayLine[]
  poster?: string
  posterEncryption?: ImageEncryption
  posterTransport?: ImageTransport
}) {
  const [activeLineIdx, setActiveLineIdx] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, PlayStatus>>({})
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)

  const activeLine = lines[activeLineIdx] ?? lines[0]
  if (!activeLine) return null

  const playing: PlayStatus | undefined =
    (playingUrl && statuses[playingUrl]) || undefined
  const playingTitle =
    playingUrl && activeLine
      ? (activeLine.episodes.find((e) => e.url === playingUrl)?.title ?? playingUrl)
      : ''

  // 条目级 coverUrl（剧集封面）：任一项有图即走横向缩略图行，无图项纯色占位对齐行高；
  // 全块无图回退文字宫格。封面与块级 poster 共用同一传输/加密上下文。

  function playEpisode(url: string) {
    const st = statuses[url]
    if (st?.status === 'loading') return
    if (!pluginId) return
    setPlayingUrl(url)
    if (st?.status === 'done' || st?.status === 'error') return
    setStatuses((s) => ({ ...s, [url]: { status: 'loading' } }))
    apiRun({ pluginId, action: 'play', target: url })
      .then((res) => {
        if (res.ok && res.data && typeof (res.data as PlayUrlResult).url === 'string') {
          setStatuses((s) => ({ ...s, [url]: { status: 'done', result: res.data as PlayUrlResult } }))
        } else {
          setStatuses((s) => ({ ...s, [url]: { status: 'error', message: res.error || '播放地址解析失败' } }))
        }
      })
      .catch((e) => {
        setStatuses((s) => ({ ...s, [url]: { status: 'error', message: String(e) } }))
      })
  }

  return (
    <div className="pv-episodes">
      {/* 线路 tab */}
      {lines.length > 1 && (
        <div className="pv-episodes__lines" role="tablist">
          {lines.map((line, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === activeLineIdx}
              className={`pv-episodes__line${i === activeLineIdx ? ' is-active' : ''}`}
              onClick={() => setActiveLineIdx(i)}
            >
              {line.name}
              <span className="pv-episodes__count">{line.episodes.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* 剧集区：有图走横向缩略图行，无图回退文字宫格 */}
      {activeLine.episodes.some((e) => !!e.coverUrl) ? (
        <div className="pv-episodes__list">
          {activeLine.episodes.map((ep, i) => {
            const st = statuses[ep.url]
            const isPlaying = playingUrl === ep.url && (st?.status === 'done' || st?.status === 'loading')
            return (
              <button
                key={i}
                type="button"
                className={`pv-episodes__row${isPlaying ? ' is-playing' : ''}`}
                title={ep.title}
                onClick={() => playEpisode(ep.url)}
              >
                {ep.coverUrl ? (
                  <LazyImage
                    src={proxyUrl(ep.coverUrl, posterEncryption, posterTransport)}
                    alt={ep.title}
                    className="pv-episodes__thumb"
                  />
                ) : (
                  <span className="pv-episodes__thumb is-empty" aria-hidden="true" />
                )}
                <span className="pv-episodes__rowtitle">{ep.title}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="pv-episodes__grid">
          {activeLine.episodes.map((ep, i) => {
            const st = statuses[ep.url]
            const isPlaying = playingUrl === ep.url && (st?.status === 'done' || st?.status === 'loading')
            return (
              <button
                key={i}
                type="button"
                className={`pv-episodes__ep${isPlaying ? ' is-playing' : ''}`}
                title={ep.title}
                onClick={() => playEpisode(ep.url)}
              >
                {ep.title}
              </button>
            )
          })}
        </div>
      )}

      {/* 播放器区（就地播放） */}
      <div className="pv-episodes__player">
        {playing?.status === 'loading' && (
          <div className="pv-episodes__hint">正在解析播放地址…</div>
        )}
        {playing?.status === 'error' && (
          <div className="pv-episodes__error">
            <span>{playing.message}</span>
            <button type="button" onClick={() => playEpisode(playingUrl!)}>重试</button>
          </div>
        )}
        {playing?.status === 'done' && (
          <VideoPlayer
            src={playing.result.url}
            poster={playing.result.poster || poster}
            encryption={posterEncryption}
            imageTransport={posterTransport}
            referer={playing.result.referer}
            qualities={playing.result.qualities}
          />
        )}
        {!playingUrl && <div className="pv-episodes__hint">选择剧集开始播放{playingTitle && `（当前：${playingTitle}）`}</div>}
        {playingTitle && playing?.status === 'done' && (
          <div className="pv-episodes__nowplaying">正在播放：{playingTitle}</div>
        )}
      </div>
    </div>
  )
}