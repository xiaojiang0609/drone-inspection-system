import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const modulePath = new URL('../src/utils/journal-contours.js', import.meta.url)
const exists = await fs.access(modulePath).then(() => true, () => false)
const contour = exists ? await import(modulePath.href) : {}
const plan = (...args) => {
  assert.equal(typeof contour.planSubjectContour, 'function', 'a contour planner must exist')
  return contour.planSubjectContour(...args)
}
const draw = (...args) => {
  assert.equal(typeof contour.drawSubjectContour, 'function', 'a contour renderer must exist')
  return contour.drawSubjectContour(...args)
}
const pointsOf = result => result.strokes.flatMap(stroke => stroke.points)
const hasPoint = (result, point) => pointsOf(result).some(([x, y]) => x === point[0] && y === point[1])
const circle = (count = 180, radius = 150) => Array.from({ length: count }, (_, i) => {
  const t = i * Math.PI * 2 / count
  return [500 + radius * Math.cos(t), 500 + radius * Math.sin(t)]
})
const segmentsOf = result => result.strokes.flatMap(stroke => stroke.points.slice(1)
  .map((point, i) => [stroke.points[i], point]))

test('invalid or absent masks produce no invented outline and leave valid rings usable', () => {
  for (const points of [null, [], [[2, 3]], [[2, 3], [4, 5]], [[2, 3], [NaN, 5], [8, 9]],
    [[2, 3], [Infinity, 5], [8, 9]], [[2, 3], null, [8, 9]]]) {
    assert.deepEqual(plan(points, 1000).strokes, [])
  }
  assert.deepEqual(plan(circle(), NaN).strokes, [])
  assert.ok(plan([[100, 100], [120, 100], [120, 120]], 1000).strokes.length)
})

test('strict normalized coordinate pairs reject malformed whole rings without inventing clipped borders', () => {
  const invalidRings = [
    [[-100, 100], [300, 100], [300, 300], [-100, 300]],
    [[1100, 100], [300, 100], [300, 300], [1100, 300]],
    [[100, -1], [300, 100], [300, 300]],
    [[100, 1001], [300, 100], [300, 300]],
    [[100, 100, 7], [300, 100], [300, 300]],
    [['100', 100], [300, 100], [300, 300]],
    [[100, false], [300, 100], [300, 300]],
    [[true, 100], [300, 100], [300, 300]],
    [[100, ,], [300, 100], [300, 300]],
    [[100, 100], , [300, 300]],
  ]
  for (const ring of invalidRings) {
    const before = structuredClone(ring)
    assert.equal(plan(ring, 1000).strokes.length, 0, `invalid ring must remain undrawn: ${JSON.stringify(ring)}`)
    assert.deepEqual(ring, before, 'validation must not rewrite invalid detection input')
  }
  assert.ok(plan([[0, 100], [300, 100], [300, 1000]], 1000).strokes.length, 'range endpoints remain valid')
  assert.ok(plan([[100, 100], [300, 100], [300, 300]], 1000).strokes.length, 'another valid ring remains usable')
})

test('sharp ear tips and corners stay exact and visible despite breathing gaps', () => {
  const ears = [[150, 400], [230, 70], [330, 260], [700, 260], [810, 80], [900, 400]]
  for (const dashed of [false, true]) {
    const result = plan(ears, 1000, { seed: 'cat-ears', dashed })
    for (const point of ears) assert.ok(hasPoint(result, point), `missing original anchor ${point}`)
  }
})

test('solid contour gaps depend on path length rather than irregular raw point sampling', () => {
  const sparse = [[100, 100], [300, 100], [300, 300], [100, 300]]
  const irregular = [[100, 100], [101, 100], [104, 100], [170, 100], [299, 100], [300, 100],
    [300, 103], [300, 201], [300, 300], [289, 300], [130, 300], [100, 300], [100, 110]]
  const regular = plan(sparse, 1000, { seed: 'same-shape' })
  const uneven = plan(irregular, 1000, { seed: 'same-shape' })
  assert.deepEqual(uneven, regular)
  assert.ok(regular.visibleLength / regular.totalLength >= .84)
  assert.ok(regular.visibleLength / regular.totalLength <= .96)
})

