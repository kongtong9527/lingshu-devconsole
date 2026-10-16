import { useState } from 'react'
import type { HttpRecord } from '../types.js'
import { useStore } from '../store.js'
import { ChevronRightIcon, CopyIcon, CheckIcon, InboxIcon } from '../icons.js'

function methodClass(method: string): string {
  const m = method.toUpperCase()
  if (m === 'GET') return 'dc-method dc-method--get'
  if (m === 'POST') return 'dc-method dc-method--post'
  return 'dc-method dc-method--other'
}

function statusClass(status: number): string {
  if (status === 0) return 'dc-status-code dc-status-code--fail'
  if (status < 300) return 'dc-status-code dc-status-code--ok'
  if (status < 400) return 'dc-status-code dc-status-code--redirect'
  if (status < 500) return 'dc-status-code dc-status-code--client-error'
  return 'dc-status-code dc-status-code--server-error'
}

function Headers({ title, headers }: { title: string; headers: Record<string, string> }) {
  const entries = Object.entries(headers)
  if (entries.length === 0) return null
  return (
    <div className="dc-subsection">
      <div className="dc-subsection__title">{title}</div>
      <table className="dc-kv-table">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td className="dc-kv-table__key">{k}</td>
              <td className="dc-kv-table__val">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Body({ title, body }: { title: string; body?: string }) {
  if (body === undefined || body === '') return null
  return (
    <div className="dc-subsection">
      <div className="dc-subsection__title">{title}</div>
      <pre className="dc-pre">{body}</pre>
    </div>
  )
}

export default function RequestList() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const records = useStore((s) => s.result?.httpLog ?? [])

  if (records.length === 0) {
    return (
      <div className="dc-empty">
        <InboxIcon size={28} className="dc-empty__icon" />
        <div className="dc-empty__hint">本次运行没有捕获到 HTTP 请求</div>
      </div>
    )
  }

  const copy = async (idx: number, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  }

  return (
    <div className="dc-request-list">
      {records.map((r, i) => (
        <details key={i} open={records.length === 1} className="dc-request">
          <summary className="dc-request__summary">
            <ChevronRightIcon size={14} className="dc-request__chevron" />
            <span className={methodClass(r.method)}>{r.method}</span>
            <span className="dc-request__url" title={r.url}>
              {r.url}
            </span>
            <span className="dc-request__meta">
              {r.fixture && (
                <span className="dc-tag dc-tag--fixture" title="fixture 模式命中本地快照">
                  fixture
                </span>
              )}
              <span className={statusClass(r.status)}>{r.status === 0 ? '失败' : r.status}</span>
              <span className="dc-duration">{r.durationMs}ms</span>
            </span>
          </summary>

          <div className="dc-request__body">
            <div className="dc-subsection">
              <div className="dc-subsection__head">
                <span className="dc-subsection__title">完整 URL</span>
                <button
                  type="button"
                  className="dc-btn dc-btn--ghost dc-btn--xs"
                  onClick={() => copy(i, r.url)}
                  aria-label="复制完整 URL"
                >
                  {copiedIdx === i ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copiedIdx === i ? '已复制' : '复制'}
                </button>
              </div>
              <pre className="dc-pre">{r.url}</pre>
            </div>

            <Headers title="请求头" headers={r.requestHeaders} />
            <Body title="请求体" body={r.requestBody} />
            <Headers title="响应头" headers={r.responseHeaders} />
            <Body title="响应体" body={r.responseBody} />

            {r.error && <div className="dc-inline-error">{r.error}</div>}
          </div>
        </details>
      ))}
    </div>
  )
}
