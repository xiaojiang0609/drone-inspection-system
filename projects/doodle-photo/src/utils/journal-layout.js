import { journalTextHeight } from './journal-text.js'
import { nearestSubjectBoundary, planJournalArrow } from './journal-arrows.js'
import { ACCENT_DOODLES, DOODLE_TYPES, FEATURE_DOODLES, themedDoodles, validSketchPaths } from './doodle-catalog.js'

const intersects = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function polygonIntersectsRect(points, rect) {
  const inside = ([x, y]) => x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (inside(a)) return true
    const dx = b[0] - a[0], dy = b[1] - a[1]
    for (const x of [rect.x1, rect.x2]) {
      const t = dx ? (x - a[0]) / dx : -1
      if (t >= 0 && t <= 1 && a[1] + t * dy >= rect.y1 && a[1] + t * dy <= rect.y2) return true
    }
    for (const y of [rect.y1, rect.y2]) {
      const t = dy ? (y - a[1]) / dy : -1
      if (t >= 0 && t <= 1 && a[0] + t * dx >= rect.x1 && a[0] + t * dx <= rect.x2) return true
    }
  }
  // If no edges intersect, the rectangle may still be fully inside the mask.
  let contained = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [x1, y1] = points[i], [x2, y2] = points[j]
    if ((y1 > rect.y1) !== (y2 > rect.y1)
      && rect.x1 < (x2 - x1) * (rect.y1 - y1) / (y2 - y1) + x1) contained = !contained
  }
  return contained
}

export function elementBounds(e, padding = 0) {
  // Include rotation so the text corners cannot spill onto another subject.
  const angle = (e.rotation || 0) * Math.PI / 180
  const aspect = e.aspect || 1
  const w = Math.abs(e.width * Math.cos(angle)) + Math.abs(e.height * aspect * Math.sin(angle))
  const h = Math.abs(e.height * Math.cos(angle)) + Math.abs(e.width / aspect * Math.sin(angle))
  return { x1: e.x - w / 2 - padding, y1: e.y - h / 2 - padding,
    x2: e.x + w / 2 + padding, y2: e.y + h / 2 + padding }
}

export function constrainElementToImage(element, padding = 12) {
  let result = { ...element }
  let bounds = elementBounds(result)
  const scale = Math.min(1, (1000 - padding * 2) / (bounds.x2 - bounds.x1),
    (1000 - padding * 2) / (bounds.y2 - bounds.y1))
  if (scale < 1) {
    result.width *= scale
    result.height *= scale
    if (Number.isFinite(result.fontSize)) result.fontSize *= scale
    bounds = elementBounds(result)
  }
  const halfWidth = (bounds.x2 - bounds.x1) / 2, halfHeight = (bounds.y2 - bounds.y1) / 2
  result.x = clamp(result.x, padding + halfWidth, 1000 - padding - halfWidth)
  result.y = clamp(result.y, padding + halfHeight, 1000 - padding - halfHeight)
  return result
}

