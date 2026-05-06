from typing import List
from models.types import Position, Detection


class VisualRecognitionAgent:
    def capture_frame(self, position: Position, heading: float) -> dict:
        return {
            "position": position,
            "heading": heading,
            "data": b"SIMULATED_FRAME"
        }

    def analyze_frame(self, frame: dict, zone_id: str, hazard_types: List[str], scenario: str) -> List[Detection]:
        from simulation.visual_simulator import VisualSimulator
        sim = VisualSimulator(scenario)
        position = frame.get("position", Position(0, 0, 0, 0))
        return sim.generate_detections(position, zone_id, hazard_types)

    def classify_risk(self, detection: Detection) -> str:
        return detection.severity

    def log_detection(self, state: dict, detection: Detection) -> None:
        state.setdefault("detected_objects", []).append(detection)
