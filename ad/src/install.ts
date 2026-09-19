// First import of main.tsx: window.deck must exist before any of the app's modules run.
import { world } from './world'

window.deck = world.api()
window.deckErrors = { onError: () => () => {} }
