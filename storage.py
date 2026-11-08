import json
import logging
import os
import sqlite3
import tempfile
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime
from pathlib import Path

from data_types import ExerciseLibrary, WorkoutData
from exercise_library import DEFAULT_EXERCISES


DATA_FILE = Path(os.environ.get("IRONTRACK_DATA_DIR", Path(__file__).parent)) / "workout_data.json"
MAX_AUTOMATIC_BACKUPS = 10
SQLITE_FILE_NAME = "irontrack.sqlite3"
logger = logging.getLogger(__name__)
_transaction = ContextVar("storage_transaction", default=None)


@contextmanager
def write_transaction():
    """Serialize the entire read/modify/write operation across server workers."""
    load_data()  # Complete legacy migration before acquiring the write lock.
    connection = _connect_database()
    state = {"connection": connection, "pending": None}
    token = _transaction.set(state)
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield
        connection.commit()
        if state["pending"] is not None:
            try:
                # A second lock prevents a delayed mirror write from replacing
                # the export of a newer committed request.
                connection.execute("BEGIN IMMEDIATE")
                _write_json_mirror(_data_from_tables(connection))
            except OSError:
                logger.exception("Database saved, but JSON export mirror could not be updated")
            finally:
                connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        _transaction.reset(token)
        connection.close()


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
    settings = data.get("settings", {"gym_name": "Home gym", "equipment": []})
    nutrition = data.get("nutrition", [])
    profiles = data.get("profiles", [{"id": "default", "name": "Default profile"}])
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
        or not isinstance(settings, dict)
        or not isinstance(nutrition, list) or not all(isinstance(item, dict) for item in nutrition)
        or not isinstance(profiles, list) or not all(isinstance(item, dict) for item in profiles)
    ):
        raise ValueError("Workout data has an invalid structure.")

    exercises: ExerciseLibrary = {}
    for category, names in stored_library.items():
        if not isinstance(category, str) or not isinstance(names, list):
            raise ValueError("Exercise categories must contain lists of names.")
        if not all(isinstance(name, str) for name in names):
            raise ValueError("Exercise names must be strings.")
        exercises[category] = list(dict.fromkeys(names))

    if not isinstance(settings.get("gym_name", "Home gym"), str) or not isinstance(settings.get("equipment", []), list):
        raise ValueError("Settings must contain a gym name and equipment list.")
    settings = {
        "gym_name": settings.get("gym_name", "Home gym").strip()[:100] or "Home gym",
        "equipment": list(dict.fromkeys(str(item).strip()[:80] for item in settings.get("equipment", []) if str(item).strip()))[:100],
    }
    profiles = [{"id": str(item.get("id", "")), "name": str(item.get("name", "")).strip()[:80]}
                for item in profiles if item.get("id") and str(item.get("name", "")).strip()]
    if not profiles:
        profiles = [{"id": "default", "name": "Default profile"}]
    profile_id = profiles[0]["id"]
    for record in [*workouts, *routines, *measurements, *goals, *nutrition]:
        record.setdefault("profile_id", profile_id)
    return {
        "workouts": workouts,
        "exercises": exercises,
        "routines": routines,
        "measurements": measurements,
        "goals": goals,
        "settings": settings,
        "nutrition": nutrition,
        "profiles": profiles,
    }


def _read_file(path: Path) -> WorkoutData:
    with path.open("r", encoding="utf-8") as data_file:
        return validate_data(json.load(data_file))


def automatic_backups() -> list[Path]:
    backup_dir = _backup_dir()
    if not backup_dir.exists():
        return []
    return sorted(backup_dir.glob("workout_data_*.json"), reverse=True)


def _database_file() -> Path:
    return DATA_FILE.with_name(SQLITE_FILE_NAME)


def database_path() -> Path:
    """Return the local SQLite database path for download/diagnostic routes."""
    return _database_file()


def database_backup_bytes() -> bytes:
    """Export a consistent SQLite snapshot even while another request saves."""
    source = _connect_database()
    destination = sqlite3.connect(":memory:")
    try:
        source.backup(destination)
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("The database backup failed its integrity check.")
        return destination.serialize()
    finally:
        destination.close()
        source.close()


def database_integrity_check() -> str:
    connection = _connect_database()
    try:
        return str(connection.execute("PRAGMA integrity_check").fetchone()[0])
    finally:
        connection.close()


def _empty_data() -> WorkoutData:
    return {
        "workouts": [],
        "exercises": deepcopy(DEFAULT_EXERCISES),
        "routines": [],
        "measurements": [],
        "goals": [],
        "settings": {"gym_name": "Home gym", "equipment": []},
        "nutrition": [],
        "profiles": [{"id": "default", "name": "Default profile"}],
    }


