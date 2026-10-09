// Segmentation stays authoritative. This module only plans small display changes
// on its real edges; it never writes back to a detection or synthesizes a mask.
const MAX_INPUT_POINTS = 8192
const MAX_DRAW_POINTS = 2048
const EPSILON = 1e-7
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const emptyPlan = () => ({ strokes: [], totalLength: 0, visibleLength: 0, anchors: [] })

function preparePoints(input, logicalHeight) {
  if (!Array.isArray(input) || input.length < 3 || input.length > MAX_INPUT_POINTS
    || !Number.isFinite(logicalHeight) || logicalHeight <= 0 || logicalHeight > 100000) return null
  const points = []
  for (const point of input) {
    if (!Array.isArray(point) || point.length !== 2
      || typeof point[0] !== 'number' || typeof point[1] !== 'number'
      || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
      || point[0] < 0 || point[0] > 1000 || point[1] < 0 || point[1] > 1000) return null
    const next = [point[0], point[1] * logicalHeight / 1000]
    if (!points.length || distance(points.at(-1), next) > EPSILON) points.push(next)
  }
  if (points.length > 1 && distance(points[0], points.at(-1)) <= EPSILON) points.pop()
  // Remove only exactly straight intermediate samples. The same polygon with
  // uneven collinear sampling then receives the same gaps and pen pressure.
  const reduced = points.filter((point, i) => {
    const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length]
    const ax = point[0] - a[0], ay = point[1] - a[1], bx = b[0] - point[0], by = b[1] - point[1]
    return Math.abs(ax * by - ay * bx) > Math.hypot(ax, ay) * Math.hypot(bx, by) * 1e-10 || ax * bx + ay * by <= 0
  })
  return reduced.length >= 3 ? reduced : null
}

function hashSeed(value) {
  let hash = 2166136261
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

function seededRandom(seed) {
  let state = seed || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function sharpVertices(points) {
  let perimeter = 0
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % points.length], length = distance(a, b), start = perimeter
    perimeter += length
    return { a, b, length, start, end: perimeter }
  })
  const neighborhood = Math.min(10, perimeter / 4)
  const neighborAt = (index, direction) => {
    const at = (edges[index].start + direction * neighborhood + perimeter) % perimeter
    const edge = nearestEdge({ edges }, at), fraction = clamp((at - edge.start) / edge.length, 0, 1)
    return [edge.a[0] + (edge.b[0] - edge.a[0]) * fraction, edge.a[1] + (edge.b[1] - edge.a[1]) * fraction]
  }
  return points.map((point, i) => {
    if (points.length < 12) return true
    const previous = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length]
    const px = point[0] - previous[0], py = point[1] - previous[1], nx = next[0] - point[0], ny = next[1] - point[1]
    if ((px * nx + py * ny) / (Math.hypot(px, py) * Math.hypot(nx, ny)) > Math.cos(.28)) return false
    // Pixel stair steps turn by 90 degrees too. Measuring on a short physical
    // neighborhood identifies the feature's direction rather than its pixels.
    const a = neighborAt(i, -1), b = neighborAt(i, 1)
    const ax = point[0] - a[0], ay = point[1] - a[1], bx = b[0] - point[0], by = b[1] - point[1]
    const cosine = clamp((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)), -1, 1)
    return Math.acos(cosine) >= .6
  })
}

function contourRuns(points, sharp, logicalHeight) {
  const border = 1.5
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % points.length]
    const cropped = (a[0] <= border && b[0] <= border) || (a[0] >= 1000 - border && b[0] >= 1000 - border)
      || (a[1] <= border && b[1] <= border) || (a[1] >= logicalHeight - border && b[1] >= logicalHeight - border)
    return { a, b, index: i, length: distance(a, b), cropped, sharpA: sharp[i], sharpB: sharp[(i + 1) % points.length] }
  })
  // Start after an omitted edge, so a crop crossing the array seam cannot be
  // accidentally reconnected by a closePath or a newly invented straight line.
  const firstCrop = edges.findIndex(edge => edge.cropped)
  const runs = []
  let run = null
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[(i + firstCrop + 1) % edges.length]
    if (edge.cropped) { run = null; continue }
    if (!run) { run = { edges: [], length: 0, anchors: [], closed: firstCrop < 0 }; runs.push(run) }
    const next = { ...edge, start: run.length, end: run.length + edge.length }
    if (edge.sharpA) run.anchors.push({ at: next.start, point: edge.a })
    run.edges.push(next); run.length = next.end
  }
  for (const current of runs) {
    const last = current.edges.at(-1)
    if (last.sharpB || !current.closed) current.anchors.push({ at: current.length, point: last.b })
    if (!current.closed && !current.anchors.some(anchor => anchor.at === 0)) {
      current.anchors.unshift({ at: 0, point: current.edges[0].a })
    }
  }
  return { runs, edges }
}

