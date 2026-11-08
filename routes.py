import datetime
import json
import uuid
import calendar
from copy import deepcopy

from flask import current_app, flash, jsonify, redirect, render_template, request, session, abort, send_from_directory, url_for

from exercise_library import DEFAULT_EXERCISES, add_exercise, delete_exercise, update_exercise
from exercise_metadata import library_metadata
from storage import automatic_backups, database_integrity_check, database_path, load_data, save_data


from routing import main
from training_review import weekly_review


from workout_domain import _validated_workout, _workout_groups, _elapsed_seconds, _goal_progress, _training_insights


def _active_profile(data):
    profiles = data.get("profiles") or [{"id": "default", "name": "Default profile"}]
    valid_ids = {item.get("id") for item in profiles}
    profile_id = session.get("profile_id")
    if profile_id not in valid_ids:
        profile_id = profiles[0]["id"]
        session["profile_id"] = profile_id
    profile = next(item for item in profiles if item.get("id") == profile_id)
    return profile_id, profile.get("name", "Profile")


def _redirect_to_library():
    return redirect(url_for("main.index", tab="library"))


@main.route("/diagnostics")
def diagnostics():
    data = load_data()
    database = database_path()
    backup_paths = automatic_backups()
    try:
        integrity = database_integrity_check()
    except (OSError, ValueError):
        integrity = "unavailable"
    return render_template(
        "diagnostics.html",
        workout_count=len(data["workouts"]),
        routine_count=len(data["routines"]),
        measurement_count=len(data["measurements"]),
        exercise_count=sum(len(items) for items in data["exercises"].values()),
        database_path=str(database),
        database_size=database.stat().st_size if database.exists() else 0,
        database_integrity=integrity,
        backup_count=len(backup_paths),
        latest_backup=backup_paths[0].name if backup_paths else "None",
    )


@main.route("/switch_profile", methods=["POST"])
def switch_profile():
    data = load_data()
    profile_id = request.form.get("profile_id", "")
    if any(item.get("id") == profile_id for item in data.get("profiles", [])):
        session["profile_id"] = profile_id
    return redirect(request.referrer or url_for("main.index"))


@main.route("/create_profile", methods=["POST"])
def create_profile():
    data = load_data()
    name = request.form.get("name", "").strip()[:60]
    if not name:
        flash("Enter a profile name.", "error")
    else:
        profile = {"id": str(uuid.uuid4()), "name": name}
        data.setdefault("profiles", []).append(profile)
        save_data(data)
        session["profile_id"] = profile["id"]
        flash(f"Switched to {name}.", "success")
    return redirect(url_for("main.index"))


