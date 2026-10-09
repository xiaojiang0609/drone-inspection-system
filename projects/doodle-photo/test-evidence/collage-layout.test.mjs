import test from 'node:test'
import assert from 'node:assert/strict'
import { createCollageLayout, placeAdditionalSticker, collageElementBounds, constrainCollageElement } from '../src/utils/collage-layout.js'
import { collageInk } from '../src/utils/collage-config.js'
import { drawJournalElement } from '../src/utils/journal.js'

const options = { title: '把日常，贴成一页', ink: '#fffaf1', seed: 42, measureText: (text, size) => text.length * size }
const assets = count => Array.from({ length: count }, (_, i) => ({ assetId: `a${i}`, sourceId: `s${i}`, width: i % 3 === 0 ? 1000 : 100, height: i % 3 === 1 ? 1000 : 100, meta: { caption: '小小快乐', theme: 'daily' } }))
const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

test('layout_keeps_every_sticker_inside_rotated_border_bounds', () => {
  for (const count of [1, 2, 4, 9, 16]) {
    const result = createCollageLayout(assets(count), options)
    assert.equal(result.filter(e => e.type === 'imageSticker').length, count)
    assert.deepEqual(createCollageLayout(assets(count), options), result)
    assert.ok(result.filter(e => e.role === 'caption').length <= 4)
    assert.ok(result.filter(e => e.type === 'doodle').length <= 8)
    for (const e of result) {
      const b = collageElementBounds(e)
      assert.ok(b.x1 >= 0 && b.y1 >= 0 && b.x2 <= 1000 && b.y2 <= 1000, JSON.stringify({ e, b }))
      if (e.type === 'imageSticker') {
        const asset = assets(count).find(a => a.assetId === e.assetId)
        assert.ok(Math.abs(e.width * 1080 / (e.height * 1440) - asset.width / asset.height) < 1e-8)
        assert.ok(Math.abs(e.rotation) <= 8)
      }
    }
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      assert.equal(overlaps(collageElementBounds(result[i]), collageElementBounds(result[j])), false)
    }
  }
})

test('bounds use export pixels for border and rotation', () => {
  const b = collageElementBounds({ type: 'imageSticker', x: 500, y: 500, width: 200, height: 100, rotation: 90, borderStyle: 'solid', borderWidth: 16 })
  assert.ok(Math.abs(b.x1 - (500 - 88 / 1080 * 1000)) < 1e-8)
  assert.ok(Math.abs(b.y1 - (500 - 124 / 1440 * 1000)) < 1e-8)
  const original = { type: 'imageSticker', x: -40, y: 1100, width: 2100, height: 1600, rotation: 37, borderWidth: 16, borderStyle: 'dashed' }
  const e = constrainCollageElement(original), bounds = collageElementBounds(e)
  assert.ok(bounds.x1 >= -1e-8 && bounds.y1 >= -1e-8 && bounds.x2 <= 1000 + 1e-8 && bounds.y2 <= 1000 + 1e-8)
  assert.equal(original.x, -40)
  assert.ok(Math.abs(e.width / e.height - original.width / original.height) < 1e-8)
})

test('safe append preserves existing positions and returns null for a full page', () => {
  const existing = createCollageLayout(assets(1), options), snapshot = structuredClone(existing)
  const added = placeAdditionalSticker(assets(2)[1], existing, options)
  assert.ok(added)
  assert.deepEqual(existing, snapshot)
  assert.ok(existing.every(e => !overlaps(collageElementBounds(e), collageElementBounds(added))))
  assert.equal(placeAdditionalSticker(assets(1)[0], [{ type: 'text', x: 500, y: 500, width: 1000, height: 1000 }], options), null)
})

test('appending the same asset gives each editable instance a unique element ID', () => {
  const existing = createCollageLayout(assets(1), options)
  const added = placeAdditionalSticker(assets(1)[0], existing, options)
  assert.ok(added)
  assert.ok(existing.every(e => e.id !== added.id))
})

test('homogeneous square and extreme assets all fit without omitting a successful asset', () => {
  for (const [width, height] of [[100, 100], [1000, 100], [100, 1000]]) for (const count of [1, 2, 4, 9, 16]) {
    const input = assets(count).map(a => ({ ...a, width, height }))
    const result = createCollageLayout(input, options)
    assert.equal(result.filter(e => e.type === 'imageSticker').length, count)
    for (const e of result) {
      const b = collageElementBounds(e)
      assert.ok(b.x1 >= 0 && b.x2 <= 1000 && b.y1 >= 0 && b.y2 <= 1000)
    }
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) assert.equal(overlaps(collageElementBounds(result[i]), collageElementBounds(result[j])), false)
  }
})

test('related doodles use recognized labels and broad themes do not invent subjects', () => {
  const result = createCollageLayout([{ ...assets(1)[0], meta: { theme: '美食', subject: { label: '热咖啡杯' } } }], options)
  assert.ok(result.some(e => e.type === 'doodle' && e.icon === 'cup'))
  const broad = createCollageLayout([{ ...assets(1)[0], meta: { theme: '美食' } }], options)
  assert.ok(broad.filter(e => e.type === 'doodle').every(e => !['cup', 'cat', 'fruit'].includes(e.icon)))
})

