import { useEffect, useRef, useState, type CSSProperties } from 'react'

export default function LazyImage({
  src,
  alt,
  style,
  className,
}: {
  src: string
  alt: string
  style?: CSSProperties
  className?: string
}) {
  const ref = useRef<HTMLImageElement>(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const handleReload = () => {
    setError(false)
    setLoaded(false)
    setReloadKey((k) => k + 1)
  }

  const showSkeleton = visible && !loaded && !error
  const imageClassName = [className, showSkeleton && 'dc-image-skeleton']
    .filter(Boolean)
    .join(' ')

  if (error) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
      >
        <button type="button" onClick={handleReload}>
          重新加载
        </button>
      </div>
    )
  }

  return (
    <img
      ref={ref}
      key={reloadKey}
      src={visible ? src : undefined}
      alt={alt}
      loading="lazy"
      className={imageClassName || undefined}
      style={style}
      onError={() => setError(true)}
      onLoad={() => setLoaded(true)}
    />
  )
}
