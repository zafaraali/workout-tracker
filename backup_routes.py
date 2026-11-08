import datetime
import json
import math
import uuid
import csv
import io

from flask import Response, flash, redirect, render_template, request, send_file, session, url_for

from storage import automatic_backups, database_backup_bytes, load_data, save_data, validate_data


from routing import main
from routine_routes import _validated_routine_exercises


from workout_domain import _reject_json_constant, _merge_backup_data, _validated_backup_data


def _csv_field(row, *names):
    normalized = {str(key).strip().casefold(): value for key, value in row.items()}
    for name in names:
        value = normalized.get(name.casefold())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _decode_csv_upload(payload):
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV encoding is not supported.")


def _import_csv_date(value):
    value = value.strip()
    for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(value[:10], pattern).date().isoformat()
        except ValueError:
            continue
    raise ValueError("CSV contains an invalid date.")


def _import_csv_duration(row):
    seconds = _csv_field(row, "duration (seconds)", "duration_seconds", "seconds", "elapsed seconds")
    minutes = _csv_field(row, "duration", "duration (minutes)", "minutes")
    raw = seconds or minutes
    if not raw:
        return ""
    try:
        if seconds:
            return str(max(1, math.ceil(float(raw) / 60)))
        if ":" in raw:
            parts = [int(part) for part in raw.split(":")]
            if len(parts) == 2:
                return str(max(1, math.ceil((parts[0] * 60 + parts[1]) / 60)))
            if len(parts) == 3:
                return str(max(1, math.ceil((parts[0] * 3600 + parts[1] * 60 + parts[2]) / 60)))
        return str(max(1, int(float(raw))))
    except (ValueError, TypeError, OverflowError):
        raise ValueError("CSV contains an invalid cardio duration.")


def _exercise_alias_key(value):
    tokens = str(value).casefold().replace("-", " ").replace("_", " ").split()
    aliases = {
        "db": "dumbbell", "dumbbells": "dumbbell", "bb": "barbell",
        "bbs": "barbell", "ohp": "overhead", "dl": "deadlift",
    }
    return " ".join(aliases.get(token, token) for token in tokens)


def _match_library_exercise(name, exercises):
    target = _exercise_alias_key(name)
    for category, names in exercises.items():
        for existing in names:
            if _exercise_alias_key(existing) == target:
                return category, existing
    return None, name


@main.route("/restore_automatic_backup", methods=["POST"])
def restore_automatic_backup():
    selected_name = request.form.get("backup_name", "")
    backup_path = next(
        (path for path in automatic_backups() if path.name == selected_name), None
    )
    if backup_path is None:
        flash("The selected automatic backup could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))
    try:
        with backup_path.open("r", encoding="utf-8") as backup_file:
                restored = validate_data(json.load(backup_file))
        save_data(restored)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError, ValueError):
        flash("The selected automatic backup is damaged and was not restored.", "error")
        return redirect(url_for("main.index", tab="history"))
    flash(f"Restored automatic backup {backup_path.name}.", "success")
    return redirect(url_for("main.index", tab="history"))


def _csv_safe(value):
    text = "" if value is None else str(value)
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text
    return text


@main.route("/export/workouts.csv")
def export_workouts_csv():
    data = load_data()
    columns = [
        "date", "session_name", "muscle", "exercise", "set_type",
        "weight", "bodyweight", "unit", "reps", "rpe", "distance", "distance_unit",
        "duration", "notes", "superset_group", "elapsed_seconds",
    ]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    for workout in data["workouts"]:
        writer.writerow(_csv_safe(workout.get(column, "")) for column in columns)
    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=workouts_{datetime.date.today().isoformat()}.csv"},
    )


