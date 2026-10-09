const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

function validRing(points) {
  return Array.isArray(points) && points.length >= 3 && Array.from(points).every(point =>
    Array.isArray(point) && point.length === 2 && Array.from(point).every(value =>
      Number.isFinite(value) && value >= 0 && value <= 1000))
}

function contourRings(detection, aspect) {
  const rings = Array.isArray(detection?.shape_contours) ? detection.shape_contours.filter(validRing) : []
  const valid = rings.length ? rings : validRing(detection?.shape_points) ? [detection.shape_points] : []
  return valid.map(points => points.map(([x, y]) => [x, y * aspect]))
}

function boxRing(box, aspect) {
  if (!Array.isArray(box) || box.length !== 4 || !Array.from(box).every(Number.isFinite)) return null
  const [y1, x1, y2, x2] = box.map(value => clamp(value, 0, 1000))
  if (!(x1 < x2 && y1 < y2)) return null
  return [[x1, y1 * aspect], [x2, y1 * aspect], [x2, y2 * aspect], [x1, y2 * aspect]]
}

function bounds(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const [x, y] of points) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y)
    x2 = Math.max(x2, x); y2 = Math.max(y2, y)
  }
  return { x1, y1, x2, y2 }
}

function elementRectangle(element, aspect) {
  if (!element || ![element.x, element.y, element.width, element.height].every(Number.isFinite)
    || !(element.width > 0 && element.height > 0) || element.x < 0 || element.x > 1000
    || element.y < 0 || element.y > 1000 || (element.rotation != null && !Number.isFinite(element.rotation))) return null
  const angle = (element.rotation || 0) * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const center = [element.x, element.y * aspect]
  const halfWidth = element.width / 2, halfHeight = element.height * aspect / 2
  const points = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]]
    .map(([x, y]) => [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos])
  return { points, center, halfWidth, halfHeight, cos, sin }
}

function projection(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const square = dx * dx + dy * dy
  const t = square ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / square, 0, 1) : 0
  return [a[0] + dx * t, a[1] + dy * t]
}

function onCrop(a, b, height) {
  // The mask is closed for collision protection, but crop edges are not real
  // silhouette attachment sites. Never remove vertices and bridge the gap.
  const border = 1.5, verticalBorder = height * border / 1000
  return (a[0] <= border && b[0] <= border) || (a[0] >= 1000 - border && b[0] >= 1000 - border)
    || (a[1] <= verticalBorder && b[1] <= verticalBorder)
    || (a[1] >= height - verticalBorder && b[1] >= height - verticalBorder)
}

function closestBoundary(center, rings, height) {
  let target = null, minimum = Infinity
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      if (distance(a, b) < .000001 || onCrop(a, b, height)) continue
      const point = projection(center, a, b)
      const gap = distance(center, point)
      if (gap < minimum) { minimum = gap; target = point }
    }
  }
  return target
}

/**
 * Cheap proximity anchor for caption placement, using the planner's exact
 * contour projection and crop rules. Both center and returned [x, y] use
 * physical width-1000 / logicalHeight coordinates; this does not route an
 * arrow or claim that the intervening space is clear.
 */
export function nearestSubjectBoundary(subject, center, logicalHeight) {
  if (!subject || !Number.isFinite(logicalHeight) || logicalHeight <= 4 || !Array.isArray(center)
    || center.length !== 2 || !Array.from(center).every(Number.isFinite)
    || center[0] < 0 || center[0] > 1000 || center[1] < 0 || center[1] > logicalHeight) return null
  const aspect = logicalHeight / 1000
  const rings = contourRings(subject, aspect)
  const fallback = boxRing(subject.box_2d, aspect)
  return closestBoundary(center, rings.length ? rings : fallback ? [fallback] : [], logicalHeight)
}

function nearbyBoundaryTargets(subject, center, nearest, height) {
  const gap = distance(center, nearest)
  const nx = -(nearest[1] - center[1]) / gap, ny = (nearest[0] - center[0]) / gap
  const aspect = height / 1000
  const contours = contourRings(subject, aspect)
  const fallback = boxRing(subject.box_2d, aspect)
  const rings = contours.length ? contours : fallback ? [fallback] : []
  const targets = [nearest]
  // Reproject shifted probes onto the unchanged real rings. This works for
  // dense pixel contours as well as long sparse edges, without connecting
  // removed crop vertices or inventing an attachment inside the target.
  for (const offset of [-18, 18, -32, 32, -48, 48]) {
    const point = closestBoundary([center[0] + nx * offset, center[1] + ny * offset], rings, height)
    if (point && distance(point, nearest) <= 48.001 && !targets.some(target => distance(target, point) < 2)) targets.push(point)
  }
  return targets
}

