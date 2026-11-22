import { describe, expect, it } from 'vitest'

import { parseExpressionMetadata } from './expression-metadata'

describe('parseExpressionMetadata', () => {
  it('reads emotions and gaze from gltf.userData.airi.expressions', () => {
    const userData = {
      vrm: {},
      airi: { expressions: {
        version: 1,
        emotions: { happy: ['happy', 'laugh'], think: ['think', 'think_b'] },
        gaze: { think_b: [60, -35] },
      } },
    }

    expect(parseExpressionMetadata(userData)).toEqual({
      emotions: { happy: ['happy', 'laugh'], think: ['think', 'think_b'] },
      gaze: { think_b: [60, -35] },
    })
  })

  it('returns nothing for models without it or with another version', () => {
    expect(parseExpressionMetadata({ vrm: {} })).toBeUndefined()
    expect(parseExpressionMetadata(undefined)).toBeUndefined()
    expect(parseExpressionMetadata({ airi: { expressions: { version: 2, emotions: { happy: ['laugh'] } } } })).toBeUndefined()
  })

  it('skips malformed entries', () => {
    const userData = {
      airi: { expressions: {
        version: 1,
        emotions: { happy: ['laugh', 3, ''], sad: 'sigh', angry: [] },
        gaze: { laugh: [10], smug: [5, 'up'], wink: [1, 2] },
      } },
    }

    expect(parseExpressionMetadata(userData)).toEqual({
      emotions: { happy: ['laugh'] },
      gaze: { wink: [1, 2] },
    })
  })
})