@main.route("/import/workouts.csv", methods=["POST"])
def import_workouts_csv():
    uploaded_file = request.files.get("workouts_file")
    if uploaded_file is None or not uploaded_file.filename:
        flash("Select a workout CSV file to import.", "error")
        return redirect(url_for("main.index", tab="history"))
    try:
        content = _decode_csv_upload(uploaded_file.read())
        try:
            dialect = csv.Sniffer().sniff(content[:4096], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.DictReader(io.StringIO(content), dialect=dialect))
        if not rows or len(rows) > 10000:
            raise ValueError("The CSV is empty or contains too many rows.")
        data = load_data()
        exercises = {category: list(names) for category, names in data["exercises"].items()}
        category_lookup = {
            name.casefold(): category
            for category, names in exercises.items()
            for name in names
        }
        imported_workouts = []
        session_ids = {}
        for row_index, row in enumerate(rows):
            date = _import_csv_date(_csv_field(row, "date", "workout date", "start time"))
            exercise = _csv_field(row, "exercise name", "exercise", "name")[:100]
            if not exercise:
                raise ValueError("CSV contains a row without an exercise name.")
            matched_category, matched_exercise = _match_library_exercise(exercise, exercises)
            if matched_category:
                exercise = matched_exercise
            category = _csv_field(row, "muscle", "muscle group", "category", "body part") or matched_category or category_lookup.get(exercise.casefold(), "Imported")
            if category not in exercises:
                exercises[category] = []
            if exercise.casefold() not in {name.casefold() for name in exercises[category]}:
                exercises[category].append(exercise)
            raw_type = _csv_field(row, "set type", "type").casefold()
            set_type = {
                "warm up": "warmup", "warm-up": "warmup", "warmup": "warmup",
                "drop set": "drop", "drop": "drop", "failure": "failure",
                "to failure": "failure", "cardio": "cardio",
            }.get(raw_type, "working")
            weight_unit = _csv_field(row, "weight unit", "unit").casefold()
            unit = "lb" if weight_unit in {"lb", "lbs", "pound", "pounds"} else "kg"
            weight = _csv_field(row, "weight", "load") or "0"
            reps = _csv_field(row, "reps", "repetitions") or "1"
            distance = _csv_field(row, "distance")
            duration = _import_csv_duration(row)
            if distance or duration and not _csv_field(row, "reps", "repetitions"):
                set_type = "cardio"
            session_name = _csv_field(row, "workout name", "workout", "title") or "Imported workout"
            session_key = (date, session_name)
            session_id = session_ids.setdefault(session_key, str(uuid.uuid4()))
            entry = {
                "date": date, "session_id": session_id, "session_name": session_name[:100],
                "entry_id": str(uuid.uuid4()), "muscle": category, "exercise": exercise,
                "set_type": set_type, "weight": weight, "unit": unit, "reps": reps,
                "bodyweight": str(weight).strip() in {"0", "0.0"} and not _csv_field(row, "bodyweight").casefold() in {"false", "no", "0"},
                "rpe": _csv_field(row, "rpe", "rir") or "7", "distance": distance,
                "distance_unit": "mi" if _csv_field(row, "distance unit").casefold() in {"mi", "mile", "miles"} else "km",
                "duration": duration, "notes": _csv_field(row, "notes", "note")[:500],
            }
            imported_workouts.append(entry)
        imported = {"workouts": imported_workouts, "exercises": exercises, "routines": [], "measurements": [], "goals": []}
        validated = _validated_backup_data(imported)
        merged = _merge_backup_data(data, validated)
        save_data(merged)
    except (UnicodeDecodeError, ValueError, TypeError, OverflowError):
        flash("The workout CSV could not be imported. Check its date, exercise, weight, and rep columns.", "error")
        return redirect(url_for("main.index", tab="history"))
    flash(f"Imported {len(imported_workouts)} workout set(s) from CSV.", "success")
    return redirect(url_for("main.index", tab="history"))


