export interface Price {
  in: number
  out: number
  read: number
}
export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
  speed?: string
}
export interface Cost {
  input: number
  write5m: number
  write1h: number
  read: number
  output: number
  cost: number
  unpriced: boolean
}
export const PRICES: Record<string, Price>
export function priceOf(model: unknown): Price | null
export function modelName(model: unknown): string
export function costOf(model: unknown, usage: Usage | undefined): Cost
export function projectOf(cwd: unknown): string
export const LEDGER_PATH: string
export const IDLE_MS: number
