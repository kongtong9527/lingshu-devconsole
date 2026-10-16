import type { ImageEncryption } from '../types.js'

export function getImageEncryption(metadata?: Record<string, any>): ImageEncryption | undefined {
  const value = metadata?.imageEncryption
  if (!value || typeof value !== 'object') return undefined
  const config = value as Partial<ImageEncryption>
  if (typeof config.algorithm !== 'string' || typeof config.key !== 'string' || typeof config.iv !== 'string') return undefined
  return config as ImageEncryption
}
