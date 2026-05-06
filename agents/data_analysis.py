from typing import List, Dict
from models.types import Detection, Zone, InspectionReport


class DataAnalysisAgent:
    def aggregate_results(self, detections: List[Detection]) -> Dict[str, List[Detection]]:
        by_severity = {"critical": [], "warning": [], "info": []}
        by_type = {}
        by_zone = {}

        for d in detections:
            by_severity[d.severity].append(d)
            by_type.setdefault(d.detection_type, []).append(d)
            by_zone.setdefault(d.zone_id, []).append(d)

        return {
            "by_severity": by_severity,
            "by_type": by_type,
            "by_zone": by_zone,
        }

    def calculate_risk_scores(self, results: Dict, zones: List[Zone]) -> Dict[str, float]:
        zone_risks = {}
        by_zone = results.get("by_zone", {})

        for zone in zones:
            detections_in_zone = by_zone.get(zone.zone_id, [])
            if not detections_in_zone:
                zone_risks[zone.zone_id] = 0.0
            else:
                critical = sum(1 for d in detections_in_zone if d.severity == "critical")
                warning = sum(1 for d in detections_in_zone if d.severity == "warning")
                risk = min(1.0, (critical * 0.3 + warning * 0.1) / max(zone.inspection_priority, 1))
                zone_risks[zone.zone_id] = risk

        return zone_risks

    def generate_report(
        self,
        mission_id: str,
        scenario: str,
        duration_minutes: float,
        zones_inspected: int,
        total_detections: int,
        detections_by_severity: Dict[str, List],
        zone_risk_scores: Dict[str, float]
    ) -> InspectionReport:
        critical_count = len(detections_by_severity.get("critical", []))
        warning_count = len(detections_by_severity.get("warning", []))
        info_count = len(detections_by_severity.get("info", []))

        high_risk_zones = [zid for zid, score in zone_risk_scores.items() if score > 0.5]

        summary = f"{scenario.replace('_', ' ').title()} inspection completed with {total_detections} detections across {zones_inspected} zones. CRITICAL: {critical_count} safety violations require immediate attention."
        if high_risk_zones:
            summary += f" High-risk zones: {', '.join(high_risk_zones)}."

        recommendations = []
        if critical_count > 0:
            recommendations.append("Address critical safety violations immediately")
        if warning_count > 3:
            recommendations.append("Review warning-level items within 24 hours")
        if zone_risk_scores:
            max_risk_zone = max(zone_risk_scores, key=zone_risk_scores.get)
            if zone_risk_scores[max_risk_zone] > 0.6:
                recommendations.append(f"Increase inspection frequency for high-risk zone: {max_risk_zone}")

        return InspectionReport(
            mission_id=mission_id,
            scenario=scenario,
            timestamp="2026-05-06",
            duration_minutes=duration_minutes,
            zones_inspected=zones_inspected,
            total_detections=total_detections,
            detections_by_severity={
                "critical": critical_count,
                "warning": warning_count,
                "info": info_count
            },
            zone_risk_scores=zone_risk_scores,
            executive_summary=summary,
            recommendations=recommendations
        )

    def export_report(self, report: InspectionReport, format: str, filename: str) -> str:
        import json
        import os

        os.makedirs(os.path.dirname(filename), exist_ok=True)

        data = {
            "mission_id": report.mission_id,
            "scenario": report.scenario,
            "timestamp": report.timestamp,
            "duration_minutes": report.duration_minutes,
            "zones_inspected": report.zones_inspected,
            "total_detections": report.total_detections,
            "detections_by_severity": report.detections_by_severity,
            "zone_risk_scores": report.zone_risk_scores,
            "executive_summary": report.executive_summary,
            "recommendations": report.recommendations
        }

        with open(filename, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return filename
