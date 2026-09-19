import './install'
import { createRoot } from 'react-dom/client'
import App from '@r/App'
import { writeData } from '@r/lib/terminals'
import { bootSettings } from '@r/lib/theme'
import { installFoxSheet } from '@r/lib/fox'
import '@r/styles.css'
import './ad.css'
import { Director, WORLD } from './director'
import { preload, world } from './world'
import { film } from './script'

declare global {
  interface Window {
    __ad?: { ready: boolean; duration: number; start: () => void }
    __virtual?: boolean
  }
}

window.deck.onPtyData(writeData)
installFoxSheet()

const capture = /[?&]capture/.test(location.search)
const wide = /[?&]wide/.test(location.search)
if (!wide) Object.assign(WORLD, { w: 1280, h: 1720 })

function Stage() {
  return (
    <div className="ad-frame" id="ad-frame">
      <div className="ad-world" id="ad-world" style={{ width: WORLD.w, height: WORLD.h }}>
        <div className="ad-lights">
          <i /> <i /> <i />
        </div>
        <App />
      </div>
      <div className="ad-scrim" />
      <div className="ad-caption" id="ad-caption" />
      <div className="ad-fx" id="ad-fx" />
      <div className="fox fox-idle" id="ad-fox" />
      <div className="ad-end" id="ad-end">
        <div className="ad-end-word">deck</div>
        <div className="ad-end-line">ten Claude Code sessions.<br />one window. one fox.</div>
      </div>
    </div>
  )
}

document.documentElement.classList.toggle('ad-wide', wide)
document.documentElement.classList.toggle('ad-capture', capture)

// Preview: the frame is its real size (540×960, or 960×540 with ?wide) scaled to fit the browser window.
function fitPreview(): void {
  if (capture) return
  const [w, h] = wide ? [960, 540] : [540, 960]
  const k = Math.min(window.innerWidth / w, window.innerHeight / h)
  document.getElementById('ad-frame')!.style.transform = `translate(-50%, -50%) scale(${k})`
}

void Promise.all([bootSettings(), preload(), document.fonts.load("16px 'Press Start 2P'")]).then(() => {
  createRoot(document.getElementById('root')!).render(<Stage />)
  // One real frame for React to commit, then the film is written against the mounted deck.
  setTimeout(() => {
    const $ = (id: string): HTMLElement => document.getElementById(id)!
    const d = new Director($('ad-frame'), $('ad-world'), $('ad-fox'), $('ad-caption'), $('ad-fx'))
    d.onTick = (t) => world.tick(t * 1000)
    film(d, wide)
    fitPreview()
    window.addEventListener('resize', fitPreview)
    window.__ad = { ready: true, duration: d.duration, start: () => d.start() }
    if (!capture) d.start()
  }, 50)
})
