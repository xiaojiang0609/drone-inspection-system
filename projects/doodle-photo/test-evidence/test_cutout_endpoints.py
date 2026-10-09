import base64
import asyncio
import copy
import io
import json
import struct
import sys
import threading
import unittest
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from tempfile import SpooledTemporaryFile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with patch('dotenv.dotenv_values', return_value={}):
    import server


def photo(color=(120, 30, 50), size=(100, 80), fmt='PNG'):
    stream = io.BytesIO()
    Image.new('RGB', size, color).save(stream, format=fmt)
    return stream.getvalue()


def subject():
    return {'label': '主角', 'box_2d': [200, 200, 800, 800], 'positive_points': [[500, 500]]}


class FakePredictor:
    """Stateful SAM double; predictions depend on the last set_image."""
    def __init__(self):
        self.image = None
        self.seen = []
        self.set_count = 0
        self.low_region = None

    def set_image(self, image):
        self.image = np.array(image, copy=True)
        self.set_count += 1

    def predict(self, box, multimask_output, **kwargs):
        self.seen.append(int(self.image[0, 0, 0]))
        h, w = self.image.shape[:2]
        mask = np.zeros((h, w), dtype=bool)
        x1, y1, x2, y2 = np.asarray(box).astype(int)
        mask[max(0, y1):min(h, y2), max(0, x1):min(w, x2)] = True
        mask[y1+2, x1+2] = False
        score = .1 if self.low_region == (len(self.seen)+1)//2 else .99
        return mask[None], np.array([score]), None


