CAMPUS_CONFIG = {
    "name": "Campus Inspection",
    "default_altitude": 50.0,
    "default_hover_duration": 8.0,
    "zones": [
        {
            "zone_id": "campus_main_gate",
            "name": "Main Entrance",
            "priority": 2,
            "hazard_types": ["illegal_parking"],
            "center": {"lat": 31.2304, "lng": 121.4737, "alt": 50.0},
        },
        {
            "zone_id": "campus_lab_block",
            "name": "Laboratory Block",
            "priority": 5,
            "hazard_types": ["no_hard_hat", "fire_hazard"],
            "center": {"lat": 31.2310, "lng": 121.4740, "alt": 50.0},
        },
        {
            "zone_id": "campus_parking",
            "name": "Parking Area",
            "priority": 2,
            "hazard_types": ["illegal_parking", "abnormal_stacking"],
            "center": {"lat": 31.2295, "lng": 121.4730, "alt": 50.0},
        },
        {
            "zone_id": "campus_sports_field",
            "name": "Sports Field",
            "priority": 1,
            "hazard_types": ["abnormal_stacking"],
            "center": {"lat": 31.2320, "lng": 121.4750, "alt": 50.0},
        },
    ],
}

CONSTRUCTION_CONFIG = {
    "name": "Construction Site Inspection",
    "default_altitude": 30.0,
    "default_hover_duration": 10.0,
    "zones": [
        {
            "zone_id": "site_entry",
            "name": "Site Entry/Exit",
            "priority": 5,
            "hazard_types": ["no_hard_hat"],
            "center": {"lat": 31.2300, "lng": 121.4740, "alt": 30.0},
        },
        {
            "zone_id": "site_material_storage",
            "name": "Material Storage",
            "priority": 4,
            "hazard_types": ["abnormal_stacking", "fire_hazard"],
            "center": {"lat": 31.2308, "lng": 121.4745, "alt": 30.0},
        },
        {
            "zone_id": "site_work_zone_a",
            "name": "Work Zone A",
            "priority": 5,
            "hazard_types": ["no_hard_hat", "missing_harness"],
            "center": {"lat": 31.2298, "lng": 121.4738, "alt": 30.0},
        },
        {
            "zone_id": "site_equipment_area",
            "name": "Equipment Area",
            "priority": 3,
            "hazard_types": ["abnormal_stacking", "fire_hazard"],
            "center": {"lat": 31.2312, "lng": 121.4752, "alt": 30.0},
        },
    ],
}
