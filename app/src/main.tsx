import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces'
import '@fontsource/source-sans-3/400.css'
import '@fontsource/source-sans-3/600.css'
import '@fontsource/source-sans-3/700.css'
import './styles.css'
import App from './App'
import Secours from './components/Secours'
import { installerRemonteeErreurs } from './lib/erreurs'
import { demarrerPwa } from './lib/pwa'
import { MiseAJour } from './components/Pwa'

installerRemonteeErreurs()
demarrerPwa()
createRoot(document.getElementById('root')!).render(<StrictMode><Secours><App /><MiseAJour /></Secours></StrictMode>)
