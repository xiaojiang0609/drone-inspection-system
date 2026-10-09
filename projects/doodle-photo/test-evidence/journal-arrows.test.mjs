import test from 'node:test'
import assert from 'node:assert/strict'
import { drawArrow } from '../src/utils/journal-marks.js'
import { planJournalArrow as plan } from '../src/utils/journal-arrows.js'
import * as arrowUtils from '../src/utils/journal-arrows.js'
const rectangle = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
const label = { id: 'caption', type: 'text', x: 300, y: 500, width: 100, height: 60, rotation: 0 }
const arrow = { id: 'arrow-3', type: 'arrow', labelId: 'caption', subjectIndex: 0, bend: 1 }
const subject = { box_2d: [350, 480, 650, 560], shape_contours: [rectangle(480, 350, 560, 650)] }
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const insideRect = (point, x1, y1, x2, y2) => point[0] >= x1 && point[0] <= x2 && point[1] >= y1 && point[1] <= y2

test('layout proximity uses the same projected contour target and physical photo coordinates', () => {
  assert.equal(typeof arrowUtils.nearestSubjectBoundary, 'function')
  const detection = { ...subject, shape_contours: [rectangle(550, 350, 600, 650), rectangle(420, 470, 440, 530)] }
  assert.deepEqual(arrowUtils.nearestSubjectBoundary(detection, [300, 750], 1500), [420, 750])
  assert.deepEqual(arrowUtils.nearestSubjectBoundary({ box_2d: [350, 480, 650, 560] }, [300, 325], 650), [480, 325])
  assert.equal(arrowUtils.nearestSubjectBoundary(detection, [NaN, 750], 1500), null)
  assert.equal(arrowUtils.nearestSubjectBoundary(detection, [300, 750], 0), null)
})

test('the arrow attaches to the closest edge projection across every contour', () => {
  const detection = { ...subject, shape_points: rectangle(800, 300, 850, 700),
    shape_contours: [rectangle(550, 350, 600, 650), rectangle(420, 470, 440, 530)] }
  const path = plan(arrow, [label], [detection], 1000)
  assert.ok(path)
  assert.deepEqual(path.target, [420, 500], 'project onto the second ring edge, between its vertices')
  assert.ok(Math.abs(distance(path.end, path.target) - 8) < .01)
  assert.ok(path.samples.every(point => point[0] < 420))
})

test('a tiny collinear contour still supplies a nearest segment attachment', () => {
  const path = plan(arrow, [{ ...label, y: 503 }], [{ ...subject, shape_contours: [[[430, 475], [430, 500], [430, 525]]] }], 1000)
  assert.ok(path)
  assert.deepEqual(path.target, [430, 503])
})

test('the source leaves the actual rotated label rectangle at portrait and landscape aspects', () => {
  for (const logicalHeight of [650, 1500]) {
    const rotated = { ...label, rotation: 41, width: 160, height: 60 }
    const path = plan(arrow, [rotated], [subject], logicalHeight)
    assert.ok(path)
    const dx = path.start[0] - 300, dy = path.start[1] - logicalHeight / 2
    const angle = 41 * Math.PI / 180
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle)
    assert.ok(Math.abs(localX) >= 87.9 || Math.abs(localY) >= 30 * logicalHeight / 1000 + 7.9)
    assert.deepEqual(path.target, [480, logicalHeight / 2])
    for (const point of [path.start, path.end, path.c1, path.c2, ...path.samples,
      ...path.headSegments.flatMap(segment => [segment.start, segment.control, segment.end])]) {
      assert.ok(point.every(Number.isFinite))
      assert.ok(point[0] >= 2 && point[0] <= 998 && point[1] >= 2 && point[1] <= logicalHeight - 2)
    }
  }
})

test('all visible label and decoration types block a crowded arrow corridor', () => {
  for (const type of ['text', 'note', 'bubble', 'doodle', 'stamp', 'tape']) {
    const obstacle = { id: `obstacle-${type}`, type, x: 415, y: 500, width: 60, height: 350, rotation: 8 }
    assert.equal(plan(arrow, [label, obstacle], [subject], 1000), null, type)
  }
})

test('every other mask ring and conservative uncertain or partial boxes block routes', () => {
  const blockingBox = [300, 390, 700, 445]
  const farRing = rectangle(800, 300, 850, 700)
  for (const obstacle of [
    { box_2d: [300, 390, 700, 850], shape_contours: [farRing, rectangle(390, 300, 445, 700)] },
    { box_2d: blockingBox },
    { box_2d: blockingBox, shape_contours: [farRing], outline_status: 'uncertain' },
    { box_2d: [300, 390, 700, 850], shape_contours: [farRing], outline_status: 'partial',
      segmentation_regions: [{ box_2d: blockingBox }], segmentation_quality: [{ outline_ready: false }] },
  ]) assert.equal(plan(arrow, [label], [subject, obstacle], 1000), null)
})

test('a small obstacle is avoided or suppresses the arrow without crossing it', () => {
  const obstacle = { box_2d: [478, 401, 522, 422], shape_contours: [rectangle(401, 478, 422, 522)] }
  const path = plan(arrow, [label], [subject, obstacle], 1000)
  if (path) assert.ok(path.samples.every(point => !insideRect(point, 398, 475, 425, 525)))
})

