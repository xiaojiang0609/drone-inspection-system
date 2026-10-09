export const FONT_CN = '"Long Cang", "KaiTi", cursive'
export const FONT_EN = '"Caveat", cursive'

const fontFiles = [
  ['Long Cang', new URL('../assets/fonts/LongCang-Regular.ttf', import.meta.url).href],
  ['Caveat', new URL('../assets/fonts/Caveat.ttf', import.meta.url).href],
]
let loadingPromise = null

export function ensureFontLoaded() {
  if (loadingPromise) return loadingPromise
  loadingPromise = Promise.all(fontFiles.map(async ([family, url]) => {
    const existing = [...document.fonts].find(font =>
      font.family.replaceAll('"', '').replaceAll("'", '') === family && font.status === 'loaded')
    if (existing) return
    const font = new FontFace(family, `url("${url}")`, { style: 'normal', weight: '400' })
    document.fonts.add(await font.load())
  })).then(() => document.fonts.ready).catch(error => {
    loadingPromise = null
    console.warn('手写字体加载失败，将暂用备用字体并在下次绘制时重试。', error)
  })
  return loadingPromise
}
