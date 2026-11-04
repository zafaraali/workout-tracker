from data_types import ExerciseLibrary


DEFAULT_EXERCISES: ExerciseLibrary = {
    "Chest": [
        "Barbell Bench Press",
        "Incline Dumbbell Press",
        "Push-ups",
        "Chest press machine",
        "Db press",
        "Machine flys",
    ],
    "Back": [
        "Pull-ups",
        "Barbell Row",
        "Lat Pulldown",
        "Weighted pullups",
        "Single arm cable rows",
        "Single arm pulldowns",
        "Single arm machine rows",
    ],
    "Legs": [
        "Barbell Squat",
        "Romanian Deadlift",
        "Leg Press",
        "Hack squats",
        "Leg curls",
        "Single leg ext",
        "Seated Calf raises",
        "Rdl",
        "Horizontal leg press",
        "Standing calf raises",
    ],
    "Shoulders": [
        "Overhead Press",
        "Lateral Raises",
        "Db ohp",
        "Cable lateral raises",
    ],
    "Arms": ["Barbell Curl", "Triceps Pushdown", "Db curls"],
    "Core": ["Plank", "Hanging Leg Raises", "Ab crunch", "Leg raises"],
}


def add_exercise(library: ExerciseLibrary, category: str, name: str) -> None:
    if category not in library:
        raise ValueError("Choose an existing category.")
    if any(name.casefold() == existing.casefold() for existing in library[category]):
        raise ValueError("That exercise already exists in this category.")
    library[category].append(name)


def update_exercise(
    library: ExerciseLibrary,
    old_category: str,
    old_name: str,
    new_category: str,
    new_name: str,
) -> None:
    if old_category not in library or old_name not in library[old_category]:
        raise ValueError("The exercise could not be found.")
    if new_category not in library:
        raise ValueError("Choose an existing category.")
    if any(
        name.casefold() == new_name.casefold()
        for name in library[new_category]
        if (new_category, name) != (old_category, old_name)
    ):
        raise ValueError("An exercise with that name already exists in this category.")

    old_index = library[old_category].index(old_name)
    library[old_category].pop(old_index)
    if new_category == old_category:
        library[new_category].insert(old_index, new_name)
    else:
        library[new_category].append(new_name)


def delete_exercise(library: ExerciseLibrary, category: str, name: str) -> None:
    if category not in library or name not in library[category]:
        raise ValueError("The exercise could not be found.")
    library[category].remove(name)