function visibleIntervals(run, random, dashed, tiny) {
  if (tiny || run.length < 80) return [[0, run.length]]
  const gaps = []
  const protectedGap = (start, end) => run.anchors.some(anchor => start < anchor.at + 7 && end > anchor.at - 7)
    || start < 4 || end > run.length - 4
  if (dashed) {
    const scale = Math.max(1, run.length / 5000)
    for (let at = 0; at < run.length;) {
      const start = at + (7 + random() * 5) * scale, end = Math.min(run.length, start + (4 + random() * 3) * scale)
      if (start < run.length && !protectedGap(start, end)) gaps.push([start, end])
      at = end
    }
  } else {
    const count = Math.min(64, Math.floor(run.length / 76)), spacing = run.length / count
    for (let i = 0; i < count; i++) {
      const center = (i + .25 + random() * .5) * spacing, halfGap = 1.9 + random() * 1.1
      if (!protectedGap(center - halfGap, center + halfGap)) gaps.push([center - halfGap, center + halfGap])
    }
  }
  const intervals = []
  let start = 0
  for (const [gapStart, gapEnd] of gaps) { intervals.push([start, gapStart]); start = gapEnd }
  if (start < run.length) intervals.push([start, run.length])
  return intervals
}

function nearestEdge(run, at) {
  let low = 0, high = run.edges.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (run.edges[middle].end < at - EPSILON) low = middle + 1
    else high = middle
  }
  return run.edges[low]
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const fraction = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(point[0] - a[0] - fraction * dx, point[1] - a[1] - fraction * dy)
}

function displayPoint(run, at, allEdges, phase, logicalHeight) {
  const anchor = run.anchors.find(candidate => Math.abs(candidate.at - at) <= EPSILON)
  if (anchor) return [...anchor.point]
  const edge = nearestEdge(run, at), fraction = clamp((at - edge.start) / edge.length, 0, 1)
  const point = [edge.a[0] + (edge.b[0] - edge.a[0]) * fraction, edge.a[1] + (edge.b[1] - edge.a[1]) * fraction]
  // Sparse polygons and corners are exact. Only already dense, smooth regions
  // receive a tiny normal movement, with extra clearance around narrow necks.
  if (allEdges.length < 24 || allEdges.length > 1024 || edge.length > 16 || edge.sharpA || edge.sharpB) return point
  let clearance = Infinity
  for (const other of allEdges) {
    const delta = Math.abs(other.index - edge.index)
    if (delta <= 2 || delta >= allEdges.length - 2) continue
    clearance = Math.min(clearance, distanceToSegment(point, other.a, other.b))
    if (clearance < 2) return point
  }
  const anchorDistance = Math.min(at, run.length - at, ...run.anchors.map(candidate => Math.abs(candidate.at - at)))
  const movement = (.31 * Math.sin(at / 19 + phase) + .11 * Math.sin(at / 7.7 + phase * .6))
    * clamp(anchorDistance / 7, 0, 1)
  point[0] = clamp(point[0] - (edge.b[1] - edge.a[1]) / edge.length * movement, 0, 1000)
  point[1] = clamp(point[1] + (edge.b[0] - edge.a[0]) / edge.length * movement, 0, logicalHeight)
  return point
}

