"""SAM inference and display contours, independent of server predictor state."""

import cv2
import numpy as np

from segmentation_masks import select_subject_mask


def predict_subject_mask(predictor, image_rgb, box_xyxy, *, image_ready=False,
                         positive_points=None, negative_points=None):
    """Select an unchanged mask; callers own predictor locking and model errors."""
    if not image_ready:
        predictor.set_image(image_rgb)
    foreground = [] if positive_points is None else np.asarray(positive_points, dtype=np.float32).reshape(-1, 2).tolist()
    background = [] if negative_points is None else np.asarray(negative_points, dtype=np.float32).reshape(-1, 2).tolist()
    prompt = {'box': np.asarray(box_xyxy)}
    if foreground or background:
        prompt['point_coords'] = np.asarray(foreground + background, dtype=np.float32)
        prompt['point_labels'] = np.asarray([1] * len(foreground) + [0] * len(background))
    baseline = predictor.predict(**prompt, multimask_output=False)
    alternatives = predictor.predict(**prompt, multimask_output=True)
    masks = np.concatenate([baseline[0], alternatives[0]])
    scores = np.concatenate([baseline[1], alternatives[1]])
    logits = np.concatenate([baseline[2], alternatives[2]]) if baseline[2] is not None and alternatives[2] is not None else None
    return select_subject_mask(masks, scores, logits, box_xyxy, foreground, background)


def mask_to_contour_rings(mask, img_w, img_h):
    """Preserve legacy external-ring filtering, simplification and 0–1000 XY."""
    contours, _ = cv2.findContours(np.asarray(mask).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    areas = [cv2.contourArea(contour) for contour in contours]
    threshold = max(8, max(areas) * .008)
    selected = sorted((i for i, area in enumerate(areas) if area >= threshold), key=lambda i: areas[i], reverse=True)
    rings = []
    for index in selected[:16]:
        epsilon = .25
        points = cv2.approxPolyDP(contours[index], epsilon, True).reshape(-1, 2)
        while len(points) > 4096:
            epsilon *= 1.25
            points = cv2.approxPolyDP(contours[index], epsilon, True).reshape(-1, 2)
        if len(points) >= 3:
            rings.append([[max(0, min(1000, round(float(x) / img_w * 1000, 3))),
                           max(0, min(1000, round(float(y) / img_h * 1000, 3)))] for x, y in points])
    return rings
