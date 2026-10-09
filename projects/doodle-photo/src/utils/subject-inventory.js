const textTypes = new Set(['text', 'note', 'bubble'])
const stringOrEmpty = value => typeof value === 'string' ? value : ''
const arrayOrEmpty = value => Array.isArray(value) ? value : []

function boundSubjectText(elements, subjectCount) {
  const boundText = new Map()
  for (const element of arrayOrEmpty(elements)) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) continue
    const index = element.subjectIndex
    if (!textTypes.has(element.type) || typeof element.text !== 'string'
      || !Number.isInteger(index) || index < 0 || index >= subjectCount) continue
    if (!boundText.has(index)) boundText.set(index, [])
    boundText.get(index).push(element.text)
  }
  return boundText
}

function validRing(points) {
  return Array.isArray(points) && points.length >= 3 && Array.from(points).every(point =>
    Array.isArray(point) && point.length === 2 && Array.from(point).every(value =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000))
}

function outlineStatus(detection) {
  const contours = arrayOrEmpty(detection?.shape_contours)
  const rings = contours.filter(validRing)
  const hasPoints = validRing(detection?.shape_points)
  if (!rings.length && !hasPoints) return '轮廓暂不可用'

  const parts = arrayOrEmpty(detection?.shape_contours_by_region)
  const regionCount = Math.max(arrayOrEmpty(detection?.segmentation_regions).length, parts.length)
  if (parts.length && regionCount > 1) {
    const outlinedRegions = parts.filter(part => arrayOrEmpty(part).some(validRing)).length
    return outlinedRegions === regionCount ? '已描边' : '部分描边'
  }
  if ((rings.length && rings.length < contours.length)
    || ['partial', 'uncertain'].includes(detection?.outline_status)) return '部分描边'
  return '已描边'
}

function recognitionWarnings(summary) {
  const warnings = []
  const positiveCount = value => Number.isSafeInteger(value) && value > 0
  if (positiveCount(summary?.rejected_geometry)) warnings.push(`${summary.rejected_geometry}条坐标无效结果未采用`)
  if (positiveCount(summary?.duplicates)) warnings.push(`${summary.duplicates}条重复结果未重复列出`)
  if (positiveCount(summary?.limited_subjects)) warnings.push(`另有${summary.limited_subjects}组主体未纳入本次清单`)
  return warnings
}

/** Store the current caption so removing its canvas element does not restore an older one. */
export function retainSubjectCaptions(detections = [], elements = []) {
  const subjects = arrayOrEmpty(detections)
  let retained = subjects
  for (const [subjectIndex, text] of boundSubjectText(elements, subjects.length)) {
    const detection = subjects[subjectIndex]
    if (!detection || typeof detection !== 'object' || Array.isArray(detection)) continue
    const caption = text.join('\n')
    if (detection.caption === caption) continue
    if (retained === subjects) retained = subjects.slice()
    retained[subjectIndex] = { ...detection, caption }
  }
  return retained
}

/** Keep every recognized group visible even when the photo has no safe caption space. */
export function buildSubjectInventory(detections = [], elements = [], summary = null) {
  const subjects = arrayOrEmpty(detections)
  const boundText = boundSubjectText(elements, subjects.length)
  const rows = Array.from(subjects, (detection, subjectIndex) => {
    // A present element with empty text represents an intentional edit.
    const caption = boundText.has(subjectIndex)
      ? boundText.get(subjectIndex).join('\n') : stringOrEmpty(detection?.caption)
    const hasText = Boolean(caption.trim())
    const hasPlacedText = boundText.has(subjectIndex) && hasText
    const outline = outlineStatus(detection)
    return {
      subjectIndex,
      label: stringOrEmpty(detection?.label).trim() || `主体${subjectIndex + 1}`,
      caption,
      textStatus: !hasText ? '暂无文案' : hasPlacedText ? '已放置文字' : '文案保留在清单中',
      outlineStatus: outline,
      hasPlacedText,
      hasOutline: outline !== '轮廓暂不可用',
    }
  })
  return {
    rows,
    groupCount: rows.length,
    placedTextCount: rows.filter(row => row.hasPlacedText).length,
    outlinedCount: rows.filter(row => row.hasOutline).length,
    warnings: recognitionWarnings(summary),
  }
}