function planStrokes(runs, edges, intervalsByRun, lineWidth, phase, logicalHeight, density) {
  const totalLength = runs.reduce((sum, run) => sum + run.length, 0)
  const sampleStep = Math.max(2, totalLength / 800) * density
  const pressureStep = Math.max(18, totalLength / 100) * density
  const strokes = []
  for (const [index, run] of runs.entries()) {
    for (const [start, end] of intervalsByRun[index]) {
      for (let chunkStart = start; chunkStart < end - EPSILON;) {
        const chunkEnd = Math.min(end, (Math.floor((chunkStart + EPSILON) / pressureStep) + 1) * pressureStep)
        const stations = [chunkStart, chunkEnd]
        for (let at = (Math.floor(chunkStart / sampleStep) + 1) * sampleStep; at < chunkEnd - EPSILON; at += sampleStep) stations.push(at)
        for (const anchor of run.anchors) if (anchor.at > chunkStart + EPSILON && anchor.at < chunkEnd - EPSILON) stations.push(anchor.at)
        stations.sort((a, b) => a - b)
        const points = stations.filter((at, i) => !i || at - stations[i - 1] > EPSILON)
          .map(at => displayPoint(run, at, edges, phase, logicalHeight))
        const middle = (chunkStart + chunkEnd) / 2
        let pressure = 1 + .085 * Math.sin(middle / 29 + phase) + .025 * Math.sin(middle / 11 + phase * .7)
        if (middle - start < 4 || end - middle < 4) pressure -= .035
        strokes.push({ points, lineWidth: lineWidth * clamp(pressure, .88, 1.12), start: chunkStart, end: chunkEnd })
        chunkStart = chunkEnd
      }
    }
  }
  return strokes
}

/** Plan a single normalized mask ring in the journal's 1000-unit canvas. */
export function planSubjectContour(normalizedPoints, logicalHeight, options = {}) {
  const points = preparePoints(normalizedPoints, logicalHeight)
  if (!points) return emptyPlan()
  const sharp = sharpVertices(points)
  if (sharp.filter(Boolean).length > 1024) return emptyPlan()
  const { runs, edges } = contourRuns(points, sharp, logicalHeight)
  if (!runs.length) return emptyPlan()
  const bounds = points.reduce((b, point) => [Math.min(b[0], point[0]), Math.min(b[1], point[1]),
    Math.max(b[2], point[0]), Math.max(b[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity])
  const seed = hashSeed(options.seed ?? points.map(point => point.join(',')).join(';'))
  const random = seededRandom(seed), phase = random() * Math.PI * 2
  const tiny = Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) < 12
  const intervalsByRun = runs.map(run => visibleIntervals(run, random, !!options.dashed, tiny))
  const lineWidth = Number.isFinite(options.lineWidth) && options.lineWidth > 0 ? clamp(options.lineWidth, .2, 5) : 1.75
  let strokes
  for (let density = 1; density <= 8; density *= 2) {
    strokes = planStrokes(runs, edges, intervalsByRun, lineWidth, phase, logicalHeight, density)
    if (strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) <= MAX_DRAW_POINTS) break
  }
  if (strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) > MAX_DRAW_POINTS) return emptyPlan()
  return {
    strokes,
    totalLength: runs.reduce((sum, run) => sum + run.length, 0),
    visibleLength: intervalsByRun.flat().reduce((sum, [start, end]) => sum + end - start, 0),
    anchors: runs.flatMap(run => run.anchors.map(anchor => [...anchor.point])),
  }
}

/** Draw one ring. Calling separately for each ring keeps disconnected masks apart. */
export function drawSubjectContour(ctx, normalizedPoints, logicalHeight, options = {}) {
  const plan = planSubjectContour(normalizedPoints, logicalHeight, options)
  if (!plan.strokes.length) return plan
  ctx.save()
  try {
    if (typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
      ctx.beginPath(); ctx.rect(0, 0, 1000, logicalHeight); ctx.clip()
    }
    ctx.strokeStyle = typeof options.color === 'string' ? options.color : '#fffaf1e8'
    ctx.shadowColor = typeof options.shadowColor === 'string' ? options.shadowColor : '#211e1838'
    ctx.shadowBlur = .7; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = .2
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([])
    for (const stroke of plan.strokes) {
      ctx.lineWidth = stroke.lineWidth
      ctx.beginPath(); ctx.moveTo(...stroke.points[0])
      for (const point of stroke.points.slice(1)) ctx.lineTo(...point)
      ctx.stroke()
    }
  } finally {
    ctx.restore()
  }
  return plan
}
