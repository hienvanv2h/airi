import type { AnimationAction, AnimationClip, AnimationMixer } from 'three'

import type { VRMAnimationMetadata } from './animation-metadata'

import { LoopOnce, LoopRepeat } from 'three'
import { shallowRef } from 'vue'

import { DEFAULT_FIDGET_INTERVAL } from './animation-metadata'

export interface VRMMotionOptions {
  /** Body animations the model carries; without base clips the fallback idle is used. */
  metadata?: VRMAnimationMetadata
  /** Seconds of cross-fade between clips. */
  fade?: number
  /** Returns a number in [0, 1); injectable for tests. */
  random?: () => number
}

type MotionMode = 'base' | 'fidget' | 'hold'

/**
 * Drives the body clips of a VRM on one AnimationMixer: the model rests in a looping base
 * idle, now and then plays a one-shot fidget and fades back, and can hold a clip (for
 * example while it waits for a reply) until released.
 *
 * @param mixer The model's mixer; this composable owns its actions.
 * @param clips Clips by name, already bound to the model.
 * @param fallbackIdle The idle clip for models whose metadata has no base clips.
 * @param options Metadata, fade time and random source.
 */
export function useVRMMotion(
  mixer: AnimationMixer,
  clips: ReadonlyMap<string, AnimationClip>,
  fallbackIdle: AnimationClip | undefined,
  options: VRMMotionOptions = {},
) {
  const fade = options.fade ?? 0.6
  const random = options.random ?? Math.random
  const metadata = options.metadata
  const loops = new Set(Object.entries(metadata?.clips ?? {}).filter(([, clip]) => clip.loop).map(([name]) => name))

  const named = new Map(clips)
  const baseNames = metadata?.idle.base.filter(name => named.has(name)) ?? []
  if (baseNames.length === 0 && fallbackIdle) {
    named.set(fallbackIdle.name || 'idle', fallbackIdle)
    loops.add(fallbackIdle.name || 'idle')
    baseNames.push(fallbackIdle.name || 'idle')
  }
  const fidgetNames = metadata?.idle.fidgets.filter(name => named.has(name)) ?? []
  const thinkNames = metadata?.think.filter(name => named.has(name)) ?? []
  const [minInterval, maxInterval] = metadata?.idle.interval ?? DEFAULT_FIDGET_INTERVAL

  const currentClip = shallowRef<string>()
  const mode = shallowRef<MotionMode>('base')
  let current: AnimationAction | undefined
  let fidgetIn = 0

  function pick(names: readonly string[]): string | undefined {
    return names[Math.floor(random() * names.length)] ?? names[0]
  }

  function scheduleFidget() {
    fidgetIn = minInterval + random() * (maxInterval - minInterval)
  }

  function actionOf(name: string) {
    const clip = named.get(name)
    if (!clip)
      return undefined
    const action = mixer.clipAction(clip)
    if (loops.has(name)) {
      action.setLoop(LoopRepeat, Infinity)
      action.clampWhenFinished = false
    }
    else {
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
    }
    return action
  }

  /**
   * Cross-fades to a clip. Without restart, a clip faded out earlier resumes where it
   * stopped, so a base idle does not jump back to its first frame.
   */
  function fadeTo(name: string, restart: boolean) {
    const next = actionOf(name)
    if (!next)
      return false
    if (next === current) {
      if (restart)
        next.reset().play()
      currentClip.value = name
      return true
    }
    if (restart)
      next.reset()
    next.enabled = true
    next.paused = false
    next.setEffectiveTimeScale(1)
    next.setEffectiveWeight(1)
    next.play()
    // A clamped one-shot is paused on its last frame; its weight still fades out.
    if (current)
      next.crossFadeFrom(current, fade, false)
    current = next
    currentClip.value = name
    return true
  }

  function toBase() {
    const name = pick(baseNames)
    mode.value = 'base'
    scheduleFidget()
    if (name)
      fadeTo(name, false)
  }

  /** Plays a one-shot clip now (the debug panel's button), then fades back to the base. */
  function play(name: string) {
    if (!named.has(name))
      return false
    if (loops.has(name)) {
      mode.value = 'base'
      scheduleFidget()
      return fadeTo(name, false)
    }
    mode.value = 'fidget'
    return fadeTo(name, true)
  }

  /** Plays one of the clips until release(); fidgets wait meanwhile. */
  function hold(names: readonly string[]) {
    const name = pick(names.filter(name => named.has(name)))
    if (!name)
      return false
    mode.value = 'hold'
    return fadeTo(name, true)
  }

  function release() {
    if (mode.value === 'hold')
      toBase()
  }

  function update(delta: number) {
    if (mode.value === 'base') {
      if (fidgetNames.length === 0)
        return
      fidgetIn -= delta
      if (fidgetIn <= 0) {
        const name = pick(fidgetNames)
        if (name) {
          mode.value = 'fidget'
          fadeTo(name, true)
        }
      }
      return
    }
    if (mode.value === 'fidget' && current) {
      // Start the fade early enough that the base is fully back when the clip ends.
      const remaining = current.getClip().duration - current.time
      if (remaining <= fade)
        toBase()
    }
  }

  function dispose() {
    mixer.stopAllAction()
    current = undefined
    currentClip.value = undefined
  }

  toBase()

  return {
    currentClip,
    mode,
    clipNames: [...named.keys()],
    /** Clips the model holds while it waits for a reply. */
    thinkClips: thinkNames,
    play,
    hold,
    release,
    update,
    dispose,
  }
}
