import test from 'node:test'
import assert from 'node:assert/strict'
import * as catalog from '../src/utils/doodle-catalog.js'
import { drawDoodle } from '../src/utils/journal-marks.js'

const newMotifs = ['fruit', 'berry', 'bread', 'steam', 'rays', 'wave', 'dots']

// These assertions catch a label-rule regression, such as selecting cake for
// every food photograph, or inferring hot steam from a cold coffee label.
for (const [label, expected] of [
  ['一盘水果', 'fruit'], ['切开的橙子', 'fruit'], ['新鲜草莓', 'berry'],
  ['蓝莓', 'berry'], ['法棍面包', 'bread'], ['可颂', 'bread'],
  ['热咖啡杯', 'cup'], ['海边的浪花', 'wave'],
  ['Mixed berries', 'berry'], ['A croissant', 'bread'],
]) {
  test(`${label} prioritizes a motif supported by its recognized label`, () => {
    assert.equal(catalog.themedDoodles('其他', [{ label }])[0], expected)
  })
}

for (const [label, wantsSteam] of [
  ['热咖啡杯', true], ['刚出炉的面包', true], ['热粥', true], ['Hot tea', true],
  ['冰咖啡', false], ['草莓冰沙', false], ['餐盘', false], ['Hot dog', false],
]) {
  test(`${label} ${wantsSteam ? 'supports' : 'does not imply'} a heat accent`, () => {
    assert.equal(catalog.themedDoodles('美食', [{ label }]).includes('steam'), wantsSteam)
  })
}

test('themes and captions do not invent concrete food or pet objects', () => {
  const concrete = ['fruit', 'berry', 'bread', 'cake', 'cup', 'cat', 'chefHat']
  for (const theme of ['美食', '宠物', '其他']) {
    const motifs = catalog.themedDoodles(theme, [{ label: '主体', caption: '草莓面包与小猫' }])
    assert.ok(motifs.every(icon => !concrete.includes(icon)), `${theme}: ${motifs.join(', ')}`)
    assert.ok(motifs.includes('rays') && motifs.includes('dots'), 'neutral micro accents remain available')
  }
})

test('cup and fruit rules avoid misleading object names', () => {
  const motifs = catalog.themedDoodles('静物', [{ label: '茶几上的苹果手机' }])
  assert.ok(!motifs.includes('cup'))
  assert.ok(!motifs.includes('fruit'))
  assert.ok(!catalog.themedDoodles('静物', [{ label: 'Coffee table' }]).includes('cup'))
})

test('a hot dog label does not imply a real pet', () => {
  assert.ok(!catalog.themedDoodles('美食', [{ label: 'Hot dog' }]).includes('paw'))
})

test('multi-subject label selection retains each relevant motif without duplicates', () => {
  const motifs = catalog.themedDoodles('美食', [
    { label: '草莓' }, { label: '法棍面包' }, { label: '冰咖啡杯' }, { label: '草莓' },
  ])
  assert.ok(['berry', 'bread', 'cup'].every(icon => motifs.includes(icon)))
  assert.equal(new Set(motifs).size, motifs.length)
  assert.ok(!motifs.includes('steam'))
})

test('new editable types and accent budgets share the catalog', () => {
  for (const icon of newMotifs) {
    assert.ok(catalog.DOODLE_OPTIONS.some(option => option.id === icon && option.label))
    assert.ok(catalog.DOODLE_TYPES.has(icon))
  }
  for (const icon of ['fruit', 'berry', 'bread']) assert.ok(catalog.FEATURE_DOODLES.has(icon))
  assert.ok(catalog.ACCENT_DOODLES instanceof Set, 'layout needs an exported micro-accent category')
  for (const icon of ['steam', 'rays', 'wave', 'dots']) {
    assert.ok(catalog.ACCENT_DOODLES.has(icon))
    assert.ok(!catalog.FEATURE_DOODLES.has(icon), `${icon} should not consume the large-feature budget`)
  }
  for (const icon of [...catalog.FEATURE_DOODLES, ...catalog.ACCENT_DOODLES]) {
    assert.ok(icon === 'custom' || catalog.DOODLE_TYPES.has(icon))
  }
})

// This records the Canvas boundary, which Node does not provide. It catches
// clipped curves and filled silhouettes while exercising real drawDoodle code.
function traceDoodle(icon, size) {
  const points = [], commands = []
  let fills = 0, strokes = 0
  const record = (name, values) => {
    commands.push([name, ...values])
    for (let i = 0; i < values.length; i += 2) points.push(values.slice(i, i + 2))
  }
  const ctx = {
    save() {}, restore() {}, scale() {}, beginPath() {}, closePath() {},
    moveTo(...values) { record('move', values) },
    lineTo(...values) { record('line', values) },
    quadraticCurveTo(...values) { record('quadratic', values) },
    bezierCurveTo(...values) { record('bezier', values) },
    ellipse(x, y, rx, ry, rotation, start, end) {
      commands.push(['ellipse', x, y, rx, ry, rotation, start, end])
      for (let i = 0; i <= 80; i++) {
        const angle = start + (end - start) * i / 80
        const dx = Math.cos(angle) * rx, dy = Math.sin(angle) * ry
        points.push([x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
          y + dx * Math.sin(rotation) + dy * Math.cos(rotation)])
      }
    },
    arc(x, y, radius, start, end) { this.ellipse(x, y, radius, radius, 0, start, end) },
    fill() { fills++ }, stroke() { strokes++ },
  }
  drawDoodle(ctx, icon, size)
  return { points, commands, ctx, fills, strokes }
}

for (const icon of newMotifs) {
  test(`${icon} draws a white outline within its editable box at small and large sizes`, () => {
    for (const size of [30, 72]) {
      const trace = traceDoodle(icon, size)
      assert.ok(trace.commands.some(([command]) => command !== 'move'), 'must draw a visible line')
      assert.equal(trace.ctx.strokeStyle, '#fffaf1')
      assert.equal(trace.fills, 0, 'small natural doodles should remain outlines')
      assert.equal(trace.strokes, 1)
      const inset = trace.ctx.lineWidth / 2
      assert.ok(trace.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)
        && Math.abs(x) + inset <= .5 && Math.abs(y) + inset <= .5), 'stroke must stay inside reserved bounds')
    }
  })
}

test('new motifs have distinguishable vector geometry', () => {
  const signatures = newMotifs.map(icon => JSON.stringify(traceDoodle(icon, 72).commands))
  assert.equal(new Set(signatures).size, newMotifs.length)
})
