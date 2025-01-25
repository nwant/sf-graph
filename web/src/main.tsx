import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <FluentProvider theme={webLightTheme}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </FluentProvider>
    </BrowserRouter>
  </StrictMode>,
)
