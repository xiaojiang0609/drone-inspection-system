"""Crop-local subject corrections must keep the original image coordinate space."""

import base64
import copy
import io
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import subject_refinement as refinement
except ModuleNotFoundError:
    refinement = None


class SubjectRefinementTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(refinement, "subject_refinement helpers must exist")
        self.metadata = {
            "crop_bounds": [200, 100, 1200, 600],
            "original_size": [2000, 1000],
            "region_index": 0,
        }
        self.geometry = {
            "box_2d": [100, 100, 900, 900],
            "segmentation_regions": [
                {"box_2d": [100, 100, 600, 600],
                 "positive_points": [[300, 300]], "negative_points": [[0, 0]]},
                {"box_2d": [700, 700, 900, 900],
                 "positive_points": [[800, 800]], "negative_points": [[500, 500]]},
            ],
            "label": "Old label", "caption": "Keep my caption", "layout": {"x": 17},
        }
        self.answer = {
            "verified": True, "label": "  Ceramic cup  ",
            "bbox": [100, 200, 800, 900],
            "positive_points": [[400, 300]],
            "negative_points": [[0, 0], [1000, 1000]],
            "caption": "Do not replace", "layout": {"x": 999},
        }

    def test_crop_uses_selected_region_and_original_nonsquare_pixels(self):
        image = Image.new("RGB", (2000, 1000))
        geometry = {
            "box_2d": [100, 100, 900, 900],
            "segmentation_regions": [
                {"box_2d": [100, 100, 400, 300]},
                {"box_2d": [600, 700, 900, 900]},
            ],
        }
        crop, metadata = refinement.make_subject_crop(image, geometry, 1)
        self.assertEqual(crop.size, (560, 420))
        self.assertEqual(metadata["crop_bounds"], [1320, 540, 1880, 960])
        self.assertEqual(metadata["original_size"], [2000, 1000])
        self.assertEqual(metadata["region_index"], 1)
        self.assertEqual(image.size, (2000, 1000))

    def test_edge_crop_gets_safe_context_without_padding_outside_photo(self):
        crop, metadata = refinement.make_subject_crop(
            Image.new("RGB", (100, 60)), {"box_2d": [0, 0, 100, 100]})
        self.assertEqual(metadata["crop_bounds"], [0, 0, 32, 32])
        self.assertEqual(crop.size, (32, 32))
        tiny, tiny_metadata = refinement.make_subject_crop(
            Image.new("RGB", (8, 4)), {"box_2d": [0, 0, 100, 100]})
        self.assertEqual(tiny_metadata["crop_bounds"], [0, 0, 8, 4])
        self.assertEqual(tiny.size, (8, 4))

    def test_bottom_right_crop_remains_inside_photo(self):
        crop, metadata = refinement.make_subject_crop(
            Image.new("RGB", (100, 60)), {"box_2d": [900, 900, 1000, 1000]})
        self.assertEqual(metadata["crop_bounds"], [68, 28, 100, 60])
        self.assertEqual(crop.size, (32, 32))

    def test_crop_rounding_metadata_matches_pixels_actually_used(self):
        image = Image.new("RGB", (101, 67))
        image.putpixel((12, 5), (255, 12, 7))
        crop, metadata = refinement.make_subject_crop(
            image, {"box_2d": [200, 200, 600, 600]})
        self.assertEqual(metadata["crop_bounds"], [12, 5, 69, 49])
        self.assertEqual(crop.size, (57, 44))
        self.assertEqual(crop.getpixel((0, 0)), (255, 12, 7))

    def test_crop_rejects_invalid_geometry_or_region_index(self):
        image = Image.new("RGB", (100, 60))
        for geometry, index in (({}, 0), ({"box_2d": [0, 0, 0, 1]}, 0),
                                ({"box_2d": [0, 0, 500, 500]}, -1),
                                ({"box_2d": [0, 0, 500, 500]}, 1),
                                ({"box_2d": [0, 0, 500, 500]}, True),
                                ({"box_2d": [0, 0, 500, 500]}, "0")):
            with self.subTest(geometry=geometry, index=index):
                with self.assertRaises(ValueError):
                    refinement.make_subject_crop(image, geometry, index)

    def test_jpeg_encoding_resizes_only_the_encoded_copy(self):
        crop = Image.new("RGB", (2500, 1000), (30, 60, 90))
        encoded = refinement.encode_crop_jpeg(crop)
        decoded = Image.open(io.BytesIO(base64.b64decode(encoded)))
        self.assertEqual(decoded.format, "JPEG")
        self.assertEqual(decoded.size, (1024, 410))
        self.assertEqual(crop.size, (2500, 1000))

    def test_local_bbox_yx_and_points_xy_map_to_original_image(self):
        before = copy.deepcopy(self.geometry)
        result = refinement.apply_vision_refinement(
            self.answer, self.geometry, self.metadata)
        region = result["geometry"]["segmentation_regions"][0]
        self.assertEqual(region["box_2d"], [150.0, 200.0, 500.0, 550.0])
        self.assertEqual(region["positive_points"], [[300.0, 250.0]])
        self.assertEqual(region["negative_points"], [[100.0, 100.0], [600.0, 600.0]])
        self.assertEqual(result["label"], "Ceramic cup")
        self.assertEqual(self.geometry, before)

    def test_refinement_preserves_other_regions_and_unions_parent_box(self):
        result = refinement.apply_vision_refinement(
            self.answer, self.geometry, self.metadata)
        self.assertEqual(result["geometry"]["box_2d"], [150.0, 200.0, 900.0, 900.0])
        self.assertEqual(result["geometry"]["segmentation_regions"][1],
                         self.geometry["segmentation_regions"][1])
        self.assertEqual(set(result), {"geometry", "label"})
        result["geometry"]["segmentation_regions"][1]["positive_points"][0][0] = 10
        self.assertEqual(self.geometry["segmentation_regions"][1]["positive_points"],
                         [[800, 800]])

    def test_nonzero_region_index_replaces_only_that_region(self):
        metadata = {"crop_bounds": [1300, 600, 1900, 1000],
                    "original_size": [2000, 1000], "region_index": 1}
        result = refinement.apply_vision_refinement(
            self.answer, self.geometry, metadata, 1)
        self.assertEqual(result["geometry"]["segmentation_regions"][0],
                         self.geometry["segmentation_regions"][0])
        self.assertEqual(result["geometry"]["segmentation_regions"][1]["box_2d"],
                         [640.0, 710.0, 920.0, 920.0])

    def test_vision_verification_requires_json_true(self):
        for verified in (False, None, 1, "true", "false"):
            answer = dict(self.answer, verified=verified)
            with self.subTest(verified=verified):
                with self.assertRaises(ValueError):
                    refinement.apply_vision_refinement(answer, self.geometry, self.metadata)

    def test_invalid_nonfinite_or_whole_crop_vision_boxes_are_rejected(self):
        for bbox in (None, [], [0, 0, 0, 500], [500, 100, 100, 800],
                     [0, 0, float("nan"), 900], [0, 0, 800, float("inf")],
                     [False, 0, 800, 900], [-1, 0, 800, 900], [0, 0, 1001, 900],
                     [0, 0, 1000, 1000], [5, 5, 995, 995]):
            with self.subTest(bbox=bbox):
                with self.assertRaises(ValueError):
                    refinement.apply_vision_refinement(
                        dict(self.answer, bbox=bbox), self.geometry, self.metadata)
        for answer in (None, {}, [], "cup"):
            with self.subTest(answer=answer):
                with self.assertRaises(ValueError):
                    refinement.apply_vision_refinement(answer, self.geometry, self.metadata)

    def test_malformed_nonfinite_or_out_of_crop_points_are_rejected(self):
        for points in ([[float("nan"), 20]], [[20, float("inf")]],
                       [[True, 20]], [[1001, 20]], [[20]], "20,30"):
            with self.subTest(points=points):
                with self.assertRaises(ValueError):
                    refinement.apply_vision_refinement(
                        dict(self.answer, positive_points=points),
                        self.geometry, self.metadata)

    def test_label_is_optional_sanitized_and_bounded(self):
        for label in (None, "   ", ["cup"], {"name": "cup"}):
            result = refinement.apply_vision_refinement(
                dict(self.answer, label=label), self.geometry, self.metadata)
            self.assertNotIn("label", result)
        result = refinement.apply_vision_refinement(
            dict(self.answer, label="a" * 100), self.geometry, self.metadata)
        self.assertEqual(result["label"], "a" * 80)

    def test_global_to_crop_roundtrip_keeps_box_and_available_hints(self):
        region = {"box_2d": [150, 200, 500, 550],
                  "positive_points": [[300, 250]],
                  "negative_points": [[100, 100], [600, 600], [900, 900]]}
        local = refinement.global_geometry_to_crop_region(region, self.metadata)
        self.assertEqual(local, {"box_2d": [100.0, 200.0, 800.0, 900.0],
                                 "positive_points": [[400.0, 300.0]],
                                 "negative_points": [[0.0, 0.0], [1000.0, 1000.0]]})
        mapped = refinement.apply_vision_refinement(
            dict(local, verified=True), self.geometry, self.metadata)
        self.assertEqual(mapped["geometry"]["segmentation_regions"][0]["box_2d"],
                         region["box_2d"])

    def test_global_to_crop_clips_box_but_never_moves_outside_points(self):
        local = refinement.global_geometry_to_crop_region(
            {"box_2d": [50, 50, 700, 700],
             "positive_points": [[100, 100], [900, 900]],
             "negative_points": [[90, 90], [600, 600]]}, self.metadata)
        self.assertEqual(local["box_2d"], [0.0, 0.0, 1000.0, 1000.0])
        self.assertEqual(local["positive_points"], [[0.0, 0.0]])
        self.assertEqual(local["negative_points"], [[1000.0, 1000.0]])
        with self.assertRaises(ValueError):
            refinement.global_geometry_to_crop_region(
                {"box_2d": [700, 700, 900, 900]}, self.metadata)

    def test_contour_xy_maps_to_global_without_axis_swap(self):
        contour = refinement.crop_contour_to_global(
            [[0, 0], [1000, 0], [1000, 1000], [400, 300]], self.metadata)
        self.assertEqual(contour,
                         [[100.0, 100.0], [600.0, 100.0],
                          [600.0, 600.0], [300.0, 250.0]])
        with self.assertRaises(ValueError):
            refinement.crop_contour_to_global([[float("nan"), 0]], self.metadata)

    def test_invalid_metadata_or_wrong_selected_index_cannot_remap_geometry(self):
        for metadata in ({}, {"crop_bounds": [0, 0, 0, 10], "original_size": [100, 100]},
                         {"crop_bounds": [0, 0, 110, 10], "original_size": [100, 100]},
                         {"crop_bounds": [0, 0, 10, 10], "original_size": [0, 100]},
                         dict(self.metadata, region_index=1)):
            with self.subTest(metadata=metadata):
                with self.assertRaises(ValueError):
                    refinement.apply_vision_refinement(
                        self.answer, self.geometry, metadata)


if __name__ == "__main__":
    unittest.main()