test('a neighboring object over the nearest tip can use a nearby real boundary attachment', () => {
  const neighbor = { box_2d: [480, 460, 520, 491], shape_contours: [rectangle(460, 480, 491, 520)] }
  const path = plan(arrow, [label], [subject, neighbor], 1000)
  assert.ok(path, 'a clear adjacent section of the target edge should remain usable')
  assert.equal(path.target[0], 480)
  assert.ok(path.target[1] < 475 || path.target[1] > 525)
  assert.ok(distance(path.target, [480, 500]) <= 48)
  assert.ok(path.samples.every(point => !insideRect(point, 455, 475, 496, 525)))
  assert.ok(path.length <= 210)
})

test('long arrows and targets too close to fit an open arrowhead are suppressed', () => {
  assert.equal(plan(arrow, [{ ...label, x: 100 }], [subject], 1000), null)
  assert.equal(plan(arrow, [{ ...label, x: 413 }], [subject], 1000), null)
})

test('crop-only contour edges are never reconnected into an attachment target', () => {
  const detection = { box_2d: [200, 0, 800, 20], shape_contours: [[[0, 200], [0, 500], [0, 800]]] }
  assert.equal(plan(arrow, [{ ...label, x: 120 }], [detection], 1000), null)
})

test('invalid coordinates fail safely while a valid bounded box can replace a missing mask', () => {
  assert.equal(plan(arrow, [{ ...label, rotation: Infinity }], [subject], 1000), null)
  assert.equal(plan(arrow, [{ ...label, x: NaN }], [subject], 1000), null)
  assert.equal(plan(arrow, [label], [subject], 0), null)
  assert.equal(plan(arrow, [label], [{ box_2d: [350, -30, Infinity, 560] }], 1000), null)
  const path = plan(arrow, [label], [{ box_2d: [350, 480, 650, 560], shape_contours: [[[NaN, 1], [2, 3], [4, 5]]] }], 1000)
  assert.ok(path)
  assert.deepEqual(path.target, [480, 500])
})

test('short curved bodies and small asymmetric open heads stay outside their target', () => {
  const path = plan(arrow, [label], [subject], 1000)
  assert.ok(path)
  assert.ok(path.length > 40 && path.length <= 220)
  assert.ok(path.c1[1] !== path.start[1] || path.c2[1] !== path.end[1])
  assert.equal(path.style.lineWidth, 1.65)
  assert.equal(path.headSegments.length, 2)
  const wings = path.headSegments.map(segment => distance(segment.start, path.end))
  assert.ok(wings.every(length => length >= 6 && length <= 11))
  assert.notEqual(wings[0], wings[1], 'a handdrawn open head has unequal wings')
  assert.ok(path.headSegments.every(segment => segment.end === path.end))
  assert.ok([...path.samples, ...path.headSegments.flatMap(segment => [segment.start, segment.control])]
    .every(point => !insideRect(point, 480, 350, 560, 650)))
})

test('arc-length dash rhythm and curve variation are stable without mutating the inputs', () => {
  const dashed = { ...arrow, dashed: true }
  const inputs = [dashed, [label], [subject]]
  const before = JSON.stringify(inputs)
  const first = plan(...inputs, 1000)
  assert.ok(first)
  assert.deepEqual(plan(...inputs, 1000), first)
  assert.equal(JSON.stringify(inputs), before)
  const chunks = first.bodyChunks.map(points => points.slice(1).reduce((sum, point, i) => sum + distance(point, points[i]), 0))
  assert.ok(chunks.length >= 4)
  assert.ok(chunks.every(length => length > 1 && length < 14))
  assert.ok(new Set(chunks.map(length => length.toFixed(1))).size > 2)
  assert.notDeepEqual(plan({ ...dashed, id: 'another-arrow' }, [label], [subject], 1000).c1, first.c1)
})

function canvasTrace(scale) {
  const strokes = []
  let path = []
  const point = (x, y) => [x * scale, y * scale]
  const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() { path = [] },
    moveTo(x, y) { path.push(['M', ...point(x, y)]) }, lineTo(x, y) { path.push(['L', ...point(x, y)]) },
    bezierCurveTo(...coords) { path.push(['C', ...coords.map(value => value * scale)]) },
    quadraticCurveTo(...coords) { path.push(['Q', ...coords.map(value => value * scale)]) },
    stroke() { strokes.push({ points: path, width: this.lineWidth * scale }) } }
  return { ctx, strokes }
}

test('preview and export render the same planned curves and expose suppressed arrows', () => {
  const preview = canvasTrace(.6), exported = canvasTrace(2)
  const first = drawArrow(preview.ctx, arrow, [label], [subject], 1000)
  const second = drawArrow(exported.ctx, arrow, [label], [subject], 1000)
  assert.ok(first)
  assert.deepEqual(first, second)
  assert.equal(preview.strokes.length, 2)
  assert.ok(preview.strokes[0].points.some(command => command[0] === 'C'))
  assert.equal(preview.strokes[1].points.filter(command => command[0] === 'Q').length, 2)
  assert.deepEqual(exported.strokes.map(stroke => ({ width: stroke.width / 2,
    points: stroke.points.map(([op, ...values]) => [op, ...values.map(value => Number((value / 2).toFixed(8)))]) })),
  preview.strokes.map(stroke => ({ width: stroke.width / .6,
    points: stroke.points.map(([op, ...values]) => [op, ...values.map(value => Number((value / .6).toFixed(8)))]) })))
  assert.equal(drawArrow(preview.ctx, arrow, [{ ...label, x: 100 }], [subject], 1000), null)
})