test('background ink follows brightness and explicit project selection', () => {
  assert.equal(collageInk({ kind: 'paper-dark' }), '#fffaf1')
  assert.equal(collageInk({ kind: 'paper-light' }), '#665d50')
  assert.equal(collageInk({ kind: 'solid', color: '#ffffff' }), '#665d50')
  assert.equal(collageInk({ kind: 'solid', color: '#000' }), '#fffaf1')
  assert.equal(collageInk({ kind: 'photo' }), '#fffaf1')
  assert.equal(collageInk({ kind: 'photo' }, 'dark'), '#665d50')
})

test('switching to light paper ignores the retained dark solid color for automatic ink', () => {
  assert.equal(collageInk({ kind: 'paper-light', color: '#000000' }, 'auto'), '#665d50')
})

test('switching to dark paper ignores the retained light solid color for automatic ink', () => {
  assert.equal(collageInk({ kind: 'paper-dark', color: '#ffffff' }, 'auto'), '#fffaf1')
})

test('switching to a photo keeps automatic light ink regardless of the retained solid color', () => {
  assert.equal(collageInk({ kind: 'photo', color: '#ffffff' }, 'auto'), '#fffaf1')
  assert.equal(collageInk({ kind: 'photo', color: '#000000' }, 'auto'), '#fffaf1')
})

test('shared text renderer accepts explicit ink and preserves legacy default ink', () => {
  const texts = []
  const ctx = { save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, measureText(text) { return { width: text.length * parseFloat(this.font) } }, fillText(text) { texts.push({ text, color: this.fillStyle }) } }
  const e = { type: 'text', text: '日常', x: 500, y: 200, width: 200, height: 90, fontSize: 30 }
  drawJournalElement(ctx, 1080, 1440, { ...e, color: '#665d50' })
  drawJournalElement(ctx, 1080, 1440, e)
  assert.deepEqual(texts, [{ text: '日常', color: '#665d50' }, { text: '日常', color: '#fffaf1' }])
})

function renderCaptionLines(element) {
  const lines = []
  const ctx = { save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
    measureText(text) { return { width: Array.from(text).length * parseFloat(this.font) * .8 } },
    fillText(text) { lines.push({ text, fontSize: parseFloat(this.font) }) } }
  drawJournalElement(ctx, 1080, 1440, element)
  return lines
}

test('automatic comma captions reserve enough height for the real renderer to stay readable', () => {
  const input = [
    { assetId: 'coffee', sourceId: 'coffee', width: 500, height: 399, meta: { caption: '一杯冒着热气的土耳其咖啡，泡沫细腻，花纹瓷杯静置在书页旁。' } },
    { assetId: 'cat', sourceId: 'cat', width: 546, height: 619, meta: { caption: '绿叶丛中探头的小猫' } },
    { assetId: 'vase', sourceId: 'vase', width: 196, height: 439, meta: { caption: '黑色花瓶中插着白色玫瑰与兰花，优雅点缀甜品台' } },
  ]
  const snapshot = structuredClone(input)
  for (const measureText of [undefined, (text, size) => Array.from(text).length * size * .8]) {
    const result = createCollageLayout(input, { seed: 20261008, measureText })
    assert.equal(result.filter(e => e.type === 'imageSticker').length, 3)
    const coffee = result.find(e => e.id === 'caption-0')
    assert.ok(coffee, 'the roomy three-sticker layout must retain its coffee caption')
    const lines = renderCaptionLines(coffee)
    assert.equal(lines.map(line => line.text).join(''), input[0].meta.caption.slice(0, 30))
    assert.ok(lines.every(line => line.fontSize >= 18), `actual renderer shrank caption: ${JSON.stringify(lines)}`)
    assert.ok(result.filter(e => e.role === 'caption').length <= 4)
    assert.ok(result.filter(e => e.type === 'doodle').length <= 8)
    for (let i = 0; i < result.length; i++) {
      const b = collageElementBounds(result[i])
      assert.ok(b.x1 >= 0 && b.x2 <= 1000 && b.y1 >= 0 && b.y2 <= 1000)
      for (let j = i + 1; j < result.length; j++) assert.equal(overlaps(b, collageElementBounds(result[j])), false)
    }
  }
  assert.deepEqual(input, snapshot)
})

test('crowded layouts omit comma-heavy captions when readable height has no safe space', () => {
  const input = assets(16).map(a => ({ ...a, width: 100, height: 100, meta: { caption: '一，二，三，四，五，六，七，八，九，十，甲，乙，丙，丁，戊，' } }))
  const result = createCollageLayout(input, options)
  assert.equal(result.filter(e => e.type === 'imageSticker').length, 16)
  assert.equal(result.filter(e => e.role === 'caption').length, 0)
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) assert.equal(overlaps(collageElementBounds(result[i]), collageElementBounds(result[j])), false)
})
