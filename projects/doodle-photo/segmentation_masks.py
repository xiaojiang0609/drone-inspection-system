"""Choose an unchanged SAM mask using prompt agreement and geometric quality.

SAM quality estimates describe the predicted mask, not whether it is the named
subject. Known foreground/background points disambiguate supports inside a box.
Box leakage and logit stability help discard oversized or noisy alternatives.
"""
import math

import numpy as np


def select_subject_mask(masks, scores, logits, box_xyxy,
                        positive_points=None, negative_points=None):
    """Return ``(mask, quality)`` or ``(None, quality)`` when no candidate is safe.

    ``masks`` is C x H x W; ``logits`` is optional C x h x w at either SAM output
    resolution. SAM uses logit threshold 0; stability compares thresholds +/-1.
    Points use image-pixel XY coordinates and must be known subject/background
    locations. A box center is not necessarily foreground. Returned mask pixels
    are copied without clipping, component removal, smoothing, or hole filling.

    The gates and rank are conservative heuristics checked on the local coffee
    and cat fixtures. They do not prove semantic correctness or recover detail
    absent from SAM's prediction. Missing logits omit the stability term.
    """
    rejected = []
    failure = {'reason': 'no_valid_mask', 'rejected_candidates': rejected}
    try:
        candidates = np.asarray(masks)
        if candidates.ndim == 2:
            candidates = candidates[None]
        provider_scores = np.asarray(scores, dtype=float).reshape(-1)
        box = np.asarray(box_xyxy, dtype=float)
        if (candidates.ndim != 3 or not candidates.shape[1] or not candidates.shape[2]
                or provider_scores.size != candidates.shape[0] or box.shape != (4,)
                or not np.isfinite(box).all() or box[0] >= box[2] or box[1] >= box[3]):
            return None, {**failure, 'reason': 'invalid_inputs'}
        height, width = candidates.shape[1:]
        logit_candidates = None if logits is None else np.asarray(logits, dtype=float)
        if logit_candidates is not None and (logit_candidates.ndim != 3
                or logit_candidates.shape[0] != candidates.shape[0]
                or not logit_candidates.shape[1] or not logit_candidates.shape[2]):
            return None, {**failure, 'reason': 'invalid_logits'}

        hints = []
        for points in (positive_points, negative_points):
            coords = np.asarray([] if points is None else points, dtype=float)
            if not coords.size:
                hints.append(np.empty((0, 2), dtype=int))
                continue
            if (coords.ndim != 2 or coords.shape[1] != 2 or not np.isfinite(coords).all()
                    or np.any(coords[:, 0] < 0) or np.any(coords[:, 0] >= width)
                    or np.any(coords[:, 1] < 0) or np.any(coords[:, 1] >= height)):
                return None, {**failure, 'reason': 'invalid_points'}
            rounded = np.floor(coords + .5).astype(int)
            rounded[:, 0] = np.minimum(rounded[:, 0], width - 1)
            rounded[:, 1] = np.minimum(rounded[:, 1], height - 1)
            hints.append(rounded)
    except (TypeError, ValueError, OverflowError):
        return None, {**failure, 'reason': 'invalid_inputs'}

    x1, y1, x2, y2 = box
    dx, dy = max(3, math.ceil((x2-x1)*.03)), max(3, math.ceil((y2-y1)*.03))
    inner = (slice(max(0, math.floor(y1)), min(height, math.ceil(y2))),
             slice(max(0, math.floor(x1)), min(width, math.ceil(x2))))
    expanded = (slice(max(0, math.floor(y1-dy)), min(height, math.ceil(y2+dy))),
                slice(max(0, math.floor(x1-dx)), min(width, math.ceil(x2+dx))))
    if inner[0].start >= inner[0].stop or inner[1].start >= inner[1].stop:
        return None, {**failure, 'reason': 'invalid_box'}

    best_mask, best_quality = None, None
    for index, (candidate, score) in enumerate(zip(candidates, provider_scores)):
        reason = None
        try:
            finite = np.isfinite(candidate).all()
        except TypeError:
            finite = False
        if not finite or not math.isfinite(float(score)):
            rejected.append({'index': index, 'reason': 'nonfinite_mask_or_score'})
            continue
        mask = candidate.astype(bool)
        area = int(np.count_nonzero(mask))
        if not area:
            rejected.append({'index': index, 'reason': 'empty_mask'})
            continue
        foreground, background = hints
        if (foreground.size and not mask[foreground[:, 1], foreground[:, 0]].all()
                or background.size and mask[background[:, 1], background[:, 0]].any()):
            rejected.append({'index': index, 'reason': 'point_mismatch'})
            continue
        outside = 1 - np.count_nonzero(mask[inner]) / area
        far_outside = 1 - np.count_nonzero(mask[expanded]) / area
        stability = None
        if logit_candidates is not None:
            values = logit_candidates[index]
            if not np.isfinite(values).all():
                rejected.append({'index': index, 'reason': 'nonfinite_logits'})
                continue
            union = int(np.count_nonzero(values > -1))
            stability = np.count_nonzero(values > 1) / union if union else 0.

        # Score-only acceptance cannot identify a saucer entirely inside a cup
        # box. Hints above are essential for such semantic ambiguities.
        if score < .65:
            reason = 'low_provider_score'
        elif far_outside > .20:
            reason = 'excessive_box_leakage'
        elif stability is not None and stability < .65:
            reason = 'unstable_mask'
        bounded_score = float(np.clip(score, 0., 1.))
        rank = ((.55*bounded_score + .45*stability) if stability is not None else bounded_score)
        rank -= 1.2*far_outside + .25*outside
        if reason is None and rank < .65:
            reason = 'low_combined_quality'
        if reason:
            rejected.append({'index': index, 'reason': reason})
            continue
        quality = {'candidate_index': index, 'score': float(score),
                   'stability': float(stability) if stability is not None else None,
                   'outside_fraction': float(outside),
                   'expanded_outside_fraction': float(far_outside),
                   'quality_score': float(rank), 'area': area}
        if best_quality is None or rank > best_quality['quality_score']:
            best_mask, best_quality = candidate.copy(), quality
    if best_mask is None:
        return None, failure
    return best_mask, {**best_quality, 'rejected_candidates': rejected}