export function createJournalLayout(detections, meta, width, height, style, measure = (text, fontSize) => text.length * fontSize) {
  if (!detections.length) return []
  const aspect = height / width
  const boxes = detections.filter(d => d.box_2d).map(d => {
    const [y1, x1, y2, x2] = d.box_2d
    return { x1, y1, x2, y2 }
  })
  // A union rectangle erases all the useful gaps between multiple subjects.
  const protectedAreas = detections.flatMap((det, i) => {
    const rings = det.shape_contours?.length ? det.shape_contours : [det.shape_points]
    const valid = rings.filter(points => points?.length >= 3)
    if (valid.length) {
      const contours = valid.map(points => ({ points,
        x1: Math.min(...points.map(p => p[0])), x2: Math.max(...points.map(p => p[0])),
        y1: Math.min(...points.map(p => p[1])), y2: Math.max(...points.map(p => p[1])) }))
      const failed = det.outline_status === 'partial' ? (det.segmentation_regions || [])
        .filter((region, index) => region.box_2d && det.segmentation_quality?.[index]?.outline_ready !== true)
        .map(region => {
          const [y1, x1, y2, x2] = region.box_2d
          return { x1, y1, x2, y2 }
        }) : []
      return [...contours, ...failed]
    }
    return [detections.length === 1 && meta.safeZone ? meta.safeZone : boxes[i]].filter(Boolean)
  })
  const occupied = []
  const elements = []
  function candidates(w, h, preferred = []) {
    const points = [...preferred]
    for (const r of [...(meta.decorationZones || []), { x1: 0, y1: 0, x2: 1000, y2: 1000 }]) {
      for (const y of [r.y1 + h / 2 + 26, r.y2 - h / 2 - 26]) {
        for (const x of [r.x1 + w / 2 + 26, r.x2 - w / 2 - 26]) points.push({ x, y })
      }
      for (let y = r.y1 + h / 2 + 26; y + h / 2 < r.y2 - 20; y += 35) {
        for (let x = r.x1 + w / 2 + 26; x + w / 2 < r.x2 - 20; x += 40) points.push({ x, y })
      }
    }
    return points
  }
  function place(type, w, h, extra = {}, preferred = [], rank = null, accept = null) {
    const choices = candidates(w, h, preferred).map((point, index) => {
      if (type !== 'doodle' || index < preferred.length) return point
      // Stable offsets break up the search grid without moving API advice or text.
      const seed = index * 12.9898 + elements.length * 78.233
      return { x: point.x + Math.sin(seed) * 9, y: point.y + Math.cos(seed * .79) * 9 / aspect }
    }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(point => ({ ...point, score: rank ? rank(point) : 0 }))
    if (rank) choices.sort((a, b) => a.score - b.score)
    for (const p of choices) {
      const e = { id: `${style.id}-${type}-${elements.length}`, type, x: p.x, y: p.y,
        width: w, height: h, aspect, ...extra }
      if (accept && !accept(e)) continue
      const bounds = elementBounds(e, type === 'doodle' ? 8 : 12)
      if (bounds.x1 < 12 || bounds.y1 < 12 || bounds.x2 > 988 || bounds.y2 > 988) continue
      if (occupied.some(b => intersects(bounds, b))) continue
      if (protectedAreas.some(area => intersects(bounds, area)
        && (!area.points || polygonIntersectsRect(area.points, bounds)))) continue
      elements.push(e); occupied.push(bounds)
      return e
    }
    return null
  }
  const deferredCaptions = []
  let nearbyPass = true
  function annotation(det, index) {
    const [y1, x1, y2, x2] = det.box_2d || [350, 350, 650, 650]
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
    let label = null
    const text = String(det.caption || det.label || '').slice(0, 160)
    const anchors = new Map()
    const gapFromLabel = (point, w, h, rotation) => {
      const key = `${point.x},${point.y}`
      if (!anchors.has(key)) anchors.set(key, nearestSubjectBoundary(det, [point.x, point.y * aspect], 1000 * aspect))
      const target = anchors.get(key)
      if (!target) return Infinity
      const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
      const dx = target[0] - point.x, dy = target[1] - point.y * aspect
      const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos
      return Math.hypot(Math.max(0, Math.abs(localX) - w / 2), Math.max(0, Math.abs(localY) - h * aspect / 2))
    }
    const nearby = candidate => {
      const gap = gapFromLabel(candidate, candidate.width, candidate.height, candidate.rotation || 0)
      return gap >= 34 && gap <= 180
    }
    const suggestion = det.layout
    if (nearbyPass && suggestion && ['note', 'text'].includes(suggestion.type)
      && [suggestion.x, suggestion.y, suggestion.width, suggestion.fontSize, suggestion.rotation].every(Number.isFinite)) {
      const preferred = { x: clamp(suggestion.x, 0, 1000), y: clamp(suggestion.y, 0, 1000) }
      const rotation = clamp(suggestion.rotation, -8, 8)
      const initialWidth = clamp(suggestion.width, 180, 380)
      const initialFont = clamp(suggestion.fontSize, 22, 36)
      for (const scale of [1, .9, .8]) {
        const w = Math.max(180, initialWidth * scale), fontSize = Math.max(22, initialFont * scale)
        const type = style.annotationType === 'text' ? 'text' : suggestion.type
        const h = journalTextHeight(type, text, w, fontSize, measure) / aspect
        const rank = p => {
          const gap = gapFromLabel(p, w, h, rotation)
          if (p.x === preferred.x && p.y === preferred.y && gap >= 34 && gap <= 180) return 0
          const advice = Math.hypot(p.x - preferred.x, (p.y - preferred.y) * aspect)
          return Math.abs(gap - 55) + Math.max(0, gap - 180) * 4 + .18 * advice
        }
        label = place(type, w, h, { text, subjectIndex: index, rotation, fontSize }, [preferred], rank, nearby)
        if (label) break
      }
    }
    if (nearbyPass && !label && detections.length === 1 && style.maxPaperNotes > 0) {
      for (const w of [340, 280, 230, 180]) {
        const fontSize = w < 280 ? 26 : 30
        const h = journalTextHeight('note', text, w, fontSize, measure) / aspect
        label = place('note', w, h, { text, subjectIndex: index, rotation: -2, fontSize }, [], null, nearby)
        if (label) break
      }
    }
    if (nearbyPass && !label) {
      for (const [w, fontSize] of [[300, 27], [260, 24], [220, 24], [180, 22], [150, 22], [120, 20], [100, 18]]) {
        const h = journalTextHeight('text', text, w, fontSize, measure) / aspect
        const locations = { above: { x: cx, y: y1 - h / 2 - 35 / aspect },
          below: { x: cx, y: y2 + h / 2 + 35 / aspect },
          left: { x: x1 - w / 2 - 35, y: cy }, right: { x: x2 + w / 2 + 35, y: cy } }
        const ideal = locations[det.textPlacement] || locations.above
        const rotation = index % 2 ? 3 : -3
        const rank = p => {
          const gap = gapFromLabel(p, w, h, rotation)
          return Math.abs(gap - 55) + Math.max(0, gap - 180) * 4 + .12 * Math.hypot(p.x - ideal.x, (p.y - ideal.y) * aspect)
        }
        label = place('text', w, h, { text, subjectIndex: index, fontSize, rotation,
          underline: index === 0 }, [ideal, ...Object.values(locations)], rank, nearby)
        if (label) break
      }
    }
    if (!label && nearbyPass) {
      deferredCaptions.push([det, index])
      return
    }
    if (!label) {
      // Keep captions available when no nearby space exists, while the renderer
      // omits an unsafe long connector. Exhaust compact nearby choices first.
      for (const [w, fontSize] of [[220, 24], [180, 22], [150, 22], [120, 20], [100, 18]]) {
        const h = journalTextHeight('text', text, w, fontSize, measure) / aspect
        const rotation = index % 2 ? 3 : -3
        label = place('text', w, h, { text, subjectIndex: index, fontSize, rotation, underline: index === 0 }, [],
          p => gapFromLabel(p, w, h, rotation))
        if (label) break
      }
    }
    if (label) {
      elements.push({ id: `${style.id}-arrow-${index}`, type: 'arrow', labelId: label.id, subjectIndex: index,
        x: label.x, y: label.y, width: 0, height: 0, bend: index % 2 ? -1 : 1, dashed: index % 3 === 1 })
    }
  }
  // Crowded photos reserve nearby caption space before considering a title.
  if (detections.length > 6) detections.forEach(annotation)
  const headline = meta.headline === null ? null : meta.headline && typeof meta.headline.text === 'string' ? meta.headline
    : {text: '留住这一刻的小美好', x: 760, y: 130, width: 360, fontSize: 34, rotation: -2}
  const headlinePoint = {x: Number.isFinite(headline?.x) ? clamp(headline.x, 0, 1000) : 760,
    y: Number.isFinite(headline?.y) ? clamp(headline.y, 0, 1000) : 130}
  for (const scale of headline ? [1, .9, .8] : []) {
    const w = clamp(Number.isFinite(headline.width) ? headline.width : 360, 260, 420) * scale
    const fontSize = clamp(Number.isFinite(headline.fontSize) ? headline.fontSize : 34, 28, 38) * scale
    const text = String(headline.text).trim().slice(0, 48)
    if (!text) break
    const h = journalTextHeight('bubble', text, w, fontSize, measure) / aspect
    const bubble = place('bubble', w, h, {text, fontSize, rotation: Number.isFinite(headline.rotation) ? clamp(headline.rotation, -5, 5) : 0}, [headlinePoint],
      p => Math.hypot(p.x - headlinePoint.x, (p.y - headlinePoint.y) * aspect))
    if (bubble) break
  }
  if (detections.length <= 6) detections.forEach(annotation)
  nearbyPass = false
  deferredCaptions.forEach(([det, index]) => annotation(det, index))
  for (const caption of (Array.isArray(meta.ambientCaptions) ? meta.ambientCaptions : []).slice(0, 2)) {
    if (!caption || typeof caption.text !== 'string' || !caption.text.trim() || !Number.isFinite(caption.x) || !Number.isFinite(caption.y)) continue
    const text = caption.text.trim().slice(0, 36)
    const w = clamp(Number.isFinite(caption.width) ? caption.width : 250, 150, 300)
    const fontSize = clamp(Number.isFinite(caption.fontSize) ? caption.fontSize : 24, 22, 28)
    const h = journalTextHeight('text', text, w, fontSize, measure) / aspect
    place('text', w, h, {text, fontSize, rotation: Number.isFinite(caption.rotation) ? clamp(caption.rotation, -5, 5) : 0, underline: true}, [caption],
      p => Math.hypot(p.x - caption.x, (p.y - caption.y) * aspect))
  }
  // Stationery is a small accent; each subject's words remain beside that subject.
  if (style.maxPaperNotes > 0 && detections.length > 1) {
    const title = `${meta.theme && meta.theme !== '其他' ? meta.theme : detections[0].label}小记`
    place('note', 230, journalTextHeight('note', title, 230, 28, measure) / aspect, { text: title,
      rotation: -2, fontSize: 28 })
  } else if (style.maxPaperNotes > 0) {
    const note = elements.find(e => e.type === 'note')
    if (note) place('stamp', 86, 86 / aspect, { rotation: 8 }, [{ x: note.x + note.width / 2 + 76, y: note.y }])
  }
  const motifs = themedDoodles(meta.theme, detections)
  const customShapes = new Set()
  const suggestions = (Array.isArray(meta.decorations) ? meta.decorations : []).filter(s => s
    && Number.isFinite(s.x) && Number.isFinite(s.y)
    && (DOODLE_TYPES.has(s.type) || (s.type === 'custom' && validSketchPaths(s.paths)))).filter(s => {
    if (s.type !== 'custom') return true
    const signature = JSON.stringify(s.paths)
    if (customShapes.has(signature)) return false
    customShapes.add(signature)
    return true
  }).slice(0, 18).sort((a, b) => Number(b.type === 'custom') - Number(a.type === 'custom'))
  // Decorative marks must not take away an already-safe caption connection.
  for (const arrow of elements.filter(e => e.type === 'arrow')) {
    const plan = planJournalArrow(arrow, elements, detections, 1000 * aspect)
    if (!plan) continue
    const trace = [...plan.samples]
    for (const { start, control, end } of plan.headSegments) {
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, u = 1 - t
        trace.push([u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
          u * u * start[1] + 2 * u * t * control[1] + t * t * end[1]])
      }
    }
    for (const [x, physicalY] of trace) protectedAreas.push({
      x1: x - 7, x2: x + 7, y1: (physicalY - 7) / aspect, y2: (physicalY + 7) / aspect,
    })
  }
  const freePoints = []
  for (let y = 35; y < 980; y += 50) for (let x = 35; x < 980; x += 50) {
    const bounds = { x1: x - 16, y1: y - 16 / aspect, x2: x + 16, y2: y + 16 / aspect }
    if (bounds.y1 < 12 || bounds.y2 > 988) continue
    if (!occupied.some(area => intersects(bounds, area)) && !protectedAreas.some(area => intersects(bounds, area)
      && (!area.points || polygonIntersectsRect(area.points, bounds)))) freePoints.push({ x, y })
  }
  const freeRatio = freePoints.length / (19 * 19)
  const freeArea = freeRatio * clamp(aspect, .6, 1.8)
  const count = freePoints.length ? Math.min(style.maxDoodles, Math.round(10 + 26 * Math.sqrt(freeArea))) : 0
  const featureLimit = freeArea > .24 ? 3 : 2
  const customSlots = Math.min(2, suggestions.filter(s => s.type === 'custom').length)
  const smallMotifs = motifs.filter(icon => !FEATURE_DOODLES.has(icon))
  const sceneFeatures = motifs.filter(icon => FEATURE_DOODLES.has(icon))
  let adviceIndex = 0, sceneIndex = 0
  for (let i = 0; i < count; i++) {
    const suggestion = i % 3 !== 0 || !sceneFeatures.length ? suggestions[adviceIndex++] : null
    let proposed = suggestion?.type || (i % 3 === 0 && sceneIndex < sceneFeatures.length
      ? sceneFeatures[sceneIndex++] : smallMotifs[i % smallMotifs.length])
    const used = icon => elements.filter(e => e.type === 'doodle' && e.icon === icon).length
    const existing = elements.filter(e => e.type === 'doodle')
    const features = existing.filter(e => e.icon !== 'custom' && FEATURE_DOODLES.has(e.icon)).length
    const repeatLimit = proposed === 'custom' ? 2 : FEATURE_DOODLES.has(proposed) ? 1 : ACCENT_DOODLES.has(proposed) ? 4 : 3
    if (used(proposed) >= repeatLimit || (proposed !== 'custom'
      && FEATURE_DOODLES.has(proposed) && features >= featureLimit - customSlots)) {
      proposed = [...smallMotifs].sort((a, b) => used(a) - used(b))[0]
    }
    let icon = proposed
    const feature = FEATURE_DOODLES.has(icon)
    const size = (feature ? [66, 58, 62][i % 3] : ACCENT_DOODLES.has(icon)
      ? [30, 24, 34, 22, 28, 20][i % 6] : [38, 32, 30, 42][i % 4])
      * (Number.isFinite(suggestion?.scale) ? clamp(suggestion.scale, .6, 1.2) : 1)
    const related = detections.filter(det => themedDoodles(null, [det]).includes(icon))
    const det = related[i % related.length] || detections[i % detections.length]
    const [y1, x1, y2, x2] = det.box_2d || [300, 300, 700, 700]
    const subjectPoint = { x: i % 2 ? x2 + 40 : x1 - 40, y: i % 3 ? y1 - 30 / aspect : y2 + 30 / aspect }
    const spacePoint = freePoints[(i * 137 + 53) % freePoints.length]
    const preferred = [...(suggestion ? [suggestion] : []), subjectPoint, spacePoint]
    const target = suggestion || (feature ? subjectPoint : spacePoint)
    const rank = p => {
      const cellX = Math.floor(p.x / 334), cellY = Math.floor(p.y / 334)
      let crowding = 0
      for (const e of existing) {
        const distance = Math.hypot(p.x - e.x, (p.y - e.y) * aspect)
        crowding += Math.max(0, 1 - distance / 120) * 180
        if (Math.floor(e.x / 334) === cellX && Math.floor(e.y / 334) === cellY) crowding += 75
      }
      return crowding + (feature ? .5 : .16) * Math.hypot(p.x - target.x, (p.y - target.y) * aspect)
    }
    const rotation = Number.isFinite(suggestion?.rotation) ? clamp(suggestion.rotation, -15, 15)
      : [-11, 7, -3, 13, 2, -8][i % 6]
    let mark = null
    for (const scale of [1, .78, .58]) {
      const extent = Math.max(feature ? 36 : 14, size * scale)
      mark = place('doodle', extent, extent / aspect, { icon, color: '#fffaf1', rotation,
        ...(icon === 'custom' ? { paths: suggestion.paths, label: suggestion.label || 'AI 线稿' } : {}) }, preferred, rank)
      if (mark) break
    }
    if (!mark) {
      // A failed large motif may still have room for a tiny hand-drawn accent.
      icon = [...smallMotifs].sort((a, b) => used(a) - used(b))[0]
      place('doodle', 16, 16 / aspect, { icon, color: '#fffaf1', rotation }, [spacePoint], rank)
    }
  }
  return elements
}
