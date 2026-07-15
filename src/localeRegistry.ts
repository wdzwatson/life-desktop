import {
  buildLocaleResources,
  getConfiguredLocaleOptions,
  type LocaleModule,
} from './localeRegistryUtils'

const localeModules = import.meta.glob<LocaleModule>('./locales/*.json', { eager: true })

export const localeResources = buildLocaleResources(localeModules)

export const getConfiguredLocales = (displayLocale: string) =>
  getConfiguredLocaleOptions(localeResources, displayLocale)
