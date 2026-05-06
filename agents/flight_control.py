from models.types import Waypoint, Position
from models.state import InspectionState


class FlightControlAgent:
    def update_drone_position(self, state: InspectionState, waypoint_index: int) -> Position:
        if waypoint_index < len(state.flight_plan):
            return state.flight_plan[waypoint_index].position
        return state.drone_position

    def check_drone_status(self, state: InspectionState) -> dict:
        return {
            "status": state.drone_status,
            "battery": state.battery_level,
            "gps": state.gps_signal
        }

    def adjust_path(self, state: InspectionState, obstacle: dict) -> list:
        return state.flight_plan

    def execute_emergency_return(self, state: InspectionState) -> bool:
        state.drone_status = "emergency"
        return True
