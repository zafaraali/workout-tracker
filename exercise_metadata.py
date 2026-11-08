"""Small, editable metadata layer for the exercise library."""


def metadata_for(category: str, exercise: str) -> dict[str, str]:
    name = exercise.casefold()
    if "bodyweight" in name or "push-up" in name or "pull-up" in name or "plank" in name:
        equipment = "Bodyweight"
    elif "cable" in name:
        equipment = "Cable"
    elif "machine" in name or "fly" in name:
        equipment = "Machine"
    elif "dumbbell" in name or name.startswith("db "):
        equipment = "Dumbbells"
    elif "barbell" in name or "squat" in name or "deadlift" in name:
        equipment = "Barbell"
    else:
        equipment = "Free weights or machine"

    movement = {
        "Chest": "Push",
        "Back": "Pull",
        "Legs": "Lower body",
        "Shoulders": "Shoulder press or raise",
        "Arms": "Isolation",
        "Core": "Core stability",
    }.get(category, "Strength")
    return {"equipment": equipment, "movement": movement}


def library_metadata(exercises: dict[str, list[str]]) -> dict[str, dict[str, dict[str, str]]]:
    return {
        category: {exercise: metadata_for(category, exercise) for exercise in names}
        for category, names in exercises.items()
    }
