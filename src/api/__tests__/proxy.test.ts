import { describe, it, expect } from 'vitest'
import { proxyUrl } from '../proxy.js'

describe('proxyUrl', () => {
  it('把远程 URL 编码为代理端点', () => {
    const remote = 'https://a.com/b c.png?x=1&y=2'
    expect(proxyUrl(remote)).toBe('/api/proxy?url=' + encodeURIComponent(remote))
  })

  it('空串原样返回', () => {
    expect(proxyUrl('')).toBe('')
  })

  it('把图片解密元数据一并传给代理端点', () => {
    const remote = 'https://pic.example/image.jpeg'
    const decrypt = {
      algorithm: 'AES-128-CBC',
      padding: 'Pkcs7',
      encoding: 'Base64 ciphertext',
      key: 'f5d965df75336270',
      iv: '97b60394abc2fbe1',
    }
    expect(proxyUrl(remote, decrypt)).toBe(
      '/api/proxy?url=' + encodeURIComponent(remote) + '&decrypt=' + encodeURIComponent(JSON.stringify(decrypt)),
    )
  })

  it('把图片传输元数据编码传给代理端点', () => {
    const remote = 'https://pic.example/image.jpg'
    expect(proxyUrl(remote, undefined, { encoding: 'base64-text' })).toBe(
      '/api/proxy?url=' + encodeURIComponent(remote) + '&transport=base64-text',
    )
  })
})
