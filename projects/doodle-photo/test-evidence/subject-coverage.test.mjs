import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createJournalElements, JOURNAL_STYLE } from '../src/utils/journal.js'
import { elementBounds } from '../src/utils/journal-layout.js'

const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

function polygonOverlapsRect(points, rect) {
  const corners = [[rect.x1, rect.y1], [rect.x2, rect.y1], [rect.x2, rect.y2], [rect.x1, rect.y2]]
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  const pointInPolygon = ([x, y]) => {
    let crossings = 0
    for (const [index, start] of points.entries()) {
      const end = points[(index + 1) % points.length]
      if ((start[1] > y) !== (end[1] > y)
        && x < start[0] + (y - start[1]) * (end[0] - start[0]) / (end[1] - start[1])) crossings++
    }
    return crossings % 2 === 1
  }
  if (corners.some(pointInPolygon) || points.some(([x, y]) => x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2)) return true
  for (const [index, start] of points.entries()) {
    const end = points[(index + 1) % points.length]
    for (const [cornerIndex, corner] of corners.entries()) {
      const next = corners[(cornerIndex + 1) % corners.length]
      if (Math.max(start[0], end[0]) < Math.min(corner[0], next[0])
        || Math.min(start[0], end[0]) > Math.max(corner[0], next[0])
        || Math.max(start[1], end[1]) < Math.min(corner[1], next[1])
        || Math.min(start[1], end[1]) > Math.max(corner[1], next[1])) continue
      if (cross(start, end, corner) * cross(start, end, next) <= 0
        && cross(corner, next, start) * cross(corner, next, end) <= 0) return true
    }
  }
  return false
}

function assertSafeLayout(elements, subjects) {
  const solids = elements.filter(element => element.type !== 'arrow')
  const bounds = solids.map(element => elementBounds(element))
  for (const [index, rect] of bounds.entries()) {
    assert.ok(Object.values(rect).every(Number.isFinite), `${solids[index].id} has invalid bounds`)
    assert.ok(rect.x1 >= 12 && rect.y1 >= 12 && rect.x2 <= 988 && rect.y2 <= 988,
      `${solids[index].id} escapes the photo`)
    for (const subject of subjects) {
      const contours = (subject.shape_contours?.length ? subject.shape_contours : [subject.shape_points])
        .filter(points => points?.length >= 3)
      for (const contour of contours) assert.equal(polygonOverlapsRect(contour, rect), false,
        `${solids[index].id} covers the contour of ${subject.label}`)
      const boxes = !contours.length ? [subject.box_2d] : subject.outline_status === 'partial'
        ? (subject.segmentation_regions || []).filter((region, regionIndex) => subject.segmentation_quality?.[regionIndex]?.outline_ready !== true)
          .map(region => region.box_2d) : []
      for (const [y1, x1, y2, x2] of boxes.filter(Boolean)) assert.equal(overlaps(rect, { x1, y1, x2, y2 }), false,
        `${solids[index].id} covers an unsegmented region of ${subject.label}`)
    }
    for (const other of bounds.slice(index + 1)) {
      assert.equal(overlaps(rect, other), false, `${solids[index].id} overlaps another element`)
    }
  }
  assert.equal(new Set(elements.map(element => element.id)).size, elements.length)
  assert.ok(elements.filter(element => element.type === 'doodle').length <= JOURNAL_STYLE.maxDoodles)
}

test('dense buffet captions can use smaller readable text to improve real-photo coverage', () => {
  const fixture = JSON.parse(readFileSync(new URL('./coverage-buffet-analyzed.json', import.meta.url), 'utf8'))
  const elements = createJournalElements(fixture.data, fixture, 1536, 1151)
  const captions = elements.filter(element => element.subjectIndex !== undefined && element.type !== 'arrow')
  // The existing fallback places only three captions in this cached real scene.
  assert.ok(captions.length >= 4, `expected more than the three original captions, received ${captions.length}`)
  assert.ok(captions.some(element => element.fontSize < 22), 'tight gaps require a compact fallback')
  for (const caption of captions) {
    assert.ok(caption.fontSize >= 18, 'a compact caption must remain readable')
    assert.equal(caption.text, fixture.data[caption.subjectIndex].caption)
    const arrow = elements.find(element => element.type === 'arrow' && element.labelId === caption.id)
    assert.ok(arrow)
    assert.equal(arrow.subjectIndex, caption.subjectIndex)
  }
  assertSafeLayout(elements, fixture.data)
})

