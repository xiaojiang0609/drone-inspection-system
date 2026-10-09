import { inspectImageMetadata } from './collage-files.js'
import { MAX_IMAGE_FILE_BYTES, MAX_IMAGE_PIXELS } from './collage-config.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value)
const geometryError = () => { throw new Error('主体几何无效，请调整选框或提示点') }
const coords = (value, count) => {
  if (!Array.isArray(value) || value.length !== count || value.some(n => !finite(n) || n < 0 || n > 1000)) geometryError()
  return value
}
const box = value => { const b = coords(value, 4); if (b[0] >= b[2] || b[1] >= b[3]) geometryError(); return b }
const hints = (region, bounds) => {
  const positive = region.positive_points === undefined ? [] : region.positive_points
  const negative = region.negative_points === undefined ? [] : region.negative_points
  for (const [points, max] of [[positive, 4], [negative, 8]]) {
    if (!Array.isArray(points) || points.length > max) geometryError()
    points.forEach(point => coords(point, 2))
    if (new Set(points.map(point => point.join(','))).size !== points.length) geometryError()
  }
  if (positive.some(([x, y]) => x < bounds[1] || x > bounds[3] || y < bounds[0] || y > bounds[2])) geometryError()
  if (positive.some(p => negative.some(n => p[0] === n[0] && p[1] === n[1]))) geometryError()
  return [positive, negative]
}

export function validateCutoutSubject(subject) {
  if (!object(subject) || typeof subject.label !== 'string' || !subject.label.trim()) geometryError()
  const outer = box(subject.box_2d)
  hints(subject, outer)
  if (subject.segmentation_regions !== undefined) {
    const regions = subject.segmentation_regions
    if (!Array.isArray(regions) || !regions.length || regions.length > 8) geometryError()
    const foreground = new Set(), background = new Set()
    for (const region of regions) {
      if (!object(region)) geometryError()
      const bounds = box(region.box_2d === undefined ? region.tightbox_2d : region.box_2d)
      if (Math.min(bounds[2], outer[2]) <= Math.max(bounds[0], outer[0]) || Math.min(bounds[3], outer[3]) <= Math.max(bounds[1], outer[1])) geometryError()
      const [positive, negative] = hints(region, bounds)
      positive.forEach(point => foreground.add(point.join(',')))
      negative.forEach(point => background.add(point.join(',')))
    }
    if ([...foreground].some(point => background.has(point))) geometryError()
  }
  return subject
}

function validateData(data) {
  const bad = () => { throw new Error('抠图响应无效，请重试') }
  if (!object(data) || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.image)) bad()
  for (const name of ['width', 'height', 'original_width', 'original_height']) if (!Number.isInteger(data[name]) || data[name] <= 0) bad()
  if (Math.max(data.width, data.height) > 1536 || data.original_width * data.original_height > MAX_IMAGE_PIXELS) bad()
  try {
    const encoded = data.image.split(',')[1]
    if (encoded.length > Math.ceil(MAX_IMAGE_FILE_BYTES / 3) * 4) bad()
    const raw = atob(encoded)
    const metadata = inspectImageMetadata(Uint8Array.from(raw, char => char.charCodeAt(0)))
    if (metadata.format !== 'png' || metadata.animated || metadata.width !== data.width || metadata.height !== data.height) bad()
  } catch { throw new Error('抠图 PNG 头或尺寸无效，请重试') }
  validateCutoutSubject(data.subject)
  const crop = data.crop_box
  if (!Array.isArray(crop) || crop.length !== 4 || crop.some(n => !Number.isInteger(n) || n < 0) || crop[0] >= crop[2] || crop[1] >= crop[3] || crop[2] > data.original_width || crop[3] > data.original_height) bad()
  for (const name of ['caption', 'theme', 'emotion']) if (typeof data[name] !== 'string') bad()
  const regionCount = data.subject.segmentation_regions?.length || 1
  if (!Array.isArray(data.quality) || data.quality.length !== regionCount || data.quality.some(value => !object(value))) bad()
  if (!Array.isArray(data.contours)) bad()
  let contourPoints = 0
  for (const ring of data.contours) {
    if (!Array.isArray(ring) || ring.length < 3 || ring.length > 4096) bad()
    contourPoints += ring.length
    if (contourPoints > 16384) bad()
    for (const point of ring) if (!Array.isArray(point) || point.length !== 2 || !finite(point[0]) || !finite(point[1]) || point[0] < 0 || point[1] < 0 || point[0] > data.width || point[1] > data.height) bad()
  }
  return data
}

async function decodePng(data) {
  const image = new Image()
  image.src = data.image
  try { await image.decode() } catch { throw new Error('无法解码抠图 PNG，请重试') }
  if (image.naturalWidth !== data.width || image.naturalHeight !== data.height) throw new Error('抠图 PNG 尺寸与响应不一致')
}

export async function requestCutout(file, subject = null, { signal, fetchImpl = fetch, timeoutMs = 150000 } = {}) {
  if (subject !== null) validateCutoutSubject(subject)
  const controller = new AbortController()
  let timedOut = false, timer, rejectAbort
  const interrupted = new Promise((resolve, reject) => { rejectAbort = reject })
  const abort = () => {
    controller.abort()
    rejectAbort(timedOut ? new Error('抠图请求超时，请重试') : new DOMException('抠图已取消', 'AbortError'))
  }
  signal?.addEventListener('abort', abort, { once: true })
  timer = setTimeout(() => { timedOut = true; abort() }, timeoutMs)
  try {
    if (signal?.aborted) abort()
    const work = async () => {
      if (controller.signal.aborted) throw new DOMException('抠图已取消', 'AbortError')
      const body = new FormData()
      body.append('file', file)
      if (subject !== null) body.append('subject', JSON.stringify(subject))
      const response = await fetchImpl('/api/cutout', { method: 'POST', body, signal: controller.signal })
      let payload
      try { payload = await response.json() } catch {
        const error = new Error(response.ok ? '抠图响应不是有效 JSON，请重试' : `抠图失败（HTTP ${response.status}），请重试`)
        error.status = response.status
        throw error
      }
      if (!response.ok) {
        const detail = typeof payload?.detail === 'string' ? payload.detail : typeof payload?.error === 'string' ? payload.error : `抠图失败（HTTP ${response.status}），请重试`
        const error = new Error(detail); error.status = response.status; throw error
      }
      if (payload?.status !== 'success') throw new Error('抠图响应未成功，请重试')
      const data = validateData(payload.data)
      if (controller.signal.aborted) throw new DOMException('抠图已取消', 'AbortError')
      await decodePng(data)
      return data
    }
    return await Promise.race([interrupted, work()])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
