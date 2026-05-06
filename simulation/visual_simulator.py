import random
from datetime import datetime
from typing import List
from models.types import Position, Detection
from config.detection_rules import DETECTION_PROBABILITIES, SEVERITY_MAP, DESCRIPTIONS


class VisualSimulator:
    def __init__(self, scenario: str):
        self.scenario = scenario
        self._detection_count = 0

    def generate_detections(self, position: Position, zone_id: str, zone_hazard_types: List[str]) -> List[Detection]:
        detections = []

        for hazard_type in zone_hazard_types:
            prob = self._get_detection_probability(hazard_type)
            if random.random() < prob:
                detection = self._create_detection(hazard_type, position, zone_id)
                detections.append(detection)

        if random.random() < 0.05:
            detection = self._create_unexpected_detection(position, zone_id)
            if detection:
                detections.append(detection)

        return detections

    def _get_detection_probability(self, hazard_type: str) -> float:
        return DETECTION_PROBABILITIES.get(self.scenario, {}).get(hazard_type, 0.10)

    def _create_detection(self, hazard_type: str, position: Position, zone_id: str) -> Detection:
        self._detection_count += 1
        return Detection(
            detection_id=f"DET-{self._detection_count:04d}",
            timestamp=datetime.now(),
            position=position,
            zone_id=zone_id,
            category="safety_violation",
            detection_type=hazard_type,
            severity=SEVERITY_MAP.get(hazard_type, "info"),
            description=DESCRIPTIONS.get(hazard_type, f"Detected {hazard_type}"),
            confidence=0.95
        )

    def _create_unexpected_detection(self, position: Position, zone_id: str) -> Detection:
        unexpected = ["illegal_parking", "abnormal_stacking"]
        hazard_type = random.choice(unexpected)
        return self._create_detection(hazard_type, position, zone_id)
