import json
from copy import deepcopy
from pathlib import Path

from data_types import ExerciseLibrary, WorkoutData
from exercise_library import DEFAULT_EXERCISES


DATA_FILE = Path(__file__).with_name("workout_data.json")


def load_data() -> WorkoutData:
    if not DATA_FILE.exists():
        return {"workouts": [], "exercises": deepcopy(DEFAULT_EXERCISES)}

    with DATA_FILE.open("r", encoding="utf-8") as data_file:
        data = json.load(data_file)

    if not isinstance(data, dict):
        raise ValueError("Workout data must be a JSON object.")

    workouts = data.get("workouts", [])
    stored_library = data.get("exercises", deepcopy(DEFAULT_EXERCISES))
    if not isinstance(workouts, list) or not isinstance(stored_library, dict):
        raise ValueError("Workout data has an invalid structure.")

    exercises: ExerciseLibrary = {}
    for category, names in stored_library.items():
        if not isinstance(category, str) or not isinstance(names, list):
            raise ValueError("Exercise categories must contain lists of names.")
        if not all(isinstance(name, str) for name in names):
            raise ValueError("Exercise names must be strings.")
        exercises[category] = list(dict.fromkeys(names))

    return {"workouts": workouts, "exercises": exercises}


def save_data(data: WorkoutData) -> None:
    with DATA_FILE.open("w", encoding="utf-8") as data_file:
        json.dump(data, data_file, indent=4)
