import { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { openVerifyWindow } from '../api/client.js'
import { loadAutoVerify, loadBrowserPref, saveAutoVerify, saveBrowserPref } from '../verify-prefs.js'
import { rearmAuto, useAutoVerify } from './useAutoVerify.js'
import type { RunResponse } from '../types.js'
import { AlertIcon } from '../icons.js'

/** 从文案中回退提取首个 https URL（对齐 iOS jsChallengeError：url 缺失时的人话兜底） */
function extractUrl(result: RunResponse): string | undefined {
  if (result.url) return result.url
  const m = (result.error ?? '').match(/https?:\/\/[^\s)）]+/)
  return m ? m[0] : undefined
}

/** 是否挑战态：结构化 code 优先，文案命中为兜底（老插件只抛裸文案时仍可切验证态） */
export function isChallengeResult(result: RunResponse): boolean {
  if (result.ok) return false
  if (result.code === 'CHALLENGE') return true
  return /cloudflare|挑战|challenge|just a moment|attention required/i.test(result.error ?? '')
}

/**
 * 挑战态错误块（对齐 iOS ErrorStateView 挑战态；加一次性）。
 * 被动触发 + 手动确认：三个按钮均由用户显式点击，不自动弹验证窗口、
 * 不自动检测通过（防误伤与烧 session 声誉）；取消/失败语义不变。
 * 一次性联动（Q9）：点「一次性窗口打开」= 本轮验证窗 ephemeral + 下一次重试抓取
 * 也 ephemeral（经 store.browserMode 一次消费，不记忆）；ephemeral 验证不保留状态。
 */
