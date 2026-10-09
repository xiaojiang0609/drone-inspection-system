import { COLLAGE_WIDTH, COLLAGE_HEIGHT, COLLAGE_BORDER_WIDTH, COLLAGE_MAX_BORDER_WIDTH, collageBackgroundColor, collageInk, collageRandom } from './collage-config.js'
import { drawJournalElement } from './journal.js'
import { FONT_CN, FONT_EN, ensureFontLoaded } from './fonts.js'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const paperCache = new Map()
const canvas = (width, height) => {
  const result = document.createElement('canvas')
  result.width = width; result.height = height
  return result
}

function exteriorMask(data, width, height) {
  const exterior = new Uint8Array(width * height), queue = new Int32Array(width * height)
  let head = 0, tail = 0
  const add = index => {
    if (!exterior[index] && data[index * 4 + 3] === 0) { exterior[index] = 1; queue[tail++] = index }
  }
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1) }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width)
    if (x) add(index - 1)
    if (x + 1 < width) add(index + 1)
    if (y) add(index - width)
    if (y + 1 < height) add(index + width)
  }
  return exterior
}

// Exact squared Euclidean distance transform, separable in linear time.
function distanceLine(values, length, output, vertices, breaks) {
  let k = 0
  vertices[0] = 0; breaks[0] = -Infinity; breaks[1] = Infinity
  for (let q = 1; q < length; q++) {
    let intersection
    do {
      const p = vertices[k]
      intersection = ((values[q] + q * q) - (values[p] + p * p)) / (2 * (q - p))
      if (intersection <= breaks[k]) k--
      else break
    } while (k >= 0)
    k++; vertices[k] = q; breaks[k] = intersection; breaks[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < length; q++) {
    while (breaks[k + 1] < q) k++
    const d = q - vertices[k]
    output[q] = d * d + values[vertices[k]]
  }
}

export function createExteriorBorderPixels({ data, width, height }, radius) {
  const exterior = exteriorMask(data, width, height), distances = new Float64Array(width * height)
  const length = Math.max(width, height), values = new Float64Array(length), output = new Float64Array(length)
  const vertices = new Int32Array(length), breaks = new Float64Array(length + 1)
  const far = (width + height) ** 2 + 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) values[x] = data[(y * width + x) * 4 + 3] > 0 ? 0 : far
    distanceLine(values, width, output, vertices, breaks)
    for (let x = 0; x < width; x++) distances[y * width + x] = output[x]
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) values[y] = distances[y * width + x]
    distanceLine(values, height, output, vertices, breaks)
    for (let y = 0; y < height; y++) distances[y * width + x] = output[y]
  }
  const pixels = new Uint8ClampedArray(data.length)
  for (let i = 0; i < exterior.length; i++) if (radius > 0 && exterior[i] && distances[i] <= radius * radius) {
    pixels[i * 4] = 255; pixels[i * 4 + 1] = 255; pixels[i * 4 + 2] = 255; pixels[i * 4 + 3] = 255
  }
  return { data: pixels, width, height, exterior }
}

function strokeExteriorContours(ctx, data, exterior, width, height, radius) {
  const edges = new Map(), stride = width + 1
  const add = (x1, y1, x2, y2) => {
    const key = y1 * stride + x1
    if (!edges.has(key)) edges.set(key, [])
    edges.get(key).push(y2 * stride + x2)
  }
  // Only foreground/exterior interfaces participate; sealed alpha holes have
  // no exterior neighbours and never become contour strokes.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (data[i * 4 + 3] === 0) continue
    if (y === 0 || exterior[i - width]) add(x, y, x + 1, y)
    if (x === width - 1 || exterior[i + 1]) add(x + 1, y, x + 1, y + 1)
    if (y === height - 1 || exterior[i + width]) add(x + 1, y + 1, x, y + 1)
    if (x === 0 || exterior[i - 1]) add(x, y + 1, x, y)
  }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = radius * 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.setLineDash([Math.max(3, radius * 3), Math.max(3, radius * 2)])
  while (edges.size) {
    const start = edges.keys().next().value
    let current = start
    ctx.beginPath(); ctx.moveTo(start % stride, Math.floor(start / stride))
    do {
      const nexts = edges.get(current)
      if (!nexts?.length) break
      const next = nexts.pop()
      if (!nexts.length) edges.delete(current)
      ctx.lineTo(next % stride, Math.floor(next / stride)); current = next
    } while (current !== start)
    if (current === start) ctx.closePath()
    ctx.stroke()
  }
}

function borderCanvas(record, width, height, style, radius) {
  // Position/rotation changes reuse the same cache; even during resize each
  // asset keeps only three LRU entries. Rasterize at the exact content size so
  // fractional sizing cannot move a border across the PNG's transparent holes.
  const w = width, h = height, pad = Math.ceil(radius) + 2
  const key = `${w}:${h}:${style}:${radius}`
  if (record.borderCache.has(key)) {
    const cached = record.borderCache.get(key)
    record.borderCache.delete(key); record.borderCache.set(key, cached)
    return cached
  }
  const raster = canvas(Math.ceil(w) + pad * 2, Math.ceil(h) + pad * 2), ctx = raster.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(record.image, pad, pad, w, h)
  const source = ctx.getImageData(0, 0, raster.width, raster.height)
  const result = createExteriorBorderPixels(source, radius)
  ctx.clearRect(0, 0, raster.width, raster.height)
  if (style === 'dashed') {
    strokeExteriorContours(ctx, source.data, result.exterior, raster.width, raster.height, radius)
    const mask = canvas(raster.width, raster.height), maskCtx = mask.getContext('2d')
    const maskPixels = maskCtx.createImageData(raster.width, raster.height)
    for (let i = 0; i < result.exterior.length; i++) if (result.exterior[i]) maskPixels.data[i * 4 + 3] = 255
    maskCtx.putImageData(maskPixels, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0); ctx.globalCompositeOperation = 'source-over'
  } else {
    const pixels = ctx.createImageData(raster.width, raster.height)
    pixels.data.set(result.data); ctx.putImageData(pixels, 0, 0)
  }
  const entry = { canvas: raster, pad, width: w, height: h }
  record.borderCache.set(key, entry)
  while (record.borderCache.size > 3) record.borderCache.delete(record.borderCache.keys().next().value)
  return entry
}

