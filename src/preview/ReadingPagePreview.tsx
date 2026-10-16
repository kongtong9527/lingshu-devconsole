import type { ReadingPage, ImageTransport } from '../types.js'
import { proxyUrl } from '../api/proxy.js'
import LazyImage from './LazyImage.js'
import BlockRenderer from './BlockRenderer.js'
import { getImageEncryption } from './imageEncryption.js'
import { ArrowLeftIcon, ArrowRightIcon } from '../icons.js'

export default function ReadingPagePreview({
  data,
  onPrev,
  onNext,
}: {
  data: ReadingPage
  onPrev?: () => void
  onNext?: () => void
}) {
  const imageEncryption = getImageEncryption(data.metadata)
  const imageTransport = data.metadata?.imageTransport as ImageTransport | undefined
  // ADR-0026：content 优先（章节内容，图文任意混排）；缺则回退 pages 逐张转 image 块
  const hasContent = !!data.content?.length

  return (
    <div className="dc-preview-wrap">
      <div className="pv-reading">
        <div className="pv-reading__head">
          <h2 className="pv-reading__title">{data.title}</h2>
          {data.sourceName && <div className="pv-reading__source">{data.sourceName}</div>}
        </div>

        {hasContent ? (
          <div className="pv-reading__content">
            {data.content!.map((block, i) => (
              <BlockRenderer
                key={i}
                block={block}
                onJumpJson={() => {}}
                imageEncryption={imageEncryption}
                imageTransport={imageTransport}
              />
            ))}
          </div>
        ) : (
          <div className="pv-reading__pages">
            {data.pages?.map((url, i) => (
              <div key={i} className="pv-reading__page">
                <LazyImage
                  src={proxyUrl(url, undefined, imageTransport)}
                  alt={`page ${i + 1}`}
                />
                <span className="pv-reading__page-badge">image</span>
              </div>
            ))}
          </div>
        )}

        <div className="pv-reading__nav">
          <button
            type="button"
            className="pv-reading__nav--prev"
            onClick={onPrev}
            disabled={!data.prevUrl}
          >
            <ArrowLeftIcon size={12} /> 上一话
          </button>
          <button
            type="button"
            className="pv-reading__nav--next"
            onClick={onNext}
            disabled={!data.nextUrl}
          >
            下一话 <ArrowRightIcon size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
