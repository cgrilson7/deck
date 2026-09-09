import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { THEMES, type Appearance } from '@shared/themes'
import { isDark, patchSettings, systemDark, useSettings } from '../lib/theme'

/**
 * Far right of the top bar: the theme picker (a popover of families with swatches, plus
 * light / dark / follow-system) and a one-click light/dark toggle. ⌘, opens the picker,
 * ⌘⇧L is the toggle; both also live in the View menu.
 */
export function ThemeControls({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const s = useSettings()
  const dark = isDark(s)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  const fam = THEMES.find((t) => t.id === s.theme) ?? THEMES[0]
  const appearance = (label: string, value: Appearance, Icon: typeof Sun) => (
    <button className={`seg ${s.appearance === value ? 'on' : ''}`} onClick={() => patchSettings({ appearance: value })} title={value === 'system' ? `Follow macOS (${systemDark() ? 'dark' : 'light'} now)` : label}>
      <Icon size={13} />
      {label}
    </button>
  )

  return (
    <div className="theme-controls" ref={box}>
      <button className={`bar-btn ${open ? 'on' : ''}`} onClick={() => onOpenChange(!open)} title="Theme (⌘,)">
        <Palette size={14} />
        <span>{fam.name}</span>
      </button>
      <button className="bar-btn icon" onClick={() => patchSettings({ appearance: dark ? 'light' : 'dark' })} title={dark ? 'Switch to light (⌘⇧L)' : 'Switch to dark (⌘⇧L)'}>
        {dark ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      {open && (
        <div className="popover theme-pop">
          <div className="menu-title">Theme</div>
          <div className="theme-list">
            {THEMES.map((t) => {
              const v = dark ? t.dark : t.light
              return (
                <button key={t.id} className={`theme-row ${t.id === s.theme ? 'on' : ''}`} onClick={() => patchSettings({ theme: t.id })}>
                  <span className="swatches" style={{ background: v.bg, borderColor: v.line }}>
                    <i style={{ background: v.panel, borderColor: v.line }} />
                    <i style={{ background: v.accent }} />
                    <i style={{ background: v.term.green }} />
                    <i style={{ background: v.term.blue }} />
                    <i style={{ background: v.term.magenta }} />
                  </span>
                  <span className="name">{t.name}</span>
                  {t.id === s.theme && <Check size={14} />}
                </button>
              )
            })}
          </div>
          <div className="menu-title">Appearance</div>
          <div className="segmented">
            {appearance('Light', 'light', Sun)}
            {appearance('Dark', 'dark', Moon)}
            {appearance('System', 'system', Monitor)}
          </div>
        </div>
      )}
    </div>
  )
}
