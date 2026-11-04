import json
import logging
import os
import shutil
import tempfile
from copy import deepcopy
from datetime import datetime
from pathlib import Path

from data_types import ExerciseLibrary, WorkoutData
from exercise_library import DEFAULT_EXERCISES


DATA_FILE = Path(__file__).with_name("workout_data.json")
MAX_AUTOMATIC_BACKUPS = 10
logger = logging.getLogger(__name__)


def _backup_dir() -> Path:
    return DATA_FILE.with_name("workout_backups")


def validate_data(data: object) -> WorkoutData:
    if not isinstance(data, dict):
        raise ValueError("Workout data must be a JSON object.")

    workouts = data.get("workouts", [])
    stored_library = data.get("exercises", deepcopy(DEFAULT_EXERCISES))
    routines = data.get("routines", [])
    measurements = data.get("measurements", [])
    goals = data.get("goals", [])
    if (
        not isinstance(workouts, list)
        or not all(isinstance(item, dict) for item in workouts)
        or not isinstance(stored_library, dict)
        or not isinstance(routines, list)
        or not all(isinstance(item, dict) for item in routines)
        or not isinstance(measurements, list)
        or not all(isinstance(item, dict) for item in measurements)
        or not isinstance(goals, list)
        or not all(isinstance(item, dict) for item in goals)
    ):
        raise ValueError("Workout data has an invalid structure.")

    exercises: ExerciseLibrary = {}
    for category, names in stored_library.items():
        if not isinstance(category, str) or not isinstance(names, list):
            raise ValueError("Exercise categories must contain lists of names.")
        if not all(isinstance(name, str) for name in names):
            raise ValueError("Exercise names must be strings.")
        exercises[category] = list(dict.fromkeys(names))

    return {
        "workouts": workouts,
        "exercises": exercises,
        "routines": routines,
        "measurements": measurements,
        "goals": goals,
    }


def _read_file(path: Path) -> WorkoutData:
    with path.open("r", encoding="utf-8") as data_file:
        return validate_data(json.load(data_file))


def automatic_backups() -> list[Path]:
    backup_dir = _backup_dir()
    if not backup_dir.exists():
        return []
    return sorted(backup_dir.glob("workout_data_*.json"), reverse=True)


def load_data() -> WorkoutData:
    if not DATA_FILE.exists():
        for backup_path in automatic_backups():
            try:
                recovered = _read_file(backup_path)
                save_data(recovered, create_backup=False)
                logger.warning("Recovered missing workout data from automatic backup %s", backup_path)
                return recovered
            except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as backup_error:
                logger.error("Automatic backup %s is unusable: %s", backup_path, backup_error)
        return {
            "workouts": [],
            "exercises": deepcopy(DEFAULT_EXERCISES),
            "routines": [],
            "measurements": [],
            "goals": [],
        }

    try:
        return _read_file(DATA_FILE)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
        logger.error("Could not read workout data at %s: %s", DATA_FILE, error)
        for backup_path in automatic_backups():
            try:
                recovered = _read_file(backup_path)
                save_data(recovered, create_backup=False)
                logger.warning("Recovered workout data from automatic backup %s", backup_path)
                return recovered
            except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as backup_error:
                logger.error("Automatic backup %s is unusable: %s", backup_path, backup_error)
        raise ValueError(
            "Workout data is damaged and no valid automatic backup could be recovered."
        ) from error


def save_data(data: WorkoutData, create_backup: bool = True) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if create_backup and DATA_FILE.exists():
        backup_dir = _backup_dir()
        backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        backup_path = backup_dir / f"workout_data_{timestamp}.json"
        shutil.copy2(DATA_FILE, backup_path)
        for obsolete in automatic_backups()[MAX_AUTOMATIC_BACKUPS:]:
            obsolete.unlink()

    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=DATA_FILE.parent,
            prefix=f"{DATA_FILE.name}.",
            suffix=".tmp",
            delete=False,
        ) as data_file:
            temporary_path = Path(data_file.name)
            json.dump(data, data_file, indent=4)
            data_file.flush()
            os.fsync(data_file.fileno())
        os.replace(temporary_path, DATA_FILE)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
