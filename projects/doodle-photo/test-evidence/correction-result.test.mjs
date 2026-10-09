import test from 'node:test'
import assert from 'node:assert/strict'

let mergeCorrectedDetection
try {
  ;({ mergeCorrectedDetection } = await import('../src/utils/correction-result.js'))
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
}

const first = { box_2d: [100, 100, 400, 400], positive_points: [[200, 200]], negative_points: [[0, 0]] }
const second = { box_2d: [500, 600, 800, 900], positive_points: [[700, 600]], negative_points: [[950, 900]] }
const ringA = [[110, 110], [390, 110], [250, 390]]
const ringB = [[610, 510], [890, 510], [750, 790]]
const ringNew = [[120, 120], [380, 120], [250, 380]]

function detection(parts, quality = parts.map(rings => ({ outline_ready: rings.length > 0 }))) {
  return {
    label: 'old identity', box_2d: [100, 100, 800, 900],
    segmentation_regions: structuredClone([first, second]),
    shape_contours_by_region: structuredClone(parts), segmentation_quality: structuredClone(quality),
    shape_contours: parts.flat(), shape_points: parts.flat()[0] || [], outline_status: 'partial',
  }
}

function merge(previous, updated, index = 0) {
  assert.equal(typeof mergeCorrectedDetection, 'function', 'correction merge helper must exist')
  return mergeCorrectedDetection(previous, updated, index)
}

test('correcting a neighbor preserves an earlier crop contour when full-photo SAM now fails there', () => {
  const previous = detection([[ringA], [ringB]], [
    { outline_ready: true, source: 'local_crop', score: .97 },
    { outline_ready: true, source: 'local_crop', score: .99 },
  ])
  const updated = detection([[ringNew], []], [
    { outline_ready: true, source: 'full_photo', score: .94 },
    { outline_ready: false, source: 'full_photo', reason: 'ambiguous' },
  ])
  const result = merge(previous, updated)
  assert.deepEqual(result.shape_contours_by_region, [[ringNew], [ringB]])
  assert.deepEqual(result.segmentation_quality, [
    { outline_ready: true, source: 'full_photo', score: .94 },
    { outline_ready: true, source: 'local_crop', score: .99 },
  ])
  assert.deepEqual(result.shape_contours, [ringNew, ringB])
  assert.deepEqual(result.shape_points, ringNew)
  assert.equal(result.outline_status, 'ready')
})

test('selected region always adopts the updated contour and quality even with unchanged geometry', () => {
  const previous = detection([[ringA], [ringB]])
  const updated = detection([[ringNew], []], [{ outline_ready: true }, { outline_ready: false, reason: 'failure' }])
  const result = merge(previous, updated, 1)
  assert.deepEqual(result.shape_contours_by_region, [[ringA], []])
  assert.deepEqual(result.segmentation_quality[1], { outline_ready: false, reason: 'failure' })
  assert.equal(result.outline_status, 'partial')
})

test('changed boxes and changed positive or negative hints use updated parts rather than stale contours', () => {
  const previous = detection([[ringA], [ringB]])
  for (const change of [
    { box_2d: [510, 600, 800, 900] },
    { positive_points: [[710, 620]] },
    { negative_points: [[990, 990]] },
  ]) {
    const updated = detection([[ringNew], []])
    Object.assign(updated.segmentation_regions[1], change)
    const result = merge(previous, updated)
    assert.deepEqual(result.shape_contours_by_region[1], [])
    assert.equal(result.segmentation_quality[1].outline_ready, false)
    assert.equal(result.outline_status, 'partial')
  }
})

test('geometry comparison uses normalized boxes and sanitized hints', () => {
  const previous = detection([[ringA], [ringB]])
  previous.segmentation_regions[1].box_2d = [500, 600, 800, 1100]
  previous.segmentation_regions[1].positive_points.push([700, 600], [NaN, 0], [10, 10])
  previous.segmentation_regions[1].negative_points.push([950, 900], [1001, 500])
  const updated = detection([[ringNew], []])
  updated.segmentation_regions[1].box_2d = [500, 600, 800, 1000]
  assert.deepEqual(merge(previous, updated).shape_contours_by_region[1], [ringB])
})

