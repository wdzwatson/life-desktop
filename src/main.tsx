import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ConfirmationProvider } from './components/ConfirmationProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmationProvider>
      <App />
    </ConfirmationProvider>
  </StrictMode>,
)