test('dense pixel stairs allow breathing gaps while their real large corners remain exact', () => {
  const stairs = [[100, 100]]
  for (let i = 1; i <= 100; i++) stairs.push([100 + i * 2, 98 + i * 2], [100 + i * 2, 100 + i * 2])
  stairs.push([300, 100])
  const result = plan(stairs, 1000, { seed: 'pixel-stairs' })
  for (const point of [[100, 100], [300, 300], [300, 100]]) assert.ok(hasPoint(result, point))
  assert.ok(result.visibleLength / result.totalLength <= .96, 'tiny staircase turns must not prohibit all gaps')
  assert.ok(result.visibleLength / result.totalLength >= .84)
})

test('crop-edge segments stay open even when the first source vertex lies on the crop', () => {
  for (const points of [
    [[0, 100], [0, 800], [300, 800], [300, 100]],
    [[100, 1000], [900, 1000], [900, 100], [100, 100]],
    [[1000, 100], [1000, 800], [700, 800], [700, 100]],
    [[100, 0], [900, 0], [900, 300], [100, 300]],
  ]) {
    const result = plan(points, 1000, { seed: 'cropped' })
    assert.ok(result.strokes.length)
    for (const [a, b] of segmentsOf(result)) {
      assert.ok(!((a[0] <= 1.5 && b[0] <= 1.5) || (a[0] >= 998.5 && b[0] >= 998.5)
        || (a[1] <= 1.5 && b[1] <= 1.5) || (a[1] >= 998.5 && b[1] >= 998.5)), 'artificial crop segment')
    }
    for (const point of points) assert.ok(hasPoint(result, point), `real edges must reach crop ${point}`)
  }
})

test('tiny masks keep a complete readable contour including when dashed is requested', () => {
  const tiny = [[100, 100], [105, 100], [105, 105], [100, 105]]
  for (const dashed of [false, true]) {
    const result = plan(tiny, 1000, { dashed })
    assert.equal(result.totalLength, 20)
    assert.equal(result.visibleLength, 20)
    for (const point of tiny) assert.ok(hasPoint(result, point))
  }
})

test('a tiny densely sampled mask remains visible instead of becoming thousands of false sharp anchors', () => {
  const result = plan(circle(8192, 1), 1000)
  assert.ok(result.strokes.length, 'small real masks still need a visible boundary')
  assert.equal(result.visibleLength, result.totalLength)
  assert.ok(pointsOf(result).length <= 2048)
})

test('smooth contour variation stays within a subpixel distance of the actual mask', () => {
  const source = circle()
  const result = plan(source, 1000, { seed: 'soft-circle' })
  const nearestSegment = point => Math.min(...source.map((a, i) => {
    const b = source[(i + 1) % source.length], dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
  }))
  const deviation = pointsOf(result).map(nearestSegment)
  assert.ok(Math.max(...deviation) <= .8, 'display must not replace precise segmentation geometry')
  assert.ok(deviation.some(distance => distance > .05), 'a smooth long edge can have bounded pen variation')
  assert.ok(result.visibleLength / result.totalLength >= .84 && result.visibleLength / result.totalLength <= .96)
  const widths = result.strokes.map(stroke => stroke.lineWidth)
  assert.ok(Math.min(...widths) >= 1.75 * .88 && Math.max(...widths) <= 1.75 * 1.12)
  assert.ok(Math.max(...widths) - Math.min(...widths) > .08, 'subtle pressure variation should remain visible')
})

