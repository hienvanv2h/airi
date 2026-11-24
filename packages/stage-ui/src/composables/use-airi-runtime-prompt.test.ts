import { describe, expect, it, vi } from 'vitest'

import { useAiriRuntimePrompt } from './use-airi-runtime-prompt'

const i18nMock = vi.hoisted(() => ({
  hasTranslation: vi.fn<(key: string, locale: string) => boolean>(),
  locale: { value: 'en' },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: i18nMock.locale,
    t: (key: string) => key,
    te: (key: string, currentLocale: string) => i18nMock.hasTranslation(key, currentLocale),
  }),
}))

describe('useAiriRuntimePrompt', () => {
  it('returns no prompt for a locale that still uses the combined prompt', () => {
    i18nMock.hasTranslation.mockReturnValue(false)

    expect(useAiriRuntimePrompt().value).toBe('')
  })

  it('assembles the emotion and emoji prompt for a split locale', () => {
    i18nMock.hasTranslation.mockReturnValue(true)

    const prompt = useAiriRuntimePrompt().value

    expect(prompt).toContain('base.prompt.emotion')
    expect(prompt).toContain('base.prompt.suffix')
    expect(prompt).toContain('base.prompt.emoji')
  })

  it('tells awkward and embarrassed apart in the emotion list', () => {
    i18nMock.hasTranslation.mockReturnValue(true)

    const prompt = useAiriRuntimePrompt().value

    expect(prompt).toContain('- awkward (Emotion for feeling Awkward: mild unease')
    expect(prompt).toContain('- embarrassed (Emotion for feeling Embarrassed: blushing, flustered or shy')
    expect(prompt).toContain('- happy (Emotion for feeling Happy)')
  })
})
