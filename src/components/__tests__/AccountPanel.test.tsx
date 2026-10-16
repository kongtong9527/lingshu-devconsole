import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../../store.js'
import { run as apiRun } from '../../api/client.js'
import AccountPanel from '../AccountPanel.js'
import type { PluginInfo } from '../../types.js'
import { caps } from '../../__tests__/fixtures.js'

vi.mock('../../api/client.js', () => ({
  getPlugins: vi.fn(),
  run: vi.fn(),
}))

const plugin: PluginInfo = {
  id: 'manga_site_b',
  name: 'manga_site_b',
  version: '1.0.0',
  author: 'lingshu',
  sourceUrl: 'https://www.manga_site_b.org',
  capabilities: caps({ list: true, detail: true, account: true }),
  accountSchema: {
    loginFields: [{ name: 'username', label: '账号', type: 'text', required: true }],
  },
}

function reset() {
  useStore.setState({
    plugins: [plugin],
    selected: {
      pluginId: 'manga_site_b',
      action: 'categories',
      target: '',
      page: '1',
      category: '',
      url: '',
      fixture: '',
    },
    result: null,
    history: [],
    view: 'account',
    loading: false,
    listItems: [],
    listPagination: undefined,
    loadingMore: false,
  })
  localStorage.clear()
  vi.mocked(apiRun).mockReset()
}

describe('AccountPanel 登录态', () => {
  beforeEach(reset)

  it('登录成功后显示账号信息并持久化，重新打开仍可见', async () => {
    vi.mocked(apiRun).mockResolvedValueOnce({
      ok: true,
      data: { uid: '42', username: 'alice', message: '登录成功' },
      durationMs: 1,
    })

    const { unmount } = render(<AccountPanel />)
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('已登录：alice')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('devconsole-account:manga_site_b')!)).toEqual({
      uid: '42',
      username: 'alice',
      message: '登录成功',
    })

    unmount()
    render(<AccountPanel />)
    expect(screen.getByText('已登录：alice')).toBeTruthy()
  })

  it('退出登录清除本地账号信息并回到登录表单', () => {
    localStorage.setItem(
      'devconsole-account:manga_site_b',
      JSON.stringify({ uid: '42', username: 'alice', message: '登录成功' }),
    )

    render(<AccountPanel />)
    expect(screen.getByText('已登录：alice')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    expect(localStorage.getItem('devconsole-account:manga_site_b')).toBeNull()
    expect(screen.queryByText(/已登录/)).toBeNull()
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
  })
})