test('legacy multi-region response without attributed contours adopts updated parts', () => {
  const previous = detection([[ringA], [ringB]])
  delete previous.shape_contours_by_region
  const updated = detection([[ringNew], []])
  const result = merge(previous, updated)
  assert.deepEqual(result.shape_contours_by_region, [[ringNew], []])
  assert.equal(result.outline_status, 'partial')
})

test('missing previous per-region entry uses its updated attributed parts', () => {
  const previous = detection([[ringA]])
  const updated = detection([[ringNew], [ringB]])
  assert.deepEqual(merge(previous, updated).shape_contours_by_region, [[ringNew], [ringB]])
})

test('legacy single-region response falls back to main contours or primary points', () => {
  const previous = { box_2d: [100, 100, 400, 400], shape_contours: [ringA] }
  for (const shapes of [{ shape_contours: [ringNew] }, { shape_points: ringNew }]) {
    const updated = { box_2d: [100, 100, 400, 400], label: 'new identity', ...shapes }
    const result = merge(previous, updated)
    assert.deepEqual(result.shape_contours_by_region, [[ringNew]])
    assert.deepEqual(result.shape_contours, [ringNew])
    assert.deepEqual(result.segmentation_quality, [{ outline_ready: true }])
    assert.equal(result.outline_status, 'ready')
  }
})

test('flattened main contours deduplicate numeric contents while per-region attribution remains', () => {
  const previous = detection([[ringA], [structuredClone(ringNew)]])
  const updated = detection([[ringNew, structuredClone(ringNew)], []])
  const result = merge(previous, updated)
  assert.deepEqual(result.shape_contours, [ringNew])
  assert.deepEqual(result.shape_points, ringNew)
  assert.equal(result.shape_contours_by_region[1].length, 1)
  assert.equal(result.outline_status, 'ready')
})

test('flattening caps valid contours at 32 and discards malformed nonnumeric rings', () => {
  const many = Array.from({ length: 40 }, (_, index) => [[index, 0], [index + 1, 0], [index, 1]])
  const invalid = [null, [[1, 2], [3, 4]], [[NaN, 1], [2, 3], [4, 5]],
    [['1', 2], [3, 4], [5, 6]], [[true, 2], [3, 4], [5, 6]]]
  const updated = detection([[...invalid, ...many], []])
  const result = merge(null, updated)
  assert.equal(result.shape_contours.length, 32)
  assert.deepEqual(result.shape_contours[0], [[0, 0], [1, 0], [0, 1]])
  assert.deepEqual(result.shape_contours[31], [[31, 0], [32, 0], [31, 1]])
  assert.equal(result.outline_status, 'partial')
})

test('status and per-region readiness describe merged parts even when old flags disagree', () => {
  const previous = detection([[], []])
  const updated = detection([[], []], [{ outline_ready: true }, { outline_ready: true }])
  const result = merge(previous, updated)
  assert.equal(result.outline_status, 'uncertain')
  assert.deepEqual(result.segmentation_quality, [{ outline_ready: false }, { outline_ready: false }])
  assert.deepEqual(result.shape_points, [])
})

test('label, manual flags and other metadata come from updated while neither input is mutated', () => {
  const previous = detection([[ringA], [ringB]])
  const updated = detection([[ringNew], []])
  updated.label = 'verified identity'
  updated.manual_hint_regions = [{ positive: true, negative: false }, { positive: false, negative: true }]
  updated.caption = 'Human caption'
  const beforePrevious = structuredClone(previous), beforeUpdated = structuredClone(updated)
  const result = merge(previous, updated)
  assert.equal(result.label, 'verified identity')
  assert.equal(result.caption, 'Human caption')
  assert.deepEqual(result.manual_hint_regions, updated.manual_hint_regions)
  result.shape_contours_by_region[1][0][0][0] = 1
  result.segmentation_quality[1].outline_ready = false
  assert.deepEqual(previous, beforePrevious)
  assert.deepEqual(updated, beforeUpdated)
})

test('invalid selection or unnormalizable old geometry cannot preserve old region shapes', () => {
  const previous = detection([[ringA], [ringB]])
  const updated = detection([[ringNew], []])
  for (const index of [-1, 2, NaN, '0']) {
    assert.deepEqual(merge(previous, updated, index).shape_contours_by_region, [[ringNew], []])
  }
  previous.segmentation_regions[1].box_2d = [900, 900, 100, 100]
  assert.deepEqual(merge(previous, updated).shape_contours_by_region, [[ringNew], []])
})
