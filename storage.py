import json
import logging
import os
import shutil
import sqlite3
import tempfile
from copy import deepcopy
from datetime import datetime
from pathlib import Path

from data_types import ExerciseLibrary, WorkoutData
from exercise_library import DEFAULT_EXERCISES


DATA_FILE = Path(__file__).with_name("workout_data.json")
MAX_AUTOMATIC_BACKUPS = 10
SQLITE_FILE_NAME = "irontrack.sqlite3"
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


def _legacy_load_data() -> WorkoutData:
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


def _legacy_save_data(data: WorkoutData, create_backup: bool = True) -> None:
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


# SQLite persistence layer. The JSON functions above are retained for legacy
# backup files and migration compatibility; routes continue using load_data and
# save_data, so the storage format can change without touching the UI.
def _database_file() -> Path:
    return DATA_FILE.with_name(SQLITE_FILE_NAME)


def _empty_data() -> WorkoutData:
    return {
        "workouts": [],
        "exercises": deepcopy(DEFAULT_EXERCISES),
        "routines": [],
        "measurements": [],
        "goals": [],
    }


def _connect_database() -> sqlite3.Connection:
    database_file = _database_file()
    database_file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_file)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    return connection


def _read_database() -> WorkoutData:
    connection = _connect_database()
    try:
        row = connection.execute(
            "SELECT data_json FROM app_state WHERE id = 1"
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        return _empty_data()
    return validate_data(json.loads(row["data_json"]))


def _write_database(data: WorkoutData) -> None:
    payload = json.dumps(data, separators=(",", ":"))
    connection = _connect_database()
    try:
        connection.execute(
            """
            INSERT INTO app_state (id, data_json, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                data_json = excluded.data_json,
                updated_at = excluded.updated_at
            """,
            (payload, datetime.now().isoformat(timespec="seconds")),
        )
        connection.commit()
    finally:
        connection.close()


def _write_json_mirror(data: WorkoutData) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
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


def _recover_from_backups() -> WorkoutData | None:
    for backup_path in automatic_backups():
        try:
            recovered = _read_file(backup_path)
            _write_database(recovered)
            _write_json_mirror(recovered)
            logger.warning("Recovered workout data from automatic backup %s", backup_path)
            return recovered
        except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError, sqlite3.Error) as backup_error:
            logger.error("Automatic backup %s is unusable: %s", backup_path, backup_error)
    return None


def load_data() -> WorkoutData:
    database_file = _database_file()
    if not database_file.exists():
        if DATA_FILE.exists():
            try:
                migrated = _read_file(DATA_FILE)
                _write_database(migrated)
                logger.info("Migrated workout data from %s to %s", DATA_FILE, database_file)
                return migrated
            except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
                logger.error("Could not migrate workout data at %s: %s", DATA_FILE, error)
        recovered = _recover_from_backups()
        if recovered is not None:
            return recovered
        empty = _empty_data()
        # Create the SQLite schema, but defer the first state row until the
        # first actual save so an empty launch does not create a backup entry.
        connection = _connect_database()
        connection.close()
        return empty

    # During the transition, a newer legacy JSON file is treated as an explicit
    # manual edit and imported into SQLite. This also preserves old recovery
    # workflows that write directly to DATA_FILE.
    if DATA_FILE.exists() and DATA_FILE.stat().st_mtime_ns > database_file.stat().st_mtime_ns:
        try:
            edited = _read_file(DATA_FILE)
            _write_database(edited)
            return edited
        except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
            logger.error("Could not read legacy workout data at %s: %s", DATA_FILE, error)
            recovered = _recover_from_backups()
            if recovered is not None:
                return recovered

    try:
        return _read_database()
    except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError, sqlite3.Error) as error:
        logger.error("Could not read SQLite workout data at %s: %s", database_file, error)
        recovered = _recover_from_backups()
        if recovered is not None:
            return recovered
        raise ValueError(
            "Workout data is damaged and no valid automatic backup could be recovered."
        ) from error


def save_data(data: WorkoutData, create_backup: bool = True) -> None:
    validated = validate_data(data)
    database_file = _database_file()
    if create_backup and database_file.exists() and DATA_FILE.exists():
        try:
            current = _read_database()
            backup_dir = _backup_dir()
            backup_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            backup_path = backup_dir / f"workout_data_{timestamp}.json"
            with backup_path.open("w", encoding="utf-8") as backup_file:
                json.dump(current, backup_file, indent=4)
            for obsolete in automatic_backups()[MAX_AUTOMATIC_BACKUPS:]:
                obsolete.unlink()
        except (OSError, sqlite3.Error, ValueError) as error:
            logger.warning("Could not create automatic backup before SQLite save: %s", error)

    _write_database(validated)
    # Keep a human-readable copy for portability and a safe rollback path.
    _write_json_mirror(validated)
