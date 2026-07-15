import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { localeResources } from './localeRegistry'

i18n.use(initReactI18next).init({
  lng: 'zh-CN', // Default language
  fallbackLng: 'en-US',
  resources: localeResources,
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Disable suspense to prevent layout disruption
  },
})

export default i18n
