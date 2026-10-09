import json
import sys
import unittest
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import numpy as np
import cv2
from fastapi import HTTPException


class VisionTests(unittest.TestCase):
    def test_scene_caption_validation_keeps_plain_text_and_layout_bounds(self):
        title = server.normalize_scene_caption({'text': '今天的小美好', 'x': 1200, 'y': 20, 'width': 900, 'fontSize': 100}, headline=True)
        self.assertEqual(title['text'], '今天的小美好')
        self.assertEqual(title['x'], 1000)
        self.assertLessEqual(title['width'], 380)
        self.assertIsNone(server.normalize_scene_caption({'text': '', 'x': 10, 'y': 10}))
        self.assertIsNone(server.normalize_scene_caption({'text': 'abc', 'x': float('nan'), 'y': 10}))
    def test_related_doodles_and_custom_sketches_are_validated(self):
        paths = [[[100, 100], [500, 800], [900, 100]]]
        result = server.normalize_decorations([
            {'type': 'cup', 'x': 200, 'y': 300, 'scale': 1.2},
            {'type': 'custom', 'label': '柠檬片', 'paths': paths, 'x': 700, 'y': 100},
            {'type': 'custom', 'paths': [[[float('nan'), 0], [500, 500]]], 'x': 0, 'y': 0},
            {'type': 'unknown', 'x': 0, 'y': 0},
        ])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['type'], 'cup')
        self.assertEqual(result[1]['paths'], paths)
        self.assertEqual(result[1]['label'], '柠檬片')

    def test_decoration_payload_limits_and_invalid_numbers(self):
        self.assertEqual(server.normalize_decorations(None), [])
        self.assertEqual(server.normalize_decorations({'type': 'cup'}), [])
        self.assertEqual(server.normalize_decorations([{'type': ['cup'], 'x': 0, 'y': 0}]), [])
        self.assertEqual(server.normalize_decorations([{'type': 'custom', 'paths': [[[0, 0], [0, 0]]]}]), [])
        self.assertEqual(server.normalize_decorations([{'type': 'cup', 'x': float('inf'), 'y': 0}]), [])
        result = server.normalize_decorations([{'type': 'sun', 'x': 10, 'y': 10}] * 100)
        self.assertLessEqual(len(result), 18)

    def test_scene_motifs_and_micro_accents_reach_the_editor_with_bounded_positions(self):
        for motif in ('fruit', 'berry', 'bread', 'steam', 'rays', 'wave', 'dots'):
            with self.subTest(motif=motif):
                result = server.normalize_decorations([
                    {'type': motif, 'x': 1200, 'y': -20, 'scale': 2, 'rotation': -40},
                    {'type': motif, 'x': float('nan'), 'y': 500},
                    {'type': 'tape', 'x': 100, 'y': 100},
                ])
                self.assertEqual(result, [{'type': motif, 'x': 1000, 'y': 0,
                                           'scale': 1.2, 'rotation': -15}])

    def test_new_micro_accents_keep_the_eighteen_suggestion_limit(self):
        result = server.normalize_decorations([
            {'type': 'rays', 'x': 100 + index * 20, 'y': 200} for index in range(25)
        ])
        self.assertEqual(len(result), 18)
        self.assertEqual(result[-1]['x'], 440)

    def test_identical_custom_sketches_are_not_repeated(self):
        first = {'type': 'custom', 'label': '线稿', 'paths': [[[0, 0], [100, 100]]], 'x': 100, 'y': 100}
        result = server.normalize_decorations([first, {**first, 'x': 300},
            {**first, 'paths': [[[0, 100], [100, 0]]]}])
        self.assertEqual(len(result), 2)

    def test_layout_suggestion_is_bounded_and_does_not_override_text(self):
        result = server.normalize_layout_suggestion({'type': 'note', 'x': -10, 'y': 1200,
            'width': 900, 'fontSize': 200, 'rotation': 90, 'text': 'untrusted replacement'})
        self.assertEqual(result, {'type': 'note', 'x': 0, 'y': 1000,
            'width': 380, 'fontSize': 36, 'rotation': 8})

    def test_malformed_layout_suggestions_are_optional(self):
        for value in (None, [], {'type': 'unknown', 'x': 0, 'y': 0},
                      {'type': 'note', 'x': float('nan'), 'y': 0},
                      {'type': 'text', 'x': 0, 'y': 'bad'}):
            self.assertIsNone(server.normalize_layout_suggestion(value))

    def setUp(self):
        key_patch = patch.object(server, 'API_KEY', 'test-only-key')
        key_patch.start()
        self.addCleanup(key_patch.stop)

    def test_server_environment_overrides_env_files(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            Path(directory, '.env').write_text('DOODLE_API_KEY=file-key\nDOODLE_MODEL=file-model\n')
            Path(directory, '.env.local').write_text('DOODLE_API_KEY=local-key\n')
            with patch.dict(os.environ, {'DOODLE_API_KEY': 'server-key'}, clear=True):
                settings = server.load_api_config(directory)
        self.assertEqual(settings['DOODLE_API_KEY'], 'server-key')
        self.assertEqual(settings['DOODLE_MODEL'], 'file-model')

    def test_local_env_file_works_from_another_working_directory(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            Path(directory, '.env.local').write_text('DOODLE_API_KEY=local-key\n')
            with patch.dict(os.environ, {}, clear=True):
                settings = server.load_api_config(directory)
        self.assertEqual(settings['DOODLE_API_KEY'], 'local-key')

    def test_no_config_has_no_fallback_key(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory, patch.dict(os.environ, {}, clear=True):
            settings = server.load_api_config(directory)
        self.assertFalse(settings.get('DOODLE_API_KEY'))

    def test_missing_key_is_reported_before_provider_request(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError('must not request provider')
        with patch.object(server, 'API_KEY', ''), patch.object(server, 'OpenAI', return_value=client) as provider:
            with self.assertRaises(HTTPException) as caught:
                server.call_vision_api('test')
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn('DOODLE_API_KEY', caught.exception.detail)
        provider.assert_not_called()

    def test_configured_key_endpoint_and_model_are_used(self):
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'detections': []})))])
        with patch.object(server, 'API_BASE', 'https://vision.example/v1'), \
             patch.object(server, 'MODEL', 'configured-model'), \
             patch.object(server, 'OpenAI', return_value=client) as provider:
            server.call_vision_api('test')
        self.assertEqual(provider.call_args.kwargs['api_key'], 'test-only-key')
        self.assertEqual(provider.call_args.kwargs['base_url'], 'https://vision.example/v1')
        self.assertEqual(client.chat.completions.create.call_args.kwargs['model'], 'configured-model')

    def test_segmentation_keeps_separate_parts_without_tracing_surface_texture(self):
        mask = np.zeros((300, 300), dtype=np.uint8)
        cv2.rectangle(mask, (30, 30), (200, 230), 1, -1)
        cv2.circle(mask, (130, 100), 25, 0, -1)
        cv2.circle(mask, (130, 100), 12, 1, -1)
        cv2.rectangle(mask, (230, 50), (270, 180), 1, -1)
        predictor = MagicMock()
        predictor.predict.return_value = (mask[None, ...], np.array([.99]), None)
        detections = [{'box_2d': [0, 0, 1000, 1000]}]
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', predictor):
            server.segment_detections(np.zeros((300, 300, 3), dtype=np.uint8), detections, 300, 300)
        rings = detections[0].get('shape_contours', [])
        self.assertEqual(len(rings), 2, 'keep separate outer parts, but not texture holes or islands within them')
        self.assertEqual(detections[0]['shape_points'], rings[0], 'old consumers still get the main boundary')

    def test_segmentation_uses_separate_regions_and_known_point_hints(self):
        predictor = MagicMock()
        def predict(**kwargs):
            x1, y1, x2, y2 = map(int, kwargs['box'])
            mask = np.zeros((300, 300), dtype=np.uint8)
            cv2.rectangle(mask, (x1 + 2, y1 + 2), (x2 - 2, y2 - 2), 1, -1)
            count = 3 if kwargs['multimask_output'] else 1
            return np.repeat(mask[None, ...], count, axis=0), np.full(count, .99), None
        predictor.predict.side_effect = predict
        detection = {'box_2d': [100, 100, 750, 800], 'segmentation_regions': [
            {'box_2d': [100, 100, 300, 300], 'positive_points': [[200, 200]], 'negative_points': [[100, 400]]},
            {'box_2d': [500, 600, 750, 800], 'positive_points': [[700, 600]], 'negative_points': []},
        ]}
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', predictor):
            server.segment_detections(np.zeros((300, 300, 3), dtype=np.uint8), [detection], 300, 300)
        self.assertEqual(len(detection['shape_contours']), 2)
        self.assertEqual(predictor.set_image.call_count, 1)
        self.assertEqual(predictor.predict.call_count, 4, 'retain baseline plus three alternate candidates per region')
        first = predictor.predict.call_args_list[0].kwargs
        np.testing.assert_array_equal(first['point_labels'], [1, 0])
        np.testing.assert_allclose(first['point_coords'][0], [60, 60], atol=1)

    def test_contour_stays_within_a_third_of_a_pixel_of_the_mask(self):
        mask = np.zeros((1000, 1000), dtype=np.uint8)
        cv2.circle(mask, (500, 500), 220, 1, -1)
        predictor = MagicMock()
        predictor.predict.return_value = (mask[None, ...], np.array([.99]), None)
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', predictor):
            points = server.extract_contours_with_sam(np.zeros((1000, 1000, 3), dtype=np.uint8),
                [270, 270, 730, 730], 1000, 1000)
        contour = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
        raw = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0][0]
        maximum_error = max(abs(cv2.pointPolygonTest(contour, tuple(map(float, p[0])), True)) for p in raw)
        self.assertLessEqual(maximum_error, .35, f'outline drifts {maximum_error:.2f} pixels from the subject')

    def test_numpy_prompt_points_are_supported(self):
        mask = np.zeros((100, 100), dtype=np.uint8)
        mask[30:70, 30:70] = 1
        predictor = MagicMock()
        predictor.predict.return_value = (mask[None, ...], np.array([.99]), None)
        with patch.object(server, '_sam_available', True), patch.object(server, '_sam_predictor', predictor):
            rings = server.extract_contour_rings_with_sam(np.zeros((100, 100, 3), dtype=np.uint8),
                [25, 25, 75, 75], 100, 100, positive_points=np.array([[50, 50]]),
                negative_points=np.array([[10, 10]]))
        self.assertEqual(len(rings), 1)

    def test_provider_failure_is_not_an_empty_success(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError('model unavailable')
        with patch.object(server, 'OpenAI', return_value=client):
            with self.assertRaises(HTTPException) as caught:
                server.call_vision_api('test')
        self.assertEqual(caught.exception.status_code, 502)

    def test_invalid_json_is_reported(self):
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='not a layout'))])
        with patch.object(server, 'OpenAI', return_value=client):
            with self.assertRaises(HTTPException):
                server.call_vision_api('test')

    def test_vision_request_uses_instant_mode(self):
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'detections': []})))])
        with patch.object(server, 'OpenAI', return_value=client):
            server.call_vision_api('test')
        kwargs = client.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs.get('extra_body', {}).get('thinking', {}).get('type'), 'disabled')


if __name__ == '__main__':
    unittest.main()
