import type { ImageEncryption, ImageTransport } from '../types.js'

export function proxyUrl(remote: string, decrypt?: ImageEncryption, transport?: ImageTransport, referer?: string): string {
  if (!remote) return remote
  const suffix = [
    decrypt ? `&decrypt=${encodeURIComponent(JSON.stringify(decrypt))}` : '',
    transport?.encoding ? `&transport=${encodeURIComponent(transport.encoding)}` : '',
    referer ? `&referer=${encodeURIComponent(referer)}` : '',
  ].join('')
  return `/api/proxy?url=${encodeURIComponent(remote)}${suffix}`
}
