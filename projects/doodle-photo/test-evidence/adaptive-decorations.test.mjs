import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createJournalElements, JOURNAL_STYLE } from '../src/utils/journal.js'
import { elementBounds } from '../src/utils/journal-layout.js'
import { planJournalArrow } from '../src/utils/journal-arrows.js'

const doodles = elements => elements.filter(e => e.type === 'doodle')
const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
const scene = { label: '咖啡杯', caption: '一杯暖意', box_2d: [420, 420, 580, 580] }

test('ample background receives more small decorations than a crowded photograph', () => {
  const spacious = createJournalElements([scene], { headline: null, theme: '美食' }, 1000, 1000)
  const crowded = createJournalElements([{ ...scene, box_2d: [60, 60, 940, 940] }], { headline: null, theme: '美食' }, 1000, 1000)
  assert.ok(doodles(spacious).length >= 22, 'a spacious image should not retain the old 16-element ceiling')
  assert.ok(doodles(crowded).length < doodles(spacious).length)
  assert.ok(doodles(spacious).length <= JOURNAL_STYLE.maxDoodles)
})

test('API suggestions in one corner cannot leave the rest of the usable photo undecorated', () => {
  const meta = { headline: null, theme: '美食', decorations: Array.from({ length: 18 }, () => ({ type: 'sparkle', x: 90, y: 80 })) }
  const elements = createJournalElements([scene], meta, 1000, 1000)
  const marks = doodles(elements)
  assert.ok(marks.filter(e => e.y > 600).length >= 4, 'small marks should also use the lower background')
  assert.ok(marks.filter(e => e.x > 650).length >= 4, 'advice is a hint, not a mandatory corner cluster')
  assert.deepEqual(createJournalElements([scene], meta, 1000, 1000), elements, 'automatic layout must be stable')
})

for (const [name, file, width, height] of [
  ['buffet', 'coverage-buffet-analyzed.json', 1707, 1280],
  ['cat', 'white-doodle-cat-live.json', 1000, 683],
  ['coffee', 'white-doodle-coffee-live.json', 900, 1350],
]) {
  test(`${name}: richer decoration preserves every already-safe arrow and existing caption`, () => {
    const fixture = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
    const elements = createJournalElements(fixture.data, fixture, width, height)
    const labelsOnly = elements.filter(e => e.type !== 'doodle')
    const logicalHeight = 1000 * height / width
    const arrows = labelsOnly.filter(e => e.type === 'arrow')
    for (const arrow of arrows) {
      if (!planJournalArrow(arrow, labelsOnly, fixture.data, logicalHeight)) continue
      assert.ok(planJournalArrow(arrow, elements, fixture.data, logicalHeight), `${arrow.id} lost its safe route`)
    }
    const solids = elements.filter(e => e.type !== 'arrow').map(e => elementBounds(e))
    for (const [index, bounds] of solids.entries()) {
      assert.ok(bounds.x1 >= 12 && bounds.x2 <= 988 && bounds.y1 >= 12 && bounds.y2 <= 988)
      for (const other of solids.slice(index + 1)) assert.equal(overlaps(bounds, other), false)
    }
    assert.ok(doodles(elements).length <= JOURNAL_STYLE.maxDoodles)
    if (name === 'buffet') {
      assert.ok(doodles(elements).length >= 14, 'small accents should fill remaining safe gaps')
      assert.ok(doodles(elements).filter(e => e.y > 450).length >= 3, 'the tablecloth should not remain empty')
    }
    if (name === 'coffee') assert.ok(doodles(elements).filter(e => e.y > 650).length >= 5, 'portrait space needs decorations beyond the top strip')
  })
}

test('fully occupied subjects never force decoration through the subject or beyond the photo', () => {
  const elements = createJournalElements([{ ...scene, box_2d: [0, 0, 1000, 1000] }], { headline: null }, 1000, 1400)
  assert.equal(doodles(elements).length, 0)
  assert.deepEqual(createJournalElements([], {}, 1000, 1000), [])
})

test('automatic scene motifs cannot consume the slots for valid API custom sketches', () => {
  const paths = [[[100, 100], [500, 800], [900, 100]]]
  const elements = createJournalElements([{ label: '咖啡杯和书本', caption: '今日小记', box_2d: [90, 90, 910, 910] }], {
    headline: null, decorations: [
      { type: 'sparkle', x: 100, y: 400 }, { type: 'star', x: 100, y: 400 },
      { type: 'smallHeart', x: 100, y: 400 }, { type: 'custom', paths, label: '小线稿', x: 100, y: 400 },
    ],
  }, 1000, 1000)
  assert.equal(doodles(elements).filter(e => e.icon === 'custom').length, 1)
  assert.deepEqual(doodles(elements).find(e => e.icon === 'custom').paths, paths)
})
