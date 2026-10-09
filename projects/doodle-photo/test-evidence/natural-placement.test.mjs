import test from 'node:test'
import assert from 'node:assert/strict'
import { createJournalElements, elementBounds } from '../src/utils/journal.js'
import { nearestSubjectBoundary, planJournalArrow } from '../src/utils/journal-arrows.js'
import { readFileSync } from 'node:fs'

const subject = {
  label: '杯子', caption: '一杯小美好', box_2d: [300, 250, 550, 450],
  shape_points: [[250, 300], [450, 300], [450, 550], [250, 550]],
}

test('a crowded real photograph tries compact nearby captions before accepting distant wide ones', () => {
  const fixture = JSON.parse(readFileSync(new URL('coverage-buffet-analyzed.json', import.meta.url), 'utf8'))
  const elements = createJournalElements(fixture.data, fixture, 1707, 1280)
  const visible = elements.filter(e => e.type === 'arrow').map(arrow =>
    planJournalArrow(arrow, elements, fixture.data, 1000 * 1280 / 1707)).filter(Boolean)
  assert.ok(visible.length >= 1, 'at least one caption needs a short unobstructed pointer on the real buffet scene')
  assert.ok(visible.every(plan => plan.length <= 210))
})

test('an earlier distant fallback does not consume a later subject nearby caption space', () => {
  const fixture = JSON.parse(readFileSync(new URL('coverage-buffet-analyzed.json', import.meta.url), 'utf8'))
  const elements = createJournalElements(fixture.data, fixture, 1707, 1280)
  const arrow = elements.find(e => e.type === 'arrow' && e.subjectIndex === 4)
  assert.ok(arrow)
  assert.ok(planJournalArrow(arrow, elements, fixture.data, 1000 * 1280 / 1707), 'blueberries should retain their nearby pointer')
})

test('a distant API caption moves beside its subject instead of requiring a cross-photo arrow', () => {
  const detection = { ...subject, layout: { type: 'text', x: 850, y: 850, width: 220, fontSize: 24, rotation: 0 } }
  const elements = createJournalElements([detection], { headline: null }, 1000, 1000)
  const label = elements.find(element => element.subjectIndex === 0 && element.type === 'text')
  assert.ok(label)
  const target = nearestSubjectBoundary(detection, [label.x, label.y], 1000)
  const bounds = elementBounds(label)
  const gap = Math.hypot(Math.max(bounds.x1 - target[0], 0, target[0] - bounds.x2),
    Math.max(bounds.y1 - target[1], 0, target[1] - bounds.y2))
  assert.ok(gap <= 180, `caption remains ${gap.toFixed(1)} units from its subject`)
  assert.equal(label.text, detection.caption)
})

test('a nearby safe API caption retains its position and source connection', () => {
  const detection = { ...subject, layout: { type: 'text', x: 650, y: 420, width: 220, fontSize: 24, rotation: 3 } }
  const elements = createJournalElements([detection], { headline: null }, 1000, 1000)
  const label = elements.find(element => element.subjectIndex === 0 && element.type === 'text')
  assert.equal(label.x, 650)
  assert.equal(label.y, 420)
  const arrow = elements.find(element => element.type === 'arrow' && element.labelId === label.id)
  assert.equal(arrow.subjectIndex, 0)
  assert.ok(planJournalArrow(arrow, elements.filter(element => element.type !== 'doodle'), [detection], 1000))
})

test('nearby placement still reserves rotated caption boundaries in portrait and landscape', () => {
  for (const [width, height] of [[1000, 1600], [1600, 1000]]) {
    const detection = { ...subject, layout: { type: 'text', x: 920, y: 870, width: 240, fontSize: 24, rotation: -6 } }
    const elements = createJournalElements([detection], { headline: null }, width, height)
    const label = elements.find(element => element.subjectIndex === 0 && element.type === 'text')
    assert.ok(label)
    const bounds = elementBounds(label)
    assert.ok(bounds.x1 >= 12 && bounds.x2 <= 988 && bounds.y1 >= 12 && bounds.y2 <= 988)
    assert.ok(!(bounds.x1 < 450 && bounds.x2 > 250 && bounds.y1 < 550 && bounds.y2 > 300))
    assert.ok(label.x !== 920 || label.y !== 870)
  }
})
