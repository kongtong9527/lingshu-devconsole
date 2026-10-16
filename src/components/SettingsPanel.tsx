import { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { run as apiRun } from '../api/client.js'
import { loadPluginSettings, updatePluginSetting, type SettingValue } from '../settings.js'
import type { SettingField } from '../types.js'
import { SettingsIcon, CheckIcon, AlertIcon } from '../icons.js'

/** 单个 action 按钮的运行反馈 */
interface ActionFeedback {
  loading: boolean
  message?: string
  error?: string
}

export default function SettingsPanel() {
  const plugins = useStore((s) => s.plugins)
  const pluginId = useStore((s) => s.selected.pluginId)
  const plugin = plugins.find((p) => p.id === pluginId)
  const schema = plugin?.settingsSchema

  const [values, setValues] = useState<Record<string, SettingValue>>({})
  const [feedback, setFeedback] = useState<Record<string, ActionFeedback>>({})

  // 切换插件时重载该插件的设置值
  useEffect(() => {
    setValues(pluginId ? loadPluginSettings(pluginId) : {})
    setFeedback({})
  }, [pluginId])

  if (!pluginId || !schema || schema.length === 0) {
    return (
      <div style={{ padding: 'var(--dc-space-6)' }}>
        <div className="dc-empty">
          <SettingsIcon size={28} className="dc-empty__icon" />
          <div className="dc-empty__title">无设置项</div>
          <div className="dc-empty__hint">该插件未声明 getSettingsSchema</div>
        </div>
      </div>
    )
  }

  function setField(field: SettingField, value: SettingValue) {
    if (!pluginId) return
    const next = { ...values, [field.key]: value }
    setValues(next)
    updatePluginSetting(pluginId, field.key, value)
  }

  async function runAction(field: Extract<SettingField, { type: 'action' }>) {
    if (!pluginId) return
    setFeedback((s) => ({ ...s, [field.key]: { loading: true } }))
    try {
      const res = await apiRun({
        pluginId,
        action: 'setting-action',
        target: field.key,
        options: { settings: values },
      })
      if (res.ok) {
        // runSettingAction 返回 { message?: string } | void；message 缺失给个默认成功提示
        const msg = readMessage(res.data) ?? '已完成'
        setFeedback((s) => ({ ...s, [field.key]: { loading: false, message: msg } }))
      } else {
        setFeedback((s) => ({
          ...s,
          [field.key]: { loading: false, error: res.error ?? '运行失败' },
        }))
      }
    } catch (e) {
      setFeedback((s) => ({
        ...s,
        [field.key]: { loading: false, error: String(e) },
      }))
    }
  }

  return (
    <div style={{ padding: 'var(--dc-space-6)', maxWidth: 560 }}>
      <div className="dc-section-label">
        <SettingsIcon size={14} />
        <span>{plugin?.name ?? pluginId} 设置</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dc-space-4)', marginTop: 'var(--dc-space-4)' }}>
        {schema.map((field) => (
          <SettingsField
            key={field.key}
            field={field}
            value={values[field.key]}
            feedback={feedback[field.key]}
            onChange={(v) => setField(field, v)}
            onAction={() => runAction(field as Extract<SettingField, { type: 'action' }>)}
          />
        ))}
      </div>
    </div>
  )
}

/** 从 RunResponse.data（runSettingAction 的返回）里取 message */
function readMessage(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message
    return typeof m === 'string' ? m : undefined
  }
  return undefined
}

function SettingsField({
  field,
  value,
  feedback,
  onChange,
  onAction,
}: {
  field: SettingField
  value: SettingValue | undefined
  feedback?: ActionFeedback
  onChange: (v: SettingValue) => void
  onAction: () => void
}) {
  if (field.type === 'action') {
    return (
      <div className="dc-field">
        <span className="dc-field__label">{field.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dc-space-2)' }}>
          <button
            type="button"
            className="dc-btn dc-btn--primary dc-btn--xs"
            onClick={onAction}
            disabled={feedback?.loading}
            aria-label={field.label}
          >
            {feedback?.loading ? <span className="dc-spinner" aria-hidden /> : null}
            {field.buttonText}
          </button>
          {feedback?.message && (
            <span className="dc-status-dot dc-status-dot--ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckIcon size={12} />
              {feedback.message}
            </span>
          )}
          {feedback?.error && (
            <span className="dc-status-dot dc-status-dot--error" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertIcon size={12} />
              {feedback.error}
            </span>
          )}
        </div>
      </div>
    )
  }

  if (field.type === 'switch') {
    const checked = value === true
    return (
      <div className="dc-field">
        <span className="dc-field__label">{field.label}</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--dc-space-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-label={field.label}
          />
          <span style={{ color: 'var(--dc-color-text-muted)' }}>{checked ? '开' : '关'}</span>
        </label>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="dc-field">
        <span className="dc-field__label">{field.label}</span>
        <select
          className="dc-input"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
          style={{ width: 'auto', minWidth: 160 }}
        >
          <option value="" disabled>
            请选择…
          </option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // text
  return (
    <div className="dc-field">
      <span className="dc-field__label">{field.label}</span>
      <input
        className="dc-input dc-input--mono"
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.default ?? ''}
        aria-label={field.label}
        style={{ width: '100%' }}
      />
    </div>
  )
}
