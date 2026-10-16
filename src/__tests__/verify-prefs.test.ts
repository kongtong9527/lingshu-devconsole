import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadAutoVerify,
  loadBrowserPref,
  saveAutoVerify,
  saveBrowserPref,
} from '../verify-prefs.js'

beforeEach(() => {
  localStorage.clear()
})

describe('verify-prefs（ADR-0047 按插件偏好）', () => {
  it('自动开关缺省关，按插件隔离', () => {
    expect(loadAutoVerify('anime_site_a')).toBe(false)
    saveAutoVerify('anime_site_a', true)
    expect(loadAutoVerify('anime_site_a')).toBe(true)
    expect(loadAutoVerify('other')).toBe(false)
    saveAutoVerify('anime_site_a', false)
    expect(loadAutoVerify('anime_site_a')).toBe(false)
  })

  it('通道偏好缺省 persistent，只认 ephemeral', () => {
    expect(loadBrowserPref('anime_site_a')).toBe('persistent')
    saveBrowserPref('anime_site_a', 'ephemeral')
    expect(loadBrowserPref('anime_site_a')).toBe('ephemeral')
    expect(loadBrowserPref('other')).toBe('persistent')
    // 脏数据回 persistent（零回退）
    localStorage.setItem('devconsole-browser-pref:anime_site_a', 'incognito')
    expect(loadBrowserPref('anime_site_a')).toBe('persistent')
  })
})