@main.route("/")
def index():
    data = load_data()
    active_profile_id, active_profile_name = _active_profile(data)
    selected_date = request.args.get("date", "").strip()
    selected_month = request.args.get("month", datetime.date.today().strftime("%Y-%m"))
    try:
        history_page = max(1, int(request.args.get("page", "1")))
    except ValueError:
        history_page = 1
    if selected_date:
        try:
            datetime.date.fromisoformat(selected_date)
        except ValueError:
            flash("Choose a valid date to filter workout history.", "error")
            selected_date = ""
    try:
        month_date = datetime.datetime.strptime(selected_month, "%Y-%m").date().replace(day=1)
    except ValueError:
        month_date = datetime.date.today().replace(day=1)
        selected_month = month_date.strftime("%Y-%m")

    profile_workouts = [item for item in data["workouts"] if item.get("profile_id", "default") == active_profile_id]
    profile_routines = [item for item in data["routines"] if item.get("profile_id", "default") == active_profile_id]
    profile_measurements = [item for item in data["measurements"] if item.get("profile_id", "default") == active_profile_id]
    profile_nutrition = [item for item in data.get("nutrition", []) if item.get("profile_id", "default") == active_profile_id]
    workouts = profile_workouts
    if selected_date:
        workouts = [workout for workout in workouts if workout.get("date") == selected_date]

    exercises = sorted(
        {
            workout.get("exercise", "")
            for workout in data["workouts"]
            if workout.get("exercise")
        },
        key=str.casefold,
    )
    calendar_start = month_date.weekday()
    days_in_month = calendar.monthrange(month_date.year, month_date.month)[1]
    workout_counts = {}
    for workout in data["workouts"]:
        workout_counts[workout.get("date", "")] = workout_counts.get(workout.get("date", ""), 0) + 1
    calendar_days = (
        [{"date": "", "day": "", "count": 0} for _ in range(calendar_start)]
        + [
            {
                "date": f"{month_date.year:04d}-{month_date.month:02d}-{day:02d}",
                "day": day,
                "count": workout_counts.get(
                    f"{month_date.year:04d}-{month_date.month:02d}-{day:02d}", 0
                ),
            }
            for day in range(1, days_in_month + 1)
        ]
    )
    while len(calendar_days) % 7:
        calendar_days.append({"date": "", "day": "", "count": 0})

    active_session_id = request.args.get("session_id", "").strip()
    all_workout_groups = _workout_groups(profile_workouts, selected_date)
    history_page_size = 20
    history_page_count = max(1, (len(all_workout_groups) + history_page_size - 1) // history_page_size)
    history_page = min(history_page, history_page_count)
    workout_groups = all_workout_groups[(history_page - 1) * history_page_size:history_page * history_page_size]
    training_insights = _training_insights(profile_workouts, datetime.date.today())
    measurements = list(reversed(profile_measurements))
    for measurement_index, measurement in enumerate(reversed(profile_measurements)):
        if not measurement.get("id"):
            measurements[measurement_index]["id"] = f"legacy-measurement-{len(data['measurements']) - measurement_index - 1}"
    active_session_sets = [
        {"index": index, "workout": workout}
        for index, workout in enumerate(data["workouts"])
        if active_session_id and workout.get("session_id") == active_session_id
    ]
    active_session_routine_id = next(
        (item["workout"].get("routine_id", "") for item in active_session_sets if item["workout"].get("routine_id")),
        "",
    )
    active_exercises = {}
    for item in active_session_sets:
        exercise_name = item["workout"].get("exercise", "Exercise")
        active_exercises.setdefault(exercise_name, []).append(item)
    active_session_volume = 0.0
    for item in active_session_sets:
        workout = item["workout"]
        if workout.get("set_type") == "cardio":
            continue
        try:
            weight = float(workout.get("weight", 0) or 0)
            reps = int(workout.get("reps", 0) or 0)
        except (TypeError, ValueError):
            continue
        if workout.get("unit", "kg") == "lb":
            weight *= 0.45359237
        active_session_volume += weight * reps
    routine_progress = {}
    for routine in profile_routines:
        routine_id = routine.get("id")
        planned_sets = sum(
            int(item.get("target_sets", 0) or 0) + int(item.get("warmup_sets", 0) or 0)
            for item in routine.get("exercises", [])
        )
        routine_workouts = [workout for workout in profile_workouts if workout.get("routine_id") == routine_id]
        session_keys = sorted(
            {(workout.get("date", ""), workout.get("session_id", "")) for workout in routine_workouts},
            reverse=True,
        )
        latest_key = session_keys[0] if session_keys else None
        latest_sets = [
            workout for workout in routine_workouts
            if latest_key and (workout.get("date", ""), workout.get("session_id", "")) == latest_key
        ]
        completed_sets = len(latest_sets)
        routine_progress[routine_id] = {
            "planned": planned_sets,
            "completed": completed_sets,
            "percent": round(min(100, completed_sets / planned_sets * 100)) if planned_sets else 0,
            "date": latest_key[0] if latest_key else "",
        }
    return render_template(
        "index.html",
        weekly_review=weekly_review(profile_workouts, profile_routines, datetime.date.today()),
        has_workouts=bool(profile_workouts),
        workouts=workouts,
        exercises=data["exercises"],
        exercise_metadata=library_metadata(data["exercises"]),
        exercise_names=exercises,
        workout_groups=workout_groups,
        history_page=history_page,
        history_page_count=history_page_count,
        progress_workouts=profile_workouts,
        training_insights=training_insights,
        settings=data.get("settings", {"gym_name": "Home gym", "equipment": []}),
        routines=profile_routines,
        measurements=measurements,
        goals=_goal_progress([item for item in data["goals"] if item.get("profile_id", "default") == active_profile_id], profile_measurements),
        nutrition=profile_nutrition,
        profiles=data.get("profiles", []),
        active_profile_id=active_profile_id,
        active_profile_name=active_profile_name,
        automatic_backups=[path.name for path in automatic_backups()],
        calendar_days=calendar_days,
        calendar_month=month_date.strftime("%B %Y"),
        calendar_month_value=selected_month,
        previous_month=(month_date - datetime.timedelta(days=1)).strftime("%Y-%m"),
        next_month=(month_date.replace(day=28) + datetime.timedelta(days=4)).replace(day=1).strftime("%Y-%m"),
        active_session_id=active_session_id,
        active_session_routine_id=active_session_routine_id,
        active_session_sets=active_session_sets,
        active_session_set_count=len(active_session_sets),
        active_session_exercise_count=len(active_exercises),
        active_session_volume=round(active_session_volume, 1),
        routine_progress=routine_progress,
        active_session_groups=[
            {
                "exercise": name,
                "sets": sets,
                "previous": next((entry for entry in sorted(
                    reversed(data["workouts"]), key=lambda entry: entry.get("date", ""), reverse=True
                ) if entry.get("exercise") == name and entry.get("session_id") != active_session_id), None),
                "superset_group": next(
                    (item["workout"].get("superset_group", "") for item in sets if item["workout"].get("superset_group")),
                    "",
                ),
            }
            for name, sets in active_exercises.items()
        ],
        active_session_duration=max(
            (_elapsed_seconds(item["workout"].get("elapsed_seconds", 0)) for item in active_session_sets),
            default=0,
        ),
        active_session_finished=bool(
            active_session_sets
            and all(item["workout"].get("finished") for item in active_session_sets)
        ),
        active_session_started=bool(active_session_sets),
        active_session_name=(
            active_session_sets[0]["workout"].get("session_name", "Workout")
            if active_session_sets else ""
        ),
        today=datetime.date.today().isoformat(),
        today_weekday=str(datetime.date.today().weekday()),
        selected_date=selected_date,
        selected_tab=request.args.get("tab", "log"),
    )


@main.route("/log", methods=["POST"])
def log_workout():
    data = load_data()
    entry_id = request.form.get("entry_id", "").strip()
    existing_entry = next((workout for workout in data["workouts"] if workout.get("entry_id") == entry_id), None) if entry_id else None
    if existing_entry:
        submitted = {key: request.form.get(key, "") for key in ("date", "exercise", "weight", "unit", "reps", "rpe", "set_type", "notes")}
        existing = {key: str(existing_entry.get(key, "")) for key in submitted}
        if submitted == existing:
            if request.headers.get("X-Offline-Sync"):
                return jsonify(ok=True, duplicate=True)
            return redirect(url_for("main.index", tab="history"))
        if request.headers.get("X-Offline-Sync"):
            return jsonify(ok=False, conflict=True, error="This set already exists with different values. Review the pending set before retrying."), 409
        flash("This workout set already exists with different values.", "error")
        return redirect(url_for("main.index", tab="history"))
    try:
        entry = _validated_workout(request.form, data["exercises"])
    except (ValueError, TypeError) as error:
        if request.headers.get("X-Offline-Sync"):
            return jsonify(ok=False, error=str(error)), 400
        flash("Enter a valid date, exercise, weight, reps, RPE, and unit.", "error")
        return redirect(url_for("main.index"))

    entry["session_id"] = request.form.get("session_id", "").strip() or str(uuid.uuid4())
    entry["session_name"] = request.form.get("session_name", "").strip()[:100] or "Workout"
    entry["entry_id"] = entry_id or str(uuid.uuid4())
    entry["profile_id"] = session.get("profile_id", "default")
    routine_id = request.form.get("routine_id", "").strip()
    routine_missing = bool(
        routine_id and not any(routine.get("id") == routine_id for routine in data["routines"])
    )
    if routine_id and not routine_missing:
        entry["routine_id"] = routine_id
        routine = next(routine for routine in data["routines"] if routine.get("id") == routine_id)
        slot = request.form.get("routine_slot", "").strip()
        original = request.form.get("routine_exercise", "").strip()
        if slot:
            try:
                slot = int(slot)
                planned = routine.get("exercises", [])[slot] if slot >= 0 else None
                if not planned or planned.get("exercise") != original:
                    raise ValueError("Routine target changed. Reload the routine before logging this set.")
            except (ValueError, IndexError, TypeError) as error:
                if request.headers.get("X-Offline-Sync"):
                    return jsonify(ok=False, error="Routine target changed. Reload the routine or remove its link in the pending-set editor."), 400
                flash("Routine target changed. Reload the routine before logging this set.", "error")
                return redirect(url_for("main.index"))
            entry["routine_slot"] = slot
            entry["routine_exercise"] = original
    is_new_personal_record = False
    if entry.get("set_type") not in {"cardio", "warmup"}:
        try:
            current_weight = float(entry.get("weight", 0) or 0)
            current_reps = int(entry.get("reps", 0) or 0)
            current_unit = entry.get("unit", "kg")
            current_kg = current_weight * (0.45359237 if current_unit == "lb" else 1)
            current_1rm = current_kg * (1 + current_reps / 30)
            previous = [
                workout for workout in data["workouts"]
                if workout.get("exercise") == entry.get("exercise")
                and workout.get("set_type") not in {"cardio", "warmup"}
            ]
            previous_metrics = []
            for workout in previous:
                weight = float(workout.get("weight", 0) or 0)
                reps = int(workout.get("reps", 0) or 0)
                weight *= 0.45359237 if workout.get("unit", "kg") == "lb" else 1
                previous_metrics.append((weight, weight * (1 + reps / 30)))
            is_new_personal_record = bool(previous_metrics) and (
                current_kg > max(metric[0] for metric in previous_metrics)
                or current_1rm > max(metric[1] for metric in previous_metrics)
            )
        except (TypeError, ValueError, ZeroDivisionError):
            is_new_personal_record = False

    data["workouts"].append(entry)
    save_data(data)
    if request.headers.get("X-Offline-Sync"):
        return jsonify(ok=True), 201
    if routine_missing:
        message = "Workout set recorded, but its routine was removed and could not be linked."
    elif is_new_personal_record:
        message = f"New personal record for {entry['exercise']}! Workout set recorded."
    else:
        message = "Workout set recorded."
    flash(message, "success")
    return redirect(
        url_for(
            "main.index",
            date=entry["date"],
            tab="log",
            session_id=entry["session_id"],
        )
    )


@main.route("/edit_workout/<int:index>", methods=["POST"])
@main.route("/sets/<entry_id>/edit", methods=["POST"])
def edit_workout(index=None, entry_id=None):
    data = load_data()
    if entry_id is not None:
        index = next((i for i, entry in enumerate(data["workouts"]) if entry.get("entry_id") == entry_id), -1)
    else:
        abort(409, description="Reload this page before changing a set.")
    if index < 0 or index >= len(data["workouts"]):
        flash("Workout set could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    try:
        updated = _validated_workout(request.form, data["exercises"])
    except (ValueError, TypeError):
        flash("Enter a valid date, exercise, weight, reps, RPE, and unit.", "error")
        return redirect(url_for("main.index", tab="history"))

    previous = data["workouts"][index]
    updated["session_id"] = previous.get("session_id", "")
    updated["entry_id"] = previous.get("entry_id", "")
    updated["session_name"] = request.form.get("session_name", "").strip()[:100] or "Workout"
    updated["elapsed_seconds"] = previous.get("elapsed_seconds", 0)
    updated["superset_group"] = previous.get("superset_group", "")
    updated["finished"] = previous.get("finished", False)
    for key in ("routine_id", "routine_slot", "routine_exercise"):
        if key in previous:
            updated[key] = previous[key]
    data["workouts"][index] = updated

    if previous.get("session_id"):
        for workout in data["workouts"]:
            if workout.get("session_id") == previous["session_id"]:
                workout["session_name"] = updated["session_name"]
                workout["date"] = updated["date"]
    save_data(data)
    flash("Workout set updated.", "success")
    return redirect(url_for("main.index", tab="history", date=updated["date"]))


@main.route("/delete_workout/<int:index>", methods=["POST"])
@main.route("/sets/<entry_id>/delete", methods=["POST"])
def delete_workout(index=None, entry_id=None):
    data = load_data()
    if entry_id is not None:
        index = next((i for i, entry in enumerate(data["workouts"]) if entry.get("entry_id") == entry_id), -1)
    else:
        abort(409, description="Reload this page before changing a set.")
    if index < 0 or index >= len(data["workouts"]):
        flash("Workout set could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    session.pop("deleted_sets", None)
    session["deleted_set"] = {"entry": data["workouts"][index], "position": index}
    del data["workouts"][index]
    save_data(data)
    flash("Workout set deleted.", "success")
    return redirect(url_for("main.index", tab="history"))


@main.route("/bulk_delete_workouts", methods=["POST"])
def bulk_delete_workouts():
    raw_ids = request.form.get("entry_ids", "")
    entry_ids = {value.strip() for value in raw_ids.split(",") if value.strip()}
    if not entry_ids:
        flash("Select at least one workout set first.", "error")
        return redirect(url_for("main.index", tab="history"))
    data = load_data()
    deleted = [
        {"entry": workout, "position": index}
        for index, workout in enumerate(data["workouts"])
        if workout.get("entry_id") in entry_ids
    ]
    if not deleted:
        flash("The selected workout sets could not be found. Reload and try again.", "error")
        return redirect(url_for("main.index", tab="history"))
    session.pop("deleted_set", None)
    session["deleted_sets"] = deleted
    data["workouts"] = [
        workout for workout in data["workouts"] if workout.get("entry_id") not in entry_ids
    ]
    save_data(data)
    flash(f"Deleted {len(deleted)} workout set(s).", "success")
    return redirect(url_for("main.index", tab="history"))


@main.route("/duplicate_workout/<int:index>", methods=["POST"])
@main.route("/sets/<entry_id>/duplicate", methods=["POST"])
def duplicate_workout(index=None, entry_id=None):
    data = load_data()
    if entry_id is not None:
        index = next((i for i, entry in enumerate(data["workouts"]) if entry.get("entry_id") == entry_id), -1)
    else:
        abort(409, description="Reload this page before changing a set.")
    if index < 0 or index >= len(data["workouts"]):
        flash("Workout set could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    original = data["workouts"][index]
    duplicate = dict(original)
    duplicate["date"] = request.form.get("date", "").strip()
    try:
        datetime.date.fromisoformat(duplicate["date"])
    except ValueError:
        flash("Choose a valid date for the copied set.", "error")
        return redirect(url_for("main.index", tab="history"))
    duplicate["session_id"] = str(uuid.uuid4())
    duplicate["session_name"] = (original.get("session_name") or "Workout")[:100]
    duplicate["entry_id"] = str(uuid.uuid4())
    duplicate["elapsed_seconds"] = 0
    duplicate["finished"] = False
    data["workouts"].append(duplicate)
    save_data(data)
    flash("Set copied to a new workout.", "success")
    return redirect(url_for("main.index", tab="history", date=duplicate["date"]))


@main.route("/duplicate_session", methods=["POST"])
def duplicate_session():
    data = load_data()
    session_id = request.form.get("session_id", "").strip()
    workout_date = request.form.get("date", "").strip()
    try:
        datetime.date.fromisoformat(workout_date)
    except ValueError:
        flash("Choose a valid date for the copied workout.", "error")
        return redirect(url_for("main.index", tab="history"))

    if session_id.startswith("legacy:"):
        source_date = session_id.removeprefix("legacy:")
        source = [
            item for item in data["workouts"]
            if not item.get("session_id") and item.get("date") == source_date
        ]
    else:
        source = [item for item in data["workouts"] if item.get("session_id") == session_id]
    if not source:
        flash("Workout could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    new_session_id = str(uuid.uuid4())
    for workout in source:
        duplicate = dict(workout)
        duplicate.update({
            "date": workout_date,
            "session_id": new_session_id,
            "session_name": f"{workout.get('session_name') or 'Workout'} (copy)"[:100],
            "entry_id": str(uuid.uuid4()),
            "elapsed_seconds": 0,
            "finished": False,
        })
        data["workouts"].append(duplicate)
    save_data(data)
    flash(f"Workout copied with {len(source)} set(s).", "success")
    return redirect(url_for("main.index", tab="history", date=workout_date))


@main.route("/edit_session", methods=["POST"])
def edit_session():
    data = load_data()
    session_id = request.form.get("session_id", "").strip()
    original_date = request.form.get("original_date", "").strip()
    name = request.form.get("session_name", "").strip()
    workout_date = request.form.get("date", "").strip()

    try:
        datetime.date.fromisoformat(workout_date)
    except ValueError:
        flash("Choose a valid date for the workout.", "error")
        return redirect(url_for("main.index", tab="history"))

    matching = [
        workout for workout in data["workouts"]
        if (
            workout.get("session_id") == session_id
            if not session_id.startswith("legacy:")
            else not workout.get("session_id") and workout.get("date") == original_date
        )
    ]
    if not matching:
        flash("Workout could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    workout_name = name[:100] or "Workout"
    for workout in matching:
        workout["date"] = workout_date
        workout["session_name"] = workout_name
    save_data(data)
    flash("Workout updated.", "success")
    return redirect(url_for("main.index", tab="history", date=workout_date))


@main.route("/delete_session", methods=["POST"])
def delete_session():
    data = load_data()
    session_id = request.form.get("session_id", "").strip()
    workout_date = request.form.get("date", "").strip()

    if not session_id or not workout_date:
        flash("Workout could not be identified.", "error")
        return redirect(url_for("main.index", tab="history"))

    if session_id.startswith("legacy:"):
        matching = lambda workout: (
            not workout.get("session_id") and workout.get("date") == workout_date
        )
    else:
        matching = lambda workout: workout.get("session_id") == session_id

    original_count = len(data["workouts"])
    deleted = [
        {"entry": workout, "position": index}
        for index, workout in enumerate(data["workouts"])
        if matching(workout)
    ]
    data["workouts"] = [
        workout for workout in data["workouts"] if not matching(workout)
    ]
    deleted_count = original_count - len(data["workouts"])
    if not deleted_count:
        flash("Workout could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    save_data(data)
    session.pop("deleted_set", None)
    session["deleted_sets"] = deleted
    flash(f"Workout deleted along with its {deleted_count} set(s).", "success")
    return redirect(url_for("main.index", tab="history"))


@main.route("/update_session_structure", methods=["POST"])
def update_session_structure():
    data = load_data()
    session_id = request.form.get("session_id", "").strip()
    session_workouts = [
        item for item in data["workouts"] if item.get("session_id") == session_id
    ]
    try:
        order = json.loads(request.form.get("exercise_order", "[]"))
        groups = json.loads(request.form.get("superset_groups", "{}"))
        current_exercises = list(dict.fromkeys(item.get("exercise", "") for item in session_workouts))
        if (
            not session_id
            or not session_workouts
            or not isinstance(order, list)
            or len(order) != len(current_exercises)
            or set(order) != set(current_exercises)
            or not isinstance(groups, dict)
        ):
            raise ValueError("Invalid workout exercise order.")
        if any(value not in {"", "A", "B", "C", "D", "E"} for value in groups.values()):
            raise ValueError("Invalid superset group.")
    except (ValueError, TypeError, json.JSONDecodeError):
        flash("Workout structure could not be updated.", "error")
        return redirect(url_for("main.index", tab="log", session_id=session_id))

    rank = {name: index for index, name in enumerate(order)}
    indexed_session = [
        (index, item)
        for index, item in enumerate(data["workouts"])
        if item.get("session_id") == session_id
    ]
    sorted_session = sorted(
        indexed_session,
        key=lambda pair: (rank[pair[1].get("exercise", "")], pair[0]),
    )
    for _, updated in sorted_session:
        updated["superset_group"] = groups.get(updated.get("exercise", ""), "")
    ordered_items = [item for _, item in sorted_session]
    insert_at = min(index for index, _ in indexed_session)
    remaining = [item for item in data["workouts"] if item.get("session_id") != session_id]
    data["workouts"] = remaining[:insert_at] + ordered_items + remaining[insert_at:]
    save_data(data)
    flash("Workout exercise order and supersets updated.", "success")
    return redirect(url_for("main.index", tab="log", session_id=session_id))


@main.route("/finish_session", methods=["POST"])
def finish_session():
    data = load_data()
    session_id = request.form.get("session_id", "").strip()
    try:
        elapsed_seconds = int(request.form.get("elapsed_seconds", "0"))
        if not 0 <= elapsed_seconds <= 86400:
            raise ValueError
    except ValueError:
        flash("Workout duration is invalid.", "error")
        return redirect(url_for("main.index", tab="log", session_id=session_id))
    matching = [item for item in data["workouts"] if item.get("session_id") == session_id]
    if not matching:
        flash("Workout could not be found.", "error")
    else:
        for item in matching:
            item["elapsed_seconds"] = max(
                _elapsed_seconds(item.get("elapsed_seconds", 0)), elapsed_seconds
            )
            item["finished"] = True
        save_data(data)
        volume = 0.0
        for item in matching:
            if item.get("set_type") == "cardio":
                continue
            try:
                weight = float(item.get("weight", 0) or 0)
                reps = int(item.get("reps", 0) or 0)
            except (TypeError, ValueError):
                continue
            if item.get("unit", "kg") == "lb":
                weight *= 0.45359237
            volume += weight * reps
        minutes, seconds = divmod(elapsed_seconds, 60)
        flash(
            f"Workout complete: {len(matching)} sets across "
            f"{len({item.get('exercise') for item in matching})} exercises · "
            f"{volume:.1f} kg × reps · {minutes:02d}:{seconds:02d}.",
            "success",
        )
    return redirect(url_for("main.index", tab="history"))


@main.route("/add_exercise", methods=["POST"])
def add_library_exercise():
    data = load_data()
    category = request.form.get("muscle", "").strip()
    name = request.form.get("exercise_name", "").strip()
    try:
        if not name:
            raise ValueError("Exercise name cannot be empty.")
        add_exercise(data["exercises"], category, name)
        save_data(data)
        flash("Exercise added to the library.", "success")
    except ValueError as error:
        flash(str(error), "error")
    if request.form.get("return_tab") == "log":
        return redirect(url_for(
            "main.index",
            tab="log",
            session_id=request.form.get("session_id", "").strip(),
            muscle=category,
            exercise=name,
        ))
    return _redirect_to_library()


@main.route("/update_exercise", methods=["POST"])
def update_library_exercise():
    data = load_data()
    old_category = request.form.get("old_muscle", "").strip()
    old_name = request.form.get("old_name", "").strip()
    new_category = request.form.get("muscle", "").strip()
    new_name = request.form.get("exercise_name", "").strip()
    try:
        if not new_name:
            raise ValueError("Exercise name cannot be empty.")
        update_exercise(data["exercises"], old_category, old_name, new_category, new_name)
        save_data(data)
        flash("Exercise updated.", "success")
    except ValueError as error:
        flash(str(error), "error")
    return _redirect_to_library()


@main.route("/delete_exercise", methods=["POST"])
def delete_library_exercise():
    data = load_data()
    category = request.form.get("muscle", "").strip()
    name = request.form.get("exercise_name", "").strip()
    try:
        delete_exercise(data["exercises"], category, name)
        save_data(data)
        flash("Exercise deleted from the library. Existing workout history is unchanged.", "success")
    except ValueError as error:
        flash(str(error), "error")
    return _redirect_to_library()


@main.route("/add_category", methods=["POST"])
def add_category():
    data = load_data()
    category = request.form.get("category", "").strip()
    if not category:
        flash("Category name cannot be empty.", "error")
    elif any(category.casefold() == existing.casefold() for existing in data["exercises"]):
        flash("That category already exists.", "error")
    else:
        data["exercises"][category] = []
        save_data(data)
        flash("Category added.", "success")
    return _redirect_to_library()


@main.route("/delete_category", methods=["POST"])
def delete_category():
    data = load_data()
    category = request.form.get("category", "").strip()
    if category not in data["exercises"]:
        flash("The category could not be found.", "error")
    elif data["exercises"][category]:
        flash("Move or delete its exercises before deleting this category.", "error")
    else:
        del data["exercises"][category]
        save_data(data)
        flash("Empty category deleted.", "success")
    return _redirect_to_library()


@main.route("/restore_exercise_library", methods=["POST"])
def restore_exercise_library():
    data = load_data()
    data["exercises"] = deepcopy(DEFAULT_EXERCISES)
    save_data(data)
    flash("Default exercise library restored. Workout history was not changed.", "success")
    return _redirect_to_library()


@main.route("/service-worker.js")
def service_worker():
    return send_from_directory(
        current_app.static_folder,
        "service-worker.js",
        mimetype="application/javascript",
    )


@main.route("/undo_delete_set", methods=["POST"])
def undo_delete_set():
    deleted_sets = session.pop("deleted_sets", None)
    if deleted_sets:
        data = load_data()
        existing = {entry.get("entry_id") for entry in data["workouts"]}
        for deleted in sorted(deleted_sets, key=lambda item: item.get("position", 0)):
            entry = deleted.get("entry", {})
            if entry.get("entry_id") not in existing:
                data["workouts"].insert(min(deleted.get("position", len(data["workouts"])), len(data["workouts"])), entry)
                existing.add(entry.get("entry_id"))
        save_data(data)
        flash(f"Restored {len(deleted_sets)} workout set(s).", "success")
        return redirect(url_for("main.index", tab="history"))
    deleted = session.pop("deleted_set", None)
    if deleted:
        data = load_data()
        if not any(entry.get("entry_id") == deleted["entry"].get("entry_id") for entry in data["workouts"]):
            data["workouts"].insert(min(deleted["position"], len(data["workouts"])), deleted["entry"])
            save_data(data)
        flash("Set restored.", "success")
    return redirect(url_for("main.index", tab="history"))


# Register feature routes on the shared blueprint.
import routine_routes
import measurement_routes
import backup_routes
import nutrition_routes
import report_routes