function arrowEndpoints(source, target) {
  const totalDistance = distance(source.center, target)
  if (totalDistance < .001) return null
  const ux = (target[0] - source.center[0]) / totalDistance, uy = (target[1] - source.center[1]) / totalDistance
  const localX = ux * source.cos + uy * source.sin, localY = -ux * source.sin + uy * source.cos
  const sourceExit = Math.min((source.halfWidth + 8) / Math.max(.000001, Math.abs(localX)),
    (source.halfHeight + 8) / Math.max(.000001, Math.abs(localY)))
  return { ux, uy, span: totalDistance - sourceExit - 8,
    start: [source.center[0] + ux * sourceExit, source.center[1] + uy * sourceExit],
    end: [target[0] - ux * 8, target[1] - uy * 8] }
}

function insidePolygon(point, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function obstacle(points, padding) {
  return { points, padding, ...bounds(points) }
}

function blocked(point, areas) {
  for (const area of areas) {
    const { padding, points } = area
    if (point[0] < area.x1 - padding || point[0] > area.x2 + padding
      || point[1] < area.y1 - padding || point[1] > area.y2 + padding) continue
    if (insidePolygon(point, points)) return true
    for (let i = 0; i < points.length; i++) {
      if (distance(point, projection(point, points[i], points[(i + 1) % points.length])) <= padding) return true
    }
  }
  return false
}

function protectedSubjects(detections, ownIndex, aspect) {
  const result = []
  for (const [index, detection] of detections.entries()) {
    const rings = contourRings(detection, aspect)
    const box = boxRing(detection?.box_2d, aspect)
    const padding = index === ownIndex ? 2.75 : 5
    for (const ring of rings) result.push(obstacle(ring, padding))
    // A failed/uncertain mask is not evidence of an empty safe space.
    if ((!rings.length || detection?.outline_status === 'uncertain') && box) result.push(obstacle(box, padding))
    if (detection?.outline_status === 'partial' && Array.isArray(detection.segmentation_regions)) {
      for (const [regionIndex, region] of detection.segmentation_regions.entries()) {
        if (detection.segmentation_quality?.[regionIndex]?.outline_ready === true) continue
        const failedBox = boxRing(region?.box_2d, aspect)
        if (failedBox) result.push(obstacle(failedBox, padding))
      }
    }
  }
  return result
}

function stableUnit(key, salt) {
  let hash = 2166136261
  for (const char of `${key}:${salt}`) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  // Avalanche adjacent arrow ids so their curves do not share a template.
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

function cubicPoint(start, c1, c2, end, t) {
  const a = lerp(start, c1, t), b = lerp(c1, c2, t), c = lerp(c2, end, t)
  return lerp(lerp(a, b, t), lerp(b, c, t), t)
}

function curveSamples(start, c1, c2, end) {
  const upperLength = distance(start, c1) + distance(c1, c2) + distance(c2, end)
  const count = Math.max(24, Math.ceil(upperLength / 1.5))
  return Array.from({ length: count + 1 }, (_, i) => cubicPoint(start, c1, c2, end, i / count))
}

function pathLength(points) {
  let length = 0
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i])
  return length
}

function headFor(end, c2, key) {
  const dx = end[0] - c2[0], dy = end[1] - c2[1], length = Math.hypot(dx, dy)
  if (length < .001) return []
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux
  return [-1, 1].map((side, index) => {
    const wingLength = (index ? 7.4 : 9.3) + stableUnit(key, `wing-${index}`) * .65
    const angle = .37 + stableUnit(key, `spread-${index}`) * .10
    const back = wingLength * Math.cos(angle), spread = wingLength * Math.sin(angle) * side
    const start = [end[0] - ux * back + nx * spread, end[1] - uy * back + ny * spread]
    const control = [end[0] - ux * back * .54 + nx * spread * .28,
      end[1] - uy * back * .54 + ny * spread * .28]
    return { start, control, end }
  })
}

function headSamples(segments) {
  return segments.flatMap(({ start, control, end }) => Array.from({ length: 12 }, (_, i) => {
    const t = i / 11
    return lerp(lerp(start, control, t), lerp(control, end, t), t)
  }))
}

function dashChunks(samples, key) {
  const cumulative = [0]
  for (let i = 1; i < samples.length; i++) cumulative.push(cumulative[i - 1] + distance(samples[i - 1], samples[i]))
  const length = cumulative[cumulative.length - 1]
  function pointAt(position) {
    for (let i = 1; i < cumulative.length; i++) {
      if (position <= cumulative[i]) {
        const segment = cumulative[i] - cumulative[i - 1]
        return lerp(samples[i - 1], samples[i], segment ? (position - cumulative[i - 1]) / segment : 0)
      }
    }
    return [...samples[samples.length - 1]]
  }
  const chunks = []
  for (let position = 0, index = 0; position < length; index++) {
    const visible = 6.5 + stableUnit(key, `dash-${index}`) * 4.4
    const finish = Math.min(length, position + visible)
    if (finish - position >= 1.5) {
      const chunk = [pointAt(position)]
      for (let i = 1; i < cumulative.length; i++) {
        if (cumulative[i] > position && cumulative[i] < finish) chunk.push(samples[i])
      }
      chunk.push(pointAt(finish)); chunks.push(chunk)
    }
    position = finish + 4.2 + stableUnit(key, `gap-${index}`) * 3.0
  }
  return chunks
}

