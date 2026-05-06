import random
import math
from typing import List
from models.types import Position, Waypoint, Zone


class FlightSimulator:
    def __init__(self, flight_plan: List[Waypoint], start_position: Position):
        self.waypoints = flight_plan
        self.current_index = 0
        self.position = start_position
        self.battery = 100.0
        self.status = "idle"

    def start_mission(self) -> None:
        self.status = "flying"
        self.battery = 100.0

    def move_to_waypoint(self, waypoint: Waypoint) -> bool:
        distance = self._calculate_distance(self.position, waypoint.position)
        transit_time = distance / 10.0
        self._drain_battery(transit_time * 0.5)
        self.position = waypoint.position
        self.status = "hovering" if waypoint.hover_duration > 0 else "flying"
        self.current_index += 1
        return self.battery > 10.0

    def hover_and_capture(self, duration: float) -> dict:
        self._drain_battery(duration * 0.3)
        return {
            "position": self.position,
            "timestamp": "now",
            "metadata": {"hover_duration": duration}
        }

    def _calculate_distance(self, pos1: Position, pos2: Position) -> float:
        dlat = pos2.latitude - pos1.latitude
        dlng = pos2.longitude - pos1.longitude
        dalt = pos2.altitude - pos1.altitude
        return math.sqrt(dlat**2 + dlng**2 + dalt**2) * 111000

    def _drain_battery(self, amount: float) -> None:
        self.battery = max(0.0, self.battery - amount)
