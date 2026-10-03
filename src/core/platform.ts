export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const MOD = isMac ? '⌘' : 'Ctrl+'
export const ALT = isMac ? '⌥' : 'Alt+'
export const SHIFT = isMac ? '⇧' : 'Shift+'
