"""Pure, in-memory validation and transparent sticker image processing.

Geometry is normalized against the EXIF-corrected original. Metadata sizes are
[width, height]; crop bounds and crop_box are original pixel [left, top, right,
bottom] with exclusive right/bottom. Contours describe output-local pixels and
never generate or modify PNG alpha.
"""

import base64
import io
import math
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from detection_geometry import normalize_subject_geometry


class CutoutError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def decode_cutout_image(content: bytes) -> Image.Image:
    """Reject unsupported, animated or oversized input before loading pixels."""
    if len(content) > 20 * 1024 * 1024:
        raise CutoutError(413, 'Image exceeds 20 MiB')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if image.width * image.height > 40_000_000:
                    raise CutoutError(413, 'Image exceeds 40 million pixels')
                if image.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise CutoutError(400, 'Only static JPG, PNG and WebP images are supported')
                if getattr(image, 'is_animated', False) or getattr(image, 'n_frames', 1) != 1:
                    raise CutoutError(400, 'Animated images are not supported')
                image.load()
                return ImageOps.exif_transpose(image).convert('RGBA')
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise CutoutError(413, 'Image exceeds the decoded pixel limit') from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise CutoutError(400, 'Unable to decode image') from exc


def _coordinates(value, count):
    if not isinstance(value, list) or len(value) != count:
        raise CutoutError(422, 'Invalid geometry coordinate structure')
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1000
           or not math.isfinite(v) for v in value):
        raise CutoutError(422, 'Geometry coordinates must be finite numbers within 0–1000')
    return [float(v) for v in value]


def _box(value):
    result = _coordinates(value, 4)
    y1, x1, y2, x2 = result
    if y1 >= y2 or x1 >= x2:
        raise CutoutError(422, 'Subject boxes must have positive area')
    return result


def _points(region, box):
    result = []
    for name, limit in (('positive_points', 4), ('negative_points', 8)):
        points = region.get(name, [])
        if not isinstance(points, list) or len(points) > limit:
            raise CutoutError(422, 'Invalid hint point count or structure')
        validated = [_coordinates(point, 2) for point in points]
        if len({tuple(point) for point in validated}) != len(validated):
            raise CutoutError(422, 'Duplicate hint points are not allowed')
        if name == 'positive_points':
            y1, x1, y2, x2 = box
            if any(not (x1 <= x <= x2 and y1 <= y <= y2) for x, y in validated):
                raise CutoutError(422, 'Foreground hints must lie within their subject box')
        result.append(validated)
    if set(map(tuple, result[0])) & set(map(tuple, result[1])):
        raise CutoutError(422, 'Foreground and background hints conflict')
    return result


def validate_cutout_subject(value: dict) -> dict:
    """Validate before legacy normalization can clip or silently drop hints."""
    if not isinstance(value, dict) or not isinstance(value.get('label'), str) or not value['label'].strip():
        raise CutoutError(422, 'A nonempty subject label is required')
    original_box = _box(value.get('box_2d'))
    _points(value, original_box)
    if 'segmentation_regions' in value:
        regions = value['segmentation_regions']
        if not isinstance(regions, list) or not 1 <= len(regions) <= 8:
            raise CutoutError(422, 'A subject must have one to eight regions')
        foreground, background = set(), set()
        for region in regions:
            if not isinstance(region, dict):
                raise CutoutError(422, 'Each region must be an object')
            box = _box(region.get('box_2d', region.get('tightbox_2d')))
            if min(box[2], original_box[2]) <= max(box[0], original_box[0]) or min(box[3], original_box[3]) <= max(box[1], original_box[1]):
                raise CutoutError(422, 'Every region must overlap the subject box')
            positive, negative = _points(region, box)
            foreground.update(map(tuple, positive))
            background.update(map(tuple, negative))
        if foreground & background:
            raise CutoutError(422, 'Foreground and background hints conflict across regions')
    geometry = normalize_subject_geometry(value)
    return {'label': value['label'].strip(), **geometry}


def _resize(image, max_size):
    if max(image.size) <= max_size:
        return image
    scale = max_size / max(image.size)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def encode_vision_image(original_rgba, max_size=1536) -> str:
    image = _resize(original_rgba.convert('RGB'), max_size)
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


