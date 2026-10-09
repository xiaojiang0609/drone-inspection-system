import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSubjectInventory, retainSubjectCaptions } from '../src/utils/subject-inventory.js'

const ring = [[100, 100], [300, 100], [200, 300]]

test('all recognized groups remain visible beyond six, including groups without masks or placed captions', () => {
  const detections = Array.from({ length: 8 }, (_, index) => ({
    label: `小物${index + 1}`, caption: `第${index + 1}组的完整文案`,
    segmentation_regions: index === 0 ? [{}, {}, {}] : [{}],
    shape_points: [],
  }))
  const original = structuredClone(detections)
  const result = buildSubjectInventory(detections, [])

  assert.deepEqual(result.rows.map(row => row.label),
    ['小物1', '小物2', '小物3', '小物4', '小物5', '小物6', '小物7', '小物8'])
  assert.equal(result.groupCount, 8, 'multiple mask regions still belong to one subject group')
  assert.equal(result.placedTextCount, 0)
  assert.equal(result.outlinedCount, 0)
  assert.equal(result.rows[7].caption, '第8组的完整文案')
  assert.equal(result.rows[7].textStatus, '文案保留在清单中')
  assert.equal(result.rows[7].outlineStatus, '轮廓暂不可用')
  assert.deepEqual(detections, original)
})

test('current bound text, notes and bubbles replace API captions and are counted once per group', () => {
  const detections = [
    { label: '杯子', caption: '原始杯子文案' },
    { label: '花瓶', caption: '原始花瓶文案' },
    { label: '甜品', caption: '原始甜品文案' },
  ]
  const elements = [
    { type: 'text', subjectIndex: 0, text: '手动改成的杯子文案' },
    { type: 'note', subjectIndex: 0, text: '补充一行' },
    { type: 'note', subjectIndex: 1, text: '修改后的花瓶便签' },
    { type: 'bubble', subjectIndex: 2, text: '修改后的甜品气泡' },
    { type: 'arrow', subjectIndex: 1, text: '箭头不是文案' },
    { type: 'text', text: '无主体的环境文案' },
    { type: 'bubble', text: '照片总标题' },
  ]
  const result = buildSubjectInventory(detections, elements)

  assert.deepEqual(result.rows.map(row => row.caption),
    ['手动改成的杯子文案\n补充一行', '修改后的花瓶便签', '修改后的甜品气泡'])
  assert.deepEqual(result.rows.map(row => row.textStatus), ['已放置文字', '已放置文字', '已放置文字'])
  assert.equal(result.placedTextCount, 3)
})

test('intentionally cleared text stays empty instead of restoring the API caption', () => {
  const result = buildSubjectInventory([{ label: '杯子', caption: '应保留为已删除状态' }],
    [{ type: 'text', subjectIndex: 0, text: '' }])

  assert.equal(result.rows[0].caption, '')
  assert.equal(result.rows[0].textStatus, '暂无文案')
  assert.equal(result.placedTextCount, 0)
})

test('missing or whitespace-only captions have no text, while long unplaced captions stay complete', () => {
  const longCaption = '这段完整文案没有在照片上找到安全留白。'.repeat(30)
  const result = buildSubjectInventory([{ label: '盘子' }, { label: '花', caption: '  \n ' },
    { label: '杯子', caption: longCaption }], [])

  assert.equal(result.rows[0].caption, '')
  assert.equal(result.rows[0].textStatus, '暂无文案')
  assert.equal(result.rows[1].textStatus, '暂无文案')
  assert.equal(result.rows[2].caption, longCaption)
  assert.equal(result.rows[2].textStatus, '文案保留在清单中')
})

