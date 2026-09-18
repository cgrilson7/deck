import { useEffect, useState } from 'react'

const EVENT = 'deck:pokemon'

export type PokemonWant = boolean | 'toggle'

export function openPokemon(): void {
  window.dispatchEvent(new CustomEvent<PokemonWant>(EVENT, { detail: true }))
}
export function closePokemon(): void {
  window.dispatchEvent(new CustomEvent<PokemonWant>(EVENT, { detail: false }))
}
export function togglePokemon(): void {
  window.dispatchEvent(new CustomEvent<PokemonWant>(EVENT, { detail: 'toggle' }))
}

export function onPokemon(cb: (want: PokemonWant) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<PokemonWant>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

const ROM_KEY = 'deck.pokemon.rom'

export function readSavedRom(): string | null {
  try {
    return localStorage.getItem(ROM_KEY) || null
  } catch {
    return null
  }
}

export function writeSavedRom(path: string | null): void {
  try {
    if (path) localStorage.setItem(ROM_KEY, path)
    else localStorage.removeItem(ROM_KEY)
  } catch {}
}

export function usePokemonRoms(): { name: string; path: string }[] {
  const [roms, setRoms] = useState<{ name: string; path: string }[]>([])
  useEffect(() => {
    let alive = true
    void window.deck
      .pokemonListRoms()
      .then((r) => alive && setRoms(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return roms
}