class CutoutEndpointTests(unittest.TestCase):
    def setUp(self):
        self.predictor = FakePredictor()
        for name, value in [('load_sam', None), ('_sam_available', True), ('_sam_predictor', self.predictor), ('API_KEY', '')]:
            patcher = patch.object(server, name, return_value=None) if name == 'load_sam' else patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = self.enterContext(TestClient(server.app, raise_server_exceptions=False))

    def post(self, value=None, content=None, path='/api/cutout'):
        data = {} if value is None else {'subject': value if isinstance(value, str) else json.dumps(value)}
        return self.client.post(path, files={'file': ('photo.png', photo() if content is None else content, 'image/png')}, data=data)

    @contextmanager
    def memory_uploads(self):
        spools, writes = [], []
        def create_spool(*args, **kwargs):
            spool = SpooledTemporaryFile(*args, **kwargs)
            real_write = spool.write
            def write(data):
                writes.append(len(data))
                return real_write(data)
            spool.write = write
            spool.rollover = lambda: self.fail('upload attempted disk rollover')
            spools.append(spool)
            return spool
        with patch('starlette.formparsers.SpooledTemporaryFile', side_effect=create_spool):
            yield spools, writes

    def test_legal_large_photo_never_rolls_to_disk_and_closes_upload(self):
        stream = io.BytesIO()
        Image.fromarray(np.random.default_rng(7).integers(0, 256, (600, 700, 3), dtype=np.uint8)).save(stream, format='PNG')
        content = stream.getvalue()
        self.assertGreater(len(content), 1024*1024)
        with self.memory_uploads() as (spools, writes):
            response = self.post(subject(), content)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(spools), 1)
        self.assertEqual(sum(writes), len(content))
        self.assertTrue(all(spool.closed for spool in spools))

    def test_oversized_file_is_rejected_before_spool_write_and_closed(self):
        with self.memory_uploads() as (spools, writes):
            response = self.post(subject(), b'x' * (20*1024*1024+1))
        self.assertEqual(response.status_code, 413, response.text)
        self.assertLessEqual(sum(writes), 20*1024*1024)
        self.assertTrue(all(spool.closed for spool in spools))
        self.assertEqual(self.predictor.set_count, 0)

    def test_bad_multipart_fields_and_extra_files_are_rejected_and_closed(self):
        cases = [
            [('file', ('photo.png', photo(), 'image/png')), ('unexpected', (None, 'value'))],
            [('file', ('photo.png', photo(), 'image/png')), ('file', ('second.png', photo(), 'image/png'))],
            [('file', ('photo.png', photo(), 'image/png')), ('subject', (None, '{}')), ('subject', (None, '{}'))],
        ]
        for parts in cases:
            with self.subTest(parts=[p[0] for p in parts]), self.memory_uploads() as (spools, writes):
                response = self.client.post('/api/cutout', files=parts)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertTrue(all(spool.closed for spool in spools))
        self.assertEqual(self.predictor.set_count, 0)

    def test_subject_field_limit_is_rejected_and_closes_existing_file(self):
        with self.memory_uploads() as (spools, writes):
            response = self.client.post('/api/cutout', files=[
                ('file', ('photo.png', photo(), 'image/png')),
                ('subject', (None, 'x' * (64*1024+1))),
            ])
        self.assertEqual(response.status_code, 413, response.text)
        self.assertEqual(len(spools), 1)
        self.assertTrue(all(spool.closed for spool in spools))
        self.assertEqual(self.predictor.set_count, 0)

    def test_total_request_limit_rejects_declared_or_streamed_excess(self):
        with self.memory_uploads() as (spools, writes):
            response = self.client.post('/api/cutout', content=b'ignored', headers={
                'content-type': 'multipart/form-data; boundary=test', 'content-length': str(21*1024*1024+1)})
        self.assertEqual(response.status_code, 413, response.text)
        self.assertEqual(len(spools), 0)
        response = self.client.post('/api/cutout', content=iter([b'x'*(21*1024*1024+1)]), headers={
            'content-type': 'multipart/form-data; boundary=test'})
        self.assertEqual(response.status_code, 413, response.text)

    def test_fragmented_multipart_header_boundary_and_partial_upload_cleanup(self):
        # Call ASGI directly: TestClient/httpx can coalesce iterator bodies,
        # hiding the parser callback accumulation across receive messages.
        for header_bytes, expected_status in [(8191, 200), (8192, 200), (8193, 413)]:
            with self.subTest(header_bytes=header_bytes):
                disposition = b'form-data; name="subject"'
                # Three short lines stay below the dependency's separate
                # per-line cap while reaching our total per-part 8 KiB cap.
                padding_size = header_bytes - len(b'Content-Disposition') - len(disposition) - 3 * len(b'X-Padding')
                padding = b'\r\n'.join(b'X-Padding: ' + b'x' * size for size in [3000, 3000, padding_size - 6000])
                body = (b'--test\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\n'
                        b'Content-Type: image/png\r\n\r\n' + photo() +
                        b'\r\n--test\r\nContent-Disposition: ' + disposition +
                        b'\r\n' + padding + b'\r\n\r\n' +
                        json.dumps(subject()).encode() + b'\r\n--test--\r\n')
                chunks = [body[start:start+127] for start in range(0, len(body), 127)]
                messages, received = [], []
                async def receive():
                    chunk = chunks[len(received)]
                    received.append(chunk)
                    return {'type': 'http.request', 'body': chunk, 'more_body': len(received) < len(chunks)}
                async def send(message):
                    messages.append(message)
                scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                         'method': 'POST', 'scheme': 'http', 'path': '/api/cutout', 'raw_path': b'/api/cutout',
                         'query_string': b'', 'root_path': '', 'server': ('test', 80), 'client': ('test', 1),
                         'headers': [(b'content-type', b'multipart/form-data; boundary=test')]}
                previous_work = self.predictor.set_count
                with self.memory_uploads() as (spools, writes):
                    asyncio.run(server.app(scope, receive, send))
                self.assertEqual(next(m['status'] for m in messages if m['type'] == 'http.response.start'), expected_status, messages)
                self.assertGreater(len(received), 60, 'real fragmented receive stream reaches the header boundary')
                self.assertEqual(len(spools), 1, 'the earlier file part is owned before the oversized header')
                self.assertTrue(all(spool.closed for spool in spools))
                self.assertEqual(sum(writes), len(photo()))
                self.assertEqual(self.predictor.set_count - previous_work, 0 if expected_status == 413 else 1)

    def test_truncated_multipart_returns_400_and_closes_partial_file(self):
        body = b'--test\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n' + photo()
        with self.memory_uploads() as (spools, writes):
            response = self.client.post('/api/cutout', content=body, headers={
                'content-type': 'multipart/form-data; boundary=test'})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(len(spools), 1)
        self.assertTrue(all(spool.closed for spool in spools))
        self.assertEqual(self.predictor.set_count, 0)

    def test_missing_required_file_preserves_framework_422(self):
        response = self.client.post('/api/cutout', files={'subject': (None, json.dumps(subject()))})
        self.assertEqual(response.status_code, 422, response.text)

    def test_manual_transparent_png_does_not_require_vision_key(self):
        with patch.object(server, 'call_vision_api') as vision:
            response = self.post(subject())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()['data']
        self.assertEqual(response.json()['status'], 'success')
        self.assertTrue(result['image'].startswith('data:image/png;base64,'))
        image = Image.open(io.BytesIO(base64.b64decode(result['image'].split(',', 1)[1])))
        self.assertEqual(image.mode, 'RGBA')
        self.assertIn(0, np.array(image)[:, :, 3])
        self.assertEqual((result['original_width'], result['original_height']), (100, 80))
        self.assertEqual(result['subject']['label'], '主角')
        self.assertEqual(len(result['quality']), 1)
        self.assertGreaterEqual(result['quality'][0]['quality_score'], .65)
        vision.assert_not_called()

    def test_automatic_uses_single_primary_subject_and_raw_jpeg_payload(self):
        answer = {'found': True, 'subject': subject(), 'caption': '日常片刻', 'theme': '生活', 'emotion': '轻松', 'detections': [{'label': '背景', 'box_2d': [0, 0, 100, 100]}]}
        with patch.object(server, 'call_vision_api', return_value=answer) as vision:
            response = self.post(content=photo(size=(1800, 1200)))
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()['data']
        self.assertEqual(result['subject']['label'], '主角')
        self.assertEqual([result[k] for k in ('caption', 'theme', 'emotion')], ['日常片刻', '生活', '轻松'])
        self.assertEqual(vision.call_count, 1)
        payload = vision.call_args.args[0]
        self.assertFalse(payload.startswith('data:'))
        jpeg = Image.open(io.BytesIO(base64.b64decode(payload)))
        self.assertEqual(jpeg.format, 'JPEG')
        self.assertEqual(jpeg.size, (1536, 1024))
        self.assertLessEqual(vision.call_args.kwargs['max_tokens'], 4096)
        self.assertIn('found', vision.call_args.kwargs['prompt'])
        self.assertEqual(self.predictor.set_count, 1)

    def test_all_regions_must_have_reliable_masks(self):
        value = subject()
        value.pop('positive_points')
        value['segmentation_regions'] = [{'box_2d': [200, 200, 400, 400]}, {'box_2d': [600, 600, 800, 800]}]
        self.predictor.low_region = 2
        self.assertEqual(self.post(value).status_code, 422)

    def test_multiple_reliable_regions_share_one_encoding(self):
        value = subject()
        value.pop('positive_points')
        value['segmentation_regions'] = [{'box_2d': [200, 200, 400, 400]}, {'box_2d': [600, 600, 800, 800]}]
        response = self.post(value)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['data']['quality']), 2)
        self.assertEqual(len(response.json()['data']['contours']), 2)
        self.assertEqual(self.predictor.set_count, 1)

    def test_outside_box_and_malformed_manual_json_return_422(self):
        invalid = subject()
        invalid['box_2d'][0] = -1
        with patch.object(server, 'call_vision_api') as vision:
            for value in [invalid, '{', 'null', '[]']:
                with self.subTest(value=value):
                    self.assertEqual(self.post(value).status_code, 422)
        vision.assert_not_called()
        self.assertEqual(self.predictor.set_count, 0)

    def test_unrecognized_unsupported_and_corrupt_pixels_return_400(self):
        corrupt = bytearray(photo())
        start = corrupt.index(b'IDAT') + 4
        corrupt[start:start+4] = b'nope'
        for content in [b'', b'not an image', photo(fmt='GIF'), bytes(corrupt)]:
            with self.subTest(length=len(content)):
                self.assertEqual(self.post(subject(), content).status_code, 400)
        self.assertEqual(self.predictor.set_count, 0)

    def test_byte_and_decoded_pixel_limits_return_413(self):
        self.assertEqual(self.post(subject(), b'x' * (20*1024*1024+1)).status_code, 413)
        header = struct.pack('>IIBBBBB', 8000, 5001, 8, 2, 0, 0, 0)
        def chunk(name, payload):
            return struct.pack('>I', len(payload))+name+payload+struct.pack('>I', zlib.crc32(name+payload))
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(b'')) + chunk(b'IEND', b'')
        self.assertEqual(self.post(subject(), png).status_code, 413)
        self.assertEqual(self.predictor.set_count, 0)

    def test_missing_sam_returns_503(self):
        with patch.object(server, '_sam_available', False), patch.object(server, 'call_vision_api') as vision:
            self.assertEqual(self.post(subject()).status_code, 503)
        vision.assert_not_called()

    def test_automatic_missing_key_returns_503_without_provider(self):
        with patch.object(server, 'OpenAI') as provider:
            self.assertEqual(self.post().status_code, 503)
        provider.assert_not_called()

    def test_not_found_returns_422(self):
        with patch.object(server, 'call_vision_api', return_value={'found': False}):
            self.assertEqual(self.post().status_code, 422)
        self.assertEqual(self.predictor.set_count, 0)

    def test_provider_failure_and_invalid_response_return_502(self):
        with patch.object(server, 'call_vision_api', side_effect=HTTPException(502, 'offline failure')):
            self.assertEqual(self.post().status_code, 502)
        for answer in [{}, {'found': True}, {'found': True, 'subject': None}, {'found': True, 'subject': []}, {'found': 'true', 'subject': subject()}]:
            with self.subTest(answer=answer), patch.object(server, 'call_vision_api', return_value=answer):
                self.assertEqual(self.post().status_code, 502)

    def test_invalid_automatic_subject_geometry_returns_422(self):
        variants = [{}, {'label': 'bad', 'box_2d': [-1, 0, 10, 10]}]
        for key, value in [
            ('box_2d', [200, 200, 100, 800]),
            ('positive_points', [[100, 100]]),
            ('negative_points', [[500, 500]]),
            ('segmentation_regions', []),
            ('segmentation_regions', [{'box_2d': [0, 0, 100, 100]}]),
        ]:
            invalid = copy.deepcopy(subject())
            invalid[key] = value
            variants.append(invalid)
        for invalid in variants:
            with self.subTest(subject=invalid), patch.object(server, 'call_vision_api', return_value={
                    'found': True, 'subject': invalid, 'caption': '', 'theme': '', 'emotion': ''}):
                self.assertEqual(self.post().status_code, 422)
        self.assertEqual(self.predictor.set_count, 0)

    def test_invalid_automatic_metadata_protocol_returns_502(self):
        for name, value in [('caption', None), ('theme', []), ('emotion', False)]:
            answer = {'found': True, 'subject': subject(), 'caption': '', 'theme': '', 'emotion': ''}
            answer[name] = value
            with self.subTest(field=name), patch.object(server, 'call_vision_api', return_value=answer):
                self.assertEqual(self.post().status_code, 502)
        self.assertEqual(self.predictor.set_count, 0)

    def test_unexpected_predictor_error_returns_real_500(self):
        with patch.object(self.predictor, 'predict', side_effect=RuntimeError('fake model error')):
            response = self.post(subject())
        self.assertEqual(response.status_code, 500)
        self.assertIsInstance(response.json().get('detail'), str)
        self.assertNotIn('fake model error', response.text)

    def test_vision_and_png_encoding_run_on_workers_without_sam_lock(self):
        real_encode = getattr(server, 'encode_cutout_png', None)
        worker_ids = []
        def unlocked():
            acquired = server._sam_lock.acquire(blocking=False)
            self.assertTrue(acquired, 'SAM lock held during non-SAM work')
            if acquired:
                server._sam_lock.release()
            worker_ids.append(threading.get_ident())
        def vision(*args, **kwargs):
            unlocked()
            return {'found': True, 'subject': subject(), 'caption': '', 'theme': '', 'emotion': ''}
        def encode(*args, **kwargs):
            unlocked()
            return real_encode(*args, **kwargs)
        with patch.object(server, 'call_vision_api', side_effect=vision), patch.object(server, 'encode_cutout_png', side_effect=encode, create=True), patch.object(server, 'run_in_threadpool', wraps=server.run_in_threadpool) as threadpool:
            response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(worker_ids), 2)
        self.assertNotIn(threading.get_ident(), worker_ids)
        self.assertGreaterEqual(threadpool.call_count, 1)

    def test_interleaved_cutouts_and_legacy_segment_do_not_mix_images(self):
        started, release, contended = threading.Event(), threading.Event(), threading.Event()
        class ObservedLock:
            def __init__(self):
                self.lock = threading.Lock()
                self.counter_lock = threading.Lock()
                self.attempts = 0

            def __enter__(self):
                with self.counter_lock:
                    self.attempts += 1
                    if self.attempts == 3:
                        contended.set()
                self.lock.acquire()
                return self

            def __exit__(self, *args):
                self.lock.release()

        original_predict = self.predictor.predict
        def block_first(*args, **kwargs):
            if not started.is_set():
                started.set()
                if not release.wait(5):
                    raise RuntimeError('concurrency test timed out')
            return original_predict(*args, **kwargs)
        with patch.object(server, '_sam_lock', ObservedLock()), patch.object(self.predictor, 'predict', side_effect=block_first), ThreadPoolExecutor(max_workers=3) as pool:
            first = pool.submit(self.post, subject(), photo((50, 0, 0)))
            if not started.wait(5):
                release.set()
                self.fail('cutout inference never started')
            second = pool.submit(self.post, subject(), photo((100, 0, 0)))
            legacy = pool.submit(self.post, subject(), photo((150, 0, 0)), '/api/segment')
            both_contended = contended.wait(5)
            release.set()
            self.assertTrue(both_contended, 'all three requests must enter the shared SAM lock')
            results = [first.result(10), second.result(10), legacy.result(10)]
        self.assertEqual([r.status_code for r in results], [200, 200, 200])
        for response, color in zip(results[:2], [50, 100]):
            image = Image.open(io.BytesIO(base64.b64decode(response.json()['data']['image'].split(',', 1)[1])))
            self.assertEqual(image.getpixel((0, 0))[0], color)
        self.assertEqual(self.predictor.seen[0:2], [50, 50])
        self.assertIn(self.predictor.seen[2:], [[100, 100, 150, 150], [150, 150, 100, 100]])
        self.assertEqual(self.predictor.set_count, 3)
        self.assertEqual(results[2].json()['data']['outline_status'], 'ready')


if __name__ == '__main__':
    unittest.main()
