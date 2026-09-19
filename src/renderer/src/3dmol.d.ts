// 3Dmol.js, the part of it lib/mol.ts uses. The package ships types, but for its UMD entry; the
// deck imports the minified ES module build by path (a tenth the size of `main`, which carries an
// inline source map), so that path is declared here, by hand, the way serverboy.d.ts is.

declare module '3dmol/build/3Dmol.es6-min.js' {
  export interface Atom {
    x: number
    y: number
    z: number
    elem: string
    /** The atom's name in its residue (CA, OG1…); an SDF has none. */
    atom?: string
    resn?: string
    resi?: number
    chain?: string
    /** Position in its model's atom list. */
    index: number
    serial?: number
    model: number
    hetflag?: boolean
    /** B-factor; an AlphaFold model keeps its pLDDT here. */
    b?: number
    /** 'h' helix, 's' sheet, 'c' coil. */
    ss?: string
    /** Indices (in the same model) of the atoms bonded to this one. */
    bonds: number[]
    bondOrder: number[]
    properties: Record<string, number | string | undefined>
  }

  export type ColorSpec = string | number
  export type Sel = Record<string, unknown>
  export type Style = Record<string, unknown>
  export interface Point {
    x: number
    y: number
    z: number
  }

  export interface Model {
    getID(): number
    selectedAtoms(sel: Sel): Atom[]
    setStyle(sel: Sel, style: Style, add?: boolean): void
  }

  export interface Shape {
    readonly __shape: unique symbol
  }
  export interface Label {
    readonly __label: unique symbol
  }

  export interface Viewer {
    addModel(data: string, format: string, options?: Record<string, unknown>): Model
    removeAllModels(): void
    removeModel(m: Model): void
    selectedAtoms(sel: Sel): Atom[]
    setStyle(sel: Sel, style: Style): void
    addStyle(sel: Sel, style: Style): void
    addSurface(type: number | string, style: Style, atomsel?: Sel, allsel?: Sel): Promise<unknown>
    removeAllSurfaces(): void
    addLabel(text: string, options: Record<string, unknown>, sel?: Sel): Label
    removeLabel(l: Label): void
    removeAllLabels(): void
    addCylinder(spec: Record<string, unknown>): Shape
    addSphere(spec: Record<string, unknown>): Shape
    removeShape(s: Shape): void
    removeAllShapes(): void
    setClickable(sel: Sel, clickable: boolean, cb: (atom: Atom) => void): void
    setHoverable(sel: Sel, hoverable: boolean, hover: (atom: Atom) => void, unhover: (atom: Atom) => void): void
    setHoverDuration(ms: number): void
    setBackgroundColor(color: ColorSpec, alpha?: number): void
    zoomTo(sel?: Sel, ms?: number): void
    center(sel?: Sel, ms?: number): void
    zoom(factor: number, ms?: number): void
    spin(axis: string | boolean, speed?: number): void
    render(): void
    resize(): void
    pngURI(): string
    clear(): void
  }

  export const SurfaceType: { VDW: number; MS: number; SAS: number; SES: number }
  export function createViewer(el: HTMLElement, config?: Record<string, unknown>): Viewer
  /** Surfaces are computed in web workers made from a blob: URL unless this is on; the deck's CSP allows no such worker. */
  export function setSyncSurface(on: boolean): void
  /** Amber-style partial charges for a standard residue's atom, written to `properties.partialCharge`. */
  export function applyPartialCharges(atom: Atom, keepExisting?: boolean): void
}
