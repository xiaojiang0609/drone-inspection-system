export const COLLAGE_WIDTH = 1080
export const COLLAGE_HEIGHT = 1440
export const COLLAGE_ASPECT = COLLAGE_HEIGHT / COLLAGE_WIDTH
export const COLLAGE_DEFAULT_TITLE = '把日常，贴成一页'
export const COLLAGE_BORDER_WIDTH = 6
export const COLLAGE_MAX_BORDER_WIDTH = 16
export const MAX_COLLAGE_SOURCES = 16
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40000000
export const COLLAGE_HISTORY_LIMIT = 20
export const CUTOUT_CONCURRENCY = 2
export const COLLAGE_COLORS = Object.freeze({ dark: '#343638', cream: '#f7f2e7', lightInk: '#fffaf1', darkInk: '#665d50' })

export function collageBackgroundColor(background = {}) {
  if (background.kind === 'photo') return null
  if (background.kind === 'paper-light') return COLLAGE_COLORS.cream
  if (background.kind === 'solid') return background.color || COLLAGE_COLORS.dark
  return COLLAGE_COLORS.dark
}

export function collageInk(background = {}, ink = 'auto') {
  if (ink === 'light') return COLLAGE_COLORS.lightInk
  if (ink === 'dark') return COLLAGE_COLORS.darkInk
  if (background.kind === 'photo') return COLLAGE_COLORS.lightInk
  const color = collageBackgroundColor(background)
  const match = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(color)
  if (!match) return COLLAGE_COLORS.lightInk
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1]
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .55 ? COLLAGE_COLORS.darkInk : COLLAGE_COLORS.lightInk
}

export function collageRandom(seed = 0) {
  let state = 2166136261
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619)
  return () => { state += 0x6d2b79f5; let n = Math.imul(state ^ state >>> 15, 1 | state); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296 }
}
