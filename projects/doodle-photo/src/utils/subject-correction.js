const clamp = value => Math.max(0, Math.min(1000, value))
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value)

export const POINT_LIMITS = { positive_points: 4, negative_points: 8 }

function validPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(finiteNumber)
    && point.every(value => value >= 0 && value <= 1000)
}

function samePoint(a, b) { return a[0] === b[0] && a[1] === b[1] }

function insideBox([x, y], [y1, x1, y2, x2]) {
  return x >= x1 && x <= x2 && y >= y1 && y <= y2
}

function normalizedBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(finiteNumber)) return null
  const result = box.map(clamp)
  return result[0] < result[2] && result[1] < result[3] ? result : null
}

function cleanPoints(points, limit, accept) {
  const result = []
  if (!Array.isArray(points)) return result
  for (const point of points) {
    if (!validPoint(point) || !accept(point) || result.some(old => samePoint(old, point))) continue
    result.push([...point])
    if (result.length === limit) break
  }
  return result
}

function normalizedRegion(region) {
  if (!region || typeof region !== 'object') return null
  const box = normalizedBox(region.box_2d || region.tightbox_2d || region.box)
  if (!box) return null
  const positive = cleanPoints(region.positive_points, POINT_LIMITS.positive_points, point => insideBox(point, box))
  const negative = cleanPoints(region.negative_points, POINT_LIMITS.negative_points,
    point => !positive.some(old => samePoint(old, point)))
  return { box_2d: box, positive_points: positive, negative_points: negative }
}

function unionBox(regions) {
  return [
    Math.min(...regions.map(region => region.box_2d[0])),
    Math.min(...regions.map(region => region.box_2d[1])),
    Math.max(...regions.map(region => region.box_2d[2])),
    Math.max(...regions.map(region => region.box_2d[3])),
  ]
}

/** Map the actual displayed image rectangle, independently on each axis. */
export function normalizedPointer(clientX, clientY, rect) {
  if (!rect || ![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(finiteNumber)
    || rect.width <= 0 || rect.height <= 0) return null
  return [clamp((clientX - rect.left) / rect.width * 1000), clamp((clientY - rect.top) / rect.height * 1000)]
}

/** A drag runs in either direction; tiny boxes are deliberate no-ops. */
export function boxFromDrag(start, end) {
  if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 2 || end.length !== 2
    || ![...start, ...end].every(finiteNumber)) return null
  const [x1, y1] = start.map(clamp), [x2, y2] = end.map(clamp)
  const box = [Math.min(y1, y2), Math.min(x1, x2), Math.max(y1, y2), Math.max(x1, x2)]
  return box[2] - box[0] >= 5 && box[3] - box[1] >= 5 ? box : null
}

/** Produce a fresh editable draft without mutating detection data. */
export function createCorrectionGeometry(detection) {
  if (!detection || typeof detection !== 'object') return null
  const regions = Array.isArray(detection.segmentation_regions)
    ? detection.segmentation_regions.map(normalizedRegion).filter(Boolean) : []
  if (!regions.length) {
    const region = normalizedRegion(detection)
    if (!region) return null
    regions.push(region)
  }
  return { box_2d: unionBox(regions), segmentation_regions: regions }
}

/** Restore human-edited hint classes when a correction session is reopened. */
export function correctionManualFlags(detection, regionCount) {
  const saved = Array.isArray(detection?.manual_hint_regions) ? detection.manual_hint_regions : []
  return Array.from({ length: regionCount }, (_, index) => ({
    positive: saved[index]?.positive === true,
    negative: saved[index]?.negative === true,
  }))
}

/** Update the selected part while preserving every other part's box and hints. */
export function replaceCorrectionRegion(geometry, index, region) {
  const replacement = normalizedRegion(region)
  if (!replacement || !Number.isInteger(index) || index < 0 || index >= geometry.segmentation_regions.length) return null
  const regions = geometry.segmentation_regions.map((old, at) => at === index ? replacement : normalizedRegion(old))
  return { box_2d: unionBox(regions), segmentation_regions: regions }
}

/** The first manual hint can replace only its own class of earlier hints. */
export function addCorrectionPoint(region, kind, point, replace = false) {
  const result = normalizedRegion(region)
  if (!result || !Object.hasOwn(POINT_LIMITS, kind) || !validPoint(point)) return result
  const opposite = kind === 'positive_points' ? 'negative_points' : 'positive_points'
  if ((kind === 'positive_points' && !insideBox(point, result.box_2d))
    || result[opposite].some(old => samePoint(old, point))) return result
  const points = replace ? [] : result[kind]
  if (!points.some(old => samePoint(old, point)) && points.length < POINT_LIMITS[kind]) points.push([...point])
  result[kind] = points
  return result
}
