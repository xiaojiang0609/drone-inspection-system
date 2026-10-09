import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizedPointer,
  boxFromDrag,
  createCorrectionGeometry,
  replaceCorrectionRegion,
  addCorrectionPoint,
  correctionManualFlags,
} from '../src/utils/subject-correction.js'

test('pointer coordinates use each displayed photo dimension and clamp outside drags', () => {
  const rect = { left: 100, top: 40, width: 600, height: 300 }
  assert.deepEqual(normalizedPointer(250, 265, rect), [250, 750])
  assert.deepEqual(normalizedPointer(50, 500, rect), [0, 1000])
  assert.deepEqual(normalizedPointer(950, 10, rect), [1000, 0])
  assert.equal(normalizedPointer(250, 265, { ...rect, width: 0 }), null)
  assert.equal(normalizedPointer(NaN, 265, rect), null)
})

test('drag boxes support every direction, keep y/x ordering, and clamp to the photo', () => {
  for (const [start, end] of [
    [[200, 100], [800, 700]], [[800, 700], [200, 100]],
    [[200, 700], [800, 100]], [[800, 100], [200, 700]],
  ]) assert.deepEqual(boxFromDrag(start, end), [100, 200, 700, 800])
  assert.deepEqual(boxFromDrag([-10, -20], [1050, 1010]), [0, 0, 1000, 1000])
  assert.equal(boxFromDrag([100, 100], [104, 700]), null)
  assert.equal(boxFromDrag([100, 100], [700, 104]), null)
  assert.deepEqual(boxFromDrag([100, 100], [105, 105]), [100, 100, 105, 105])
})

test('editing one of several regions preserves neighboring hints and unions the main box', () => {
  const detection = {
    box_2d: [0, 0, 1000, 1000],
    segmentation_regions: [
      { box_2d: [100, 100, 400, 400], positive_points: [[200, 200]], negative_points: [[0, 0]] },
      { box_2d: [500, 600, 800, 900], positive_points: [[700, 600]], negative_points: [[950, 900]] },
    ],
  }
  const original = structuredClone(detection)
  const geometry = createCorrectionGeometry(detection)
  assert.deepEqual(geometry.box_2d, [100, 100, 800, 900])
  const updated = replaceCorrectionRegion(geometry, 0, {
    box_2d: [50, 20, 450, 480], positive_points: [], negative_points: [],
  })
  assert.deepEqual(updated.box_2d, [50, 20, 800, 900])
  assert.deepEqual(updated.segmentation_regions[1], original.segmentation_regions[1])
  assert.deepEqual(updated.segmentation_regions[0], {
    box_2d: [50, 20, 450, 480], positive_points: [], negative_points: [],
  })
  updated.segmentation_regions[1].positive_points[0][0] = 1
  assert.deepEqual(detection, original)
  assert.deepEqual(geometry.segmentation_regions[1].positive_points, [[700, 600]])
})

test('legacy single-region geometry adopts its real box and optional existing hints', () => {
  assert.deepEqual(createCorrectionGeometry({ box_2d: [100, 200, 800, 900], positive_points: [[400, 500]] }), {
    box_2d: [100, 200, 800, 900],
    segmentation_regions: [{ box_2d: [100, 200, 800, 900], positive_points: [[400, 500]], negative_points: [] }],
  })
  assert.equal(createCorrectionGeometry({ box_2d: [500, 100, 100, 800] }), null)
})

test('initial hints reject malformed, duplicate and outside points before applying their caps', () => {
  const geometry = createCorrectionGeometry({ box_2d: [100, 100, 900, 900],
    positive_points: [null, [50, 50], [200, 200], [200, 200], [300, 300], [400, 400], [500, 500], [600, 600]],
    negative_points: [[200, 200], [-1, 0], [0, 0], [0, 0], [10, 10], [20, 20], [30, 30], [40, 40], [50, 50], [60, 60], [70, 70], [80, 80], [NaN, 0]],
  })
  assert.deepEqual(geometry.segmentation_regions[0].positive_points, [[200, 200], [300, 300], [400, 400], [500, 500]])
  assert.deepEqual(geometry.segmentation_regions[0].negative_points, [[0, 0], [10, 10], [20, 20], [30, 30], [40, 40], [50, 50], [60, 60], [70, 70]])
})

test('first manual foreground and background points replace earlier API hints independently', () => {
  const region = { box_2d: [100, 100, 900, 900], positive_points: [[200, 200], [300, 300]], negative_points: [[0, 0], [10, 10]] }
  const foreground = addCorrectionPoint(region, 'positive_points', [400, 400], true)
  assert.deepEqual(foreground.positive_points, [[400, 400]])
  assert.deepEqual(foreground.negative_points, [[0, 0], [10, 10]])
  const background = addCorrectionPoint(foreground, 'negative_points', [950, 950], true)
  assert.deepEqual(background.positive_points, [[400, 400]])
  assert.deepEqual(background.negative_points, [[950, 950]])
  assert.deepEqual(addCorrectionPoint(background, 'positive_points', [500, 500]).positive_points, [[400, 400], [500, 500]])
  assert.deepEqual(region.positive_points, [[200, 200], [300, 300]])
})

test('manual hint addition enforces foreground and background caps without changing other hints', () => {
  let region = { box_2d: [0, 0, 1000, 1000], positive_points: [], negative_points: [] }
  for (let n = 1; n <= 6; n++) region = addCorrectionPoint(region, 'positive_points', [n * 100, n * 100])
  for (let n = 1; n <= 10; n++) region = addCorrectionPoint(region, 'negative_points', [n * 10, 0])
  assert.deepEqual(region.positive_points, [[100, 100], [200, 200], [300, 300], [400, 400]])
  assert.deepEqual(region.negative_points, [[10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0], [70, 0], [80, 0]])
  const unchanged = addCorrectionPoint(region, 'positive_points', [NaN, 10])
  assert.deepEqual(unchanged, region)
  assert.deepEqual(addCorrectionPoint(region, 'negative_points', [100, 100]), region)
})

test('foreground points stay in their selected region rather than silently shifting the box', () => {
  const region = { box_2d: [100, 200, 800, 900], positive_points: [[400, 500]], negative_points: [] }
  assert.deepEqual(addCorrectionPoint(region, 'positive_points', [100, 50], true), region)
  assert.deepEqual(addCorrectionPoint(region, 'negative_points', [100, 50], true).negative_points, [[100, 50]])
})

test('reopened correction drafts retain saved manual flags using only strict true values', () => {
  const detection = { manual_hint_regions: [
    { positive: true, negative: false },
    { positive: 'true', negative: 1 },
    { positive: false, negative: true },
  ] }
  const flags = correctionManualFlags(detection, 4)
  assert.deepEqual(flags, [
    { positive: true, negative: false },
    { positive: false, negative: false },
    { positive: false, negative: true },
    { positive: false, negative: false },
  ])
  flags[0].positive = false
  assert.equal(detection.manual_hint_regions[0].positive, true)
})

test('manual flags fall back per region and discard entries beyond the returned region list', () => {
  assert.deepEqual(correctionManualFlags({}, 2), [
    { positive: false, negative: false }, { positive: false, negative: false },
  ])
  assert.deepEqual(correctionManualFlags({ manual_hint_regions: [null, { positive: true }, { negative: true }] }, 2), [
    { positive: false, negative: false }, { positive: true, negative: false },
  ])
})
