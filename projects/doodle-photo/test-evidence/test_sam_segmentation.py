from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from sam_segmentation import predict_subject_mask, mask_to_contour_rings
except ModuleNotFoundError:
    predict_subject_mask = mask_to_contour_rings = None


class FakePredictor:
    def __init__(self):
        self.set_count = 0
        self.calls = []
        self.mask = np.zeros((30,30), bool)
        self.mask[5:25, 5:25] = True
        self.mask[10,10] = False

    def set_image(self, image):
        self.set_count += 1

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        n = 3 if kwargs['multimask_output'] else 1
        return np.repeat(self.mask[None], n, axis=0), np.full(n, .95), None


class SamSegmentationTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(predict_subject_mask, 'SAM mask module has not been implemented')
        self.predictor = FakePredictor()
        self.image = np.zeros((30,30,3), np.uint8)

    def test_each_image_encoded_once_each_region_predicted_twice(self):
        mask, quality = predict_subject_mask(self.predictor, self.image, [5,5,25,25], positive_points=[[6,6]], negative_points=[[0,0]])
        second, _ = predict_subject_mask(self.predictor, self.image, [5,5,25,25], image_ready=True)
        self.assertEqual(self.predictor.set_count, 1)
        self.assertEqual([call['multimask_output'] for call in self.predictor.calls], [False,True,False,True])
        np.testing.assert_array_equal(self.predictor.calls[0]['point_coords'], [[6,6],[0,0]])
        np.testing.assert_array_equal(self.predictor.calls[0]['point_labels'], [1,0])
        np.testing.assert_array_equal(mask, self.predictor.mask)
        np.testing.assert_array_equal(second, mask)
        self.assertGreater(quality['quality_score'], .65)
        mask[5,5] = False
        self.assertTrue(self.predictor.mask[5,5])

    def test_unreliable_mask_returns_none_with_quality(self):
        mask, quality = predict_subject_mask(self.predictor, self.image, [5,5,25,25], negative_points=[[6,6]])
        self.assertIsNone(mask)
        self.assertEqual(quality['reason'], 'no_valid_mask')

    def test_model_exception_is_not_swallowed(self):
        def failed(**kwargs):
            raise RuntimeError('model failure')
        self.predictor.predict = failed
        with self.assertRaisesRegex(RuntimeError, 'model failure'):
            predict_subject_mask(self.predictor, self.image, [5,5,25,25])

    def test_contours_keep_old_filter_normalization_and_do_not_mutate_mask(self):
        mask = self.predictor.mask.copy()
        mask[0,0] = True
        before = mask.copy()
        rings = mask_to_contour_rings(mask, 30,30)
        self.assertEqual(len(rings), 1)
        self.assertEqual(len(rings[0]), 4)
        self.assertEqual(sorted(rings[0]), [[166.667,166.667],[166.667,800.0],[800.0,166.667],[800.0,800.0]])
        np.testing.assert_array_equal(mask, before)


if __name__ == '__main__':
    unittest.main()