test('compact captions fit a narrow side gap without touching the subject', () => {
  const subjects = Array.from({ length: 7 }, (_, index) => ({
    label: `小物${index + 1}`, caption: '温柔一角', box_2d: [0, 0, 1000, 850],
  }))
  const elements = createJournalElements(subjects, { headline: null }, 1000, 1000)
  const captions = elements.filter(element => element.subjectIndex !== undefined && element.type !== 'arrow')
  assert.ok(captions.some(element => element.subjectIndex === 0), 'the 150-unit side gap needs a smaller caption')
  assert.ok(captions.some(element => element.subjectIndex === 6), 'later subjects retain the same compact placement opportunity')
  assert.ok(captions.every(element => element.fontSize >= 18 && element.fontSize < 22))
  assertSafeLayout(elements, subjects)
})

// Restoring the six-subject cap must fail these cases: long captions exhaust
// their own placement attempts without consuming the top strip's free space.
for (const [orientation, width, height] of [['portrait', 1000, 1600], ['landscape', 1600, 1000]]) {
  for (const subjectCount of [7, 20]) {
    test(`${orientation}: subject ${subjectCount} gets a caption after earlier captions cannot fit`, () => {
      const earlier = Array.from({ length: subjectCount - 1 }, (_, index) => ({
        label: `主体${index + 1}`, caption: '细'.repeat(160),
        box_2d: [220, index * 1000 / (subjectCount - 1), 1000, (index + 1) * 1000 / (subjectCount - 1)],
      }))
      const last = { label: '小杯子', caption: '一杯暖意', box_2d: [500, 450, 550, 500] }
      const subjects = [...earlier, last]
      const original = structuredClone(subjects)
      const elements = createJournalElements(subjects, { headline: null }, width, height)
      const captions = elements.filter(element => element.subjectIndex !== undefined && element.type !== 'arrow')
      assert.equal(captions.length, 1, 'only the short caption can fit safely in the top strip')
      assert.equal(captions[0].text, '一杯暖意')
      assert.equal(captions[0].subjectIndex, subjectCount - 1)
      const arrows = elements.filter(element => element.type === 'arrow')
      assert.equal(arrows.length, 1)
      assert.equal(arrows[0].subjectIndex, subjectCount - 1)
      assert.equal(arrows[0].labelId, captions[0].id)
      assertSafeLayout(elements, subjects)
      assert.deepEqual(subjects, original, 'layout must preserve detection order and contents')
    })
  }

  test(`${orientation}: more than six fitting subjects retain their captions and arrow targets`, () => {
    const subjects = Array.from({ length: 8 }, (_, index) => ({
      label: `小物${index + 1}`, caption: `小物${index + 1}`,
      box_2d: [420 + Math.floor(index / 4) * 120, 160 + index % 4 * 180,
        460 + Math.floor(index / 4) * 120, 200 + index % 4 * 180],
    }))
    const elements = createJournalElements(subjects, { headline: null }, width, height)
    const captions = elements.filter(element => element.subjectIndex !== undefined && element.type !== 'arrow')
    assert.deepEqual(captions.map(element => element.subjectIndex), [0, 1, 2, 3, 4, 5, 6, 7])
    for (const caption of captions) {
      assert.equal(caption.text, subjects[caption.subjectIndex].caption)
      const arrow = elements.find(element => element.type === 'arrow' && element.labelId === caption.id)
      assert.ok(arrow, `subject ${caption.subjectIndex} has no pointer`)
      assert.equal(arrow.subjectIndex, caption.subjectIndex)
    }
    assertSafeLayout(elements, subjects)
  })
}