def _connect_database() -> sqlite3.Connection:
    database_file = _database_file()
    database_file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_file)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data_json TEXT NOT NULL,
                position INTEGER
            );
            CREATE TABLE IF NOT EXISTS routines (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                exercises_json TEXT NOT NULL,
                schedule_days_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS measurements (
                id TEXT PRIMARY KEY,
                data_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                data_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nutrition (
                id TEXT PRIMARY KEY,
                data_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS exercise_categories (
                category TEXT PRIMARY KEY,
                position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS exercises (
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (category, name),
                FOREIGN KEY (category) REFERENCES exercise_categories(category) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(workouts)")}
        if "position" not in columns:
            connection.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in connection.execute("PRAGMA table_info(workouts)")}
            if "position" not in columns:
                connection.execute("ALTER TABLE workouts ADD COLUMN position INTEGER")
                connection.execute("UPDATE workouts SET position = id")
        routine_columns = {row[1] for row in connection.execute("PRAGMA table_info(routines)")}
        if "profile_id" not in routine_columns:
            connection.execute("ALTER TABLE routines ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default'")
        connection.commit()
        return connection
    except BaseException:
        connection.close()
        raise


def _replace_tables(connection: sqlite3.Connection, data: WorkoutData) -> None:
    # Keep stable database rows and update only sets that actually changed.
    existing = {}
    for row in connection.execute("SELECT id, data_json, position FROM workouts"):
        entry = json.loads(row["data_json"])
        existing[entry.get("entry_id", f"legacy-set-{row['id']}")] = row
    retained = set()
    for position, entry in enumerate(data["workouts"]):
        if not entry.get("entry_id"):
            entry["entry_id"] = str(uuid.uuid4())
        key = entry["entry_id"]
        payload = json.dumps(entry, separators=(",", ":"))
        row = existing.get(key)
        if row is None:
            connection.execute("INSERT INTO workouts (data_json, position) VALUES (?, ?)", (payload, position))
        else:
            retained.add(key)
            if row["data_json"] != payload or row["position"] != position:
                connection.execute("UPDATE workouts SET data_json = ?, position = ? WHERE id = ?", (payload, position, row["id"]))
    for key, row in existing.items():
        if key not in retained:
            connection.execute("DELETE FROM workouts WHERE id = ?", (row["id"],))
    previous = _data_from_tables(connection)
    if connection.execute("SELECT 1 FROM metadata WHERE key = 'schema_version'").fetchone() is None:
        previous["exercises"] = {}
    if previous["routines"] != data["routines"]:
        connection.execute("DELETE FROM routines")
        connection.executemany(
            "INSERT INTO routines (id, name, exercises_json, schedule_days_json, profile_id) VALUES (?, ?, ?, ?, ?)",
            [
                (
                    routine.get("id") or f"legacy-routine-{index}",
                    routine.get("name", ""),
                    json.dumps(routine.get("exercises", []), separators=(",", ":")),
                    json.dumps(routine.get("schedule_days", []), separators=(",", ":")),
                    routine.get("profile_id", "default"),
                )
                for index, routine in enumerate(data["routines"])
            ],
        )
    if previous["measurements"] != data["measurements"]:
        connection.execute("DELETE FROM measurements")
        connection.executemany(
            "INSERT INTO measurements (id, data_json) VALUES (?, ?)",
            [
                (
                    measurement.get("id", f"legacy-measurement-{index}"),
                    json.dumps(measurement, separators=(",", ":")),
                )
                for index, measurement in enumerate(data["measurements"])
            ],
        )
    if previous["goals"] != data["goals"]:
        connection.execute("DELETE FROM goals")
        connection.executemany(
            "INSERT INTO goals (id, data_json) VALUES (?, ?)",
            [
                (
                    goal.get("id") or f"legacy-goal-{index}",
                    json.dumps(goal, separators=(",", ":")),
                )
                for index, goal in enumerate(data["goals"])
            ],
        )
    if previous.get("nutrition", []) != data.get("nutrition", []):
        connection.execute("DELETE FROM nutrition")
        connection.executemany(
            "INSERT INTO nutrition (id, data_json) VALUES (?, ?)",
            [(item.get("id", f"nutrition-{index}"), json.dumps(item, separators=(",", ":")))
             for index, item in enumerate(data.get("nutrition", []))],
        )
    if previous["exercises"] != data["exercises"]:
        connection.execute("DELETE FROM exercises")
        connection.execute("DELETE FROM exercise_categories")
        connection.executemany(
            "INSERT INTO exercise_categories (category, position) VALUES (?, ?)",
            [(category, index) for index, category in enumerate(data["exercises"])],
        )
        connection.executemany(
            "INSERT INTO exercises (category, name, position) VALUES (?, ?, ?)",
            [
                (category, name, index)
                for category, names in data["exercises"].items()
                for index, name in enumerate(names)
            ],
        )
    connection.execute(
        "INSERT INTO metadata (key, value) VALUES ('settings_json', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (json.dumps({**data.get("settings", {}), "profiles": data.get("profiles", [])}, separators=(",", ":")),),
    )
    connection.execute(
        "INSERT INTO metadata (key, value) VALUES ('schema_version', '3') "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )


def _data_from_tables(connection: sqlite3.Connection) -> WorkoutData:
    if connection.execute("SELECT 1 FROM metadata WHERE key = 'schema_version'").fetchone() is None:
        return _empty_data()
    workouts = []
    for row in connection.execute("SELECT id, data_json FROM workouts ORDER BY position, id"):
        entry = json.loads(row["data_json"])
        entry.setdefault("entry_id", f"legacy-set-{row['id']}")
        workouts.append(entry)
    routines = []
    for row in connection.execute("SELECT id, name, exercises_json, schedule_days_json, profile_id FROM routines ORDER BY rowid"):
        routine = {
            "id": row["id"],
            "name": row["name"],
            "exercises": json.loads(row["exercises_json"]),
        }
        schedule_days = json.loads(row["schedule_days_json"])
        if schedule_days:
            routine["schedule_days"] = schedule_days
        routine["profile_id"] = row["profile_id"] or "default"
        routines.append(routine)
    measurements = [json.loads(row["data_json"]) for row in connection.execute("SELECT data_json FROM measurements ORDER BY rowid")]
    goals = [json.loads(row["data_json"]) for row in connection.execute("SELECT data_json FROM goals ORDER BY rowid")]
    exercises = {}
    for category_row in connection.execute("SELECT category FROM exercise_categories ORDER BY position"):
        category = category_row["category"]
        exercises[category] = [
            row["name"]
            for row in connection.execute(
                "SELECT name FROM exercises WHERE category = ? ORDER BY position", (category,)
            )
        ]
    settings_row = connection.execute("SELECT value FROM metadata WHERE key = 'settings_json'").fetchone()
    return validate_data({
        "workouts": workouts,
        "exercises": exercises,
        "routines": routines,
        "measurements": measurements,
        "goals": goals,
        "settings": json.loads(settings_row["value"]) if settings_row else {"gym_name": "Home gym", "equipment": []},
        "nutrition": [json.loads(row["data_json"]) for row in connection.execute("SELECT data_json FROM nutrition ORDER BY rowid")],
        "profiles": json.loads(settings_row["value"]).get("profiles", [{"id": "default", "name": "Default profile"}]) if settings_row else [{"id": "default", "name": "Default profile"}],
    })


def _read_database() -> WorkoutData:
    state = _transaction.get()
    connection = state["connection"] if state else _connect_database()
    try:
        if not state:
            connection.execute("BEGIN")
        legacy_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_state'"
        ).fetchone()
        if legacy_table:
            row = connection.execute("SELECT data_json FROM app_state WHERE id = 1").fetchone()
            if row:
                migrated = validate_data(json.loads(row["data_json"]))
                _replace_tables(connection, migrated)
                connection.execute("DROP TABLE app_state")
                connection.commit()
                return migrated
        return _data_from_tables(connection)
    finally:
        if not state:
            connection.close()


def _write_database(data: WorkoutData) -> None:
    for entry in data["workouts"]:
        if not entry.get("entry_id"):
            entry["entry_id"] = str(uuid.uuid4())
    state = _transaction.get()
    if state:
        _replace_tables(state["connection"], data)
        state["pending"] = deepcopy(data)
        return
    connection = _connect_database()
    try:
        connection.execute("BEGIN")
        _replace_tables(connection, data)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
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
            try:
                connection = _connect_database()
                try:
                    healthy = connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                finally:
                    connection.close()
            except sqlite3.DatabaseError:
                healthy = False
            if not healthy and _database_file().exists():
                quarantine = _database_file().with_name(f"irontrack.corrupt.{uuid.uuid4().hex}.sqlite3")
                _database_file().rename(quarantine)
            _write_database(recovered)
            _write_json_mirror(recovered)
            logger.warning("Recovered workout data from automatic backup %s", backup_path)
            return recovered
        except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError, sqlite3.Error) as backup_error:
            logger.error("Automatic backup %s is unusable: %s", backup_path, backup_error)
    return None


def load_data() -> WorkoutData:
    if _transaction.get():
        return _read_database()
    database_file = _database_file()
    if not database_file.exists():
        if DATA_FILE.exists():
            try:
                connection = _connect_database()
                try:
                    connection.execute("BEGIN IMMEDIATE")
                    if connection.execute("SELECT 1 FROM metadata WHERE key = 'schema_version'").fetchone():
                        return _data_from_tables(connection)
                    migrated = _read_file(DATA_FILE)
                    _replace_tables(connection, migrated)
                    connection.commit()
                finally:
                    connection.close()
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
    if _transaction.get():
        return
    # Keep a human-readable export for portability.
    _write_json_mirror(validated)
