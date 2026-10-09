import test from 'node:test'
import assert from 'node:assert/strict'
import { createJournalElements, drawJournal, JOURNAL_STYLE } from '../src/utils/journal.js'
import { elementBounds } from '../src/utils/journal-layout.js'
import { themedDoodles, validSketchPaths } from '../src/utils/doodle-catalog.js'
import * as layoutUtils from '../src/utils/journal-layout.js'

test('manual movement keeps rotated custom sketches inside the image', () => {
  const element = layoutUtils.constrainElementToImage({ type: 'doodle', icon: 'custom',
    x: 1000, y: 0, width: 86, height: 86, aspect: 1, rotation: 45 })
  const bounds = elementBounds(element)
  assert.ok(bounds.x1 >= 12 && bounds.y1 >= 12 && bounds.x2 <= 988 && bounds.y2 <= 988)
})

test('partial segmentation still protects the unsegmented subject regions', () => {
  const subject = { label: '两份甜点', caption: '小小甜点', box_2d: [100, 100, 700, 750],
    shape_points: [[100, 100], [300, 100], [300, 300], [100, 300]], outline_status: 'partial',
    segmentation_regions: [{box_2d: [100, 100, 300, 300]}, {box_2d: [400, 500, 700, 750]}],
    segmentation_quality: [{outline_ready: true}, {outline_ready: false}],
    layout: {type: 'text', x: 625, y: 550, width: 200, fontSize: 24, rotation: 0} }
  const elements = createJournalElements([subject], {}, 1000, 1000)
  assert.ok(elements.some(e => e.subjectIndex === 0 && e.type !== 'arrow'))
  for (const e of elements.filter(e => e.type !== 'arrow')) {
    const b = elementBounds(e)
    assert.ok(!(b.x1 < 750 && b.x2 > 500 && b.y1 < 700 && b.y2 > 400), `${e.type} covers a failed region`)
  }
})

test('oversized manual elements are scaled to fit after rotation', () => {
  const element = layoutUtils.constrainElementToImage({ type: 'text', text: '手写',
    x: 500, y: 500, width: 1000, height: 1200, aspect: .6, rotation: 65, fontSize: 40 })
  const bounds = elementBounds(element)
  assert.ok(bounds.x1 >= 12 && bounds.y1 >= 12 && bounds.x2 <= 988 && bounds.y2 <= 988)
  assert.ok(element.fontSize < 40)
})

test('food scenes gain related feature doodles while preserving safe placement', () => {
  const subject = { label: '咖啡杯', caption: '慢慢喝一杯', box_2d: [420, 420, 620, 620] }
  const elements = createJournalElements([subject], { theme: '美食' }, 1000, 1000)
  const doodles = elements.filter(e => e.type === 'doodle')
  assert.ok(doodles.length >= 10, 'spacious photo should contain richer decorations')
  assert.ok(doodles.some(e => ['cup', 'cutlery', 'chefHat', 'cake'].includes(e.icon)))
  assert.ok(doodles.some(e => e.width >= 56), 'feature motifs need readable size without dominating captions')
  assert.ok(doodles.length <= JOURNAL_STYLE.maxDoodles)
})

test('a custom API sketch stays editable and shares the safe layout', () => {
  const paths = [[[100, 100], [500, 800], [900, 100]]]
  const subject = { label: '杯子', caption: '今日小记', box_2d: [500, 500, 750, 750] }
  const elements = createJournalElements([subject], { decorations: [
    { type: 'custom', label: '小三角', paths, x: 200, y: 450, scale: 1 },
    { type: 'custom', label: '重复', paths, x: 100, y: 100, scale: 1 },
    { type: 'custom', label: 'bad', paths: [[[NaN, 10], [20, 30]]], x: 0, y: 0 },
  ] }, 1000, 1000)
  const sketch = elements.find(e => e.icon === 'custom')
  assert.ok(sketch)
  assert.equal(sketch.label, '小三角')
  assert.deepEqual(sketch.paths, paths)
  assert.equal(elements.filter(e => e.icon === 'custom').length, 1)
  const bounds = elementBounds(sketch)
  assert.ok(bounds.x2 < 500 || bounds.y2 < 500)
})

test('theme fallback selects elements related to the recognized subject', () => {
  assert.equal(themedDoodles('静物', [{ label: '咖啡杯' }])[0], 'cup')
  assert.ok(themedDoodles('宠物', [{ label: '小猫' }]).includes('paw'))
  assert.doesNotThrow(() => themedDoodles('__proto__', []))
  assert.doesNotThrow(() => themedDoodles('constructor', []))
  assert.equal(validSketchPaths([[[100, 100], [100, 100]]]), false)
})

test('a nearby safe API suggestion is retained with the recognized caption', () => {
  const subject = { label: '小猫', caption: '绿叶中的小好奇', box_2d: [400, 400, 700, 700],
    layout: { type: 'note', x: 220, y: 520, width: 240, fontSize: 26, rotation: 0 } }
  const elements = createJournalElements([subject], {}, 1000, 1000)
  const note = elements.find(e => e.subjectIndex === 0 && e.type === 'text')
  assert.equal(note.x, 220)
  assert.equal(note.y, 520)
  assert.equal(note.width, 240)
  assert.equal(note.text, subject.caption)
})

