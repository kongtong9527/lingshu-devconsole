import { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { run as apiRun } from '../api/client.js'
import { clearPluginAccount, loadPluginAccount, savePluginAccount } from '../accounts.js'
import type { AccountField, AccountLoginResult } from '../types.js'
import { UserIcon, CheckIcon, AlertIcon } from '../icons.js'

interface LoginFeedback {
  loading: boolean
  result?: AccountLoginResult
  error?: string
}

export default function AccountPanel() {
  const plugins = useStore((s) => s.plugins)
  const pluginId = useStore((s) => s.selected.pluginId)
  const plugin = plugins.find((p) => p.id === pluginId)
  const schema = plugin?.accountSchema
  const fields = schema?.loginFields ?? []

  const [values, setValues] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<LoginFeedback>(() => ({
    loading: false,
    result: pluginId ? (loadPluginAccount(pluginId) ?? undefined) : undefined,
  }))

  // 切换插件时重载该插件已保存的登录态
  useEffect(() => {
    setValues({})
    setFeedback({
      loading: false,
      result: pluginId ? (loadPluginAccount(pluginId) ?? undefined) : undefined,
    })
  }, [pluginId])

  if (!pluginId || !schema || fields.length === 0) {
    return (
      <div style={{ padding: 'var(--dc-space-6)' }}>
        <div className="dc-empty">
          <UserIcon size={28} className="dc-empty__icon" />
          <div className="dc-empty__title">无登录项</div>
          <div className="dc-empty__hint">该插件未声明 getAccountSchema（或无 loginFields）</div>
        </div>
      </div>
    )
  }

  function setValue(field: AccountField, value: string) {
    setValues((s) => ({ ...s, [field.name]: value }))
  }

  async function submit() {
    if (!pluginId) return
    setFeedback({ loading: true })
    try {
      const res = await apiRun({
        pluginId,
        action: 'login',
        options: { inputs: values },
      })
      if (res.ok) {
        const result = (res.data ?? {}) as AccountLoginResult
        savePluginAccount(pluginId, result)
        setFeedback({ loading: false, result })
      } else {
        setFeedback({ loading: false, error: res.error ?? '登录失败' })
      }
    } catch (e) {
      setFeedback({ loading: false, error: String(e) })
    }
  }

  const missing = fields.some((f) => f.required !== false && !values[f.name])
  const accountName = feedback.result?.username || feedback.result?.uid

  return (
    <div style={{ padding: 'var(--dc-space-6)', maxWidth: 560 }}>
      <div className="dc-section-label">
        <UserIcon size={14} />
        <span>{plugin?.name ?? pluginId} 登录</span>
      </div>

      {feedback.result && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--dc-space-2)',
            marginTop: 'var(--dc-space-4)',
          }}
        >
          <span className="dc-status-dot dc-status-dot--ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CheckIcon size={12} />
            {accountName ? `已登录：${accountName}` : (feedback.result.message ?? '已登录')}
          </span>
          <button
            type="button"
            className="dc-btn dc-btn--ghost dc-btn--xs"
            onClick={() => {
              if (!pluginId) return
              clearPluginAccount(pluginId)
              setValues({})
              setFeedback({ loading: false })
            }}
            disabled={feedback.loading}
            aria-label="退出登录"
          >
            退出登录
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dc-space-4)', marginTop: 'var(--dc-space-4)' }}>
        {fields.map((field) => (
          <div className="dc-field" key={field.name}>
            <span className="dc-field__label">
              {field.label}
              {field.required !== false && <span style={{ color: 'var(--dc-color-danger)' }}>*</span>}
            </span>
            <input
              className="dc-input dc-input--mono"
              type={field.type === 'password' ? 'password' : 'text'}
              value={values[field.name] ?? ''}
              onChange={(e) => setValue(field, e.target.value)}
              placeholder={field.placeholder ?? ''}
              aria-label={field.label}
              style={{ width: '100%' }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dc-space-2)' }}>
          <button
            type="button"
            className="dc-btn dc-btn--primary dc-btn--xs"
            onClick={submit}
            disabled={feedback.loading || missing}
            aria-label="登录"
          >
            {feedback.loading ? <span className="dc-spinner" aria-hidden /> : null}
            登录
          </button>
          {feedback.error && (
            <span className="dc-status-dot dc-status-dot--error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertIcon size={12} />
              {feedback.error}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
