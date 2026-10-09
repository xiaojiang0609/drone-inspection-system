import { MAX_COLLAGE_SOURCES, MAX_IMAGE_FILE_BYTES, MAX_IMAGE_PIXELS } from './collage-config.js'

const invalid = () => { throw new Error('图片头损坏或格式不受支持') }
const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

// Read container headers before asking the browser to allocate decoded pixels.
export function inspectImageMetadata(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  let format, width, height, animated = false
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) {
    format = 'png'
    let offset = 8, imageData = false, ended = false
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), kind = tag(offset + 4)
      if (size > bytes.length - offset - 12) return invalid()
      if (offset === 8) {
        if (kind !== 'IHDR' || size !== 13) return invalid()
        width = view.getUint32(16); height = view.getUint32(20)
        const depth = bytes[24], color = bytes[25]
        const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
        if (!allowed[color]?.includes(depth) || bytes[26] || bytes[27] || bytes[28] > 1) return invalid()
      } else if (kind === 'IHDR') return invalid()
      if (kind === 'acTL') { if (size !== 8) return invalid(); animated = true }
      if (kind === 'fcTL' || kind === 'fdAT') animated = true
      if (kind === 'IDAT') imageData = true
      offset += size + 12
      if (kind === 'IEND') { if (size || offset !== bytes.length) return invalid(); ended = true; break }
    }
    if (!imageData || !ended) return invalid()
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    format = 'jpeg'
    let offset = 2, scanned = false, inScan = false, ended = false
    while (offset < bytes.length) {
      // Entropy bytes are opaque. Only unstuffed markers delimit a scan;
      // FF00 is data, and restart/fill markers do not end the image.
      if (inScan) while (offset < bytes.length && bytes[offset] !== 255) offset++
      if (offset >= bytes.length) break
      if (bytes[offset++] !== 255) return invalid()
      while (bytes[offset] === 255) offset++
      if (offset >= bytes.length) return invalid()
      const marker = bytes[offset++]
      if (marker === 0) { if (!inScan) return invalid(); continue }
      if (marker === 217) { ended = scanned; break }
      if (marker === 216) return invalid()
      if (marker >= 208 && marker <= 215) { if (!inScan) return invalid(); continue }
      if (marker === 1) continue
      if (offset + 2 > bytes.length) return invalid()
      const size = view.getUint16(offset)
      if (size < 2 || offset + size > bytes.length) return invalid()
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (size < 8 || size !== 8 + bytes[offset + 7] * 3) return invalid()
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5)
      }
      // Skip length-delimited metadata/tables, including any embedded FF D9.
      // A later SOS starts the next progressive scan; DNL continues this one.
      offset += size
      if (marker === 218) { scanned = true; inScan = true }
      else if (marker !== 220) inScan = false
    }
    // JPEG decoders accept opaque bytes after EOI; preserve the original File.
    if (!ended) return invalid()
  } else if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    format = 'webp'
    if (view.getUint32(4, true) + 8 !== bytes.length) return invalid()
    let offset = 12, imageData = false
    while (offset + 8 <= bytes.length) {
      const kind = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8
      if (size > bytes.length - start) return invalid()
      if (kind === 'VP8X') {
        if (size !== 10 || width !== undefined) return invalid()
        animated ||= Boolean(bytes[start] & 2)
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16)
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16)
      } else if (kind === 'VP8 ') {
        if (size < 10 || bytes[start] & 1 || bytes[start + 3] !== 157 || bytes[start + 4] !== 1 || bytes[start + 5] !== 42) return invalid()
        const imageWidth = view.getUint16(start + 6, true) & 16383, imageHeight = view.getUint16(start + 8, true) & 16383
        if (width !== undefined && (width !== imageWidth || height !== imageHeight)) return invalid()
        width = imageWidth; height = imageHeight
        imageData = true
      } else if (kind === 'VP8L') {
        if (size < 5 || bytes[start] !== 47 || bytes[start + 4] & 224) return invalid()
        const bits = view.getUint32(start + 1, true)
        const imageWidth = (bits & 16383) + 1, imageHeight = ((bits >>> 14) & 16383) + 1
        if (width !== undefined && (width !== imageWidth || height !== imageHeight)) return invalid()
        width = imageWidth; height = imageHeight
        imageData = true
      } else if (kind === 'ANIM' || kind === 'ANMF') animated = true
      offset = start + size + (size & 1)
    }
    if (offset !== bytes.length || !imageData && !animated) return invalid()
  } else return invalid()
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return invalid()
  return { format, width, height, animated }
}

export function validateUploadMetadata(file, metadata, currentCount = 0) {
  let reason
  if (currentCount >= MAX_COLLAGE_SOURCES) reason = '每个作品最多添加 16 张图片'
  else if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > MAX_IMAGE_FILE_BYTES) reason = '每张图片最多 20 MiB，且不能为空'
  else if (!metadata || !mime[metadata.format] || file.type !== mime[metadata.format]) reason = '图片真实格式与文件类型不一致，仅支持 JPG / PNG / WebP'
  else if (metadata.animated) reason = '不支持动画图片，请选择静态图片'
  else if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0 || metadata.width * metadata.height > MAX_IMAGE_PIXELS) reason = '图片解码像素不能超过 4000 万'
  return reason ? { ok: false, reason } : { ok: true }
}

export async function validateUploadBatch(candidates, currentCount = 0) {
  const files = [], errors = []
  for (const file of candidates) {
    try {
      if (file.size > MAX_IMAGE_FILE_BYTES || file.size <= 0) throw new Error('每张图片最多 20 MiB，且不能为空')
      if (currentCount + files.length >= MAX_COLLAGE_SOURCES) throw new Error('每个作品最多添加 16 张图片')
      const metadata = inspectImageMetadata(new Uint8Array(await file.arrayBuffer()))
      const result = validateUploadMetadata(file, metadata, currentCount + files.length)
      if (!result.ok) throw new Error(result.reason)
      files.push(file)
    } catch (error) { errors.push({ file, reason: error.message }) }
  }
  return { files, errors }
}

export async function decodeSourcePreview(file) {
  if (file.size > MAX_IMAGE_FILE_BYTES || file.size <= 0) throw new Error('每张图片最多 20 MiB，且不能为空')
  const metadata = inspectImageMetadata(new Uint8Array(await file.arrayBuffer()))
  const validation = validateUploadMetadata(file, metadata, 0)
  if (!validation.ok) throw new Error(validation.reason)
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = bitmap
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('图片尺寸无效')
    const scale = Math.min(1, 320 / Math.max(width, height)), canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { file, thumbnailUrl: canvas.toDataURL('image/jpeg', .8), width, height }
  } finally { bitmap.close() }
}
