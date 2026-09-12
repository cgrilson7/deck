import { createRoot } from 'react-dom/client'
import { DEFAULT_SETTINGS } from '@shared/types'
import { applyTheme, bootSettings } from '../lib/theme'
import { installFoxSheet } from '../lib/fox'
import { installApi } from './api'
import { Phone } from './Phone'
import '../styles.css'
import './phone.css'

// window.deck first: everything below reads it. Then the default theme so the first paint is
// styled, the real one as soon as the socket answers (bootSettings swaps it in), and Foxtrot's sheet.
installApi()
applyTheme(DEFAULT_SETTINGS)
void bootSettings()
installFoxSheet()
createRoot(document.getElementById('root')!).render(<Phone />)
