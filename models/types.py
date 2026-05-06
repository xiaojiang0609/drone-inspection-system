from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime


@dataclass
class Position:
    latitude: float
    longitude: float
    altitude: float
    heading: float

    def __str__(self):
        return f"{self.latitude:.4f}, {self.longitude:.4f}, {self.altitude:.1f}m"


@dataclass
class Zone:
    zone_id: str
    name: str
    boundary: List[Position] = field(default_factory=list)
    center: Position = None
    inspection_priority: int = 3
    hazard_types: List[str] = field(default_factory=list)
    area_km2: float = 0.01


@dataclass
class Waypoint:
    waypoint_id: str
    position: Position
    hover_duration: float
    inspection_types: List[str] = field(default_factory=list)
    associated_zone_id: str = ""
    next_waypoint_id: Optional[str] = None


@dataclass
class Detection:
    detection_id: str
    timestamp: datetime
    position: Position
    zone_id: str
    category: str
    detection_type: str
    severity: str
    description: str
    confidence: float = 0.95


@dataclass
class RiskPoint:
    position: Position
    risk_level: float
    zone_id: str
    associated_detection_ids: List[str] = field(default_factory=list)
    recommendation: str = ""


@dataclass
class InspectionReport:
    mission_id: str
    scenario: str
    timestamp: str
    duration_minutes: float
    zones_inspected: int
    total_detections: int
    detections_by_severity: Dict[str, int]
    zone_risk_scores: Dict[str, float]
    executive_summary: str
    recommendations: List[str] = field(default_factory=list)
