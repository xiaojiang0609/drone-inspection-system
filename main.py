#!/usr/bin/env python3
"""
Drone Inspection System - Main Entry Point
Multi-Agent Drone Inspection for Campus and Construction Site Scenarios
"""

import os
from datetime import datetime
from models.types import Position, Zone, Waypoint, Detection, InspectionReport
from models.state import InspectionState
from config.scenarios import CAMPUS_CONFIG, CONSTRUCTION_CONFIG
from simulation.flight_simulator import FlightSimulator
from simulation.visual_simulator import VisualSimulator
from agents.task_scheduler import TaskSchedulerAgent
from agents.flight_control import FlightControlAgent
from agents.visual_recognition import VisualRecognitionAgent
from agents.data_analysis import DataAnalysisAgent


def load_zones(config: dict) -> list:
    zones = []
    for z in config["zones"]:
        center = z.get("center", {"lat": 31.23, "lng": 121.47, "alt": 50.0})
        zones.append(Zone(
            zone_id=z["zone_id"],
            name=z["name"],
            boundary=[],
            center=Position(
                latitude=center["lat"],
                longitude=center["lng"],
                altitude=center["alt"],
                heading=0.0
            ),
            inspection_priority=z["priority"],
            hazard_types=z.get("hazard_types", []),
            area_km2=0.01
        ))
    return zones


def run_inspection_demo(scenario: str, config: dict):
    print(f"\n{'='*60}")
    print(f"  DRONE INSPECTION SYSTEM - {config['name'].upper()}")
    print(f"{'='*60}\n")

    mission_id = f"{scenario.upper()}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    zones = load_zones(config)

    print(f"[INIT] Mission ID: {mission_id}")
    print(f"[INIT] Scenario: {scenario}")
    print(f"[INIT] Zones to inspect: {len(zones)}")
    for z in zones:
        print(f"       - {z.name} (priority: {z.inspection_priority})")

    # Phase 1: Task Scheduling
    print(f"\n{'='*60}")
    print("  PHASE 1: TASK SCHEDULING")
    print(f"{'='*60}")

    scheduler = TaskSchedulerAgent()
    flight_plan = scheduler.create_flight_plan(zones, scenario)

    print(f"[SCHEDULER] Generated {len(flight_plan)} waypoints")
    for i, wp in enumerate(flight_plan):
        print(f"       Waypoint {i+1}: {wp.associated_zone_id} (hover: {wp.hover_duration}s)")

    # Initialize simulators
    start_pos = flight_plan[0].position if flight_plan else Position(31.23, 121.47, 50.0, 0.0)
    flight_sim = FlightSimulator(flight_plan, start_pos)
    visual_sim = VisualSimulator(scenario)

    # Phase 2: Flight Execution & Visual Analysis
    print(f"\n{'='*60}")
    print("  PHASE 2: FLIGHT EXECUTION & VISUAL ANALYSIS")
    print(f"{'='*60}")

    flight_sim.start_mission()
    all_detections = []
    state = InspectionState()
    state.scenario = scenario
    state.mission_id = mission_id
    state.drone_position = start_pos

    flight_control = FlightControlAgent()
    visual_agent = VisualRecognitionAgent()

    for i, waypoint in enumerate(flight_plan):
        print(f"\n[*] Moving to waypoint {i+1}/{len(flight_plan)}: {waypoint.associated_zone_id}")

        success = flight_sim.move_to_waypoint(waypoint)
        if not success:
            print(f"[!] Low battery - returning home")
            break

        print(f"    Position: {flight_sim.position}")
        print(f"    Battery: {flight_sim.battery:.1f}%")

        state.drone_position = flight_sim.position
        state.battery_level = flight_sim.battery
        state.drone_status = flight_sim.status

        if waypoint.hover_duration > 0:
            print(f"    Hovering for {waypoint.hover_duration}s for visual inspection...")
            frame = flight_sim.hover_and_capture(waypoint.hover_duration)

            zone = next((z for z in zones if z.zone_id == waypoint.associated_zone_id), None)
            if zone:
                detections = visual_sim.generate_detections(
                    flight_sim.position,
                    waypoint.associated_zone_id,
                    zone.hazard_types
                )
                all_detections.extend(detections)

                if detections:
                    print(f"    [!] DETECTIONS ({len(detections)}):")
                    for d in detections:
                        print(f"        - {d.description} [{d.severity.upper()}]")
                else:
                    print(f"    [+] No violations detected")

    # Phase 3: Data Analysis & Report
    print(f"\n{'='*60}")
    print("  PHASE 3: DATA ANALYSIS & REPORT GENERATION")
    print(f"{'='*60}")

    analysis_agent = DataAnalysisAgent()

    aggregation = analysis_agent.aggregate_results(all_detections)
    print(f"\n[ANALYSIS] Detection Summary:")
    for severity, items in aggregation.get("by_severity", {}).items():
        print(f"    {severity.upper()}: {len(items)}")

    risk_scores = analysis_agent.calculate_risk_scores(aggregation, zones)
    print(f"\n[ANALYSIS] Risk Scores by Zone:")
    for zone_id, score in risk_scores.items():
        zone_name = next((z.name for z in zones if z.zone_id == zone_id), zone_id)
        risk_bar = "=" * int(score * 10) + "-" * (10 - int(score * 10))
        print(f"    {zone_name}: [{risk_bar}] {score:.2f}")

    report = analysis_agent.generate_report(
        mission_id=mission_id,
        scenario=scenario,
        duration_minutes=len(flight_plan) * 2,
        zones_inspected=len(zones),
        total_detections=len(all_detections),
        detections_by_severity=aggregation.get("by_severity", {}),
        zone_risk_scores=risk_scores
    )

    print(f"\n[REPORT] Executive Summary:")
    print(f"    {report.executive_summary}")

    os.makedirs("reports", exist_ok=True)
    report_filename = f"reports/{mission_id}.json"
    analysis_agent.export_report(report, "json", report_filename)
    print(f"\n[REPORT] Saved to: {report_filename}")

    return report


def main():
    campus_report = run_inspection_demo("campus", CAMPUS_CONFIG)
    construction_report = run_inspection_demo("construction_site", CONSTRUCTION_CONFIG)

    print(f"\n{'='*60}")
    print("  DEMO COMPLETE")
    print(f"{'='*60}")
    print(f"\nGenerated {len([campus_report, construction_report])} inspection reports")


if __name__ == "__main__":
    main()
