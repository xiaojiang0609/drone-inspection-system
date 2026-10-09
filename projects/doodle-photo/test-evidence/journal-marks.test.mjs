import test from 'node:test'
import assert from 'node:assert/strict'
import { drawDoodle } from '../src/utils/journal-marks.js'

// A recording Canvas boundary lets Node inspect the geometry sent to the browser.
function canvasTrace() {
  const points = [], commands = []
  let strokes = 0, fills = 0
  const record = (name, values) => {
    commands.push([name, ...values])
    for (let i = 0; i < values.length; i += 2) points.push(values.slice(i, i + 2))
  }
  const ctx = {
    save() {}, restore() {}, scale() {}, beginPath() {},
    closePath() { commands.push(['close']) },
    stroke() { strokes++ }, fill() { fills++ },
    moveTo(...values) { record('move', values) },
    lineTo(...values) { record('line', values) },
    quadraticCurveTo(...values) { record('quadratic', values) },
    bezierCurveTo(...values) { record('bezier', values) },
    arc(x, y, radius, start, end) { this.ellipse(x, y, radius, radius, 0, start, end) },
    ellipse(x, y, rx, ry, rotation, start, end) {
      commands.push(['ellipse', x, y, rx, ry, rotation, start, end])
      for (let i = 0; i <= 72; i++) {
        const angle = start + (end - start) * i / 72
        const dx = Math.cos(angle) * rx, dy = Math.sin(angle) * ry
        points.push([x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
          y + dx * Math.sin(rotation) + dy * Math.cos(rotation)])
      }
    },
  }
  return { ctx, points, commands, get strokes() { return strokes }, get fills() { return fills } }
}

const motifs = ['cup', 'cutlery', 'chefHat', 'cake', 'camera', 'paperPlane', 'sun',
  'rainbow', 'paw', 'cat', 'sprout', 'book', 'headphones', 'bow']

for (const icon of motifs) {
  test(`${icon} renders a finite outline inside its element`, () => {
    const trace = canvasTrace()
    drawDoodle(trace.ctx, icon, 72)
    assert.ok(trace.commands.some(([name]) => ['line', 'quadratic', 'bezier', 'ellipse'].includes(name)),
      `${icon} must contain a visible stroke`)
    assert.equal(trace.strokes, 1)
    assert.equal(trace.fills, 0, 'the new motifs should keep the light outline aesthetic')
    assert.ok(trace.points.every(point => point.length === 2 && point.every(Number.isFinite)))
    assert.ok(trace.points.every(([x, y]) => Math.abs(x) <= .5 && Math.abs(y) <= .5),
      `${icon} must stay within the reserved element bounds`)
  })
}

test('the added motifs have distinct visible geometries', () => {
  const signatures = motifs.map(icon => {
    const trace = canvasTrace()
    drawDoodle(trace.ctx, icon, 72)
    return JSON.stringify(trace.commands)
  })
  assert.equal(new Set(signatures).size, motifs.length)
})

test('the original ten motifs still emit finite drawing geometry', () => {
  for (const icon of ['heart', 'smallHeart', 'sparkle', 'star', 'smiley', 'music', 'flower', 'leaf', 'butterfly', 'cloud']) {
    const trace = canvasTrace()
    drawDoodle(trace.ctx, icon, 72)
    assert.ok(trace.points.length > 0, `${icon} should remain drawable`)
    assert.ok(trace.points.every(point => point.every(Number.isFinite)))
  }
})

test('custom polylines fit inside the element with a five-percent margin', () => {
  const trace = canvasTrace()
  drawDoodle(trace.ctx, 'custom', 72, '#fffaf1', [[[0, 0], [500, 250], [1000, 1000]]])
  assert.deepEqual(trace.points, [[-.45, -.45], [0, -.225], [.45, .45]])
  assert.deepEqual(trace.commands.map(([name]) => name), ['move', 'line', 'line'])
})

test('custom geometry rejects malformed paths while retaining a valid neighboring path', () => {
  const trace = canvasTrace()
  const paths = [null, [[0, 0]], [[0, 0], [NaN, 1]], [[0, 0], [Infinity, 1]],
    [[0, 0], [-1, 500]], [[0, 0], [500, 1001]], [[0, 0], ['500', 500]],
    [[0, 0], [200, 200, 200]], [[250, 750], [750, 250]]]
  // Put a safe stroke inside the bounded input so it is independent of the cap.
  paths[1] = [[250, 750], [750, 250]]
  drawDoodle(trace.ctx, 'custom', 72, '#fffaf1', paths)
  assert.deepEqual(trace.points, [[-.45, .45], [.45, -.45]])
})

test('custom geometry caps the stroke count and the number of points per stroke', () => {
  const trace = canvasTrace()
  const path = Array.from({ length: 60 }, (_, i) => [i * 10, 500])
  drawDoodle(trace.ctx, 'custom', 72, '#fffaf1', Array.from({ length: 12 }, () => path))
  assert.equal(trace.commands.filter(([name]) => name === 'move').length, 8)
  assert.equal(trace.commands.filter(([name]) => name === 'line').length, 8 * 47)
  assert.ok(trace.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= .5 && Math.abs(y) <= .5))
})

test('missing or non-array custom paths do not emit geometry', () => {
  for (const paths of [undefined, null, {}, 'M 0 0 L 1000 1000', [[[0, 0]]]]) {
    const trace = canvasTrace()
    drawDoodle(trace.ctx, 'custom', 72, '#fffaf1', paths)
    assert.deepEqual(trace.points, [])
  }
})

test('sparse custom paths and points cannot produce nonfinite Canvas coordinates', () => {
  for (const paths of [[new Array(2)], [[[0, 0], new Array(2)]]]) {
    const trace = canvasTrace()
    assert.doesNotThrow(() => drawDoodle(trace.ctx, 'custom', 72, '#fffaf1', paths))
    assert.deepEqual(trace.points, [])
  }
})

test('small central custom sketches grow to the available area without stretching', () => {
  const trace = canvasTrace()
  drawDoodle(trace.ctx, 'custom', 86, '#fffaf1', [[[450, 400], [550, 400], [550, 600], [450, 600], [450, 400]]])
  assert.deepEqual(trace.points, [[-.225, -.45], [.225, -.45], [.225, .45], [-.225, .45], [-.225, -.45]])
})

test('custom fitting centers all strokes together while preserving their relative positions', () => {
  const trace = canvasTrace()
  drawDoodle(trace.ctx, 'custom', 86, '#fffaf1', [[[400, 400], [500, 400]], [[600, 600], [600, 500]]])
  assert.deepEqual(trace.points, [[-.45, -.45], [0, -.45], [.45, .45], [.45, 0]])
})

test('horizontal and vertical custom lines fit without nonfinite coordinates', () => {
  for (const [path, expected] of [
    [[[400, 500], [600, 500]], [[-.45, 0], [.45, 0]]],
    [[[500, 400], [500, 600]], [[0, -.45], [0, .45]]],
  ]) {
    const trace = canvasTrace()
    drawDoodle(trace.ctx, 'custom', 86, '#fffaf1', [path])
    assert.deepEqual(trace.points, expected)
  }
})

test('identical custom points do not produce empty or nonfinite strokes', () => {
  const trace = canvasTrace()
  drawDoodle(trace.ctx, 'custom', 86, '#fffaf1', [[[500, 500], [500, 500]], [[500, 500], [500, 500]]])
  assert.deepEqual(trace.points, [])
})