function paper(color) {
  if (paperCache.has(color)) return paperCache.get(color)
  const result = canvas(COLLAGE_WIDTH, COLLAGE_HEIGHT), ctx = result.getContext('2d'), random = collageRandom('collage-paper-v1')
  ctx.fillStyle = color; ctx.fillRect(0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT)
  for (let i = 0; i < 18000; i++) {
    ctx.fillStyle = random() > .5 ? '#ffffff08' : '#0000000b'
    ctx.fillRect(Math.floor(random() * COLLAGE_WIDTH), Math.floor(random() * COLLAGE_HEIGHT), random() * 1.5 + .4, random() * 1.5 + .4)
  }
  paperCache.set(color, result)
  while (paperCache.size > 3) paperCache.delete(paperCache.keys().next().value)
  return result
}

function requiredAsset(store, id) {
  const record = store.get(id)
  if (!record?.image) throw new Error(`Missing image asset: ${id}`)
  return record
}

export function drawCollage(ctx, project, assetStore) {
  const background = project.background || { kind: 'paper-dark' }, elements = project.elements || []
  ctx.save()
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT)
    if (background.kind === 'photo') {
      const record = requiredAsset(assetStore, background.assetId)
      const scale = Math.max(COLLAGE_WIDTH / record.width, COLLAGE_HEIGHT / record.height)
      const width = record.width * scale, height = record.height * scale
      ctx.drawImage(record.image, -(width - COLLAGE_WIDTH) * clamp(background.offsetX ?? .5, 0, 1), -(height - COLLAGE_HEIGHT) * clamp(background.offsetY ?? .5, 0, 1), width, height)
    } else {
      const color = collageBackgroundColor(background)
      if (background.kind === 'solid') { ctx.fillStyle = color; ctx.fillRect(0, 0, COLLAGE_WIDTH, COLLAGE_HEIGHT) }
      else ctx.drawImage(paper(color), 0, 0)
    }
    const ink = collageInk(background, project.ink)
    for (const e of elements) {
      if (e.type !== 'imageSticker') { drawJournalElement(ctx, COLLAGE_WIDTH, COLLAGE_HEIGHT, { ...e, color: ink }, { elements }); continue }
      const record = requiredAsset(assetStore, e.assetId), width = e.width * COLLAGE_WIDTH / 1000, height = e.height * COLLAGE_HEIGHT / 1000
      ctx.save()
      try {
        ctx.translate(e.x * COLLAGE_WIDTH / 1000, e.y * COLLAGE_HEIGHT / 1000); ctx.rotate((e.rotation || 0) * Math.PI / 180)
        const radius = clamp(e.borderWidth ?? COLLAGE_BORDER_WIDTH, 0, COLLAGE_MAX_BORDER_WIDTH)
        if (e.borderStyle !== 'none' && radius > 0) {
          const cached = borderCanvas(record, width, height, e.borderStyle || 'solid', radius)
          ctx.beginPath(); ctx.rect(-width / 2 - radius, -height / 2 - radius, width + radius * 2, height + radius * 2); ctx.clip()
          ctx.drawImage(cached.canvas, -cached.width / 2 - cached.pad, -cached.height / 2 - cached.pad)
        }
        // The PNG itself is always drawn unmodified, after its independent border.
        ctx.drawImage(record.image, -width / 2, -height / 2, width, height)
      } finally { ctx.restore() }
    }
  } finally { ctx.restore() }
}

export async function exportCollage(project, assetStore) {
  const snapshot = structuredClone(project)
  const ids = (snapshot.elements || []).filter(e => e.type === 'imageSticker').map(e => e.assetId)
  if (snapshot.background?.kind === 'photo') ids.push(snapshot.background.assetId)
  const retained = assetStore.retain(ids)
  try {
    await ensureFontLoaded()
    if (document.fonts && ['Long Cang', 'Caveat'].some(family => ![...document.fonts].some(font => font.family.replaceAll('"', '').replaceAll("'", '') === family && font.status === 'loaded'))) throw new Error('Handwriting fonts are unavailable; retry export')
    await Promise.all([document.fonts?.ready, document.fonts?.load(`32px ${FONT_CN}`), document.fonts?.load(`24px ${FONT_EN}`), ...ids.map(id => retained.get(id).ready)])
    const result = canvas(COLLAGE_WIDTH, COLLAGE_HEIGHT)
    drawCollage(result.getContext('2d'), snapshot, retained)
    return await new Promise((resolve, reject) => result.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'))
  } finally { retained.release() }
}