export default function ChallengeError({ result }: { result: RunResponse }) {
  const run = useStore((s) => s.run)
  const loading = useStore((s) => s.loading)
  const browserMode = useStore((s) => s.browserMode)
  const setBrowserMode = useStore((s) => s.setBrowserMode)
  const pluginId = useStore((s) => s.selected.pluginId)
  const [opening, setOpening] = useState(false)
  const [openingEphemeral, setOpeningEphemeral] = useState(false)
  const [opened, setOpened] = useState(false)
  const [openedEphemeral, setOpenedEphemeral] = useState(false)
  const [openError, setOpenError] = useState<string | undefined>()
  // 自动验证开关：按插件记忆，缺省关
  const [autoOn, setAutoOn] = useState(() => (pluginId ? loadAutoVerify(pluginId) : false))
  useEffect(() => {
    setAutoOn(pluginId ? loadAutoVerify(pluginId) : false)
  }, [pluginId])

  const challengeUrl = extractUrl(result)
  const { auto, cancelAuto } = useAutoVerify({
    enabled: autoOn,
    pluginId,
    challengeUrl,
    resultCode: result.code,
    resultOk: result.ok,
    result,
  })
  const autoBusy = auto.phase !== 'idle'

  const toggleAuto = (on: boolean) => {
    if (pluginId) saveAutoVerify(pluginId, on)
    if (!on) {
      cancelAuto()
    } else if (pluginId && challengeUrl) {
      // 亲手重开 = 明确要再来一次：清掉当前结果的去重标记（否则换对象/旧 episode 挡住）
      rearmAuto(result, pluginId, challengeUrl)
    }
    setAutoOn(on)
  }

  const openWindow = async () => {
    if (!challengeUrl || opening || openingEphemeral) return
    setOpening(true)
    setOpenError(undefined)
    // 持久验证：显式回 persistent（洗掉之前可能武装的一次性，不记忆）
    setBrowserMode('persistent')
    if (pluginId) saveBrowserPref(pluginId, 'persistent')
    try {
      const r = await openVerifyWindow(challengeUrl)
      if (r.ok) {
        setOpened(true)
      } else {
        setOpenError(r.error ?? '打开验证窗口失败')
      }
    } catch (e) {
      setOpenError(String(e))
    } finally {
      setOpening(false)
    }
  }

  const openEphemeralWindow = async () => {
    if (!challengeUrl || opening || openingEphemeral) return
    setOpeningEphemeral(true)
    setOpenError(undefined)
    // 联动武装：下一次重试抓取同样走 ephemeral（run() 一次消费后自动回 persistent）
    setBrowserMode('ephemeral')
    if (pluginId) saveBrowserPref(pluginId, 'ephemeral')
    try {
      const r = await openVerifyWindow(challengeUrl, { mode: 'ephemeral' })
      if (r.ok) {
        setOpenedEphemeral(true)
      } else {
        setOpenError(r.error ?? '打开一次性窗口失败')
        // 开窗失败即解除武装，避免下一次重试误走一次性
        setBrowserMode('persistent')
      }
    } catch (e) {
      setOpenError(String(e))
      setBrowserMode('persistent')
    } finally {
      setOpeningEphemeral(false)
    }
  }

  return (
    <div className="dc-error">
      <div className="dc-error__title">
        <AlertIcon size={16} />
        需要验证后访问
      </div>
      {result.error && <div className="dc-error__msg">{result.error}</div>}
      <div className="dc-error__msg" style={{ opacity: 0.85 }}>
        目标站开启了 Cloudflare 验证，Node 直连无法通过。请在验证窗口内完成人机验证，
        再点「重试」（验证状态保留在浏览器 profile 中，无需每次都验证）。
        按窗口计数烧声誉的站点（如 anime_site_a 同一窗口第二次必 403）请用「一次性窗口打开」，
        重试将直接读该窗口已加载的内容（不再发新请求）、随后即焚（验证状态只传给这一次，不保留）。
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="dc-btn dc-btn--primary"
          onClick={openWindow}
          disabled={loading || autoBusy || opening || openingEphemeral || !challengeUrl}
          title={challengeUrl ?? '无挑战页地址'}
        >
          {opening ? '正在打开…' : '打开验证窗口'}
        </button>
        <button
          type="button"
          className="dc-btn dc-btn--ghost"
          onClick={openEphemeralWindow}
          disabled={loading || autoBusy || opening || openingEphemeral || !challengeUrl}
          title="开全新即焚窗口（不保留验证状态），重试直接读该窗口内容"
        >
          {openingEphemeral ? '正在打开…' : '一次性窗口打开'}
        </button>
        <button
          type="button"
          className="dc-btn dc-btn--ghost"
          onClick={() => challengeUrl && window.open(challengeUrl, '_blank', 'noopener')}
          disabled={loading || !challengeUrl}
          title="在系统浏览器中打开源页面（兜底）"
        >
          在浏览器打开
        </button>
        <button type="button" className="dc-btn dc-btn--ghost" onClick={run} disabled={loading || autoBusy}>
          重试
        </button>
      </div>
      <label style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start', cursor: 'pointer', opacity: 0.9 }}>
        <input
          type="checkbox"
          checked={autoOn}
          onChange={(e) => toggleAuto(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span className="dc-error__msg" style={{ opacity: 0.85 }}>
          自动处理验证（记住此插件）：下次 CHALLENGE 即按
          {pluginId && loadBrowserPref(pluginId) === 'ephemeral' ? '「一次性」' : '「持久」'}
          自动开窗，通过后自动重试一轮（仍失败就停，不循环）。窗内那一下验证还得你亲手点。
        </span>
      </label>
      {autoBusy && (
        <div className="dc-error__msg" style={{ opacity: 0.85 }}>
          {auto.note ?? '自动处理中…'}
          <button
            type="button"
            className="dc-btn dc-btn--ghost"
            onClick={cancelAuto}
            disabled={loading && auto.phase === 'retrying'}
            style={{ marginLeft: 8 }}
          >
            取消自动
          </button>
        </div>
      )}
      {!autoBusy && auto.note && <div className="dc-error__msg">自动已停：{auto.note}</div>}
      {opened && (
        <div className="dc-error__msg" style={{ opacity: 0.85 }}>
          验证窗口已打开：请在窗口内完成验证后，回到这里点「重试」。
        </div>
      )}
      {openedEphemeral && (
        <div className="dc-error__msg" style={{ opacity: 0.85 }}>
          一次性窗口已打开：请在窗口内确认后回到这里点「重试」（直接读该窗口内容，不再发请求；验证没过则窗口保留）。
        </div>
      )}
      {browserMode === 'ephemeral' && !openedEphemeral && (
        <div className="dc-error__msg" style={{ opacity: 0.85 }}>
          已武装一次性：下一次「重试」将走一次性窗口（阅后即焚）。点「打开验证窗口」可切回持久。
        </div>
      )}
      {openError && <div className="dc-error__msg">打开验证窗口失败：{openError}</div>}
      {result.stack && <pre className="dc-error__stack">{result.stack}</pre>}
    </div>
  )
}
