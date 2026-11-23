/**
 * Body animations a VRM can carry for AIRI. Each clip is a whole `.vrma` file stored in a
 * bufferView of the VRM itself, and the glTF root `extras` (`gltf.userData`) lists them:
 *
 * ```json
 * { "airi": { "animations": {
 *   "version": 1,
 *   "clips": { "idle_breathing": { "bufferView": 120, "loop": true }, "look_around": { "bufferView": 121 } },
 *   "idle": { "base": ["idle_breathing"], "fidgets": ["look_around"], "interval": [6, 12] },
 *   "think": ["thinking"]
 * } } }
 * ```
 *
 * Models without it keep AIRI's default idle clip.
 */
export interface VRMAnimationMetadata {
  clips: Record<string, { bufferView: number, loop: boolean }>
  idle: {
    /** Looping clips the model rests in. */
    base: string[]
    /** One-shot clips played now and then over the base. */
    fidgets: string[]
    /** Seconds between fidgets, [min, max]. */
    interval: [number, number]
  }
  /** Clips held while the character waits for a reply. */
  think: string[]
}

export const DEFAULT_FIDGET_INTERVAL: [number, number] = [6, 12]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clipNames(value: unknown, clips: VRMAnimationMetadata['clips']): string[] {
  if (!Array.isArray(value))
    return []
  return value.filter((name): name is string => typeof name === 'string' && name in clips)
}

function parseInterval(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2)
    return DEFAULT_FIDGET_INTERVAL
  const [min, max] = value
  if (typeof min !== 'number' || typeof max !== 'number' || !(min > 0) || !(max >= min))
    return DEFAULT_FIDGET_INTERVAL
  return [min, max]
}

/** Reads AIRI's animation metadata from `gltf.userData`; malformed entries are skipped. */
export function parseAnimationMetadata(userData: unknown): VRMAnimationMetadata | undefined {
  const airi = isRecord(userData) ? userData.airi : undefined
  const raw = isRecord(airi) ? airi.animations : undefined
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.clips))
    return undefined

  const clips: VRMAnimationMetadata['clips'] = {}
  for (const [name, clip] of Object.entries(raw.clips)) {
    if (isRecord(clip) && Number.isInteger(clip.bufferView) && (clip.bufferView as number) >= 0)
      clips[name] = { bufferView: clip.bufferView as number, loop: clip.loop === true }
  }
  if (Object.keys(clips).length === 0)
    return undefined

  const idle = isRecord(raw.idle) ? raw.idle : {}
  return {
    clips,
    idle: {
      base: clipNames(idle.base, clips),
      fidgets: clipNames(idle.fidgets, clips),
      interval: parseInterval(idle.interval),
    },
    think: clipNames(raw.think, clips),
  }
}