/**
 * Plan a short white journal arrow without a canvas or input mutation.
 * Coordinates use a width of 1000 and the supplied physical logicalHeight.
 * start/c1/c2/end describe the cubic body. target is the nearest real edge
 * projection, or a nearby projected point if that attachment is obstructed.
 * samples are a dense, continuous collision-checked body trace;
 * bodyChunks use that same trace with stable, irregular arc-length dashes.
 * headSegments are two open quadratic wings { start, control, end }.
 * Return null when no finite, short, unobstructed route fits the photo.
 */
export function planJournalArrow(arrow, elements, detections, logicalHeight, options = {}) {
  if (!arrow || !Array.isArray(elements) || !Array.isArray(detections) || !Number.isFinite(logicalHeight)
    || logicalHeight <= 4 || !Number.isInteger(arrow.subjectIndex) || arrow.subjectIndex < 0) return null
  const label = elements.find(element => element && element.id === arrow.labelId)
  const subject = detections[arrow.subjectIndex]
  const aspect = logicalHeight / 1000
  const source = elementRectangle(label, aspect)
  if (!source || !subject) return null
  const nearest = nearestSubjectBoundary(subject, source.center, logicalHeight)
  if (!nearest) return null
  const firstEndpoints = arrowEndpoints(source, nearest)
  const maxLength = Number.isFinite(options.maxLength) ? clamp(options.maxLength, 1, 220) : 210
  if (!firstEndpoints || firstEndpoints.span < 18 || firstEndpoints.span > maxLength) return null

  const areas = protectedSubjects(detections, arrow.subjectIndex, aspect)
  for (const element of elements) {
    if (!element || element.type === 'arrow') continue
    const rectangle = elementRectangle(element, aspect)
    // Known visible elements with malformed bounds cannot prove a safe route.
    if (!rectangle) return null
    areas.push(obstacle(rectangle.points, element === label ? 4 : 6))
  }
  const inImage = point => point.every(Number.isFinite) && point[0] >= 2 && point[0] <= 998
    && point[1] >= 2 && point[1] <= logicalHeight - 2
  const key = String(arrow.id ?? `${arrow.labelId}-${arrow.subjectIndex}`)
  const preferredSide = Number.isFinite(arrow.bend) && arrow.bend !== 0 ? Math.sign(arrow.bend)
    : stableUnit(key, 'side') < .5 ? -1 : 1
  const curl = stableUnit(key, 'shape') > .52
  // A few gentle variants give a blocked path room to turn. If they do not
  // fit, suppress the mark instead of taking a detour across the photograph.
  const turns = [preferredSide, -preferredSide, preferredSide * .55, -preferredSide * .55,
    preferredSide * 1.38, -preferredSide * 1.38]
  for (const target of nearbyBoundaryTargets(subject, source.center, nearest, logicalHeight)) {
    const endpoints = target === nearest ? firstEndpoints : arrowEndpoints(source, target)
    if (!endpoints || endpoints.span < 18 || endpoints.span > maxLength) continue
    const { start, end, span, ux, uy } = endpoints
    if (![start, end].every(point => inImage(point) && !blocked(point, areas))) continue
    const bend = Math.min(42, 12 + span * (.12 + stableUnit(key, 'bend') * .12))
    const nx = -uy, ny = ux
    for (const turn of turns) {
      const offset = bend * turn
      const firstAlong = span * (.23 + stableUnit(key, 'first-control') * .10)
      const secondAlong = span * (.67 + stableUnit(key, 'second-control') * .10)
      const firstBend = offset * (curl ? 1.0 : .54)
      const secondBend = offset * (curl ? .34 : 1.0)
      const c1 = [start[0] + ux * firstAlong + nx * firstBend, start[1] + uy * firstAlong + ny * firstBend]
      const c2 = [start[0] + ux * secondAlong + nx * secondBend, start[1] + uy * secondAlong + ny * secondBend]
      if (![c1, c2].every(inImage)) continue
      const samples = curveSamples(start, c1, c2, end)
      const length = pathLength(samples)
      if (length > maxLength || samples.some(point => !inImage(point) || blocked(point, areas))) continue
      const headSegments = headFor(end, c2, key)
      if (headSegments.length !== 2 || headSegments.flatMap(segment => [segment.start, segment.control, segment.end]).some(point => !inImage(point))
        || headSamples(headSegments).some(point => !inImage(point) || blocked(point, areas))) continue
      const dashed = Boolean(arrow.dashed)
      return { start, end, c1, c2, target, samples, length, headSegments,
        bodyChunks: dashed ? dashChunks(samples, key) : [samples],
        style: { dashed, lineWidth: 1.65, color: '#fffaf1', shape: curl ? 'curl' : 'arc' } }
    }
  }
  return null
}
