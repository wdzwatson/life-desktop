export type TranslationResource = Record<string, unknown>

export type I18nResourceMap = Record<
  string,
  {
    translation: TranslationResource
  }
>

export type LocaleModule = TranslationResource | { default: TranslationResource }

export interface ConfiguredLocaleOption {
  code: string
  label: string
}

export const buildLocaleResources = (
  modules: Record<string, LocaleModule>,
): I18nResourceMap => {
  const entries = Object.entries(modules).flatMap(([path, localeModule]) => {
    const match = path.match(/\/([^/]+)\.json$/)
    if (!match) return []

    const translation =
      'default' in localeModule
        ? (localeModule as { default: TranslationResource }).default
        : localeModule
    return [[match[1], { translation }] as const]
  })

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

export const getConfiguredLocaleOptions = (
  resources: I18nResourceMap,
  displayLocale: string,
): ConfiguredLocaleOption[] => {
  let displayNames: Intl.DisplayNames | undefined
  try {
    displayNames = new Intl.DisplayNames([displayLocale], { type: 'language' })
  } catch {
    displayNames = undefined
  }

  return Object.keys(resources)
    .sort((left, right) => left.localeCompare(right))
    .map((code) => {
      let displayName: string | undefined
      try {
        displayName = displayNames?.of(code)
      } catch {
        displayName = undefined
      }

      return {
        code,
        label: displayName || code,
      }
    })
}
