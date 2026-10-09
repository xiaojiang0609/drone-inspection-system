import { COLLAGE_WIDTH, COLLAGE_HEIGHT, COLLAGE_ASPECT, COLLAGE_BORDER_WIDTH, COLLAGE_MAX_BORDER_WIDTH, COLLAGE_DEFAULT_TITLE, COLLAGE_COLORS, collageRandom } from './collage-config.js'
import { themedDoodles } from './doodle-catalog.js'
import { journalTextHeight } from './journal-text.js'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const border = e => e.type === 'imageSticker' && e.borderStyle !== 'none' ? clamp(e.borderWidth ?? COLLAGE_BORDER_WIDTH, 0, COLLAGE_MAX_BORDER_WIDTH) : 0

// Normalized x/y dimensions map to different pixel scales on a portrait page.
export function collageElementBounds(e) {
  const angle = (e.rotation || 0) * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle))
  const halfW = e.width * COLLAGE_WIDTH / 2000 + border(e)
  const halfH = e.height * COLLAGE_HEIGHT / 2000 + border(e)
  const dx = (halfW * c + halfH * s) * 1000 / COLLAGE_WIDTH
  const dy = (halfW * s + halfH * c) * 1000 / COLLAGE_HEIGHT
  return { x1: e.x - dx, y1: e.y - dy, x2: e.x + dx, y2: e.y + dy }
}

export function constrainCollageElement(element) {
  const e = { ...element, width: Math.max(.001, element.width), height: Math.max(.001, element.height), aspect: COLLAGE_ASPECT }
  const b = collageElementBounds(e), margin = border(e)
  const angle = (e.rotation || 0) * Math.PI / 180
  const extraX = 2 * margin * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))) * 1000 / COLLAGE_WIDTH
  const extraY = 2 * margin * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))) * 1000 / COLLAGE_HEIGHT
  const scale = Math.min(1, (1000 - extraX) / (b.x2 - b.x1 - extraX), (1000 - extraY) / (b.y2 - b.y1 - extraY))
  e.width *= scale; e.height *= scale
  if (e.fontSize) e.fontSize *= scale
  const fitted = collageElementBounds(e)
  e.x = clamp(e.x, (fitted.x2 - fitted.x1) / 2, 1000 - (fitted.x2 - fitted.x1) / 2)
  e.y = clamp(e.y, (fitted.y2 - fitted.y1) / 2, 1000 - (fitted.y2 - fitted.y1) / 2)
  return e
}

function overlaps(a, b, gap = 6) {
  return a.x1 < b.x2 + gap && a.x2 + gap > b.x1 && a.y1 < b.y2 + gap && a.y2 + gap > b.y1
}

function sticker(asset, id, box, rotation, borderWidth = COLLAGE_BORDER_WIDTH, borderStyle = 'solid') {
  if (!(asset?.width > 0 && asset?.height > 0 && asset.assetId)) throw new Error('A decoded sticker asset is required')
  const c = Math.abs(Math.cos(rotation * Math.PI / 180)), s = Math.abs(Math.sin(rotation * Math.PI / 180))
  const w = box.width * COLLAGE_WIDTH / 1000, h = box.height * COLLAGE_HEIGHT / 1000
  const padding = borderStyle === 'none' ? 0 : clamp(borderWidth, 0, COLLAGE_MAX_BORDER_WIDTH) * 2 * (c + s)
  const scale = Math.max(.000001, Math.min((w - padding) / (asset.width * c + asset.height * s), (h - padding) / (asset.width * s + asset.height * c)))
  return { id, type: 'imageSticker', assetId: asset.assetId, sourceId: asset.sourceId, x: box.x, y: box.y,
    width: asset.width * scale * 1000 / COLLAGE_WIDTH, height: asset.height * scale * 1000 / COLLAGE_HEIGHT,
    rotation, aspect: COLLAGE_ASPECT, borderStyle, borderWidth: clamp(borderWidth, 0, COLLAGE_MAX_BORDER_WIDTH) }
}

