import { createCorrectionGeometry } from './subject-correction.js'

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 3 && ring.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(value =>
      typeof value === 'number' && Number.isFinite(value)))
}

function cleanRings(rings) {
  return Array.isArray(rings)
    ? rings.filter(validRing).map(ring => ring.map(point => [...point])) : []
}

function regions(detection) {
  if (Array.isArray(detection?.segmentation_regions) && detection.segmentation_regions.length) {
    // Normalize each index separately: dropping a bad region must not shift the
    // attribution of another region's contour or segmentation quality.
    return detection.segmentation_regions.map(region =>
      createCorrectionGeometry(region)?.segmentation_regions[0] || null)
  }
  return [createCorrectionGeometry(detection)?.segmentation_regions[0] || null]
}

function attributedParts(detection, index, count) {
  const parts = detection?.shape_contours_by_region?.[index]
  if (Array.isArray(parts)) return cleanRings(parts)
  if (count !== 1) return null
  const main = cleanRings(detection?.shape_contours)
  return main.length ? main : cleanRings([detection?.shape_points])
}

/** Preserve an earlier local outline when correcting a different, unchanged part. */
export function mergeCorrectedDetection(previous, updated, regionIndex) {
  const oldRegions = regions(previous), newRegions = regions(updated)
  const selectedValid = Number.isInteger(regionIndex) && regionIndex >= 0 && regionIndex < newRegions.length
  const segmentation_quality = []
  const shape_contours_by_region = newRegions.map((region, index) => {
    const oldParts = attributedParts(previous, index, oldRegions.length)
    const unchanged = region && oldRegions[index]
      && JSON.stringify(region) === JSON.stringify(oldRegions[index])
    const preserve = selectedValid && index !== regionIndex && unchanged && oldParts !== null
    const source = preserve ? previous : updated
    const parts = preserve ? oldParts : attributedParts(updated, index, newRegions.length) || []
    const quality = source?.segmentation_quality?.[index]
    segmentation_quality.push({
      ...(quality && typeof quality === 'object' && !Array.isArray(quality) ? structuredClone(quality) : {}),
      outline_ready: parts.length > 0,
    })
    return parts
  })
  const shape_contours = [], seen = new Set()
  for (const parts of shape_contours_by_region) {
    for (const ring of parts) {
      const signature = JSON.stringify(ring)
      if (!seen.has(signature) && shape_contours.length < 32) {
        shape_contours.push(ring)
        seen.add(signature)
      }
    }
  }
  const ready = shape_contours_by_region.filter(parts => parts.length).length
  return {
    ...updated,
    shape_contours_by_region,
    segmentation_quality,
    shape_contours,
    shape_points: shape_contours[0] || [],
    outline_status: ready === newRegions.length ? 'ready' : ready ? 'partial' : 'uncertain',
  }
}