test('real dense SAM contours retain their geometry along complete stroke segments', async () => {
  const fixture = JSON.parse(await fs.readFile(new URL('./cat-contour-fixed.json', import.meta.url), 'utf8'))
  const detection = fixture.data[0], before = structuredClone(fixture)
  for (const ring of detection.shape_contours?.length ? detection.shape_contours : [detection.shape_points]) {
    const result = plan(ring, 683, { seed: detection.label })
    const original = ring.map(([x, y]) => [x, y * 683 / 1000])
    for (const [a, b] of segmentsOf(result)) {
      for (const fraction of [0, .25, .5, .75, 1]) {
        const point = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]
        const deviation = Math.min(...original.map((p, i) => {
          const q = original[(i + 1) % original.length], dx = q[0] - p[0], dy = q[1] - p[1]
          const t = Math.max(0, Math.min(1, ((point[0] - p[0]) * dx + (point[1] - p[1]) * dy) / (dx * dx + dy * dy)))
          return Math.hypot(point[0] - p[0] - t * dx, point[1] - p[1] - t * dy)
        }))
        assert.ok(deviation <= 1, `stroke shortcut deviates ${deviation} units from its source mask`)
      }
    }
    assert.ok(result.visibleLength / result.totalLength >= .84 && result.visibleLength / result.totalLength <= .96)
  }
  assert.deepEqual(fixture, before, 'all detection metadata and backend polygons stay unchanged')
})

test('portrait and wide render plans stay finite and entirely inside their image', () => {
  for (const height of [260, 683, 1800, 3500]) {
    const result = plan(circle(), height, { seed: 'aspect-safe' })
    assert.ok(result.strokes.length)
    for (const [x, y] of pointsOf(result)) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y))
      assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= height)
    }
  }
})

test('a minority dashed contour uses short uneven marks rather than a fixed canvas dash', () => {
  const result = plan(circle(), 1000, { seed: 'irregular-dashes', dashed: true })
  const runs = []
  for (const stroke of result.strokes) {
    const first = stroke.points[0], last = stroke.points.at(-1)
    const previous = runs.at(-1)
    if (previous && previous.end[0] === first[0] && previous.end[1] === first[1]) {
      previous.length += stroke.end - stroke.start
      previous.end = last
    } else runs.push({ length: stroke.end - stroke.start, end: last })
  }
  assert.ok(runs.length > 30)
  assert.ok(runs.slice(1, -1).every(run => run.length >= 7 - 1e-6 && run.length <= 12 + 1e-6))
  assert.ok(new Set(runs.map(run => run.length.toFixed(1))).size > 10)
})

test('rendering is deterministic, uses warm fine ink, clips the image and never changes backend polygons', () => {
  const source = circle()
  const original = structuredClone(source)
  const capture = () => {
    const commands = []
    const ctx = new Proxy({}, {
      set(target, key, value) { commands.push([key, value]); target[key] = value; return true },
      get(target, key) { return target[key] ?? ((...args) => commands.push([key, ...args])) },
    })
    draw(ctx, source, 683, { seed: 'preview-export' })
    return commands
  }
  const preview = capture(), exported = capture()
  assert.deepEqual(exported, preview)
  assert.deepEqual(source, original)
  assert.ok(preview.some(command => command[0] === 'strokeStyle' && command[1] === '#fffaf1e8'))
  assert.ok(preview.some(command => command[0] === 'clip'))
  assert.ok(preview.every(command => command[0] !== 'closePath'), 'crop paths must never be forcibly closed')
  assert.ok(preview.filter(command => command[0] === 'lineWidth').every(command => command[1] < 2))
})

test('separate rings remain disconnected and over-budget input is rejected safely', () => {
  const a = plan([[100, 100], [120, 100], [120, 120]], 1000)
  const b = plan([[700, 700], [720, 700], [720, 720]], 1000)
  assert.ok(pointsOf(a).every(([x]) => x <= 120) && pointsOf(b).every(([x]) => x >= 700))
  assert.deepEqual(plan(circle(8193), 1000).strokes, [])
  assert.ok(pointsOf(plan(circle(8192), 1000)).length <= 2048)
})