test('outline counts belong to groups and actual rings determine full or partial coverage', () => {
  const detections = [
    { label: '成组杯子', shape_contours: [ring, ring, ring], segmentation_regions: [{}, {}, {}],
      shape_contours_by_region: [[ring], [ring], [ring]], outline_status: 'ready' },
    { label: '成组甜品', shape_contours: [ring], segmentation_regions: [{}, {}],
      shape_contours_by_region: [[ring], []], outline_status: 'ready' },
    { label: '无轮廓盘子', shape_points: [], outline_status: 'ready' },
    { label: '有真实轮廓的花', shape_points: ring, outline_status: 'uncertain' },
  ]
  const result = buildSubjectInventory(detections)

  assert.equal(result.groupCount, 4)
  assert.equal(result.outlinedCount, 3)
  assert.deepEqual(result.rows.map(row => row.outlineStatus),
    ['已描边', '部分描边', '轮廓暂不可用', '部分描边'])
})

test('finite normalized shape points can supply an outline when optional contour arrays are unusable', () => {
  const result = buildSubjectInventory([
    { shape_contours: null, shape_points: [[0, 0], [1000, 0], [0, 1000]] },
    { shape_contours: [null], shape_points: ring },
    { shape_contours: {}, shape_points: ring, shape_contours_by_region: {}, segmentation_regions: {} },
  ])

  assert.equal(result.outlinedCount, 3)
  assert.deepEqual(result.rows.map(row => row.outlineStatus), ['已描边', '已描边', '已描边'])
})

test('invalid rings cannot claim an outline even when status says ready or partial', () => {
  const invalidRings = [
    [[100, 100], [200, 200]],
    [[100, 100], [200, 200], [NaN, 300]],
    [[100, 100], [200, 200], [Infinity, 300]],
    [[100, 100], [200, 200], ['300', 300]],
    [[100, 100], [200, 200], [-1, 300]],
    [[100, 100], [200, 200], [1001, 300]],
    [[100, 100], null, [300, 300]],
  ]
  const result = buildSubjectInventory(invalidRings.map((points, index) => ({
    shape_contours: [points], shape_points: points, outline_status: index % 2 ? 'ready' : 'partial',
  })))

  assert.equal(result.outlinedCount, 0)
  assert.ok(result.rows.every(row => row.outlineStatus === '轮廓暂不可用'))
})

test('sparse contour points do not count as finite coordinates or a complete ring', () => {
  const sparseRing = [ring[0], , ring[2]]
  const sparsePoint = [100, ,]
  const result = buildSubjectInventory([
    { shape_points: sparseRing, outline_status: 'ready' },
    { shape_points: [ring[0], sparsePoint, ring[2]], outline_status: 'ready' },
  ])
  assert.equal(result.outlinedCount, 0)
  assert.deepEqual(result.rows.map(row => row.outlineStatus), ['轮廓暂不可用', '轮廓暂不可用'])
})

test('invalid subject bindings never replace another group caption or change counts', () => {
  const invalidIndices = [-1, 1, 0.5, NaN, Infinity, '0', null, undefined]
  const elements = invalidIndices.map(subjectIndex => ({ type: 'text', subjectIndex, text: '错误绑定' }))
  const result = buildSubjectInventory([{ caption: '原始文案' }], [null, {}, ...elements])

  assert.equal(result.rows[0].caption, '原始文案')
  assert.equal(result.rows[0].textStatus, '文案保留在清单中')
  assert.equal(result.placedTextCount, 0)
})

test('optional malformed arrays and fields produce safe defaults without losing valid rows', () => {
  for (const detections of [null, undefined, {}, 'not an array']) {
    const result = buildSubjectInventory(detections, null)
    assert.deepEqual(result.rows, [])
    assert.equal(result.groupCount, 0)
  }
  const result = buildSubjectInventory([null, {}, { label: 17, caption: {} }], {})
  assert.deepEqual(result.rows.map(row => row.label), ['主体1', '主体2', '主体3'])
  assert.deepEqual(result.rows.map(row => row.caption), ['', '', ''])
})

test('sparse input groups retain stable indices and visible fallback rows', () => {
  const result = buildSubjectInventory([, { label: '杯子', caption: '杯子的文案' }])
  assert.equal(result.groupCount, 2)
  assert.deepEqual(result.rows.map(row => row.label), ['主体1', '杯子'])
  assert.deepEqual(result.rows.map(row => row.subjectIndex), [0, 1])
})

