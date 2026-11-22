import type { VRMCore } from '@pixiv/three-vrm-core'

import { describe, expect, it, vi } from 'vitest'

import { useVRMEmote } from './expression'

function createMockVRMCore(customExpressions: string[] = []) {
  const values = new Map<string, number>()
  return {
    expressionManager: {
      expressionMap: {
        ...Object.fromEntries(customExpressions.map(name => [name, {}])),
        happy: {},
        aa: {},
        ee: {},
        ih: {},
        oh: {},
        ou: {},
        sad: {},
        angry: {},
        surprised: {},
        neutral: {},
        think: {},
        relaxed: {},
        // Not owned by any emotion state; driven by the blink controller.
        blink: {},
      },
      getValue: vi.fn((name: string) => values.get(name) ?? 0),
      setValue: vi.fn((name: string, val: number) => {
        values.set(name, val)
      }),
    },
  } as unknown as VRMCore
}

describe('useVRMEmote', () => {
  it('updates expression weights during transition and maintains hold after transition completes', () => {
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    expect(emote.isEmoteActive.value).toBe(false)

    emote.setEmotion('happy', 1)
    expect(emote.currentEmotion.value).toBe('happy')
    expect(emote.isTransitioning.value).toBe(true)
    expect(emote.isEmoteActive.value).toBe(true)

    // Blend duration is 0.4s for happy
    emote.update(0.2) // Halfway
    expect(emote.isTransitioning.value).toBe(true)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', expect.any(Number))

    emote.update(0.3) // Transition finishes
    expect(emote.isTransitioning.value).toBe(false)
    expect(emote.isEmoteActive.value).toBe(true)

    // Clear calls to inspect hold behavior
    vi.mocked(vrm.expressionManager!.setValue).mockClear()

    // Subsequent frame after transition completion should continue holding target weights
    emote.update(0.016)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', 0.7)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0.2)

    // ROOT CAUSE:
    //
    // Previously the emote captured every entry of expressionMap with a
    // default target of 0, so the hold branch overwrote blink and other
    // animation-driven expressions on every frame after the first emotion.
    //
    // We fixed this by capturing only morphs owned by the emotion states.
    expect(vrm.expressionManager?.setValue).not.toHaveBeenCalledWith('blink', expect.anything())
  })

  it('does not mark the emote active for a mouth-only (viseme-only) custom state', () => {
    // ROOT CAUSE:
    //
    // isEmoteActive treated any nonzero target as an eye conflict, so
    // VRMModel suppressed procedural blinking for the entire hold period
    // of *any* emotion — including a custom state added via
    // addEmotionState whose targets are only viseme mouth morphs and
    // never touch the eye region. That left the model unable to blink
    // naturally while such a state was held, despite no real conflict.
    //
    // We fixed this by only counting non-viseme target names as
    // eye-affecting for isEmoteActive.
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.addEmotionState('mouth-shape', {
      expression: [{ name: 'aa', value: 0.5 }],
      blendDuration: 0.2,
    })

    emote.setEmotion('mouth-shape', 1)
    emote.update(0.2) // Settle the transition

    expect(emote.currentEmotion.value).toBe('mouth-shape')
    expect(emote.isEmoteActive.value).toBe(false)
  })

  it('still zeroes a morph after its emotion state is removed before the reset settles', () => {
    // ROOT CAUSE:
    //
    // The neutral transition captured which morphs to zero via
    // ownedExpressionNames(), recomputed from the *current* emotionStates
    // map every time setEmotion() ran. If a caller removed (or replaced)
    // the departing emotion's state — e.g. removeEmotionState('happy') —
    // before the scheduled reset fired, that morph silently dropped out of
    // ownership and the neutral transition never wrote it back to 0,
    // leaving the avatar stuck showing the removed expression forever.
    //
    // We fixed this by tracking active morph names in a set that survives
    // emotionStates mutations, cleared only once the neutral transition
    // fully settles.
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.setEmotion('happy', 1)
    emote.update(0.4) // Settle happy: 'happy' and 'aa' held at 0.7 / 0.2

    emote.removeEmotionState('happy')

    emote.setEmotion('neutral')
    vi.mocked(vrm.expressionManager!.setValue).mockClear()

    emote.update(1.0) // > 0.6s blend duration for neutral
    expect(emote.currentEmotion.value).toBeNull()
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', 0)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('neutral', 1)
  })

  it('keeps the state machine advancing during lip sync and blends deferred visemes when speech ends', () => {
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.setEmotion('happy', 1)

    // Lip sync active: visemes yield, but the transition still progresses.
    emote.update(0.2, { skipVisemes: true })
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', expect.any(Number))
    expect(vrm.expressionManager?.setValue).not.toHaveBeenCalledWith('aa', expect.anything())

    emote.update(0.3, { skipVisemes: true })
    expect(emote.isTransitioning.value).toBe(false)

    vi.mocked(vrm.expressionManager!.setValue).mockClear()

    // Lip sync released: deferred visemes start blending smoothly instead of jumping immediately to target weight.
    emote.update(0.016, { skipVisemes: false })
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', expect.any(Number))
    const firstFrameValue = vi.mocked(vrm.expressionManager!.setValue).mock.calls.find(call => call[0] === 'aa')?.[1]
    expect(firstFrameValue).toBeGreaterThan(0)
    expect(firstFrameValue).toBeLessThan(0.2)
    expect(emote.isVisemeTransitioning.value).toBe(true)

    // Run out the remainder of the blend duration (0.4s for happy)
    emote.update(0.4, { skipVisemes: false })
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0.2)
    expect(emote.isVisemeTransitioning.value).toBe(false)

    vi.mocked(vrm.expressionManager!.setValue).mockClear()

    // Subsequent frames hold the target weight
    emote.update(0.016, { skipVisemes: false })
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0.2)
  })

  it('maintains emote active flag during neutral transition and resets when blend completes', () => {
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.setEmotion('sad', 1)
    expect(emote.isEmoteActive.value).toBe(true)

    // Settle the 'sad' transition so values exist in expressionManager
    emote.update(0.4)
    expect(emote.isTransitioning.value).toBe(false)
    expect(emote.isEmoteActive.value).toBe(true)

    // Resetting to neutral starts a transition (blendDuration: 0.6s)
    emote.setEmotion('neutral')
    expect(emote.isTransitioning.value).toBe(true)
    // Emote should remain active while previous emotion weights fade out
    expect(emote.isEmoteActive.value).toBe(true)

    // Complete the neutral transition
    emote.update(0.6)
    expect(emote.isTransitioning.value).toBe(false)
    expect(emote.isEmoteActive.value).toBe(false)
    expect(emote.currentEmotion.value).toBeNull()

    // Terminal neutral weights should have been written
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('sad', 0)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', 0)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('neutral', 1)

    vi.mocked(vrm.expressionManager!.setValue).mockClear()

    // Subsequent frames should not assert zero over expressions, releasing ownership
    emote.update(0.016)
    expect(vrm.expressionManager?.setValue).not.toHaveBeenCalled()
  })

  it('applies terminal neutral weights when transition completes in a single delta jump after pause', () => {
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.setEmotion('happy', 1)
    emote.update(0.4) // Settle happy

    emote.setEmotion('neutral')
    vi.mocked(vrm.expressionManager!.setValue).mockClear()

    // Delta jump of 1.0s (> 0.6s blend duration)
    emote.update(1.0)
    expect(emote.isTransitioning.value).toBe(false)
    expect(emote.currentEmotion.value).toBeNull()
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', 0)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('neutral', 1)

    vi.mocked(vrm.expressionManager!.setValue).mockClear()
    emote.update(0.016)
    expect(vrm.expressionManager?.setValue).not.toHaveBeenCalled()
  })

  it('does not activate emote flag for no-op intensity or empty targets and avoids holding zero weights', () => {
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.setEmotion('happy', 0)
    expect(emote.isEmoteActive.value).toBe(false)
    expect(emote.currentEmotion.value).toBeNull()
    expect(emote.isTransitioning.value).toBe(false)

    // Ensure update on subsequent frames is a no-op and does not overwrite mixer or other controllers with 0
    emote.update(0.016)
    emote.update(0.5)
    expect(vrm.expressionManager?.setValue).not.toHaveBeenCalled()

    // Test with setEmotionWithResetAfter as well
    emote.setEmotionWithResetAfter('happy', 3000, 0)
    expect(emote.isEmoteActive.value).toBe(false)
    expect(emote.currentEmotion.value).toBeNull()
    emote.update(0.016)
    expect(vrm.expressionManager?.setValue).not.toHaveBeenCalled()
  })

  it('holds an emotion until it is released', () => {
    vi.useFakeTimers()
    try {
      const vrm = createMockVRMCore()
      const emote = useVRMEmote(vrm)

      emote.holdEmotion('think', 1)
      vi.advanceTimersByTime(60_000)
      expect(emote.currentEmotion.value).toBe('think')

      emote.releaseEmotion('think', 3000)
      vi.advanceTimersByTime(2999)
      expect(emote.currentEmotion.value).toBe('think')
      vi.advanceTimersByTime(1)
      expect(emote.currentEmotion.value).toBe('neutral')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('returns a held emotion to neutral at once when released with no delay', () => {
    const vrm = createMockVRMCore()
    const emote = useVRMEmote(vrm)

    emote.holdEmotion('think', 1)
    emote.releaseEmotion('think', 0)
    expect(emote.currentEmotion.value).toBe('neutral')
  })

  it('leaves an emotion that replaced the held one to its own reset', () => {
    vi.useFakeTimers()
    try {
      const vrm = createMockVRMCore()
      const emote = useVRMEmote(vrm)

      emote.holdEmotion('think', 1)
      // The reply's first ACT replaces the held think face before the release.
      emote.setEmotionWithResetAfter('happy', 3000, 1)
      emote.releaseEmotion('think', 0)
      expect(emote.currentEmotion.value).toBe('happy')

      vi.advanceTimersByTime(3000)
      expect(emote.currentEmotion.value).toBe('neutral')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('returns a short emotion shown during a hold to the held emotion', () => {
    vi.useFakeTimers()
    try {
      const vrm = createMockVRMCore()
      const emote = useVRMEmote(vrm)

      emote.holdEmotion('think', 0.8)
      // A touch while the reply is pending.
      emote.setEmotionWithResetAfter('surprised', 3000, 1)
      vi.advanceTimersByTime(3000)
      expect(emote.currentEmotion.value).toBe('think')
      vi.mocked(vrm.expressionManager!.setValue).mockClear()
      emote.update(1)
      // The held intensity comes back with the think face.
      expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('think', expect.closeTo(0.7 * 0.8))
      expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('surprised', 0)

      emote.releaseEmotion('think', 0)
      expect(emote.currentEmotion.value).toBe('neutral')

      // After the release, short emotions return to neutral again.
      emote.setEmotionWithResetAfter('surprised', 3000, 1)
      vi.advanceTimersByTime(3000)
      expect(emote.currentEmotion.value).toBe('neutral')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('returns to neutral when a touch outlasts the release of the hold', () => {
    vi.useFakeTimers()
    try {
      const vrm = createMockVRMCore()
      const emote = useVRMEmote(vrm)

      emote.holdEmotion('think', 1)
      emote.setEmotionWithResetAfter('happy', 3000, 1)
      // The first token arrives while the touch face still shows.
      emote.releaseEmotion('think', 3000)
      expect(emote.currentEmotion.value).toBe('happy')

      vi.advanceTimersByTime(3000)
      expect(emote.currentEmotion.value).toBe('neutral')
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('useVRMEmote variants', () => {
  const metadata = {
    emotions: {
      happy: ['happy', 'laugh', 'smug'],
      awkward: ['shy_smile'],
      think: ['think', 'think_b'],
      sad: ['missing_face'],
    },
    gaze: { think_b: [60, -35] as [number, number] },
  }
  const customs = ['laugh', 'smug', 'shy_smile', 'think_b']

  it('picks variants uniformly at random, repeats allowed', () => {
    const rolls = [0, 0, 0.5, 0.99]
    const emote = useVRMEmote(createMockVRMCore(customs), { metadata, random: () => rolls.shift()! })

    const picks: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      emote.setEmotion('happy', 1)
      picks.push(emote.currentVariant.value)
    }
    expect(picks).toEqual(['happy', 'happy', 'laugh', 'smug'])
  })

  it('drives a custom variant at full weight and the built-in state for its own name', () => {
    const vrm = createMockVRMCore(customs)
    const emote = useVRMEmote(vrm, { metadata })

    emote.setEmotion('happy', 1, 'laugh')
    emote.update(1)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('laugh', 1)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', 0)

    vi.mocked(vrm.expressionManager!.setValue).mockClear()
    emote.setEmotion('happy', 1, 'happy')
    emote.update(1)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('happy', 0.7)
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0.2)
    // The custom variant shown before is driven back to 0.
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('laugh', 0)
  })

  it('gives an emotion without a built-in state a face from its variants', () => {
    const vrm = createMockVRMCore(customs)
    const emote = useVRMEmote(vrm, { metadata })

    expect(emote.hasEmotion('awkward')).toBe(true)
    emote.setEmotion('awkward', 1)
    emote.update(1)
    expect(emote.currentVariant.value).toBe('shy_smile')
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('shy_smile', 1)
  })

  it('drops variants the model does not have', () => {
    const emote = useVRMEmote(createMockVRMCore(customs), { metadata })

    // sad lists only a missing face, so it keeps its built-in state.
    expect(emote.variantsOf('sad')).toEqual([])
    emote.setEmotion('sad', 1)
    expect(emote.currentVariant.value).toBeNull()
  })

  it('keeps one face per emotion when the model has no metadata', () => {
    const emote = useVRMEmote(createMockVRMCore(customs))

    expect(emote.hasEmotion('awkward')).toBe(false)
    emote.setEmotion('happy', 1)
    expect(emote.currentVariant.value).toBeNull()
  })

  it('blends the gaze of a glancing variant in and back out', () => {
    const emote = useVRMEmote(createMockVRMCore(customs), { metadata })

    emote.setEmotion('think', 0.5, 'think_b')
    expect(emote.gazeOffset()).toEqual({ yaw: 0, pitch: 0 })
    emote.update(0.25) // halfway through think's 0.5 s blend
    expect(emote.gazeOffset().yaw).toBeCloseTo(15)
    emote.update(1)
    // Scaled by the intensity.
    expect(emote.gazeOffset()).toEqual({ yaw: 30, pitch: -17.5 })

    emote.setEmotion('neutral')
    emote.update(1)
    expect(emote.gazeOffset()).toEqual({ yaw: 0, pitch: 0 })
  })

  it('returns a touch to the same variant of the held emotion', () => {
    vi.useFakeTimers()
    try {
      let roll = 0
      // Picks alternate between variants, so a re-pick would change the face.
      const emote = useVRMEmote(createMockVRMCore(customs), { metadata, random: () => (roll++ % 2) * 0.6 })

      emote.holdEmotion('happy', 1)
      const held = emote.currentVariant.value
      emote.setEmotionWithResetAfter('think', 3000, 1)
      vi.advanceTimersByTime(3000)
      expect(emote.currentEmotion.value).toBe('happy')
      expect(emote.currentVariant.value).toBe(held)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