@main.route("/import/workouts/<source>", methods=["POST"])
def import_external_workouts(source):
    labels = {"strong": "Strong", "hevy": "Hevy", "fitnotes": "FitNotes"}
    source = source.casefold()
    if source not in labels:
        flash("Unsupported workout export format.", "error")
        return redirect(url_for("main.index", tab="history"))
    uploaded_file = request.files.get("external_workouts_file")
    if uploaded_file is None or not uploaded_file.filename:
        flash(f"Select a {labels[source]} CSV export.", "error")
        return redirect(url_for("main.index", tab="history"))

    try:
        content = _decode_csv_upload(uploaded_file.read())
        rows = list(csv.DictReader(io.StringIO(content)))
        if not rows or len(rows) > 10000:
            raise ValueError("The export is empty or too large.")
        data = load_data()
        exercises = {category: list(names) for category, names in data["exercises"].items()}
        imported_workouts = []
        session_ids = {}
        profile_id = session.get("profile_id", "default")
        for row_index, row in enumerate(rows):
            date = _import_csv_date(_csv_field(row, "date", "start_time", "start date", "workout date"))
            exercise = _csv_field(row, "exercise name", "exercise_title", "exercise", "name")[:100]
            if not exercise:
                raise ValueError("The export contains a row without an exercise name.")
            matched_category, matched_exercise = _match_library_exercise(exercise, exercises)
            if matched_category:
                exercise = matched_exercise
            category = _csv_field(row, "muscle", "muscle group", "category", "body part") or matched_category or "Imported"
            exercises.setdefault(category, [])
            if exercise.casefold() not in {name.casefold() for name in exercises[category]}:
                exercises[category].append(exercise)
            workout_name = _csv_field(row, "workout name", "workout", "title") or f"Imported {labels[source]} workout"
            session_key = (date, workout_name)
            session_id = session_ids.setdefault(session_key, str(uuid.uuid4()))
            raw_type = _csv_field(row, "set type", "set_type", "set type name").casefold()
            set_type = {"warm up": "warmup", "warm-up": "warmup", "warmup": "warmup", "drop set": "drop", "drop": "drop", "failure": "failure", "to failure": "failure", "cardio": "cardio"}.get(raw_type, "working")
            weight = _csv_field(row, "weight", "weight_kg", "load") or "0"
            unit = "lb" if _csv_field(row, "weight unit", "unit").casefold() in {"lb", "lbs", "pound", "pounds"} else "kg"
            reps = _csv_field(row, "reps", "repetitions") or "1"
            distance = _csv_field(row, "distance", "distance_km")
            duration = _import_csv_duration(row)
            if distance or (duration and not _csv_field(row, "reps", "repetitions")):
                set_type = "cardio"
            entry_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"irontrack:{source}:{row_index}:{date}:{workout_name}:{exercise}:{weight}:{reps}"))
            imported_workouts.append({"date": date, "session_id": session_id, "session_name": workout_name[:100], "entry_id": entry_id, "profile_id": profile_id, "muscle": category, "exercise": exercise, "set_type": set_type, "weight": weight, "unit": unit, "reps": reps, "bodyweight": str(weight).strip() in {"0", "0.0"}, "rpe": _csv_field(row, "rpe", "rir") or "7", "distance": distance, "distance_unit": "mi" if _csv_field(row, "distance unit").casefold() in {"mi", "mile", "miles"} else "km", "duration": duration, "notes": _csv_field(row, "notes", "note", "description")[:500]})
        imported = {"workouts": imported_workouts, "exercises": exercises, "routines": [], "measurements": [], "goals": [], "nutrition": [], "profiles": data.get("profiles", [])}
        save_data(_merge_backup_data(data, _validated_backup_data(imported)))
    except (UnicodeDecodeError, ValueError, TypeError, OverflowError):
        flash(f"The {labels[source]} export could not be imported. Check its CSV format.", "error")
        return redirect(url_for("main.index", tab="history"))
    flash(f"Imported {len(imported_workouts)} set(s) from {labels[source]}.", "success")
    return redirect(url_for("main.index", tab="history"))


@main.route("/import/template/<source>.csv")
def import_template(source):
    columns = {
        "strong": ["Date", "Workout Name", "Exercise Name", "Weight", "Weight Unit", "Reps", "RPE", "Distance", "Distance Unit", "Duration", "Notes"],
        "hevy": ["start_time", "title", "exercise_title", "weight_kg", "reps", "rpe", "distance_km", "duration_seconds", "notes"],
        "fitnotes": ["Date", "Exercise", "Category", "Weight", "Reps", "Distance", "Time", "Notes"],
    }.get(source.casefold())
    if columns is None:
        return "Unsupported import template", 404
    output = io.StringIO(newline="")
    csv.writer(output).writerow(columns)
    return Response(output.getvalue(), mimetype="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={source.casefold()}_template.csv"})


@main.route("/export/measurements.csv")
def export_measurements_csv():
    data = load_data()
    columns = ["date", "body_weight", "unit", "waist", "chest", "hips", "notes"]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    for measurement in data["measurements"]:
        writer.writerow(_csv_safe(measurement.get(column, "")) for column in columns)
    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=measurements_{datetime.date.today().isoformat()}.csv"},
    )


@main.route("/export")
def export_backup():
    return Response(
        json.dumps(load_data(), indent=4),
        mimetype="application/json",
        headers={
            "Content-Disposition": (
                f"attachment; filename=gym_backup_{datetime.date.today().isoformat()}.json"
            )
        },
    )


@main.route("/export/irontrack.sqlite3")
def export_database():
    load_data()
    try:
        snapshot = database_backup_bytes()
    except ValueError:
        flash("The SQLite database failed its integrity check and was not exported.", "error")
        return redirect(url_for("main.index", tab="history"))
    return send_file(
        io.BytesIO(snapshot),
        as_attachment=True,
        download_name=f"irontrack_{datetime.date.today().isoformat()}.sqlite3",
        mimetype="application/vnd.sqlite3",
    )


