// The translator tile's backend: Google Cloud Translation v2 (the same API and key
// languagelog uses). Runs in main because the renderer's CSP allows no outbound requests.
//
// One round trip in the common case: ask for the opposite of the box the text was typed
// into and let the API report the detected source. If it turns out the text was already in
// the target language (Spanish typed into the English box), translate once more the other way.

import type { Lang, TranslateResult } from '@shared/types'

const URL = 'https://translation.googleapis.com/language/translate/v2'
const MAX_CHARS = 1000

const other = (l: Lang): Lang => (l === 'en' ? 'es' : 'en')

interface V2Response {
  data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] }
  error?: { message?: string }
}

async function call(text: string, target: Lang, key: string): Promise<{ text: string; detected: Lang | null }> {
  const res = await fetch(`${URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, target, format: 'text' })
  })
  const body = (await res.json().catch(() => ({}))) as V2Response
  if (!res.ok) throw new Error(body.error?.message ?? `translate: HTTP ${res.status}`)
  const t = body.data?.translations?.[0]
  if (!t?.translatedText) throw new Error('translate: empty response')
  const d = t.detectedSourceLanguage
  return { text: t.translatedText, detected: d === 'en' || d === 'es' ? d : null }
}

export async function translate(raw: string, hint: Lang, key: string): Promise<TranslateResult> {
  const text = raw.trim()
  if (!text) throw new Error('nothing to translate')
  if (text.length > MAX_CHARS) throw new Error(`keep it under ${MAX_CHARS} characters`)
  if (!key) throw new Error('No API key. Put translateApiKey in config.json (a Google Cloud key with Cloud Translation enabled).')

  let source: Lang = hint
  let r = await call(text, other(hint), key)
  if (r.detected === other(hint)) {
    // Typed into the wrong box: it is already in the language we were asked for.
    source = r.detected
    r = await call(text, other(source), key)
  } else if (r.detected) {
    source = r.detected
  }
  return { source, text, translated: r.text }
}