test('recognition warnings use valid positive integer counts without replacing actual group counts', () => {
  const result = buildSubjectInventory([{ caption: '一组' }], [], {
    returned_subjects: 99, accepted_subjects: 98, rejected_geometry: 3, duplicates: 4, limited_subjects: 5,
  })

  assert.equal(result.groupCount, 1)
  assert.deepEqual(result.warnings,
    ['3条坐标无效结果未采用', '4条重复结果未重复列出', '另有5组主体未纳入本次清单'])
})

test('malformed optional warning counts never leak into the interface', () => {
  for (const value of [0, -1, 1.5, Infinity, NaN, '4', {}, true, Number.MAX_SAFE_INTEGER + 1]) {
    const result = buildSubjectInventory([], [], {
      returned_subjects: value, accepted_subjects: value, rejected_geometry: value,
      duplicates: value, limited_subjects: value,
    })
    assert.deepEqual(result.warnings, [])
  }
  assert.deepEqual(buildSubjectInventory([], [], null).warnings, [])
})

test('building the inventory preserves detection, element and recognition-summary inputs', () => {
  const detections = [{ label: '杯子', caption: '原始文案', shape_contours: [ring],
    shape_contours_by_region: [[ring]], segmentation_regions: [{}] }]
  const elements = [{ type: 'note', subjectIndex: 0, text: '当前文案' }]
  const summary = { returned_subjects: 3, rejected_geometry: 2, duplicates: 0, limited_subjects: 0, accepted_subjects: 1 }
  const original = structuredClone({ detections, elements, summary })
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
  }
  freeze(detections)
  freeze(elements)
  freeze(summary)

  const result = buildSubjectInventory(detections, elements, summary)
  assert.equal(result.rows[0].caption, '当前文案')
  assert.equal(result.outlinedCount, 1)
  assert.deepEqual({ detections, elements, summary }, original)
})

test('editing then deleting a bound caption retains the latest wording in the subject inventory', () => {
  const initial = [{ label: '杯子', caption: '最初的 AI 文案' }]
  const edited = retainSubjectCaptions(initial,
    [{ type: 'text', subjectIndex: 0, text: '我修改后的文案' }])
  assert.equal(edited[0].caption, '我修改后的文案')
  const deleted = retainSubjectCaptions(edited, [])
  const result = buildSubjectInventory(deleted, [])
  assert.equal(result.rows[0].caption, '我修改后的文案')
  assert.equal(result.rows[0].textStatus, '文案保留在清单中')
  assert.equal(initial[0].caption, '最初的 AI 文案')
})

test('clearing then deleting a note or bubble keeps the retained caption deliberately blank', () => {
  for (const type of ['note', 'bubble']) {
    const initial = [{ caption: '应保持已清空' }]
    const cleared = retainSubjectCaptions(initial, [{ type, subjectIndex: 0, text: '' }])
    assert.equal(cleared[0].caption, '')
    const deleted = retainSubjectCaptions(cleared, [])
    const result = buildSubjectInventory(deleted)
    assert.equal(result.rows[0].caption, '')
    assert.equal(result.rows[0].textStatus, '暂无文案')
    assert.equal(deleted, cleared)
  }
})

test('undoing to an earlier element array restores its retained caption without changing earlier state', () => {
  const initial = [{ caption: '最初文案' }]
  const oldElements = [{ type: 'note', subjectIndex: 0, text: '较早的手动文案' }]
  const older = retainSubjectCaptions(initial, oldElements)
  const newer = retainSubjectCaptions(older, [{ type: 'bubble', subjectIndex: 0, text: '后来的文案' }])
  assert.equal(newer[0].caption, '后来的文案')
  const restored = retainSubjectCaptions(newer, oldElements)
  assert.equal(restored[0].caption, '较早的手动文案')
  assert.equal(buildSubjectInventory(restored, []).rows[0].caption, '较早的手动文案')
  assert.equal(initial[0].caption, '最初文案')
  assert.equal(older[0].caption, '较早的手动文案')
  assert.equal(newer[0].caption, '后来的文案')
})

