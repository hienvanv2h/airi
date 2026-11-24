export enum Emotion {
  Happy = 'happy',
  Sad = 'sad',
  Angry = 'angry',
  Think = 'think',
  Surprise = 'surprised',
  Awkward = 'awkward',
  Embarrassed = 'embarrassed',
  Question = 'question',
  Curious = 'curious',
  Neutral = 'neutral',
}

export const EMOTION_VALUES = Object.values(Emotion)

export const EmotionHappyMotionName = 'Happy'
export const EmotionSadMotionName = 'Sad'
export const EmotionAngryMotionName = 'Angry'
export const EmotionAwkwardMotionName = 'Awkward'
export const EmotionEmbarrassedMotionName = 'Embarrassed'
export const EmotionThinkMotionName = 'Think'
export const EmotionSurpriseMotionName = 'Surprise'
export const EmotionQuestionMotionName = 'Question'
export const EmotionNeutralMotionName = 'Idle'
export const EmotionCuriousMotionName = 'Curious'

export const EMOTION_EmotionMotionName_value = {
  [Emotion.Happy]: EmotionHappyMotionName,
  [Emotion.Sad]: EmotionSadMotionName,
  [Emotion.Angry]: EmotionAngryMotionName,
  [Emotion.Think]: EmotionThinkMotionName,
  [Emotion.Surprise]: EmotionSurpriseMotionName,
  [Emotion.Awkward]: EmotionAwkwardMotionName,
  [Emotion.Embarrassed]: EmotionEmbarrassedMotionName,
  [Emotion.Question]: EmotionQuestionMotionName,
  [Emotion.Neutral]: EmotionNeutralMotionName,
  [Emotion.Curious]: EmotionCuriousMotionName,
}

export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprised',
  [Emotion.Awkward]: 'neutral',
  [Emotion.Embarrassed]: 'neutral',
  [Emotion.Question]: 'think',
  [Emotion.Neutral]: 'neutral',
  [Emotion.Curious]: 'think',
} satisfies Record<Emotion, string | undefined>

export const EMOTION_SpineAnimationName_value = {
  [Emotion.Happy]: 'celebrate',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprise',
  [Emotion.Awkward]: 'awkward',
  [Emotion.Embarrassed]: 'awkward',
  [Emotion.Question]: 'question',
  [Emotion.Neutral]: 'idle',
  [Emotion.Curious]: 'curious',
} satisfies Record<Emotion, string>

/**
 * When to use an emotion, for the ones whose name alone is ambiguous to the model. The
 * runtime prompt adds it to the emotion's line.
 */
export const EMOTION_PromptHint_value: Partial<Record<Emotion, string>> = {
  [Emotion.Awkward]: 'mild unease, hesitation or an uncomfortable pause',
  [Emotion.Embarrassed]: 'blushing, flustered or shy, e.g. when praised, teased or caught caring',
}

export interface EmotionPayload {
  name: Emotion
  intensity: number
}
