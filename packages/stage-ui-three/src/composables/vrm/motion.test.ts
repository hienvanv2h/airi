import type { VRMAnimationMetadata } from './animation-metadata'

import { AnimationClip, AnimationMixer, NumberKeyframeTrack, Object3D } from 'three'
import { describe, expect, it } from 'vitest'

import { useVRMMotion } from './motion'

function clip(name: string, duration: number) {
  return new AnimationClip(name, duration, [new NumberKeyframeTrack('.position[x]', [0, duration], [0, 1])])
}

function setup(metadata?: VRMAnimationMetadata, fallback = clip('idle', 4)) {
  const root = new Object3D()
  const mixer = new AnimationMixer(root)
  const clips = new Map(Object.keys(metadata?.clips ?? {}).map(name => [name, clip(name, name.startsWith('fidget') ? 3 : 5)]))
  // random() = 0 picks the first clip and the shortest interval.
  const motion = useVRMMotion(mixer, clips, fallback, { metadata, fade: 0.5, random: () => 0 })
  const weightOf = (name: string) => {
    const action = mixer.existingAction(clips.get(name) ?? fallback)
    return action?.enabled ? action.getEffectiveWeight() : 0
  }
  const step = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 0.1) {
      motion.update(0.1)
      mixer.update(0.1)
    }
  }
  return { motion, weightOf, step }
}

const metadata: VRMAnimationMetadata = {
  clips: {
    breathing: { bufferView: 0, loop: true },
    fidget_look: { bufferView: 1, loop: false },
    thinking: { bufferView: 2, loop: true },
  },
  idle: { base: ['breathing'], fidgets: ['fidget_look'], interval: [2, 4] },
  think: ['thinking'],
}

describe('useVRMMotion', () => {
  it('rests in the fallback idle when the model has no base clips', () => {
    const { motion, weightOf, step } = setup()
    step(1)
    expect(motion.currentClip.value).toBe('idle')
    expect(weightOf('idle')).toBe(1)
    // No fidgets: the idle keeps playing.
    step(20)
    expect(motion.currentClip.value).toBe('idle')
  })

  it('plays a fidget after the interval and fades back to the base', () => {
    const { motion, weightOf, step } = setup(metadata)
    expect(motion.currentClip.value).toBe('breathing')

    step(2.1)
    expect(motion.mode.value).toBe('fidget')
    expect(motion.currentClip.value).toBe('fidget_look')
    step(0.6)
    expect(weightOf('fidget_look')).toBe(1)
    expect(weightOf('breathing')).toBe(0)

    // The 3 s fidget starts fading back 0.5 s before its end.
    step(2.0)
    expect(motion.mode.value).toBe('base')
    expect(motion.currentClip.value).toBe('breathing')
    step(0.6)
    expect(weightOf('breathing')).toBe(1)
    expect(weightOf('fidget_look')).toBe(0)
  })

  it('holds a clip without fidgets until released', () => {
    const { motion, weightOf, step } = setup(metadata)
    expect(motion.hold(metadata.think)).toBe(true)
    step(10)
    expect(motion.mode.value).toBe('hold')
    expect(motion.currentClip.value).toBe('thinking')
    expect(weightOf('thinking')).toBe(1)

    motion.release()
    step(0.6)
    expect(motion.currentClip.value).toBe('breathing')
    expect(weightOf('breathing')).toBe(1)
  })

  it('ignores unknown clips', () => {
    const { motion } = setup(metadata)
    expect(motion.play('nope')).toBe(false)
    expect(motion.hold(['nope'])).toBe(false)
    expect(motion.currentClip.value).toBe('breathing')
  })
})
