import asyncio
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

import numpy as np
from PIL import Image
from fastapi import HTTPException, UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def photo():
    stream = io.BytesIO()
    Image.new('RGB', (800, 400), 'white').save(stream, format='PNG')
    return UploadFile(filename='photo.png', file=io.BytesIO(stream.getvalue()))


def subject():
    return {'label': '杯子', 'caption': '保留我编辑的文案', 'textPlacement': 'left',
            'box_2d': [200, 250, 700, 700], 'segmentation_regions': [
                {'box_2d': [200, 250, 700, 700], 'positive_points': [[500, 400]],
                 'negative_points': [[600, 800]]}],
            'shape_contours': [[[0, 0], [1000, 0], [1000, 1000]]],
            'manual_hints': {'positive': True, 'negative': True}}


def successful_segment(image, detections, width, height):
    for detection in detections:
        rings = [[[300, 300], [600, 300], [600, 600], [300, 600]]]
        detection.update(shape_contours=rings, shape_points=rings[0],
                         shape_contours_by_region=[rings for _ in detection['segmentation_regions']],
                         outline_status='ready', segmentation_quality=[{'outline_ready': True}
                         for _ in detection['segmentation_regions']])


class CorrectionEndpointTests(unittest.TestCase):
    def invoke(self, endpoint, value=None, index=0):
        return asyncio.run(endpoint(file=photo(), subject=json.dumps(value or subject()), region_index=index))

    def test_manual_redraw_requires_no_vision_key_or_request(self):
        with patch.object(server, 'API_KEY', ''), patch.object(server, '_sam_available', True), \
             patch.object(server, '_sam_predictor', MagicMock()), \
             patch.object(server, 'segment_detections', side_effect=successful_segment) as segment, \
             patch.object(server, 'call_vision_api') as vision:
            response = self.invoke(server.correct_subject)
        vision.assert_not_called()
        self.assertEqual(response['status'], 'success')
        self.assertEqual(response['data']['caption'], subject()['caption'])
        self.assertEqual(response['data']['textPlacement'], 'left')
        self.assertEqual(segment.call_args.args[1][0]['segmentation_regions'][0]['negative_points'], [[600, 800]])
        self.assertNotEqual(response['data']['shape_contours'], subject()['shape_contours'])
        self.assertEqual(response['data']['manual_hint_regions'], [{'positive': True, 'negative': True}])

    def test_invalid_geometry_is_rejected_without_inference(self):
        invalid = subject()
        invalid['box_2d'] = [0, 0, float('nan'), 1000]
        with patch.object(server, 'segment_detections') as segment:
            with self.assertRaises(HTTPException) as caught:
                self.invoke(server.correct_subject, invalid)
        self.assertEqual(caught.exception.status_code, 422)
        segment.assert_not_called()

    def test_missing_sam_is_explicit(self):
        with patch.object(server, '_sam_available', False):
            with self.assertRaises(HTTPException) as caught:
                self.invoke(server.correct_subject)
        self.assertEqual(caught.exception.status_code, 503)

    def test_uncertain_new_outline_is_not_an_empty_success(self):
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', MagicMock()), \
             patch.object(server, 'segment_detections'):
            with self.assertRaises(HTTPException) as caught:
                self.invoke(server.correct_subject)
        self.assertEqual(caught.exception.status_code, 422)

    def test_invalid_region_index_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            self.invoke(server.correct_subject, index=9)
        self.assertEqual(caught.exception.status_code, 422)

    def test_local_review_calls_vision_once_with_crop_and_keeps_caption(self):
        answer = {'verified': True, 'label': '白色杯子', 'box_2d': [150, 150, 850, 850],
                  'positive_points': [[500, 500]], 'negative_points': []}
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', MagicMock()), \
             patch.object(server, 'segment_detections', side_effect=successful_segment), \
             patch.object(server, 'call_vision_api', return_value=answer) as vision:
            response = self.invoke(server.refine_subject)
        self.assertEqual(vision.call_count, 1)
        self.assertIn('prompt', vision.call_args.kwargs)
        self.assertEqual(vision.call_args.kwargs['max_tokens'], 2048)
        self.assertEqual(response['data']['caption'], subject()['caption'])
        self.assertEqual(response['data']['label'], '白色杯子')
        self.assertEqual(response['data']['segmentation_regions'][0]['positive_points'], [[500, 400]])
        self.assertEqual(response['data']['segmentation_regions'][0]['negative_points'], [[600, 800]])
        self.assertTrue(response['data']['shape_contours'])

    def test_failed_local_verification_preserves_previous_result(self):
        original = subject()
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', MagicMock()), \
             patch.object(server, 'call_vision_api', return_value={'verified': False}), \
             patch.object(server, 'segment_detections') as segment:
            with self.assertRaises(HTTPException) as caught:
                self.invoke(server.refine_subject, original)
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(original, subject())
        segment.assert_not_called()

    def test_refinement_cannot_move_box_away_from_manual_foreground(self):
        answer = {'verified': True, 'box_2d': [100, 100, 250, 250]}
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', MagicMock()), \
             patch.object(server, 'call_vision_api', return_value=answer):
            with self.assertRaises(HTTPException) as caught:
                self.invoke(server.refine_subject)
        self.assertEqual(caught.exception.status_code, 422)

    def test_vision_foreground_cannot_erase_a_human_background_point(self):
        value = subject()
        value['segmentation_regions'][0]['negative_points'] = [[475, 450]]
        value['manual_hints'] = {'positive': False, 'negative': True}
        answer = {'verified': True, 'box_2d': [150, 150, 850, 850],
                  'positive_points': [[500, 500]], 'negative_points': []}
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', MagicMock()), \
             patch.object(server, 'call_vision_api', return_value=answer), \
             patch.object(server, 'segment_detections') as segment:
            with self.assertRaises(HTTPException) as caught:
                self.invoke(server.refine_subject, value)
        self.assertEqual(caught.exception.status_code, 422)
        segment.assert_not_called()


if __name__ == '__main__':
    unittest.main()