test('retaining captions joins all current bound string elements, including empty lines', () => {
  const initial = [{ label: '杯子', caption: '旧文案' }, { label: '花', caption: '旧花文案' }]
  const elements = [
    { type: 'text', subjectIndex: 0, text: '' },
    { type: 'note', subjectIndex: 0, text: '第二行' },
    { type: 'bubble', subjectIndex: 0, text: '第三行' },
    { type: 'bubble', subjectIndex: 1, text: '  花的新文案  ' },
  ]
  const retained = retainSubjectCaptions(initial, elements)
  assert.equal(retained[0].caption, '\n第二行\n第三行')
  assert.equal(retained[1].caption, '  花的新文案  ')
  assert.equal(buildSubjectInventory(retained, elements).rows[0].caption, '\n第二行\n第三行')
})

test('retaining a changed caption copies only its subject and preserves all geometry and input references', () => {
  const box = [100, 100, 300, 300], contours = [ring], regions = [{ box_2d: box }]
  const first = Object.freeze({ label: '杯子', caption: '原始文案', box_2d: box,
    shape_contours: contours, segmentation_regions: regions, outline_status: 'ready' })
  const second = Object.freeze({ label: '花', caption: '花的文案', shape_points: ring })
  const initial = Object.freeze([first, second])
  const elements = Object.freeze([Object.freeze({ type: 'text', subjectIndex: 0, text: '新文案' })])
  const retained = retainSubjectCaptions(initial, elements)

  assert.notEqual(retained, initial)
  assert.notEqual(retained[0], first)
  assert.equal(retained[1], second)
  assert.deepEqual(retained[0], { ...first, caption: '新文案' })
  assert.equal(retained[0].box_2d, box)
  assert.equal(retained[0].shape_contours, contours)
  assert.equal(retained[0].segmentation_regions, regions)
  assert.equal(initial[0].caption, '原始文案')
  assert.equal(elements[0].text, '新文案')
})

test('no caption changes reuse the original detection array and objects', () => {
  const initial = [{ caption: '已有文案' }, { caption: '未改文案' }]
  for (const elements of [[], null, {}, [{ type: 'text', subjectIndex: 0, text: '已有文案' }],
    [{ type: 'arrow', subjectIndex: 0, text: '箭头' }], [{ type: 'text', text: '环境文案' }]]) {
    assert.equal(retainSubjectCaptions(initial, elements), initial)
  }
})

test('invalid caption bindings and nonstring text cannot overwrite a retained subject caption', () => {
  const initial = [{ caption: '最新保留文案' }]
  const invalidIndices = [-1, 1, 0.5, NaN, Infinity, '0', null, undefined]
  const invalidTexts = [null, undefined, 7, {}, [], true]
  const elements = [null, {}, ...invalidIndices.map(subjectIndex => ({ type: 'text', subjectIndex, text: '错误绑定' })),
    ...invalidTexts.map(text => ({ type: 'note', subjectIndex: 0, text })),
    { type: 'doodle', subjectIndex: 0, text: '装饰文字' }]

  assert.equal(retainSubjectCaptions(initial, elements), initial)
  assert.equal(buildSubjectInventory(initial, elements).rows[0].caption, '最新保留文案')
  assert.equal(buildSubjectInventory(initial, elements).rows[0].textStatus, '文案保留在清单中')
})

test('retaining captions safely ignores malformed detection entries and optional arrays', () => {
  for (const value of [null, undefined, {}, 'not an array']) {
    assert.deepEqual(retainSubjectCaptions(value, null), [])
  }
  const initial = [, null, 17, [], 'bad', { caption: '旧文案' }]
  const elements = Array.from({ length: 6 }, (_, subjectIndex) => ({ type: 'text', subjectIndex, text: '新文案' }))
  const retained = retainSubjectCaptions(initial, elements)
  assert.equal(0 in retained, false)
  assert.deepEqual(retained.slice(1, 5), [null, 17, [], 'bad'])
  assert.equal(retained[3], initial[3])
  assert.equal(retained[5].caption, '新文案')
  assert.equal(initial[5].caption, '旧文案')
})
