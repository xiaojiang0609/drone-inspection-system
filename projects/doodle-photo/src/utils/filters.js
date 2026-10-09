/**
 * 日系胶片调色滤镜 - 基于 Canvas ImageData 像素操作
 *
 * 每个滤镜函数接收 ImageData，返回新的 ImageData
 * 调色思路：降对比 + 降饱和 + 高光微黄 + 暗部偏朦胧
 */

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * 滤镜 1：青森 (Aomori)
 * 淡青色调 + 低对比 + 暗部雾感 + 高光微黄
 */
export function filterAomori(imageData) {
  const d = imageData.data
  const out = new ImageData(new Uint8ClampedArray(d), imageData.width, imageData.height)
  const p = out.data
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i + 1], b = p[i + 2]

    // 降对比度（中间灰拉伸）
    r = r * 0.82 + 35
    g = g * 0.82 + 35
    b = b * 0.82 + 35

    // 降饱和度
    const avg = (r + g + b) / 3
    r = r * 0.7 + avg * 0.3
    g = g * 0.72 + avg * 0.28
    b = b * 0.72 + avg * 0.28

    // 整体偏青绿
    r = r * 0.93
    g = g * 1.02
    b = b * 1.08

    // 高光微黄
    const lum = (r + g + b) / 3
    if (lum > 150) {
      r = r + (lum - 150) * 0.12
      g = g + (lum - 150) * 0.08
    }

    // 暗部朦胧（提亮）
    if (lum < 80) {
      r = r + (80 - lum) * 0.15
      g = g + (80 - lum) * 0.12
      b = b + (80 - lum) * 0.18
    }

    p[i] = clamp(r)
    p[i + 1] = clamp(g)
    p[i + 2] = clamp(b)
  }
  return out
}

/**
 * 滤镜 2：夕焼け (Yuuyake)
 * 暖橘色调 + 高光泛黄暖光 + 暗部偏暖棕 + 胶片空气感
 */
export function filterYuuyake(imageData) {
  const d = imageData.data
  const out = new ImageData(new Uint8ClampedArray(d), imageData.width, imageData.height)
  const p = out.data
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i + 1], b = p[i + 2]

    // 降对比度
    r = r * 0.8 + 38
    g = g * 0.8 + 32
    b = b * 0.8 + 28

    // 暖色偏移
    r = r * 1.1 + 10
    g = g * 0.95 + 5
    b = b * 0.75

    // 高光泛黄（暖光感）
    const lum = (r + g + b) / 3
    if (lum > 140) {
      r = r + (lum - 140) * 0.15
      g = g + (lum - 140) * 0.1
      b = b - (lum - 140) * 0.05
    }

    // 暗部偏暖棕
    if (lum < 80) {
      r = r + (80 - lum) * 0.12
      g = g + (80 - lum) * 0.06
      b = b + (80 - lum) * 0.02
    }

    // 降饱和度
    const avg = (r + g + b) / 3
    r = r * 0.82 + avg * 0.18
    g = g * 0.82 + avg * 0.18
    b = b * 0.82 + avg * 0.18

    p[i] = clamp(r)
    p[i + 1] = clamp(g)
    p[i + 2] = clamp(b)
  }
  return out
}

/**
 * 滤镜 3：霧雨 (Kirisame)
 * 冷灰蓝色调 + 极低饱和 + 高光偏白 + 暗部蓝雾
 */
export function filterKirisame(imageData) {
  const d = imageData.data
  const out = new ImageData(new Uint8ClampedArray(d), imageData.width, imageData.height)
  const p = out.data
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i + 1], b = p[i + 2]

    // 大幅去饱和
    const gray = r * 0.3 + g * 0.59 + b * 0.11
    r = r * 0.4 + gray * 0.6
    g = g * 0.45 + gray * 0.55
    b = b * 0.55 + gray * 0.45

    // 降对比度
    r = r * 0.78 + 45
    g = g * 0.78 + 45
    b = b * 0.78 + 48

    // 冷蓝偏移
    r = r * 0.92
    g = g * 0.98
    b = b * 1.1 + 8

    // 高光偏白（空气感）
    const lum = (r + g + b) / 3
    if (lum > 160) {
      r = r + (lum - 160) * 0.1
      g = g + (lum - 160) * 0.1
      b = b + (lum - 160) * 0.12
    }

    // 暗部蓝雾
    if (lum < 70) {
      b = b + (70 - lum) * 0.2
      r = r + (70 - lum) * 0.05
    }

    p[i] = clamp(r)
    p[i + 1] = clamp(g)
    p[i + 2] = clamp(b)
  }
  return out
}

export const FILTERS = [
  { id: 'none', name: '原片', apply: null },
  { id: 'aomori', name: '青森', apply: filterAomori },
  { id: 'yuuyake', name: '夕焼け', apply: filterYuuyake },
  { id: 'kirisame', name: '霧雨', apply: filterKirisame },
]
