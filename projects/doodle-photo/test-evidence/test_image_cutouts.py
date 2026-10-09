import base64
import copy
import io
import struct
import sys
import unittest
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import image_cutouts as cutouts
except ModuleNotFoundError:
    cutouts = None


def encoded(image, format='PNG', **kwargs):
    buffer = io.BytesIO()
    image.save(buffer, format=format, **kwargs)
    return buffer.getvalue()


def unpack(result):
    return Image.open(io.BytesIO(base64.b64decode(result['image'].split(',', 1)[1])))


class CutoutTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(cutouts, 'transparent cutout module has not been implemented')
        self.original = Image.new('RGBA', (8, 8), (20, 40, 60, 255))
        self.metadata = {'original_size': [8, 8], 'crop_bounds': [0, 0, 8, 8], 'working_size': [8, 8]}

    def assert_error(self, status, operation, *args):
        with self.assertRaises(cutouts.CutoutError) as raised:
            operation(*args)
        self.assertEqual(raised.exception.status_code, status)
        self.assertTrue(raised.exception.detail)

    def test_alpha_preserves_hole_and_detached_pixel(self):
        mask = np.zeros((8, 8), bool)
        mask[1:7, 1:7] = True
        mask[3, 3] = False
        mask[7, 7] = True
        original_mask = mask.copy()
        result = cutouts.encode_cutout_png(self.original, mask, self.metadata)
        png = unpack(result)
        self.assertEqual(result['crop_box'], [1, 1, 8, 8])
        self.assertEqual(png.getpixel((2, 2))[3], 0)
        self.assertEqual(png.getpixel((6, 6))[3], 255)
        self.assertEqual(png.getpixel((0, 0))[:3], self.original.getpixel((1, 1))[:3])
        np.testing.assert_array_equal(mask, original_mask)

    def test_mask_intersects_original_alpha_and_crops_actual_alpha(self):
        self.original.putpixel((0, 0), (1, 2, 3, 0))
        self.original.putpixel((1, 1), (1, 2, 3, 90))
        mask = np.zeros((8, 8), bool)
        mask[0, 0] = mask[1, 1] = mask[2, 2] = True
        result = cutouts.encode_cutout_png(self.original, mask, self.metadata)
        self.assertEqual(result['crop_box'], [1, 1, 3, 3])
        self.assertEqual(unpack(result).getpixel((0, 0)), (1, 2, 3, 90))

    def test_decode_exif_orientation_and_crop_coordinates(self):
        exif = Image.Exif()
        exif[274] = 6
        original = cutouts.decode_cutout_image(encoded(Image.new('RGB', (8, 4)), 'JPEG', exif=exif))
        self.assertEqual(original.size, (4, 8))
        mask = np.zeros((8, 4), bool)
        mask[2:6, 1:3] = True
        result = cutouts.encode_cutout_png(original, mask, {'original_size': [4, 8], 'crop_bounds': [0, 0, 4, 8], 'working_size': [4, 8]})
        self.assertEqual(result['crop_box'], [1, 2, 3, 6])
        self.assertEqual((result['original_width'], result['original_height']), (4, 8))

    def test_union_crop_keeps_separate_regions_and_excludes_outside_negative_point(self):
        original = Image.new('RGBA', (100, 100))
        subject = {'label': '主体', 'box_2d': [100, 100, 900, 900], 'segmentation_regions': [
            {'box_2d': [100, 100, 200, 200], 'positive_points': [[150, 150]], 'negative_points': [[1000, 1000], [500, 500]]},
            {'box_2d': [800, 800, 900, 900]}]}
        rgb, metadata, regions = cutouts.prepare_cutout_crop(original, subject, padding=0)
        self.assertEqual(rgb.shape, (80, 80, 3))
        self.assertEqual(metadata, {'original_size': [100, 100], 'crop_bounds': [10, 10, 90, 90], 'working_size': [80, 80]})
        self.assertEqual(regions[0]['box_xyxy'], [0, 0, 10, 10])
        self.assertEqual(regions[1]['box_xyxy'], [70, 70, 80, 80])
        self.assertEqual(regions[0]['positive_points'], [[5, 5]])
        self.assertEqual(regions[0]['negative_points'], [[40, 40]])
        masks = [np.zeros((80, 80), bool), np.zeros((80, 80), bool)]
        masks[0][0:10, 0:10] = True
        masks[1][70:80, 70:80] = True
        result = cutouts.encode_cutout_png(Image.new('RGBA', (100, 100), 'red'), cutouts.merge_region_masks(masks), metadata)
        self.assertEqual(result['crop_box'], [10, 10, 90, 90])
        self.assertEqual(unpack(result).getpixel((40, 40))[3], 0)

    def test_working_mask_maps_to_original_with_nearest_neighbor(self):
        original = Image.new('RGBA', (8, 8), 'red')
        mask = np.array([[True, False], [False, True]])
        result = cutouts.encode_cutout_png(original, mask, {'original_size': [8, 8], 'crop_bounds': [2, 2, 6, 6], 'working_size': [2, 2]})
        self.assertEqual(result['crop_box'], [2, 2, 6, 6])
        alpha = np.array(unpack(result))[:, :, 3]
        np.testing.assert_array_equal(alpha, [[255,255,0,0],[255,255,0,0],[0,0,255,255],[0,0,255,255]])

    def test_merge_fails_if_any_region_has_no_mask(self):
        self.assert_error(422, cutouts.merge_region_masks, [np.ones((8, 8)), None])
        self.assert_error(422, cutouts.merge_region_masks, [])
        self.assert_error(422, cutouts.merge_region_masks, [np.ones((8, 8)), np.ones((4, 4))])
        self.assert_error(422, cutouts.encode_cutout_png, self.original, np.zeros((8, 8)), self.metadata)

    def test_strict_subject_validation_and_input_immutability(self):
        value = {'label': '  小猫  ', 'box_2d': [100, 100, 900, 900], 'positive_points': [[300, 400]], 'negative_points': [[950, 950]]}
        before = copy.deepcopy(value)
        result = cutouts.validate_cutout_subject(value)
        self.assertEqual(result['label'], '小猫')
        self.assertEqual(result['segmentation_regions'][0]['positive_points'], [[300, 400]])
        self.assertEqual(result['segmentation_regions'][0]['negative_points'], [[950, 950]])
        self.assertEqual(value, before)

    def test_invalid_geometry_is_rejected_without_clipping_or_dropping(self):
        good = {'label': '主体', 'box_2d': [100, 100, 900, 900]}
        bad_values = [None, [], {**good, 'label': ''}, {**good, 'label': 3}]
        for bad in (True, float('nan'), float('inf'), -1, 1001, 10**1000, '100'):
            bad_values.append({**good, 'box_2d': [bad, 100, 900, 900]})
        for points in ([[True, 200]], [[float('nan'), 200]], [[1001, 200]], [[50, 200]], [[200, 200]] * 5, [[200, 200, 300]], 'points'):
            bad_values.append({**good, 'positive_points': points})
        bad_values += [{**good, 'negative_points': [[0, 0]] * 9}, {**good, 'positive_points': [[200, 200]], 'negative_points': [[200, 200]]},
                       {**good, 'box_2d': [100, 100, 100, 900]}, {**good, 'segmentation_regions': []},
                       {**good, 'segmentation_regions': [{'box_2d': good['box_2d']}] * 9}, {**good, 'segmentation_regions': [None]},
                       {**good, 'segmentation_regions': [{'box_2d': [0, 0, 50, 50]}]}]
        for value in bad_values:
            with self.subTest(value=value):
                self.assert_error(422, cutouts.validate_cutout_subject, value)

    def test_hint_limits_and_cross_region_conflicts(self):
        region = {'box_2d': [100, 100, 900, 900],
                  'positive_points': [[200, 200], [300, 300], [400, 400], [500, 500]],
                  'negative_points': [[i * 10, 0] for i in range(8)]}
        subject = {'label': '主体', 'box_2d': region['box_2d'], 'segmentation_regions': [copy.deepcopy(region) for _ in range(8)]}
        result = cutouts.validate_cutout_subject(subject)
        self.assertEqual(len(result['segmentation_regions']), 8)
        self.assertEqual(len(result['segmentation_regions'][0]['positive_points']), 4)
        self.assertEqual(len(result['segmentation_regions'][0]['negative_points']), 8)
        subject['segmentation_regions'][1]['negative_points'] = [[200, 200]]
        self.assert_error(422, cutouts.validate_cutout_subject, subject)
        self.assert_error(422, cutouts.validate_cutout_subject,
                          {'label': '主体', 'box_2d': region['box_2d'], 'positive_points': [[200,200], [200,200]]})

    def test_default_padding_and_scaled_points_keep_all_region_boxes(self):
        rgb, metadata, regions = cutouts.prepare_cutout_crop(
            Image.new('RGBA', (4000,2000)), {'label': '主体', 'box_2d': [250,250,750,750], 'positive_points': [[500,500]]})
        self.assertEqual(metadata['crop_bounds'], [600,300,3400,1700])
        self.assertEqual(rgb.shape, (768,1536,3))
        np.testing.assert_allclose(regions[0]['positive_points'], [[768,384]])
        np.testing.assert_allclose(regions[0]['box_xyxy'], [219.42857142857142,109.71428571428571,1316.5714285714284,658.2857142857142])

    def test_twenty_mib_boundary_is_accepted(self):
        content = encoded(self.original)
        content += b'\0' * (20 * 1024 * 1024 - len(content))
        self.assertEqual(cutouts.decode_cutout_image(content).size, (8,8))

    def test_decode_rejects_file_size_pixels_animation_bad_data_and_format(self):
        self.assert_error(413, cutouts.decode_cutout_image, b'x' * (20 * 1024 * 1024 + 1))
        # A valid oversized IHDR triggers the pixel gate before image data is decoded.
        header = struct.pack('>IIBBBBB', 40000001, 1, 8, 2, 0, 0, 0)
        chunk = struct.pack('>I', len(header)) + b'IHDR' + header + struct.pack('>I', zlib.crc32(b'IHDR' + header))
        self.assert_error(413, cutouts.decode_cutout_image, b'\x89PNG\r\n\x1a\n' + chunk + b'\x00\x00\x00\x00IEND\xaeB\x60\x82')
        animation = encoded(Image.new('RGBA', (2,2), 'red'), save_all=True, append_images=[Image.new('RGBA', (2,2), 'blue')], duration=10)
        self.assert_error(400, cutouts.decode_cutout_image, animation)
        self.assert_error(400, cutouts.decode_cutout_image, b'not an image')
        self.assert_error(400, cutouts.decode_cutout_image, encoded(self.original.convert('RGB'), 'BMP'))
        self.assertEqual(cutouts.decode_cutout_image(encoded(self.original)).mode, 'RGBA')

    def test_vision_crop_and_output_size_limits(self):
        original = Image.new('RGBA', (2000, 1000), 'red')
        vision = cutouts.encode_vision_image(original)
        jpeg = Image.open(io.BytesIO(base64.b64decode(vision.split(',', 1)[1])))
        self.assertEqual(jpeg.size, (1536, 768))
        rgb, metadata, _ = cutouts.prepare_cutout_crop(original, {'label': '主体', 'box_2d': [0, 0, 1000, 1000]})
        self.assertEqual(rgb.shape, (768, 1536, 3))
        result = cutouts.encode_cutout_png(original, np.ones((768, 1536), bool), metadata)
        self.assertEqual((result['width'], result['height']), (1536, 768))
        self.assertEqual(result['crop_box'], [0, 0, 2000, 1000])

    def test_contour_point_budget_is_independent_of_png_alpha(self):
        # Many independent squares can exhaust a shared contour point budget.
        original = Image.new('RGBA', (360, 360), 'red')
        mask = np.zeros((360, 360), bool)
        for y in range(0, 360, 5):
            for x in range(0, 360, 5):
                mask[y:y+3, x:x+3] = True
        metadata = {'original_size': [360, 360], 'crop_bounds': [0, 0, 360, 360], 'working_size': [360, 360]}
        result = cutouts.encode_cutout_png(original, mask, metadata)
        self.assertLessEqual(sum(map(len, result['contours'])), 16384)
        self.assertTrue(result['contours'])
        png = unpack(result)
        np.testing.assert_array_equal(np.array(png)[:, :, 3] > 0, mask[:358, :358])
        for ring in result['contours']:
            self.assertTrue(all(0 <= x < result['width'] and 0 <= y < result['height'] for x,y in ring))
        small = cutouts.encode_cutout_png(original, mask, metadata, max_contour_points=12)
        self.assertLessEqual(sum(map(len, small['contours'])), 12)
        np.testing.assert_array_equal(np.array(unpack(small)), np.array(png))


if __name__ == '__main__':
    unittest.main()
