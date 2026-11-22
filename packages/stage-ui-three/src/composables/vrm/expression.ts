import type { VRMCore } from '@pixiv/three-vrm-core'

import type { VRMExpressionMetadata } from './expression-metadata'

import { computed, ref } from 'vue'

interface EmotionState {
  expression?: {
    name: string
    value: number
    duration?: number
    curve?: (t: number) => number
  }[]
  blendDuration?: number
}

/** Eye gaze offset in degrees, three-vrm lookAt convention (yaw > 0 = model's left, pitch < 0 = up). */
export interface EmoteGaze {
  yaw: number
  pitch: number
}

export interface VRMEmoteOptions {
  /** Expression variants and gaze from the model (see expression-metadata.ts). */
  metadata?: VRMExpressionMetadata
  /** Random source for picking variants, in [0, 1). Tests pass a fixed one. */
  random?: () => number
}

// Blend duration for a variant of an emotion that has no built-in state (e.g. awkward).
const DEFAULT_VARIANT_BLEND_DURATION = 0.4

export function useVRMEmote(vrm: VRMCore, emoteOptions: VRMEmoteOptions = {}) {
  const random = emoteOptions.random ?? Math.random
  const currentEmotion = ref<string | null>(null)
  // Variant expression picked for the current emotion, or null when it has no variants.
  const currentVariant = ref<string | null>(null)
  const isTransitioning = ref(false)
  const transitionProgress = ref(0)
  const isVisemeTransitioning = ref(false)
  const visemeTransitionProgress = ref(0)
  const visemeStartValues = ref(new Map<string, number>())
  const visemeBlendDuration = ref(0.3)
  const currentExpressionValues = ref(new Map<string, number>())
  const targetExpressionValues = ref(new Map<string, number>())
  const resetTimeout = ref<number>()
  let wasSkippingVisemes = false
  // Morph names captured while entering an emotion, kept until the neutral
  // transition fully settles. ownedExpressionNames() only reflects emotion
  // states registered *right now*, so if a caller calls removeEmotionState
  // (or replaces a state) for the departing emotion before its scheduled
  // reset fires, its morph would otherwise drop out of tracking and never
  // get the terminal zero write — leaving the avatar stuck in that
  // expression. This set survives such mutations across emotionStates.
  const trackedExpressionNames = new Set<string>()

  // Utility functions
  const lerp = (start: number, end: number, t: number): number => {
    return start + (end - start) * t
  }

  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  }

  const clampIntensity = (value: number): number => {
    return Math.min(1, Math.max(0, value))
  }

  // Emotion states definition — values are the "full weight" targets;
  // actual applied weight is value × clamped intensity.
  // Using slightly lower values (0.7–0.8) for primary expressions to
  // prevent the "too raw / smiles too much" problem reported in #590.
  const emotionStates = new Map<string, EmotionState>([
    ['happy', {
      expression: [
        { name: 'happy', value: 0.7, duration: 0.3 },
        { name: 'aa', value: 0.2 },
      ],
      blendDuration: 0.4,
    }],
    ['sad', {
      expression: [
        { name: 'sad', value: 0.7 },
        { name: 'oh', value: 0.15 },
      ],
      blendDuration: 0.4,
    }],
    ['angry', {
      expression: [
        { name: 'angry', value: 0.7 },
        { name: 'ee', value: 0.3 },
      ],
      blendDuration: 0.3,
    }],
    ['surprised', {
      expression: [
        { name: 'surprised', value: 0.8 },
        { name: 'oh', value: 0.4 },
      ],
      blendDuration: 0.15,
    }],
    ['neutral', {
      expression: [
        { name: 'neutral', value: 1.0 },
      ],
      blendDuration: 0.6,
    }],
    ['think', {
      expression: [
        { name: 'think', value: 0.7 },
      ],
      blendDuration: 0.5,
    }],
    ['relaxed', {
      expression: [
        { name: 'relaxed', value: 0.7 },
      ],
      blendDuration: 0.4,
    }],
  ])

  const modelExpressionNames = (): string[] =>
    vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap) : []

  const findModelExpression = (name: string, modelNames = modelExpressionNames()): string | undefined =>
    modelNames.find(n => n.toLowerCase() === name.toLowerCase())

  // Variants per emotion from the model's metadata. A variant named like a
  // built-in state (happy, think, ...) uses that state; any other name is a
  // custom expression of the model at full weight. Names the model lacks are
  // dropped, and an emotion left without variants keeps its single face.
  const variantsByEmotion = new Map<string, string[]>()
  for (const [emotion, names] of Object.entries(emoteOptions.metadata?.emotions ?? {})) {
    const usable = names.filter(name => emotionStates.has(name) || findModelExpression(name))
    if (usable.length > 0)
      variantsByEmotion.set(emotion, usable)
  }

  const hasEmotion = (emotionName: string): boolean =>
    emotionStates.has(emotionName) || variantsByEmotion.has(emotionName)

  const variantsOf = (emotionName: string): string[] => [...(variantsByEmotion.get(emotionName) ?? [])]

  /** Every emotion that has variants, with them. */
  const variantMap = (): Record<string, string[]> =>
    Object.fromEntries([...variantsByEmotion].map(([emotion, variants]) => [emotion, [...variants]]))

  const variantState = (emotionName: string, variant: string): EmotionState =>
    emotionStates.get(variant) ?? {
      expression: [{ name: variant, value: 1 }],
      blendDuration: emotionStates.get(emotionName)?.blendDuration ?? DEFAULT_VARIANT_BLEND_DURATION,
    }

  // Uniform random pick; the same variant may come up twice in a row.
  const pickVariant = (variants: string[]): string =>
    variants[Math.floor(random() * variants.length)] ?? variants[0]

  // Morphs the emote owns: only expressions referenced by emotion states and
  // variants. Blink and animation-driven expressions stay under their own
  // controllers, so the emote must never assert values (including 0) for them.
  const ownedExpressionNames = (modelNames: string[]): string[] => {
    const owned = new Set<string>()
    for (const state of emotionStates.values()) {
      for (const expr of state.expression || []) {
        const match = findModelExpression(expr.name, modelNames)
        if (match)
          owned.add(match)
      }
    }
    for (const variants of variantsByEmotion.values()) {
      for (const variant of variants) {
        const match = emotionStates.has(variant) ? undefined : findModelExpression(variant, modelNames)
        if (match)
          owned.add(match)
      }
    }
    return [...owned]
  }

  // Gaze offset the current variant asks for, blended like the morphs.
  const zeroGaze = (): EmoteGaze => ({ yaw: 0, pitch: 0 })
  const gaze = zeroGaze()
  let gazeStart = zeroGaze()
  let gazeTarget = zeroGaze()
  let currentBlendDuration = 0.3

  // Viseme mouth morphs driven by lip sync; the emote yields these while
  // speech is active so phoneme weights are not overwritten.
  const VISEME_NAMES = new Set(['aa', 'ee', 'ih', 'oh', 'ou'])

  const clearResetTimeout = () => {
    if (resetTimeout.value) {
      clearTimeout(resetTimeout.value)
      resetTimeout.value = undefined
    }
  }

  /**
   * Shows an emotion. When the model gives the emotion variants, `variant`
   * picks one of them; without it a random one is used.
   */
  const setEmotion = (emotionName: string, intensity = 1, variant?: string) => {
    const normalizedIntensity = clampIntensity(intensity)
    if (normalizedIntensity <= 0)
      return

    if (!hasEmotion(emotionName)) {
      console.warn(`Emotion ${emotionName} not found`)
      return
    }

    clearResetTimeout()

    const variants = variantsByEmotion.get(emotionName)
    const chosen = variants
      ? (variant && variants.includes(variant) ? variant : pickVariant(variants))
      : null
    const emotionState = chosen ? variantState(emotionName, chosen) : emotionStates.get(emotionName)!
    currentVariant.value = chosen
    currentBlendDuration = emotionState.blendDuration || 0.3

    const variantGaze = chosen ? emoteOptions.metadata?.gaze[chosen] : undefined
    gazeStart = { ...gaze }
    gazeTarget = variantGaze
      ? { yaw: variantGaze[0] * normalizedIntensity, pitch: variantGaze[1] * normalizedIntensity }
      : zeroGaze()

    currentEmotion.value = emotionName
    isTransitioning.value = true
    transitionProgress.value = 0
    isVisemeTransitioning.value = false
    visemeTransitionProgress.value = 0
    visemeStartValues.value.clear()
    wasSkippingVisemes = false

    // Store current expression values as starting point BEFORE resetting,
    // so the lerp transition starts from the actual displayed values
    // instead of snapping to 0 first (fixes #590).
    currentExpressionValues.value.clear()
    targetExpressionValues.value.clear()

    if (vrm.expressionManager) {
      // Capture current values only for morphs the emote owns, so the lerp
      // transition starts from the actual displayed values instead of
      // snapping to 0 first (fixes #590). Unrelated expressions (blink,
      // animation-driven morphs) are left to their own controllers.
      //
      // Union with trackedExpressionNames rather than using
      // ownedExpressionNames() alone: a still-pending morph from an
      // emotion state removed since it was entered must keep being driven
      // toward 0, even though it is no longer "owned" by any registered
      // state.
      const expressionNames = Object.keys(vrm.expressionManager.expressionMap)
      const namesToCapture = new Set([...ownedExpressionNames(expressionNames), ...trackedExpressionNames])
      for (const name of namesToCapture) {
        const currentValue = vrm.expressionManager.getValue(name) || 0
        currentExpressionValues.value.set(name, currentValue)
        // Default target is 0 for owned expressions not in the target emotion
        targetExpressionValues.value.set(name, 0)
      }
      trackedExpressionNames.clear()
      for (const name of namesToCapture)
        trackedExpressionNames.add(name)
    }

    // Override target values for specified expressions in the emotion state
    for (const expr of emotionState.expression || []) {
      let actualName = expr.name
      if (vrm.expressionManager) {
        const modelNames = Object.keys(vrm.expressionManager.expressionMap)
        const match = modelNames.find(n => n.toLowerCase() === expr.name.toLowerCase())
        if (match) {
          actualName = match
        }
      }
      targetExpressionValues.value.set(actualName, expr.value * normalizedIntensity)
    }
  }

  // A held emotion is the resting face: timed resets return to it instead of
  // neutral, so a short emotion during the hold (a touch) comes back to it.
  // It keeps its variant, so returning to it shows the same face.
  let restingEmotion: { name: string, intensity: number, variant: string | null } | null = null

  const returnToRest = () => {
    if (restingEmotion)
      setEmotion(restingEmotion.name, restingEmotion.intensity, restingEmotion.variant ?? undefined)
    else
      setEmotion('neutral')
  }

  const setEmotionWithResetAfter = (emotionName: string, ms: number, intensity = 1, variant?: string) => {
    if (clampIntensity(intensity) <= 0)
      return

    clearResetTimeout()
    setEmotion(emotionName, intensity, variant)

    // Reset to the resting face, which is neutral unless an emotion is held.
    resetTimeout.value = setTimeout(() => {
      resetTimeout.value = undefined
      returnToRest()
    }, ms) as unknown as number
  }

  // Shows an emotion with no reset, and makes it the resting face until releaseEmotion.
  const holdEmotion = (emotionName: string, intensity = 1, variant?: string) => {
    if (clampIntensity(intensity) <= 0 || !hasEmotion(emotionName))
      return

    setEmotion(emotionName, intensity, variant)
    restingEmotion = { name: emotionName, intensity, variant: currentVariant.value }
  }

  // Ends a hold. When another emotion has replaced the held one, that
  // emotion owns its own reset, which now returns to neutral.
  const releaseEmotion = (emotionName: string, ms: number) => {
    if (restingEmotion?.name === emotionName)
      restingEmotion = null
    if (currentEmotion.value !== emotionName)
      return

    clearResetTimeout()
    if (ms <= 0) {
      setEmotion('neutral')
      return
    }

    resetTimeout.value = setTimeout(() => {
      setEmotion('neutral')
      resetTimeout.value = undefined
    }, ms) as unknown as number
  }

  // isEmoteActive's only consumer (VRMModel.vue) uses it to suppress
  // procedural blinking, which only matters for morphs that actually
  // deform the eye region. Viseme mouth morphs (aa/ee/ih/oh/ou) never do,
  // so an emotion state driving only visemes — e.g. a custom mouth-only
  // state added via addEmotionState — must not suppress blinking just
  // because those (mouth-only) targets are nonzero.
  const hasNonzeroEyeAffectingTarget = (values: Map<string, number>): boolean =>
    Array.from(values.entries()).some(([name, val]) => val > 0.001 && !VISEME_NAMES.has(name.toLowerCase()))

  const isEmoteActive = computed(() => {
    const hasActiveTarget = currentEmotion.value !== null
      && currentEmotion.value !== 'neutral'
      && hasNonzeroEyeAffectingTarget(targetExpressionValues.value)

    if (hasActiveTarget)
      return true

    // When transitioning (e.g. returning to neutral), remain active while non-zero
    // expression weights are still fading out to prevent procedural blink conflicts.
    if (isTransitioning.value || isVisemeTransitioning.value) {
      return hasNonzeroEyeAffectingTarget(currentExpressionValues.value)
    }

    return false
  })

  const update = (deltaTime: number, options?: { skipVisemes?: boolean }) => {
    if (!currentEmotion.value)
      return

    // While lip sync owns the mouth, viseme writes are skipped but the
    // transition and reset lifecycle keep advancing, so emotions triggered
    // during speech are not lost.
    const isSkipping = Boolean(options?.skipVisemes)
    const skip = isSkipping
      ? (name: string) => VISEME_NAMES.has(name.toLowerCase())
      : () => false

    if (isSkipping) {
      wasSkippingVisemes = true
      isVisemeTransitioning.value = false
      visemeStartValues.value.clear()
    }
    else if (wasSkippingVisemes) {
      // Speech has ended and lip sync relinquished mouth ownership.
      // If any target viseme differs from its current displayed weight,
      // blend it smoothly into the emotion pose instead of snapping at once.
      wasSkippingVisemes = false
      visemeStartValues.value.clear()
      if (vrm.expressionManager) {
        for (const [exprName, targetValue] of targetExpressionValues.value) {
          if (!VISEME_NAMES.has(exprName.toLowerCase()))
            continue
          const currentValue = vrm.expressionManager.getValue(exprName) || 0
          if (Math.abs(targetValue - currentValue) > 0.001) {
            visemeStartValues.value.set(exprName, currentValue)
          }
        }
      }
      if (visemeStartValues.value.size > 0) {
        isVisemeTransitioning.value = true
        visemeTransitionProgress.value = 0
        visemeBlendDuration.value = currentBlendDuration
      }
    }

    if (isVisemeTransitioning.value) {
      visemeTransitionProgress.value += deltaTime / visemeBlendDuration.value
      const isVisemeSettling = visemeTransitionProgress.value >= 1.0
      if (isVisemeSettling) {
        visemeTransitionProgress.value = 1.0
        isVisemeTransitioning.value = false
      }

      for (const [exprName, startValue] of visemeStartValues.value) {
        const targetValue = targetExpressionValues.value.get(exprName) ?? 0
        const currentValue = isVisemeSettling
          ? targetValue
          : lerp(
              startValue,
              targetValue,
              easeInOutCubic(visemeTransitionProgress.value),
            )
        vrm.expressionManager?.setValue(exprName, currentValue)
        currentExpressionValues.value.set(exprName, currentValue)
      }

      if (isVisemeSettling && !isTransitioning.value && currentEmotion.value === 'neutral') {
        currentEmotion.value = null
        currentExpressionValues.value.clear()
        targetExpressionValues.value.clear()
        visemeStartValues.value.clear()
        trackedExpressionNames.clear()
        return
      }
    }

    if (!currentEmotion.value)
      return

    if (isTransitioning.value) {
      transitionProgress.value += deltaTime / currentBlendDuration
      const isSettling = transitionProgress.value >= 1.0
      if (isSettling) {
        transitionProgress.value = 1.0
        isTransitioning.value = false
      }

      const gazeT = isSettling ? 1 : easeInOutCubic(transitionProgress.value)
      gaze.yaw = lerp(gazeStart.yaw, gazeTarget.yaw, gazeT)
      gaze.pitch = lerp(gazeStart.pitch, gazeTarget.pitch, gazeT)

      // Update all expressions with lerp (or terminal targets if isSettling)
      for (const [exprName, targetValue] of targetExpressionValues.value) {
        if (skip(exprName))
          continue
        if (isVisemeTransitioning.value && VISEME_NAMES.has(exprName.toLowerCase()))
          continue
        const startValue = currentExpressionValues.value.get(exprName) || 0
        const currentValue = isSettling
          ? targetValue
          : lerp(
              startValue,
              targetValue,
              easeInOutCubic(transitionProgress.value),
            )
        vrm.expressionManager?.setValue(exprName, currentValue)
      }

      // Once the neutral transition completes and terminal weights are written,
      // clear targets and reset currentEmotion to release morph ownership.
      if (isSettling && !isVisemeTransitioning.value && currentEmotion.value === 'neutral') {
        currentEmotion.value = null
        currentExpressionValues.value.clear()
        targetExpressionValues.value.clear()
        trackedExpressionNames.clear()
      }
    }
    else if (currentEmotion.value) {
      // Hold target expression values across render frames so other updates don't clear them
      for (const [exprName, targetValue] of targetExpressionValues.value) {
        if (skip(exprName))
          continue
        if (isVisemeTransitioning.value && VISEME_NAMES.has(exprName.toLowerCase()))
          continue
        vrm.expressionManager?.setValue(exprName, targetValue)
      }
    }
  }

  const addEmotionState = (emotionName: string, state: EmotionState) => {
    emotionStates.set(emotionName, state)
  }

  const removeEmotionState = (emotionName: string) => {
    emotionStates.delete(emotionName)
  }

  // Cleanup function
  const dispose = () => {
    clearResetTimeout()
  }

  /** Gaze offset to add to the lookAt yaw/pitch this frame; zero when no variant glances. */
  const gazeOffset = (): Readonly<EmoteGaze> => gaze

  return {
    currentEmotion,
    currentVariant,
    isTransitioning,
    isVisemeTransitioning,
    isEmoteActive,
    hasEmotion,
    variantsOf,
    variantMap,
    gazeOffset,
    setEmotion,
    setEmotionWithResetAfter,
    holdEmotion,
    releaseEmotion,
    update,
    addEmotionState,
    removeEmotionState,
    dispose,
  }
}
