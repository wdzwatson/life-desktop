import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

i18n.use(initReactI18next).init({
  lng: 'zh-CN', // Default language
  fallbackLng: 'en-US',
  resources: {
    'zh-CN': {
      translation: zhCN,
    },
    'en-US': {
      translation: enUS,
    },
  },
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Disable suspense to prevent layout disruption
  },
})

export default i18n
