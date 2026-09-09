import { createRoot } from 'react-dom/client'
import App from './App'
import { writeData } from './lib/terminals'
import './styles.css'

// Subscribe to pty output before React mounts anything, so nothing is dropped:
// data for a terminal that doesn't exist yet is buffered until its tile mounts.
window.deck.onPtyData(writeData)

createRoot(document.getElementById('root')!).render(<App />)