test('an API suggestion on the subject is relocated without overlapping other elements', () => {
  const subject = { label: '小猫', caption: '绿叶中的小好奇', box_2d: [400, 400, 750, 750],
    layout: { type: 'text', x: 500, y: 500, width: 260, fontSize: 30, rotation: 8 } }
  const elements = createJournalElements([subject], {}, 1000, 683)
  const label = elements.find(e => e.subjectIndex === 0 && e.type !== 'arrow')
  assert.ok(label)
  assert.equal(label.type, 'text')
  assert.equal(label.rotation, 8)
  assert.ok(label.x !== 500 || label.y !== 500)
  const solid = elements.filter(e => e.type !== 'arrow').map(e => elementBounds(e))
  for (const [i, a] of solid.entries()) {
    assert.ok(a.x1 >= 12 && a.y1 >= 12 && a.x2 <= 988 && a.y2 <= 988)
    assert.ok(!(a.x1 < 750 && a.x2 > 400 && a.y1 < 750 && a.y2 > 400))
    for (const b of solid.slice(i + 1)) assert.ok(!(a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1))
  }
})

test('text sizing uses measured glyph widths instead of the API height', () => {
  const subject = { label: '小猫', caption: '这里的文字需要自动换行', box_2d: [700, 600, 950, 950],
    layout: { type: 'text', x: 200, y: 200, width: 180, height: 1, fontSize: 30, rotation: 0 } }
  const elements = createJournalElements([subject], {}, 1000, 1000, text => text.length * 50)
  const label = elements.find(e => e.subjectIndex === 0 && e.type !== 'arrow')
  assert.equal(label.type, 'text')
  assert.equal(label.width, 180)
  assert.ok(label.height >= 4 * 30 * 1.35 + 18, 'measured text needs four lines, regardless of proposed height')
})

test('malformed API suggestions fall back to the existing layout', () => {
  const subject = { label: '猫', caption: '小小好奇', box_2d: [400, 400, 700, 700] }
  const regular = createJournalElements([subject], {}, 1000, 1000)
  const invalid = createJournalElements([{ ...subject, layout: { type: 'note', x: NaN, y: 0, width: Infinity } }], {}, 1000, 1000)
  assert.deepEqual(invalid, regular)
})

const data = [{ label: '咖啡杯', caption: '一杯咖啡，慢慢享受今天', box_2d: [400, 430, 710, 990] }]
const meta = {
  theme: '美食', safeZone: { x1: 0, y1: 330, x2: 1000, y2: 1000 },
  decorationZones: [{ x1: 0, y1: 0, x2: 1000, y2: 320 }],
}

test('reference style writes captions directly without automatic paper or tape', () => {
  const elements = createJournalElements(data, meta, 900, 1350)
  assert.ok(elements.some(e => e.type === 'text' && e.text === data[0].caption))
  assert.ok(elements.every(e => !['note', 'tape', 'stamp'].includes(e.type)))
  assert.ok(elements.filter(e => e.type === 'bubble').length <= 1)
  assert.ok(elements.filter(e => e.type === 'doodle').every(e => e.color === '#fffaf1'))
  assert.ok(elements.filter(e => e.type === 'doodle').length <= JOURNAL_STYLE.maxDoodles, 'decoration budget remains bounded')
  assert.equal(new Set(elements.map(e => e.id)).size, elements.length)
})

test('scene title creates at most one unfilled bubble and background captions remain safe', () => {
  const subject = {label: '小猫', caption: '一双好奇的眼睛', box_2d: [400, 400, 700, 700]}
  const elements = createJournalElements([subject], {headline: {text: '遇见一份小可爱', x: 760, y: 160, width: 340, fontSize: 34, rotation: 0},
    ambientCaptions: [{text: '慢慢收藏这一刻', x: 550, y: 550, width: 240, fontSize: 24, rotation: 0}]}, 1000, 1000)
  const bubbles = elements.filter(e => e.type === 'bubble')
  assert.equal(bubbles.length, 1)
  assert.equal(bubbles[0].text, '遇见一份小可爱')
  const ambient = elements.find(e => e.text === '慢慢收藏这一刻')
  assert.ok(ambient)
  const b = elementBounds(ambient)
  assert.ok(!(b.x1 < 700 && b.x2 > 400 && b.y1 < 700 && b.y2 > 400))
})

test('the entire decoration stays outside the subject, not only its center', () => {
  const elements = createJournalElements(data, meta, 900, 1350)
  assert.ok(elements.length > 0)
  for (const e of elements) {
    const left = e.x - e.width / 2, right = e.x + e.width / 2
    const top = e.y - e.height / 2, bottom = e.y + e.height / 2
    assert.ok(left >= 0 && top >= 0 && right <= 1000 && bottom <= 1000)
    assert.ok(bottom < 330, `${e.id} overlaps the subject`)
  }
})

test('an empty recognition does not invent a caption or decoration', () => {
  assert.deepEqual(createJournalElements([], meta, 900, 1350), [])
})

