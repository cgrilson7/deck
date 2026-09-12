// Pasting text into a session. The desktop registers xterm's paste (bracketed, and the
// terminal knows whether the CLI asked for that); anywhere without a terminal for the id
// (the phone page, a session whose terminal has not been made) writes the bracketed-paste
// sequence straight to the pty, so a multi-line prompt lands as one paste, not one line per ⏎.

type Paster = (id: string, text: string) => boolean

let paster: Paster | null = null

/** The terminal owner's paste; returns false for an id it has no terminal for. */
export function setPaster(fn: Paster): void {
  paster = fn
}

export function pasteText(id: string, text: string): void {
  if (paster?.(id, text)) return
  window.deck.ptyInput(id, `\x1b[200~${text}\x1b[201~`)
}
