import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const require = createRequire('C:/Users/xiaojiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')
const { chromium } = require('playwright')
const base = new URL('./', import.meta.url)
const fixture = JSON.parse(await readFile(new URL('white-doodle-cat-live.json', base), 'utf8'))
const primary = fixture.data[0]
const firstRegion = structuredClone(primary.segmentation_regions[0])
const oldRings = primary.shape_contours
primary.segmentation_regions.push({ box_2d: [120, 240, 200, 300], positive_points: [], negative_points: [] })
primary.shape_contours_by_region = [oldRings, []]
primary.segmentation_quality = [{ outline_ready: true, source: 'previous_crop' }, { outline_ready: false }]
fixture.data.push({ label: '第二个测试主体', caption: '另一处小美好', box_2d: [50, 800, 250, 950],
  segmentation_regions: [{ box_2d: [50, 800, 250, 950], positive_points: [], negative_points: [] }],
  shape_contours: [], shape_points: [], outline_status: 'uncertain' })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } })
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  let analysisNumber = 0
  let liveFixture = null
  await page.route('**/api/analyze', route => {
    const data = structuredClone(liveFixture || fixture)
    if (++analysisNumber > 1 && !liveFixture) data.data[0].label = '新照片主体'
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
  })
  let segmentMode = 'success', release, pendingRoute
  const parseRequest = route => {
    const body = route.request().postDataBuffer().toString('utf8')
    const subject = JSON.parse(body.match(/name="subject"\r\n\r\n([\s\S]*?)\r\n--/)[1])
    const regionIndex = Number(body.match(/name="region_index"\r\n\r\n(\d+)/)[1])
    requests.push({ path: new URL(route.request().url()).pathname, subject, regionIndex })
    return { subject, regionIndex }
  }
  const success = ({ subject, regionIndex }, label = '纠正后的主体') => {
    const ring = [[320, 220], [360, 220], [360, 280], [320, 280]]
    const data = { ...subject, label, shape_contours: [ring], shape_points: ring, outline_status: 'partial',
      shape_contours_by_region: subject.segmentation_regions.map((_, index) => index === regionIndex ? [ring] : []),
      segmentation_quality: subject.segmentation_regions.map((_, index) => ({ outline_ready: index === regionIndex })) }
    return { status: 'success', data }
  }
  await page.route('**/api/segment', async route => {
    const request = parseRequest(route)
    if (segmentMode === 'pending') {
      pendingRoute = { route, request }
      await new Promise(resolve => { release = resolve })
    }
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(success(request, segmentMode === 'stale' ? '旧请求不应覆盖' : undefined)) }) }
    catch (error) { if (!/closed|cancel|invalid|intercept|handled/i.test(error.message)) throw error }
  })
  await page.route('**/api/refine', route => {
    parseRequest(route)
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '复核未确认主体，已保留原结果' }) })
  })
  await page.goto('http://127.0.0.1:8879/')
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('cat.jpg', base)))
  await page.getByTestId('subject-correction-open').waitFor()
  await page.getByRole('button', { name: '移动手写标注', exact: true }).first().click()
  const userText = '纠错后也保留我的手写文案'
  await page.getByLabel('修改标注文字', { exact: true }).fill(userText)
  const elementCount = await page.locator('[aria-label^="移动"]').count()
  const originalImageSource = await page.locator('canvas').evaluate(canvas => canvas.width)
  assert.equal(originalImageSource, 1000)
  await page.getByTestId('subject-correction-open').click()
  await page.getByTestId('subject-correction-dialog').waitFor()
  assert.match(await page.getByTestId('correction-photo').getAttribute('src'), /^(blob:|data:image\/)/)
  assert.equal(await page.getByTestId('correction-photo').evaluate(image => image.naturalHeight), 683)
  await page.getByTestId('correction-region').selectOption('1')
  const coordinate = async (x, y) => {
    const bounds = await page.getByTestId('correction-stage').boundingBox()
    return [bounds.x + x / 1000 * bounds.width, bounds.y + y / 1000 * bounds.height]
  }
  const clickPoint = async (x, y) => { const point = await coordinate(x, y); await page.mouse.click(...point) }
  const drawBox = async (x1, y1, x2, y2) => {
    await page.mouse.move(...await coordinate(x1, y1)); await page.mouse.down()
    await page.mouse.move(...await coordinate(x2, y2), { steps: 5 }); await page.mouse.up()
  }
  await drawBox(300, 200, 390, 300)
  await page.getByTestId('correction-tool-positive').click()
  await clickPoint(330, 250)
  await page.getByTestId('correction-tool-negative').click()
  await clickPoint(420, 350)
  await page.getByTestId('correction-region').selectOption('0')
  await page.getByTestId('correction-region').selectOption('1')
  await page.getByTestId('correction-subject').selectOption('1')
  await page.getByTestId('correction-subject').selectOption('0')
  assert.equal(await page.getByTestId('correction-region').inputValue(), '1')
  assert.match(await page.getByTestId('correction-point-summary').textContent(), /主体点 1\/4（手动标注）.*背景点 1\/8（手动标注）/)
  await page.getByTestId('correction-segment').click()
  await page.getByTestId('correction-status').filter({ hasText: '主体已更新' }).waitFor()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/api/segment')
  assert.equal(requests[0].regionIndex, 1)
  assert.deepEqual(requests[0].subject.segmentation_regions[0], firstRegion)
  const selected = requests[0].subject.segmentation_regions[1]
  assert.ok(Math.abs(selected.positive_points[0][0] - 330) < 3)
  assert.ok(Math.abs(selected.positive_points[0][1] - 250) < 3)
  assert.deepEqual(requests[0].subject.manual_hints, { positive: true, negative: true })
  assert.equal(await page.getByTestId('correction-overlay').locator('polygon').count(), 2, 'untouched cached outline is retained')
  await page.screenshot({ path: fileURLToPath(new URL('correction-dialog-preview.png', base)), fullPage: true })
  await page.getByTestId('correction-close').click()
  assert.equal(await page.locator('[aria-label^="移动"]').count(), elementCount)
  await page.getByRole('button', { name: '移动手写标注', exact: true }).first().click()
  assert.equal(await page.getByLabel('修改标注文字', { exact: true }).inputValue(), userText)
  const stableCanvas = await page.locator('canvas').evaluate(canvas => canvas.toDataURL())
  await page.getByTestId('subject-correction-open').click()
  await page.getByTestId('correction-region').selectOption('1')
  assert.match(await page.getByTestId('correction-point-summary').textContent(), /手动标注/)
  await page.getByTestId('correction-refine').click()
  await page.getByTestId('correction-error').filter({ hasText: '已保留原结果' }).waitFor()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].path, '/api/refine')
  assert.deepEqual(requests[1].subject.manual_hints, { positive: true, negative: true })
  await page.getByTestId('correction-close').click()
  assert.equal(await page.locator('canvas').evaluate(canvas => canvas.toDataURL()), stableCanvas)
  // Closing keeps processing; changing the image cancels and discards stale responses.
  segmentMode = 'pending'
  await page.getByTestId('subject-correction-open').click()
  await page.getByTestId('correction-segment').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="correction-segment"]')?.disabled)
  await page.getByTestId('correction-close').click()
  assert.ok(await page.getByRole('button', { name: '生成图片', exact: true }).isDisabled())
  assert.ok(pendingRoute)
  segmentMode = 'stale'
  await page.getByRole('button', { name: '换一张', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('coffee.jpg', base)))
  await page.getByTestId('subject-correction-open').waitFor()
  release()
  await page.getByText(/已识别：新照片主体/).waitFor()
  assert.equal(await page.getByText(/旧请求不应覆盖/).count(), 0)
  // Render the measured real SAM result and verify full-resolution export parity.
  const liveResult = JSON.parse(await readFile(new URL('correction-coffee-after.json', base), 'utf8'))
  liveFixture = { status: 'success', data: [liveResult.data], theme: '美食', emotion: '治愈',
    decorations: [], headline: null, ambientCaptions: [] }
  await page.getByRole('button', { name: '换一张', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('coffee.jpg', base)))
  await page.getByTestId('subject-correction-open').click()
  await page.screenshot({ path: fileURLToPath(new URL('correction-coffee-dialog.png', base)), fullPage: true })
  await page.getByTestId('correction-close').click()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const preview = await page.locator('canvas').evaluate(canvas => canvas.toDataURL().split(',')[1])
  await page.getByRole('button', { name: '生成图片', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出图片', exact: true }).click()
  const download = await downloadPromise
  const output = new URL('correction-coffee-export.png', base)
  await download.saveAs(fileURLToPath(output))
  assert.deepEqual(await readFile(output), Buffer.from(preview, 'base64'))
  assert.deepEqual(errors, [])
  const verification = { normalizedNonSquarePhotoPoints: true, manualBoxAndPointTools: true,
    subjectAndRegionDraftsRetained: true, noVisionRequestForRedraw: true, failedRefinementKeepsCanvas: true,
    handwrittenEditsRetained: true, untouchedRegionContourRetained: true, manualFlagsPersistOnReopen: true,
    closeLeavesWorkRunning: true, imageResetDiscardsStaleResponse: true, correctedPreviewMatchesExport: true,
    browserErrors: errors }
  await writeFile(new URL('correction-ui-verification.json', base), JSON.stringify(verification, null, 2))
  console.log(JSON.stringify(verification))
} finally { await browser.close() }