test('a close-up portrait places handwriting in a narrow background', () => {
  const portrait = { safeZone: { x1: 200, y1: 80, x2: 750, y2: 1000 },
    decorationZones: [{ x1: 800, y1: 0, x2: 1000, y2: 1000 }] }
  const elements = createJournalElements(data, portrait, 1000, 683)
  assert.ok(elements.some(e => e.type === 'text'), 'still produce an annotation in available side space')
  const note = elements.find(e => e.type === 'text')
  assert.ok(note.x - note.width / 2 > 750 || note.x + note.width / 2 < 200)
})

test('a cropped subject does not get an artificial line along the image border', () => {
  const segments = []
  let previous
  const ctx = { save() {}, restore() {}, scale() {}, setLineDash() {}, beginPath() {}, stroke() {},
    moveTo(x, y) { previous = [x, y] },
    lineTo(x, y) { segments.push([previous, [x, y]]); previous = [x, y] } }
  drawJournal(ctx, 1000, 1000, [{shape_points: [[100, 100], [900, 100], [900, 1000], [100, 1000]]}], [], true)
  assert.ok(segments.length > 0)
  assert.ok(segments.every(([a, b]) => !(a[1] === 1000 && b[1] === 1000)))
  assert.ok(segments.some(([a, b]) => a[1] === 1000 || b[1] === 1000),
    'real visible edges should reach the crop rather than end several pixels early')
})

test('the outline passes through the original sharp ear and corner points', () => {
  const visited = []
  const ctx = { save() {}, restore() {}, scale() {}, setLineDash() {}, beginPath() {}, stroke() {},
    moveTo(x, y) { visited.push([x, y]) }, lineTo(x, y) { visited.push([x, y]) }, quadraticCurveTo() {} }
  const points = [[150, 400], [230, 70], [330, 260], [700, 260], [810, 80], [900, 400]]
  drawJournal(ctx, 1000, 1000, [{shape_points: points}], [], true)
  for (const point of points) assert.ok(visited.some(p => p[0] === point[0] && p[1] === point[1]), `outline misses ${point}`)
})

test('every detected subject is outlined, including separate contour rings', () => {
  const visited = []
  const ctx = { save() {}, restore() {}, scale() {}, setLineDash() {}, beginPath() {}, stroke() {},
    moveTo(x, y) { visited.push([x, y]) }, lineTo(x, y) { visited.push([x, y]) } }
  drawJournal(ctx, 1000, 1000, [
    { shape_points: [[100, 100], [200, 100], [200, 200]] },
    { shape_points: [[500, 500], [700, 500], [700, 700]], shape_contours: [
      [[500, 500], [700, 500], [700, 700]], [[550, 550], [600, 550], [600, 600]],
    ] },
  ], [], true)
  for (const point of [[100, 100], [500, 500], [550, 550]]) {
    assert.ok(visited.some(p => p[0] === point[0] && p[1] === point[1]), `missing boundary ${point}`)
  }
})

test('a multi-subject scene keeps each caption and connects it to its subject', () => {
  const subjects = [
    { label: '冰沙', caption: '芒果的快乐', box_2d: [300, 120, 560, 360] },
    { label: '蛋糕', caption: '奶油绵绵', box_2d: [300, 630, 560, 880] },
    { label: '餐盘', caption: '今天也好好吃饭', box_2d: [720, 200, 930, 800] },
  ]
  const elements = createJournalElements(subjects, { safeZone: { x1: 0, y1: 200, x2: 1000, y2: 1000 } }, 1000, 1200)
  for (const [i, subject] of subjects.entries()) {
    const label = elements.find(e => e.subjectIndex === i && e.text === subject.caption)
    assert.ok(label, `missing caption for ${subject.label}`)
    const arrow = elements.find(e => e.type === 'arrow' && e.labelId === label.id)
    assert.ok(arrow, `missing pointer for ${subject.label}`)
    assert.equal(arrow.subjectIndex, i)
    for (const other of subjects) {
      const [y1, x1, y2, x2] = other.box_2d
      const b = { x1: label.x - label.width / 2, x2: label.x + label.width / 2,
        y1: label.y - label.height / 2, y2: label.y + label.height / 2 }
      assert.ok(!(b.x1 < x2 && b.x2 > x1 && b.y1 < y2 && b.y2 > y1), 'caption covers a subject')
    }
  }
  assert.ok(new Set(elements.filter(e => e.type === 'doodle').map(e => e.icon)).size >= 3,
    'hand drawing should contain different motifs')
})

test('real contours leave background gaps usable even inside a conservative safety rectangle', () => {
  const subjects = [{ label: '小猫', caption: '藏在绿叶后的小好奇', box_2d: [95, 232, 998, 716],
    shape_points: [[430, 100], [620, 100], [680, 430], [716, 998], [232, 998], [250, 440]] }]
  const elements = createJournalElements(subjects, { safeZone: { x1: 180, y1: 50, x2: 770, y2: 1000 } }, 1000, 683)
  assert.ok(elements.some(e => e.subjectIndex === 0 && e.text === subjects[0].caption),
    'a close-up must not lose its annotation because a union box excludes the available background')
})