@main.route("/export/routines.json")
def export_routines():
    return Response(
        json.dumps(load_data()["routines"], indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=irontrack_routines.json"},
    )


@main.route("/export/goals.json")
def export_goals():
    return Response(
        json.dumps(load_data()["goals"], indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=irontrack_goals.json"},
    )


@main.route("/import/routines", methods=["POST"])
def import_routines():
    data = load_data()
    uploaded_file = request.files.get("routines_file")
    if uploaded_file is None or not uploaded_file.filename:
        flash("Select a routines JSON file to import.", "error")
        return redirect(url_for("main.index", tab="routines"))
    try:
        imported = json.load(uploaded_file)
        if not isinstance(imported, list) or len(imported) > 500:
            raise ValueError("Invalid routines file.")
        routines = []
        for item in imported:
            if not isinstance(item, dict):
                raise ValueError("Invalid routine.")
            name = str(item.get("name", "")).strip()[:100]
            exercises = _validated_routine_exercises(item.get("exercises"), data["exercises"])
            if not name or not exercises:
                raise ValueError("Each routine must have a name and at least one valid exercise.")
            routines.append({"id": str(uuid.uuid4()), "name": name, "exercises": exercises})
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError, TypeError, OverflowError):
        flash("The routines file is invalid or contains exercises not in your library.", "error")
        return redirect(url_for("main.index", tab="routines"))

    data["routines"] = routines
    save_data(data)
    flash(f"Imported {len(routines)} routine(s), replacing the current routines.", "success")
    return redirect(url_for("main.index", tab="routines"))


@main.route("/import/goals", methods=["POST"])
def import_goals():
    data = load_data()
    uploaded_file = request.files.get("goals_file")
    if uploaded_file is None or not uploaded_file.filename:
        flash("Select a goals JSON file to import.", "error")
        return redirect(url_for("main.index", tab="measurements"))
    try:
        imported = json.load(uploaded_file)
        if not isinstance(imported, list) or len(imported) > 500:
            raise ValueError("Invalid goals file.")
        goals = []
        for item in imported:
            if not isinstance(item, dict):
                raise ValueError("Invalid goal.")
            metric = item.get("metric")
            unit = item.get("unit")
            direction = item.get("direction")
            target = float(item.get("target"))
            target_date = str(item.get("target_date", "")).strip()
            if (
                metric not in {"body_weight", "waist", "chest", "hips"}
                or (metric == "body_weight" and unit not in {"kg", "lb"})
                or (metric != "body_weight" and unit != "cm")
                or direction not in {"increase", "decrease"}
                or (metric != "body_weight" and direction == "increase")
                or not math.isfinite(target)
                or target <= 0
            ):
                raise ValueError("Invalid goal fields.")
            if target_date:
                datetime.date.fromisoformat(target_date)
            goal = {
                "id": str(uuid.uuid4()),
                "metric": metric,
                "target": str(target),
                "unit": unit,
                "direction": direction,
                "target_date": target_date,
            }
            if item.get("baseline") not in (None, ""):
                baseline = float(item["baseline"])
                if not math.isfinite(baseline) or baseline <= 0:
                    raise ValueError("Invalid goal baseline.")
                goal["baseline"] = str(baseline)
                goal["baseline_unit"] = item.get("baseline_unit", "")
            goals.append(goal)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError, TypeError, OverflowError):
        flash("The goals file is invalid.", "error")
        return redirect(url_for("main.index", tab="measurements"))

    data["goals"] = goals
    save_data(data)
    flash(f"Imported {len(goals)} goal(s), replacing the current goals.", "success")
    return redirect(url_for("main.index", tab="measurements"))


@main.route("/import", methods=["POST"])
def import_backup():
    file = request.files.get("backup_file")
    if file is None or not file.filename:
        flash("Select a JSON backup file to restore.", "error")
        return redirect(url_for("main.index", tab="history"))

    try:
        imported = json.load(file, parse_constant=_reject_json_constant)
        validated_data = _validated_backup_data(imported)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError, TypeError, OverflowError):
        flash("The backup is invalid. No data was changed.", "error")
        return redirect(url_for("main.index", tab="history"))

    current = load_data()
    merged = _merge_backup_data(current, validated_data)
    compatibility_notes = [
        f"This older backup has no {label}; the missing section will be treated as empty when replacing."
        for key, label in (
            ("routines", "routine list"),
            ("measurements", "measurement list"),
            ("goals", "goal list"),
        )
        if key not in imported
    ]
    return render_template(
        "backup_preview.html",
        imported=validated_data,
        current=current,
        merged=merged,
        compatibility_notes=compatibility_notes,
        backup_json=json.dumps(validated_data),
    )


@main.route("/import/confirm", methods=["POST"])
def confirm_backup_import():
    try:
        imported_json = request.form.get("backup_json", "")
        imported_value = json.loads(imported_json, parse_constant=_reject_json_constant)
        imported = _validated_backup_data(imported_value)
        mode = request.form.get("mode")
        if mode == "merge":
            imported = _merge_backup_data(load_data(), imported)
        elif mode != "replace":
            raise ValueError("Choose whether to merge or replace.")
    except (json.JSONDecodeError, ValueError, TypeError, OverflowError):
        flash("The backup preview is invalid or expired. No data was changed.", "error")
        return redirect(url_for("main.index", tab="history"))

    save_data(imported)
    flash(
        "Backup merged with current data." if mode == "merge" else "Backup restored, replacing current data.",
        "success",
    )
    return redirect(url_for("main.index", tab="history"))

