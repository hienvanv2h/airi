import { describe, expect, it } from 'vitest'

import { DEFAULT_FIDGET_INTERVAL, parseAnimationMetadata } from './animation-metadata'

describe('parseAnimationMetadata', () => {
  it('reads clips and keeps only group names that name a clip', () => {
    const metadata = parseAnimationMetadata({
      airi: {
        animations: {
          version: 1,
          clips: {
            breathing: { bufferView: 10, loop: true },
            look: { bufferView: 11 },
            thinking: { bufferView: 12, loop: true },
          },
          idle: { base: ['breathing', 'missing'], fidgets: ['look', 3], interval: [4, 9] },
          think: ['thinking'],
          emotions: { happy: ['look', 'missing'], sad: ['missing'], angry: 'x' },
        },
      },
    })

    expect(metadata).toEqual({
      clips: {
        breathing: { bufferView: 10, loop: true },
        look: { bufferView: 11, loop: false },
        thinking: { bufferView: 12, loop: true },
      },
      idle: { base: ['breathing'], fidgets: ['look'], interval: [4, 9] },
      think: ['thinking'],
      emotions: { happy: ['look'] },
    })
  })

  it('skips malformed clips and falls back to the default interval', () => {
    const metadata = parseAnimationMetadata({
      airi: {
        animations: {
          version: 1,
          clips: { good: { bufferView: 0 }, bad: { bufferView: -1 }, worse: 'x' },
          idle: { base: ['good'], interval: [9, 2] },
        },
      },
    })

    expect(metadata?.clips).toEqual({ good: { bufferView: 0, loop: false } })
    expect(metadata?.idle.interval).toEqual(DEFAULT_FIDGET_INTERVAL)
    expect(metadata?.think).toEqual([])
  })

  it('returns undefined without usable metadata', () => {
    expect(parseAnimationMetadata(undefined)).toBeUndefined()
    expect(parseAnimationMetadata({ airi: { expressions: {} } })).toBeUndefined()
    expect(parseAnimationMetadata({ airi: { animations: { version: 2, clips: { a: { bufferView: 0 } } } } })).toBeUndefined()
    expect(parseAnimationMetadata({ airi: { animations: { version: 1, clips: {} } } })).toBeUndefined()
  })
})
