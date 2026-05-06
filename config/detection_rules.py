DETECTION_PROBABILITIES = {
    "campus": {
        "no_hard_hat": 0.15,
        "fire_hazard": 0.05,
        "abnormal_stacking": 0.12,
        "illegal_parking": 0.20,
    },
    "construction_site": {
        "no_hard_hat": 0.25,
        "missing_harness": 0.20,
        "fire_hazard": 0.08,
        "abnormal_stacking": 0.18,
    },
}

SEVERITY_MAP = {
    "no_hard_hat": "critical",
    "missing_harness": "critical",
    "fire_hazard": "critical",
    "abnormal_stacking": "warning",
    "illegal_parking": "warning",
}

DESCRIPTIONS = {
    "no_hard_hat": "Person detected without required hard hat",
    "missing_harness": "Worker at elevated position without safety harness",
    "fire_hazard": "Potential fire hazard detected - requires immediate attention",
    "abnormal_stacking": "Objects stacked abnormally high or obstructing pathway",
    "illegal_parking": "Vehicle parked in prohibited area",
}
