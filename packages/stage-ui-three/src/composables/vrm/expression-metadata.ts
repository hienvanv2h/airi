/**
 * Expression metadata a VRM can carry for AIRI, in the glTF root `extras`
 * (three.js's GLTFLoader copies it to `gltf.userData`):
 *
 * ```json
 * { "airi": { "expressions": {
 *   "version": 1,
 *   "emotions": { "happy": ["happy", "laugh", "smug"] },
 *   "gaze": { "think_b": [60, -35] }
 * } } }
 * ```
 *
 * Models without it keep one face per emotion.
 */
export interface VRMExpressionMetadata {
  /** AIRI emotion -> expression names to pick from at random. */
  emotions: Record<string, string[]>
  /**
   * Expression name -> eye gaze offset [yaw, pitch] in degrees, in three-vrm's
   * lookAt convention (yaw > 0 looks to the model's left, pitch < 0 looks up).
   */
  gaze: Record<string, [number, number]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads AIRI's expression metadata from `gltf.userData`; malformed entries are skipped. */
export function parseExpressionMetadata(userData: unknown): VRMExpressionMetadata | undefined {
  const airi = isRecord(userData) ? userData.airi : undefined
  const raw = isRecord(airi) ? airi.expressions : undefined
  if (!isRecord(raw) || raw.version !== 1)
    return undefined

  const emotions: VRMExpressionMetadata['emotions'] = {}
  if (isRecord(raw.emotions)) {
    for (const [emotion, names] of Object.entries(raw.emotions)) {
      if (!Array.isArray(names))
        continue
      const valid = names.filter((name): name is string => typeof name === 'string' && name.length > 0)
      if (valid.length > 0)
        emotions[emotion] = valid
    }
  }

  const gaze: VRMExpressionMetadata['gaze'] = {}
  if (isRecord(raw.gaze)) {
    for (const [name, value] of Object.entries(raw.gaze)) {
      if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v)))
        gaze[name] = [value[0], value[1]]
    }
  }

  if (Object.keys(emotions).length === 0)
    return undefined
  return { emotions, gaze }
}
