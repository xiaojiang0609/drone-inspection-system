from typing import List
from models.types import Zone, Waypoint, Position


class TaskSchedulerAgent:
    def create_flight_plan(self, zones: List[Zone], scenario: str) -> List[Waypoint]:
        sorted_zones = sorted(zones, key=lambda z: -z.inspection_priority)

        waypoints = []
        for i, zone in enumerate(sorted_zones):
            hover_duration = 8.0 if scenario == "campus" else 10.0

            waypoint = Waypoint(
                waypoint_id=f"WP-{i+1:02d}",
                position=zone.center,
                hover_duration=hover_duration,
                inspection_types=zone.hazard_types,
                associated_zone_id=zone.zone_id,
                next_waypoint_id=f"WP-{i+2:02d}" if i < len(sorted_zones) - 1 else "WP-00"
            )
            waypoints.append(waypoint)

        return waypoints

    def validate_zones(self, zones: List[Zone]) -> dict:
        return {"valid": True, "zone_count": len(zones)}

    def estimate_duration(self, waypoints: List[Waypoint]) -> float:
        return len(waypoints) * 2.0

    def optimize_path(self, waypoints: List[Waypoint]) -> List[Waypoint]:
        return waypoints
