"""Mask-selection regressions run offline without loading SAM or the server."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from segmentation_masks import select_subject_mask
except ModuleNotFoundError:
    select_subject_mask = None


class SubjectMaskTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(select_subject_mask, 'subject-mask selection has not been implemented')
        self.box = [50, 50, 150, 150]
        self.subject = np.zeros((200, 200), dtype=bool)
        self.subject[50:150, 50:150] = True

    def test_slightly_higher_scored_tray_extension_loses_to_clean_subject(self):
        # Selecting solely by SAM score would retain the tray, as in the candle fixture.
        tray = self.subject.copy()
        tray[150:170, 70:130] = True
        selected, quality = select_subject_mask(
            np.stack([tray, self.subject]), [.97080, .97052], None, self.box)
        np.testing.assert_array_equal(selected, self.subject)
        self.assertEqual(quality['candidate_index'], 1)
        self.assertEqual(quality['expanded_outside_fraction'], 0)

    def test_noisy_higher_provider_score_loses_to_stable_contour(self):
        noisy = self.subject.copy()
        noisy[50:65, 60:140:2] = False
        logits = np.stack([np.where(noisy, .2, -.2), np.where(self.subject, 3., -3.)])
        selected, quality = select_subject_mask(
            np.stack([noisy, self.subject]), [.99, .90], logits, self.box)
        np.testing.assert_array_equal(selected, self.subject)
        self.assertEqual(quality['candidate_index'], 1)
        self.assertEqual(quality['stability'], 1.)

    def test_known_support_background_point_disambiguates_broad_box(self):
        support = self.subject.copy()
        support[145:180, 20:180] = True
        selected, quality = select_subject_mask(
            np.stack([support, self.subject]), [.98675, .96931], None,
            [10, 40, 190, 190], positive_points=[[100, 100]], negative_points=[[100, 170]])
        np.testing.assert_array_equal(selected, self.subject)
        self.assertEqual(quality['candidate_index'], 1)

    def test_known_foreground_point_rejects_neighboring_object(self):
        neighbor = np.zeros_like(self.subject)
        neighbor[55:85, 55:85] = True
        selected, _ = select_subject_mask(
            np.stack([neighbor, self.subject]), [.99, .90], None, self.box,
            positive_points=[[100, 100]])
        np.testing.assert_array_equal(selected, self.subject)

    def test_wildly_escaping_mask_is_rejected(self):
        escaped = np.ones_like(self.subject)
        selected, quality = select_subject_mask(escaped[None], [.99], None, self.box)
        self.assertIsNone(selected)
        self.assertEqual(quality['reason'], 'no_valid_mask')

    def test_empty_and_nonfinite_candidates_are_rejected(self):
        empty = np.zeros_like(self.subject)
        nonfinite = self.subject.astype(float)
        nonfinite[100, 100] = float('nan')
        selected, _ = select_subject_mask(np.stack([empty, nonfinite]), [.99, .99], None, self.box)
        self.assertIsNone(selected)
        selected, _ = select_subject_mask(self.subject[None], [float('nan')], None, self.box)
        self.assertIsNone(selected)
        bad_logits = np.full((1, 16, 16), float('inf'))
        selected, _ = select_subject_mask(self.subject[None], [.99], bad_logits, self.box)
        self.assertIsNone(selected)

    def test_low_confidence_returns_no_outline(self):
        selected, _ = select_subject_mask(self.subject[None], [.40], None, self.box)
        self.assertIsNone(selected)

    def test_all_point_mismatches_return_no_outline(self):
        for kwargs in ({'positive_points': [[5, 5]]}, {'negative_points': [[100, 100]]}):
            with self.subTest(kwargs=kwargs):
                selected, _ = select_subject_mask(self.subject[None], [.99], None, self.box, **kwargs)
                self.assertIsNone(selected)

    def test_provider_scores_above_one_are_valid(self):
        selected, quality = select_subject_mask(self.subject[None], [1.00439], None, self.box)
        np.testing.assert_array_equal(selected, self.subject)
        self.assertEqual(quality['score'], 1.00439)

    def test_single_mask_without_logits_is_supported(self):
        selected, quality = select_subject_mask(self.subject[None], [.95], None, self.box)
        np.testing.assert_array_equal(selected, self.subject)
        self.assertIsNone(quality['stability'])

    def test_fine_pixels_and_disjoint_visible_parts_are_preserved(self):
        visible = np.zeros_like(self.subject)
        visible[60:140, 60:100] = True
        visible[80:120, 120:140] = True
        visible[50:60, 62] = True
        visible[99, 48:60] = True  # Two pixels outside the box remain valid fine detail.
        before = visible.copy()
        selected, _ = select_subject_mask(visible[None], [.95], None, self.box)
        np.testing.assert_array_equal(selected, before)
        np.testing.assert_array_equal(visible, before)

    def test_low_resolution_logits_are_supported(self):
        low = np.full((1, 16, 16), -3.)
        low[:, 4:12, 4:12] = 3.
        selected, quality = select_subject_mask(self.subject[None], [.95], low, self.box)
        np.testing.assert_array_equal(selected, self.subject)
        self.assertEqual(quality['stability'], 1.)

    def test_malformed_box_and_point_hints_do_not_create_masks(self):
        for box, kwargs in (([100, 50, 50, 150], {}), (self.box, {'positive_points': [[float('nan'), 80]]}),
                            (self.box, {'negative_points': [[-1, 10]]})):
            with self.subTest(box=box, kwargs=kwargs):
                selected, _ = select_subject_mask(self.subject[None], [.99], None, box, **kwargs)
                self.assertIsNone(selected)


if __name__ == '__main__':
    unittest.main()