function freePosition(element, elements, step = 24) {
  const occupied = elements.map(collageElementBounds)
  for (let y = 180; y <= 950; y += step) for (let x = 30; x <= 970; x += step) {
    const candidate = { ...element, x, y }, b = collageElementBounds(candidate)
    if (b.x1 >= 30 && b.x2 <= 970 && b.y1 >= 180 && b.y2 <= 950 && !occupied.some(other => overlaps(b, other))) return candidate
  }
  return null
}

export function createCollageLayout(assets, { title = COLLAGE_DEFAULT_TITLE, ink = COLLAGE_COLORS.lightInk, seed = 0, measureText } = {}) {
  const random = collageRandom(seed), count = assets.length, elements = []
  ink = ink === 'dark' ? COLLAGE_COLORS.darkInk : ['light', 'auto'].includes(ink) ? COLLAGE_COLORS.lightInk : ink
  const titleText = String(title || COLLAGE_DEFAULT_TITLE)
  const titleSize = Math.min(52, 880 / Math.max(1, measureText ? measureText(titleText, 1) : titleText.length))
  elements.push({ id: 'collage-title', type: 'text', role: 'title', text: titleText, x: 500, y: 95, width: 900, height: 110, fontSize: titleSize, rotation: 0, color: ink, aspect: COLLAGE_ASPECT })
  let best
  for (let columns = 1; columns <= Math.max(1, count); columns++) {
    const rows = Math.ceil(count / columns) || 1, width = 940 / columns, height = 770 / rows
    const area = assets.reduce((sum, asset) => {
      const e = sticker(asset, '', { x: 0, y: 0, width: width - 28, height: height - 24 }, 8)
      return sum + e.width * e.height
    }, 0)
    if (!best || area > best.area) best = { columns, rows, width, height, area }
  }
  assets.forEach((asset, i) => {
    const column = i % best.columns, row = Math.floor(i / best.columns)
    const rotation = (random() * 2 - 1) * 8
    const x = 30 + (column + .5) * best.width + (random() * 2 - 1) * 5
    const y = 180 + (row + .5) * best.height + (random() * 2 - 1) * 4
    elements.push(sticker(asset, `sticker-${asset.assetId}`, { x, y, width: best.width - 28, height: best.height - 24 }, rotation))
  })
  for (const [i, asset] of assets.filter(a => a.meta?.caption).slice(0, 4).entries()) {
    const text = String(asset.meta.caption).slice(0, 30), fontSize = 24
    const width = Math.min(250, Math.max(80, (measureText ? measureText(text, fontSize) : text.length * fontSize) + 12))
    // Match the shared renderer's comma line breaks, wrapping, padding and
    // line spacing before looking for space; never shrink prose into a tiny box.
    const height = journalTextHeight('text', text, width, fontSize, measureText || ((value, size) => value.length * size)) / COLLAGE_ASPECT
    const caption = freePosition({ id: `caption-${i}`, type: 'text', role: 'caption', text, width, height, fontSize, rotation: 0, color: ink, aspect: COLLAGE_ASPECT }, elements)
    if (caption) elements.push(caption)
  }
  const icons = themedDoodles(assets.find(a => a.meta?.theme)?.meta.theme, assets.map(a => a.meta?.subject || { label: a.meta?.label }))
  for (let i = 0; i < Math.min(8, count * 2); i++) {
    const doodle = freePosition({ id: `doodle-${i}`, type: 'doodle', icon: icons[i % icons.length], width: 40, height: 30, rotation: 0, color: ink, aspect: COLLAGE_ASPECT }, elements)
    if (doodle) elements.push(doodle)
  }
  return elements
}

export function placeAdditionalSticker(asset, elements, { seed = 0, borderWidth = COLLAGE_BORDER_WIDTH, borderStyle = 'solid' } = {}) {
  const rotation = (collageRandom(`${seed}-${asset.assetId}`)() * 2 - 1) * 8
  const baseId = `sticker-${asset.assetId}`, usedIds = new Set(elements.map(e => e.id))
  let id = baseId, suffix = 2
  while (usedIds.has(id)) id = `${baseId}-${suffix++}`
  for (const size of [280, 220, 170, 125, 90]) {
    const e = sticker(asset, id, { x: 0, y: 0, width: size, height: size }, rotation, borderWidth, borderStyle)
    const placed = freePosition(e, elements, 16)
    if (placed) return placed
  }
  return null
}
