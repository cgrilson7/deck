import { readFileSync } from 'node:fs'
export const ROM = readFileSync('/Users/colin/Downloads/Pokemon - Yellow Version (UE) [C][!].gbc')
const symText = readFileSync(new URL('./pokeyellow.sym', import.meta.url), 'utf8')
export const SYM = {}
for (const l of symText.split('\n')) { const m = l.match(/^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)/); if (m) SYM[m[3]] = { bank: parseInt(m[1], 16), addr: parseInt(m[2], 16) } }
export const off = (bank, addr) => addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000)
export const symOff = n => { const s = SYM[n]; if (!s) throw new Error('no sym ' + n); return off(s.bank, s.addr) }
export const hex = (n, w = 2) => '$' + n.toString(16).padStart(w, '0')
