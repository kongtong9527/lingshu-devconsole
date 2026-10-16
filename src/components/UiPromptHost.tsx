import { useEffect, useState, useRef } from 'react'
import { openUiStream, respondUi } from '../api/client.js'
import type { UiPrompt, UiButton } from '../types.js'

/**
 * $lib.ui 的前端宿主（ADR-0006）：监听 SSE 流，把插件中途发起的「直问用户」渲染成
 * 输入框/确认框/toast。input/confirm 收齐答案后 POST /api/ui/respond 回传，解封插件 await。
 * 挂载一次（App.tsx），全生命周期复用一条 EventSource。
 */

interface ActivePrompt {
  promptId: string
  prompt: UiPrompt
}
interface Toast {
  id: number
  text: string
}

type InputPrompt = Extract<UiPrompt, { kind: 'input' }>
type ConfirmPrompt = Extract<UiPrompt, { kind: 'confirm' }>

function normalizeImage(image?: string): string | undefined {
  if (!image) return undefined
  return image.startsWith('data:') ? image : `data:image/png;base64,${image}`
}

export default function UiPromptHost() {
  const [active, setActive] = useState<ActivePrompt | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  function pushToast(text: string) {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = openUiStream((promptId, prompt) => {
      if (prompt.kind === 'message') {
        pushToast(prompt.text)
        return
      }
      if (prompt.kind === 'launchUrl') {
        try {
          window.open(prompt.url, '_blank', 'noopener,noreferrer')
        } catch {
          /* 弹窗被拦 */
        }
        pushToast(`已打开外链：${prompt.url}`)
        return
      }
      // input / confirm：弹模态（一次处理一个；dev 场景顺序触发，后到的覆盖）
      setActive({ promptId, prompt })
    })
    return () => es.close()
  }, [])

  async function answer(response: string | undefined) {
    if (!active) return
    const pid = active.promptId
    setActive(null)
    await respondUi(pid, response)
  }

  return (
    <>
      {active?.prompt.kind === 'input' && (
        <InputDialog prompt={active.prompt} onSubmit={(v) => answer(v)} onCancel={() => answer('')} />
      )}
      {active?.prompt.kind === 'confirm' && (
        <ConfirmDialog prompt={active.prompt} onPick={(v) => answer(v)} />
      )}
      <div className="dc-ui-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="dc-ui-toast">{t.text}</div>
        ))}
      </div>
    </>
  )
}

function InputDialog({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: InputPrompt
  onSubmit: (v: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const img = normalizeImage(prompt.image)
  return (
    <div className="dc-ui-overlay" role="dialog" aria-modal="true" aria-label={prompt.title}>
      <div className="dc-ui-dialog">
        <div className="dc-ui-dialog__title">{prompt.title}</div>
        {prompt.message && <div className="dc-ui-dialog__msg">{prompt.message}</div>}
        {img && <img className="dc-ui-dialog__img" src={img} alt="" />}
        <input
          className="dc-input dc-input--mono"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={prompt.placeholder ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(value)
            if (e.key === 'Escape') onCancel()
          }}
          style={{ width: '100%' }}
        />
        <div className="dc-ui-dialog__actions">
          <button type="button" className="dc-btn dc-btn--xs" onClick={onCancel}>取消</button>
          <button type="button" className="dc-btn dc-btn--primary dc-btn--xs" onClick={() => onSubmit(value)}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDialog({
  prompt,
  onPick,
}: {
  prompt: ConfirmPrompt
  onPick: (v: string) => void
}) {
  return (
    <div className="dc-ui-overlay" role="dialog" aria-modal="true" aria-label={prompt.title}>
      <div className="dc-ui-dialog">
        <div className="dc-ui-dialog__title">{prompt.title}</div>
        <div className="dc-ui-dialog__msg">{prompt.message}</div>
        <div className="dc-ui-dialog__actions">
          {prompt.buttons.map((b: UiButton, i: number) => (
            <button
              key={i}
              type="button"
              className={`dc-btn dc-btn--xs ${i === prompt.buttons.length - 1 ? 'dc-btn--primary' : ''}`}
              onClick={() => onPick(b.value ?? b.text)}
            >
              {b.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
