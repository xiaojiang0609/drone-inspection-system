"""Validate normalized subject geometry before it reaches segmentation."""

import math
from numbers import Number


def _finite_number(value):
    """Accept numeric JSON values and numeric strings, but never booleans."""
    if isinstance(value, bool) or not isinstance(value, (Number, str)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _normalize_box(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    coordinates = [_finite_number(coordinate) for coordinate in value]
    if any(coordinate is None for coordinate in coordinates):
        return None
    box = [max(0.0, min(1000.0, coordinate)) for coordinate in coordinates]
    y1, x1, y2, x2 = box
    return box if y2 > y1 and x2 > x1 else None


def _intersects(first, second):
    return (
        min(first[2], second[2]) > max(first[0], second[0])
        and min(first[3], second[3]) > max(first[1], second[1])
    )


def _normalize_points(value, box, limit, excluded=()):
    """Skip bad hints rather than move them onto a different image location."""
    if not isinstance(value, (list, tuple)):
        return []
    points = []
    seen = {tuple(point) for point in excluded}
    y1, x1, y2, x2 = box
    for raw_point in value:
        if not isinstance(raw_point, (list, tuple)) or len(raw_point) != 2:
            continue
        x, y = [_finite_number(coordinate) for coordinate in raw_point]
        if x is None or y is None or not (x1 <= x <= x2 and y1 <= y <= y2):
            continue
        point = (x, y)
        if point in seen:
            continue
        points.append([x, y])
        seen.add(point)
        if len(points) == limit:
            break
    return points


def _normalize_region(item, box):
    positive_points = _normalize_points(item.get("positive_points"), box, 4)
    negative_points = _normalize_points(
        item.get("negative_points"), [0.0, 0.0, 1000.0, 1000.0], 8,
        excluded=positive_points,
    )
    return {
        "box_2d": box,
        "positive_points": positive_points,
        "negative_points": negative_points,
    }


def normalize_subject_geometry(item):
    """Return validated geometry or ``None`` for an invalid required subject box.

    Boxes use ``[y1, x1, y2, x2]`` and points use ``[x, y]`` on a 0–1000
    image coordinate system. Boxes are clipped to that range and must retain
    positive width and height. Hint points are validated without clipping.

    Up to eight valid ``segmentation_regions`` are kept, each with at most four
    foreground and eight background hints. Region inputs accept ``box_2d`` or
    ``tightbox_2d``; outputs consistently use ``box_2d``. Each region must overlap
    the original subject box, but may correct its extent. Their union becomes
    the returned subject box. Missing or malformed optional regions fall back
    to one region using the original box and optional top-level hints.

    All returned coordinates are floats, input data is left untouched, and
    model confidence is deliberately not used to discard subjects.
    """
    if not isinstance(item, dict):
        return None
    original_box = _normalize_box(item.get("box_2d"))
    if original_box is None:
        return None

    regions = []
    raw_regions = item.get("segmentation_regions")
    if isinstance(raw_regions, (list, tuple)):
        for raw_region in raw_regions:
            if not isinstance(raw_region, dict):
                continue
            box = _normalize_box(raw_region.get("box_2d", raw_region.get("tightbox_2d")))
            if box is None or not _intersects(box, original_box):
                continue
            regions.append(_normalize_region(raw_region, box))
            if len(regions) == 8:
                break

    if regions:
        box = [
            min(region["box_2d"][0] for region in regions),
            min(region["box_2d"][1] for region in regions),
            max(region["box_2d"][2] for region in regions),
            max(region["box_2d"][3] for region in regions),
        ]
    else:
        box = original_box
        regions = [_normalize_region(item, original_box.copy())]

    return {"box_2d": box, "segmentation_regions": regions}