def prepare_cutout_crop(original_rgba, subject, max_size=1536, padding=.2):
    """Union all regions before cropping; outside background hints are excluded."""
    subject = validate_cutout_subject(subject)
    width, height = original_rgba.size
    regions = subject['segmentation_regions']
    boxes = [[box[1] * width / 1000, box[0] * height / 1000,
              box[3] * width / 1000, box[2] * height / 1000]
             for box in (region['box_2d'] for region in regions)]
    left, top = min(box[0] for box in boxes), min(box[1] for box in boxes)
    right, bottom = max(box[2] for box in boxes), max(box[3] for box in boxes)
    dx, dy = (right-left) * padding, (bottom-top) * padding
    bounds = [max(0, math.floor(left-dx)), max(0, math.floor(top-dy)),
              min(width, math.ceil(right+dx)), min(height, math.ceil(bottom+dy))]
    left, top, right, bottom = bounds
    crop = _resize(original_rgba.crop(bounds).convert('RGB'), max_size)
    sx, sy = crop.width / (right-left), crop.height / (bottom-top)
    pixel_regions = []
    for region, box in zip(regions, boxes):
        pixel = {'box_xyxy': [(box[0]-left)*sx, (box[1]-top)*sy,
                              (box[2]-left)*sx, (box[3]-top)*sy]}
        for name in ('positive_points', 'negative_points'):
            points = []
            for x, y in region[name]:
                # Coordinate 1000 denotes the final source pixel, not an OOB hint.
                x, y = min(width-1, x*width/1000), min(height-1, y*height/1000)
                if not (left <= x < right and top <= y < bottom):
                    if name == 'positive_points':
                        raise CutoutError(422, 'Foreground hint lies outside the crop')
                    continue
                points.append([min(crop.width-1, (x-left)*sx), min(crop.height-1, (y-top)*sy)])
            pixel[name] = points
        pixel_regions.append(pixel)
    metadata = {'original_size': [width, height], 'crop_bounds': bounds, 'working_size': list(crop.size)}
    return np.array(crop), metadata, pixel_regions


def merge_region_masks(masks) -> np.ndarray:
    if not masks or any(mask is None for mask in masks):
        raise CutoutError(422, 'Every region requires a reliable mask')
    arrays = [np.asarray(mask) for mask in masks]
    if any(array.ndim != 2 or not array.size or array.shape != arrays[0].shape
           or not np.isfinite(array).all() or not np.any(array) for array in arrays):
        raise CutoutError(422, 'Region masks must be nonempty and share their working size')
    return np.logical_or.reduce(arrays)


def _local_contours(alpha, budget):
    contours, _ = cv2.findContours((alpha > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    rings = []
    remaining = max(0, int(budget))
    for contour in contours:
        if remaining < 3:
            break
        epsilon = .25
        points = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        while len(points) > min(4096, remaining):
            epsilon *= 1.25
            points = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(points) >= 3:
            rings.append(points.tolist())
            remaining -= len(points)
    return rings


def encode_cutout_png(original_rgba, mask, metadata, max_size=1536, max_contour_points=16384) -> dict:
    """Map binary pixels back first, intersect original alpha, then resize RGBA."""
    if mask is None:
        raise CutoutError(422, 'A reliable subject mask is required')
    mask = np.asarray(mask)
    working_width, working_height = metadata['working_size']
    if mask.shape != (working_height, working_width) or not np.isfinite(mask).all():
        raise CutoutError(422, 'Mask does not match the working image')
    left, top, right, bottom = metadata['crop_bounds']
    crop = original_rgba.crop((left, top, right, bottom)).convert('RGBA')
    binary = Image.fromarray((mask.astype(bool).astype(np.uint8) * 255)).resize(crop.size, Image.Resampling.NEAREST)
    pixels = np.array(crop)
    pixels[:, :, 3] = np.where(np.asarray(binary) > 0, pixels[:, :, 3], 0)
    alpha = Image.fromarray(pixels[:, :, 3])
    bbox = alpha.getbbox()
    if bbox is None:
        raise CutoutError(422, 'Subject has no visible pixels')
    crop_box = [left+bbox[0], top+bbox[1], left+bbox[2], top+bbox[3]]
    sticker = _resize(Image.fromarray(pixels).crop(bbox), max_size)
    contours = _local_contours(np.asarray(sticker)[:, :, 3], max_contour_points)
    buffer = io.BytesIO()
    sticker.save(buffer, format='PNG')
    return {'image': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii'),
            'width': sticker.width, 'height': sticker.height,
            'original_width': original_rgba.width, 'original_height': original_rgba.height,
            'crop_box': crop_box, 'contours': contours}
