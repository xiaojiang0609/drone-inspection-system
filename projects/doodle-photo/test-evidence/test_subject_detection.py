import io
import json
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from unittest.mock import MagicMock
from types import SimpleNamespace

from PIL import Image
from fastapi import UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def item(index):
    return {'label': f'主体{index}', 'caption': f'可见的小物{index}',
            'box_2d': [100, index * 20, 300, index * 20 + 18], 'textPlacement': 'above'}


class SubjectCoverageTests(unittest.TestCase):
    def test_more_than_six_subjects_are_preserved_with_plain_captions(self):
        detections, summary = server.collect_scene_subjects([item(index) for index in range(12)])
        self.assertEqual(len(detections), 12)
        self.assertEqual(detections[-1]['caption'], '可见的小物11')
        self.assertEqual(summary['accepted_subjects'], 12)
        self.assertEqual(summary['rejected_geometry'], 0)

    def test_geometry_failures_and_exact_duplicates_are_reported(self):
        valid = item(1)
        detections, summary = server.collect_scene_subjects([valid, valid, None, {'label': '坏坐标', 'box_2d': [0, 0, 0, 50]}])
        self.assertEqual(len(detections), 1)
        self.assertEqual(summary['returned_subjects'], 4)
        self.assertEqual(summary['duplicates'], 1)
        self.assertEqual(summary['rejected_geometry'], 2)

    def test_adjacent_same_kind_subjects_are_not_merged(self):
        first, second = item(1), item(2)
        second['label'] = first['label']
        detections, _ = server.collect_scene_subjects([first, second])
        self.assertEqual(len(detections), 2)

    def test_coverage_remains_bounded_and_reports_limit(self):
        detections, summary = server.collect_scene_subjects([item(index) for index in range(25)])
        self.assertEqual(len(detections), 20)
        self.assertEqual(summary['limited_subjects'], 5)
        self.assertEqual(summary['returned_subjects'], 25)

    def test_failed_sam_outline_does_not_delete_recognition(self):
        stream = io.BytesIO()
        Image.new('RGB', (100, 80), 'white').save(stream, format='PNG')
        photo = UploadFile(filename='test.png', file=io.BytesIO(stream.getvalue()))
        with patch.object(server, 'call_vision_api', return_value={'detections': [item(index) for index in range(12)]}), \
             patch.object(server, '_sam_available', False):
            response = asyncio.run(server.analyze(photo))
        self.assertEqual(len(response['data']), 12)
        self.assertEqual(response['recognition_summary']['accepted_subjects'], 12)
        self.assertTrue(all(not detection['shape_points'] for detection in response['data']))

    def test_truncated_provider_output_is_not_treated_as_a_complete_inventory(self):
        from fastapi import HTTPException
        response = SimpleNamespace(choices=[SimpleNamespace(finish_reason='length',
            message=SimpleNamespace(content=json.dumps({'detections': [item(0)]})))])
        with patch.object(server, 'API_KEY', 'test-only-key'), patch.object(server, 'OpenAI') as client:
            client.return_value.chat.completions.create.return_value = response
            with self.assertRaises(HTTPException) as caught:
                server.call_vision_api('test')
        self.assertEqual(caught.exception.status_code, 502)

    def test_segmentation_budget_keeps_unprocessed_recognitions_and_regions(self):
        import numpy as np
        predictor = MagicMock()
        detections, _ = server.collect_scene_subjects([item(index) for index in range(3)])
        ring = [[10, 100], [15, 100], [15, 300], [10, 300]]
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', predictor), \
             patch.object(server, 'MAX_SEGMENT_REGIONS', 2), \
             patch.object(server, 'extract_contour_rings_with_sam', return_value=[ring]) as extract:
            server.segment_detections(np.zeros((80, 100, 3), dtype=np.uint8), detections, 100, 80)
        self.assertEqual(extract.call_count, 2)
        self.assertEqual(len(detections), 3)
        self.assertEqual(detections[2]['caption'], '可见的小物2')
        self.assertFalse(detections[2]['segmentation_quality'][0]['outline_ready'])
        self.assertEqual(detections[2]['segmentation_quality'][0]['reason'], 'segmentation_budget')


if __name__ == '__main__':
    unittest.main()
