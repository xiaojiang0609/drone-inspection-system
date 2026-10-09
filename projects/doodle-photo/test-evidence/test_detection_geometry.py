"""Behavior checks for subject boxes and segmentation hints."""

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detection_geometry import normalize_subject_geometry


class SubjectGeometryTests(unittest.TestCase):
    def test_inverted_and_empty_boxes_are_rejected_without_inventing_a_center(self):
        for box in (
            [100, 200, 100, 700],
            [500, 600, 300, 900],
            [100, 500, 900, 400],
            [100, 200, 900, 200],
            [1100, 200, 1200, 700],
            [100, -100, 900, -20],
        ):
            with self.subTest(box=box):
                self.assertIsNone(normalize_subject_geometry({"box_2d": box}))

    def test_box_requires_exactly_four_finite_coordinates(self):
        for box in (
            None, "100,200,900,800", [0, 0, 1000], [0, 0, 1000, 1000, 1],
            [0, 0, float("nan"), 1000], [0, 0, 1000, float("inf")],
            [float("-inf"), 0, 1000, 1000], [False, 0, 1000, 1000],
            [0, {}, 1000, 1000], [0, 0, "not-a-number", 1000],
            [0, 0, "NaN", 1000], [0, 0, "Infinity", 1000],
        ):
            with self.subTest(box=box):
                self.assertIsNone(normalize_subject_geometry({"box_2d": box}))
        for item in (None, [], "subject", {}):
            with self.subTest(item=item):
                self.assertIsNone(normalize_subject_geometry(item))

    def test_box_only_legacy_data_is_clamped_and_preserves_fractional_precision(self):
        result = normalize_subject_geometry({"box_2d": [-10, "20.25", "1001", 999.5]})
        self.assertEqual(result, {
            "box_2d": [0.0, 20.25, 1000.0, 999.5],
            "segmentation_regions": [{
                "box_2d": [0.0, 20.25, 1000.0, 999.5],
                "positive_points": [], "negative_points": [],
            }],
        })
        self.assertTrue(all(type(value) is float for value in result["box_2d"]))

    def test_confidence_does_not_discard_an_otherwise_valid_subject(self):
        result = normalize_subject_geometry({
            "box_2d": [100, 200, 800, 900], "confidence": 0.01,
        })
        self.assertEqual(result["box_2d"], [100.0, 200.0, 800.0, 900.0])

    def test_positive_hints_must_be_finite_points_inside_the_foreground_box(self):
        result = normalize_subject_geometry({
            "box_2d": [100, 200, 800, 900],
            "positive_points": [
                [300, 400], [200, 100], [900, 800], [950, 500], [500, 50],
                [True, 500], [500, float("nan")], [500], [500, 500, 500],
                {"x": 500, "y": 500}, ["400.5", "600.25"],
            ],
        })
        self.assertEqual(result["segmentation_regions"][0]["positive_points"], [
            [300.0, 400.0], [200.0, 100.0], [900.0, 800.0], [400.5, 600.25],
        ])

    def test_negative_hints_must_be_in_image_and_distinct_from_positive_hints(self):
        result = normalize_subject_geometry({
            "box_2d": [100, 200, 800, 900], "positive_points": [[500, 500]],
            "negative_points": [
                [500, 500], [0, 0], [1000, 1000], [-1, 500], [500, 1001],
                [float("inf"), 500], [False, 100], [100], ["10", "20"],
            ],
        })
        self.assertEqual(result["segmentation_regions"][0]["negative_points"], [
            [0.0, 0.0], [1000.0, 1000.0], [10.0, 20.0],
        ])

    def test_valid_hints_are_capped_after_bad_entries_and_duplicates_are_removed(self):
        result = normalize_subject_geometry({
            "box_2d": [0, 0, 1000, 1000],
            "positive_points": [None, [100, 100], [100, 100], [200, 200],
                                [300, 300], [400, 400], [500, 500]],
            "negative_points": [None, [100, 100], [10, 10], [10, 10], [20, 20],
                                [30, 30], [40, 40], [50, 50], [60, 60],
                                [70, 70], [80, 80], [90, 90]],
        })
        region = result["segmentation_regions"][0]
        self.assertEqual(region["positive_points"], [
            [100.0, 100.0], [200.0, 200.0], [300.0, 300.0], [400.0, 400.0],
        ])
        self.assertEqual(region["negative_points"], [
            [10.0, 10.0], [20.0, 20.0], [30.0, 30.0], [40.0, 40.0],
            [50.0, 50.0], [60.0, 60.0], [70.0, 70.0], [80.0, 80.0],
        ])

    def test_multiple_subject_parts_keep_their_hints_and_tighten_parent_to_union(self):
        result = normalize_subject_geometry({
            "box_2d": [50, 50, 950, 950],
            "positive_points": [[500, 900]],
            "segmentation_regions": [
                {"box_2d": [100, 200, 400, 450], "positive_points": [[300, 200]],
                 "negative_points": [[600, 500]]},
                {"box_2d": [250, 500, 600, 800], "positive_points": [[600, 500]]},
            ],
        })
        self.assertEqual(result, {
            "box_2d": [100.0, 200.0, 600.0, 800.0],
            "segmentation_regions": [
                {"box_2d": [100.0, 200.0, 400.0, 450.0],
                 "positive_points": [[300.0, 200.0]],
                 "negative_points": [[600.0, 500.0]]},
                {"box_2d": [250.0, 500.0, 600.0, 800.0],
                 "positive_points": [[600.0, 500.0]], "negative_points": []},
            ],
        })

    def test_corrected_region_may_extend_past_parent_but_must_intersect_it(self):
        result = normalize_subject_geometry({
            "box_2d": [100, 100, 600, 600],
            "segmentation_regions": [
                {"box_2d": [-10, -50, 300, 300]},
                {"box_2d": [550, 550, 1200, 1300]},
                {"box_2d": [700, 100, 900, 300]},
                {"box_2d": [100, 600, 200, 800]},
            ],
        })
        self.assertEqual(result["box_2d"], [0.0, 0.0, 1000.0, 1000.0])
        self.assertEqual(len(result["segmentation_regions"]), 2)
        self.assertEqual(result["segmentation_regions"][1]["box_2d"],
                         [550.0, 550.0, 1000.0, 1000.0])

    def test_regions_accept_tight_box_key(self):
        result = normalize_subject_geometry({
            "box_2d": [0, 0, 1000, 1000],
            "segmentation_regions": [{"tightbox_2d": [100, 200, 300, 400]}],
        })
        self.assertEqual(result["box_2d"], [100.0, 200.0, 300.0, 400.0])
        self.assertEqual(result["segmentation_regions"][0]["box_2d"],
                         [100.0, 200.0, 300.0, 400.0])

    def test_region_count_is_capped_at_eight_valid_parts(self):
        result = normalize_subject_geometry({
            "box_2d": [0, 0, 1000, 1000],
            "segmentation_regions": [None] + [
                {"box_2d": [index * 10, 100, index * 10 + 5, 200]}
                for index in range(12)
            ],
        })
        self.assertEqual(len(result["segmentation_regions"]), 8)
        self.assertEqual(result["box_2d"], [0.0, 100.0, 75.0, 200.0])

    def test_malformed_optional_regions_fall_back_to_parent_hints(self):
        malformed_regions = [None, [], "bad", {}, {"box_2d": [300, 300, 200, 400]},
                             {"box_2d": [0, 0, 500, float("nan")]},
                             {"box_2d": [900, 900, 1000, 1000]}]
        for regions in (None, "bad", {}, malformed_regions):
            with self.subTest(regions=regions):
                result = normalize_subject_geometry({
                    "box_2d": [100, 200, 800, 900],
                    "segmentation_regions": regions,
                    "positive_points": [[500, 500]], "negative_points": [[0, 0]],
                })
                self.assertEqual(result, {
                    "box_2d": [100.0, 200.0, 800.0, 900.0],
                    "segmentation_regions": [{
                        "box_2d": [100.0, 200.0, 800.0, 900.0],
                        "positive_points": [[500.0, 500.0]],
                        "negative_points": [[0.0, 0.0]],
                    }],
                })

    def test_optional_malformed_hint_arrays_do_not_invent_hint_points(self):
        for points in (None, "500,500", {"x": 500, "y": 500}, 42):
            with self.subTest(points=points):
                result = normalize_subject_geometry({
                    "box_2d": [100, 200, 800, 900],
                    "positive_points": points, "negative_points": points,
                })
                region = result["segmentation_regions"][0]
                self.assertEqual(region["positive_points"], [])
                self.assertEqual(region["negative_points"], [])

    def test_input_payload_is_not_mutated(self):
        item = {
            "box_2d": [-10, 0, 1000, 1100],
            "segmentation_regions": [{"box_2d": [100, 200, 300, 400],
                                      "positive_points": [[300, 200]]}],
        }
        before = copy.deepcopy(item)
        result = normalize_subject_geometry(item)
        self.assertEqual(item, before)
        result["segmentation_regions"][0]["box_2d"][0] = 999
        result["segmentation_regions"][0]["positive_points"][0][0] = 999
        self.assertEqual(item, before)


if __name__ == "__main__":
    unittest.main()
