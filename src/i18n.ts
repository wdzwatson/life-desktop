import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US.json'

// Custom dynamic backend loader using Vite dynamic imports
const lazyLoadingBackend = {
  type: 'backend' as const,
  init: () => {},
  read: (language: string, namespace: string, callback: (err: any, data: any) => void) => {
    // If it's en-US, we already loaded it statically to avoid async lag/raw keys
    if (language === 'en-US') {
      callback(null, enUS)
      return
    }
    import(`./locales/${language}.json`)
      .then((module) => {
        // If it's a JSON file, the default export is the JSON content
        callback(null, module.default || module)
      })
      .catch((err) => {
        callback(err, null)
      })
  },
}

i18n
  .use(lazyLoadingBackend)
  .use(initReactI18next)
  .init({
    lng: 'zh-CN', // Default language
    fallbackLng: 'en-US',
    resources: {
      'en-US': {
        translation: enUS,
      },
    },
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false, // Disable suspense to prevent layout disruption during lazy loading
    },
  })

export default i18n

