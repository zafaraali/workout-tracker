import datetime
import json
import math
import uuid
import calendar
from copy import deepcopy

from flask import Blueprint, flash, redirect, render_template, request, url_for

from data_types import WorkoutData, WorkoutEntry
from exercise_library import (
    DEFAULT_EXERCISES,
    add_exercise,
    delete_exercise,
    update_exercise,
)
from storage import load_data, save_data


main = Blueprint("main", __name__)


def _redirect_to_library():
    return redirect(url_for("main.index", tab="library"))


def _valid_import(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    workouts = data.get("workouts")
    exercises = data.get("exercises")
    optional_lists_valid = all(
        key not in data or (isinstance(data[key], list) and all(isinstance(item, dict) for item in data[key]))
        for key in ("routines", "measurements")
    )
    return optional_lists_valid and (
        isinstance(workouts, list)
        and all(isinstance(workout, dict) for workout in workouts)
        and isinstance(exercises, dict)
        and all(
            isinstance(category, str)
            and isinstance(names, list)
            and all(isinstance(name, str) for name in names)
            for category, names in exercises.items()
        )
    )


def _validated_workout(form, exercises) -> WorkoutEntry:
    workout_date = form.get("date", "").strip()
    category = form.get("muscle", "").strip()
    exercise = form.get("exercise", "").strip()
    weight = form.get("weight", "").strip()
    reps = form.get("reps", "").strip()
    rpe = form.get("rpe", "").strip()
    unit = form.get("unit", "kg").strip()
    notes = form.get("notes", "").strip()
    set_type = form.get("set_type", "working").strip()
    distance = form.get("distance", "").strip()
    duration = form.get("duration", "").strip()
    distance_unit = form.get("distance_unit", "km").strip()

    datetime.date.fromisoformat(workout_date)
    if category not in exercises or exercise not in exercises[category]:
        raise ValueError("Choose an exercise from the library.")
    if set_type not in {"working", "warmup", "drop", "failure", "cardio"}:
        raise ValueError("Choose a valid set type.")
    if unit not in {"kg", "lb"}:
        raise ValueError("Choose kg or lb for the weight unit.")
    if distance_unit not in {"km", "mi"}:
        raise ValueError("Choose km or mi for distance.")
    if len(notes) > 500:
        raise ValueError("Exercise notes must be 500 characters or fewer.")

    if set_type == "cardio":
        if not distance and not duration:
            raise ValueError("Enter distance or duration for a cardio set.")
        if distance and (not math.isfinite(float(distance)) or float(distance) < 0):
            raise ValueError("Distance must be a non-negative number.")
        if duration and int(duration) < 1:
            raise ValueError("Duration must be at least one minute.")
        weight = ""
        reps = ""
        rpe = ""
    else:
        numeric_weight = float(weight)
        if not math.isfinite(numeric_weight) or numeric_weight < 0 or int(reps) < 1:
            raise ValueError("Weight must be non-negative and reps must be at least one.")
        if not 1 <= int(rpe) <= 10:
            raise ValueError("RPE must be between 1 and 10.")

    return {
        "date": workout_date,
        "muscle": category,
        "exercise": exercise,
        "weight": weight,
        "reps": reps,
        "rpe": rpe,
        "unit": unit,
        "notes": notes,
        "set_type": set_type,
        "distance": distance,
        "duration": duration,
        "distance_unit": distance_unit,
    }


def _workout_groups(workouts, selected_date=""):
    groups = []
    grouped = {}
    for index, workout in enumerate(workouts):
        if selected_date and workout.get("date") != selected_date:
            continue
        session_id = workout.get("session_id") or f"legacy:{workout.get('date', '')}"
        if session_id not in grouped:
            group = {
                "id": session_id,
                "date": workout.get("date", ""),
                "name": workout.get("session_name") or "Workout",
                "sets": [],
            }
            grouped[session_id] = group
            groups.append(group)
        grouped[session_id]["sets"].append({"index": index, "workout": workout})
    return list(reversed(groups))


@main.route("/")
def index():
    data = load_data()
    selected_date = request.args.get("date", "").strip()
    selected_month = request.args.get("month", datetime.date.today().strftime("%Y-%m"))
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

    workouts = data["workouts"]
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
    active_session_sets = [
        {"index": index, "workout": workout}
        for index, workout in enumerate(data["workouts"])
        if active_session_id and workout.get("session_id") == active_session_id
    ]
    active_exercises = {}
    for item in active_session_sets:
        exercise_name = item["workout"].get("exercise", "Exercise")
        active_exercises.setdefault(exercise_name, []).append(item)
    return render_template(
        "index.html",
        workouts=workouts,
        exercises=data["exercises"],
        exercise_names=exercises,
        workout_groups=_workout_groups(data["workouts"], selected_date),
        progress_workouts=data["workouts"],
        routines=data["routines"],
        measurements=list(reversed(data["measurements"])),
        calendar_days=calendar_days,
        calendar_month=month_date.strftime("%B %Y"),
        calendar_month_value=selected_month,
        previous_month=(month_date - datetime.timedelta(days=1)).strftime("%Y-%m"),
        next_month=(month_date.replace(day=28) + datetime.timedelta(days=4)).replace(day=1).strftime("%Y-%m"),
        active_session_id=active_session_id,
        active_session_sets=active_session_sets,
        active_session_groups=[
            {"exercise": name, "sets": sets}
            for name, sets in active_exercises.items()
        ],
        active_session_name=(
            active_session_sets[0]["workout"].get("session_name", "Workout")
            if active_session_sets else ""
        ),
        today=datetime.date.today().isoformat(),
        selected_date=selected_date,
        selected_tab=request.args.get("tab", "log"),
    )


@main.route("/log", methods=["POST"])
def log_workout():
    data = load_data()
    try:
        entry = _validated_workout(request.form, data["exercises"])
    except (ValueError, TypeError):
        flash("Enter a valid date, exercise, weight, reps, RPE, and unit.", "error")
        return redirect(url_for("main.index"))

    entry["session_id"] = request.form.get("session_id", "").strip() or str(uuid.uuid4())
    entry["session_name"] = request.form.get("session_name", "").strip()[:100] or "Workout"
    data["workouts"].append(entry)
    save_data(data)
    flash("Workout set recorded.", "success")
    return redirect(
        url_for(
            "main.index",
            date=entry["date"],
            tab="log",
            session_id=entry["session_id"],
        )
    )


@main.route("/edit_workout/<int:index>", methods=["POST"])
def edit_workout(index):
    data = load_data()
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
    updated["session_name"] = request.form.get("session_name", "").strip()[:100] or "Workout"
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
def delete_workout(index):
    data = load_data()
    if index < 0 or index >= len(data["workouts"]):
        flash("Workout set could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    del data["workouts"][index]
    save_data(data)
    flash("Workout set deleted.", "success")
    return redirect(url_for("main.index", tab="history"))


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
    data["workouts"] = [
        workout for workout in data["workouts"] if not matching(workout)
    ]
    deleted_count = original_count - len(data["workouts"])
    if not deleted_count:
        flash("Workout could not be found.", "error")
        return redirect(url_for("main.index", tab="history"))

    save_data(data)
    flash(f"Workout deleted along with its {deleted_count} set(s).", "success")
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


@main.route("/save_routine", methods=["POST"])
def save_routine():
    data = load_data()
    session_id = request.form.get("session_id", "").strip()
    name = request.form.get("name", "").strip()[:100]
    if not session_id or not name:
        flash("Enter a routine name and choose a workout session to save.", "error")
        return redirect(url_for("main.index", tab="routines"))

    session_workouts = [
        workout for workout in data["workouts"]
        if workout.get("session_id") == session_id
    ]
    if not session_workouts:
        flash("Log at least one set in this session before saving it as a routine.", "error")
        return redirect(url_for("main.index", tab="routines"))

    routine_exercises = []
    seen = set()
    for workout in session_workouts:
        key = (workout.get("muscle", ""), workout.get("exercise", ""))
        if key not in seen:
            routine_exercises.append({"muscle": key[0], "exercise": key[1]})
            seen.add(key)

    data["routines"].append(
        {"id": str(uuid.uuid4()), "name": name, "exercises": routine_exercises}
    )
    save_data(data)
    flash("Routine saved from this workout.", "success")
    return redirect(url_for("main.index", tab="routines"))


@main.route("/delete_routine/<routine_id>", methods=["POST"])
def delete_routine(routine_id):
    data = load_data()
    original_count = len(data["routines"])
    data["routines"] = [routine for routine in data["routines"] if routine.get("id") != routine_id]
    if len(data["routines"]) == original_count:
        flash("Routine could not be found.", "error")
    else:
        save_data(data)
        flash("Routine deleted.", "success")
    return redirect(url_for("main.index", tab="routines"))


@main.route("/save_measurement", methods=["POST"])
def save_measurement():
    data = load_data()
    form = request.form
    try:
        measurement_date = form.get("date", "").strip()
        datetime.date.fromisoformat(measurement_date)
        unit = form.get("unit", "kg").strip()
        if unit not in {"kg", "lb"}:
            raise ValueError("Choose kg or lb for body weight.")
        values = {
            key: form.get(key, "").strip()
            for key in ("body_weight", "waist", "chest", "hips")
        }
        for value in values.values():
            if value and (not math.isfinite(float(value)) or float(value) < 0):
                raise ValueError("Measurements must be non-negative numbers.")
        notes = form.get("notes", "").strip()
        if len(notes) > 500:
            raise ValueError("Measurement notes must be 500 characters or fewer.")
        if not any(values.values()):
            raise ValueError("Enter at least one body measurement.")
    except (ValueError, TypeError):
        flash("Enter a valid date and at least one valid body measurement.", "error")
        return redirect(url_for("main.index", tab="measurements"))

    data["measurements"].append(
        {
            "date": measurement_date,
            **values,
            "unit": unit,
            "notes": notes,
        }
    )
    save_data(data)
    flash("Body measurements saved.", "success")
    return redirect(url_for("main.index", tab="measurements"))


@main.route("/export")
def export_backup():
    from flask import Response

    return Response(
        json.dumps(load_data(), indent=4),
        mimetype="application/json",
        headers={
            "Content-Disposition": (
                f"attachment; filename=gym_backup_{datetime.date.today().isoformat()}.json"
            )
        },
    )


@main.route("/import", methods=["POST"])
def import_backup():
    file = request.files.get("backup_file")
    if file is None or not file.filename:
        flash("Select a JSON backup file to restore.", "error")
        return redirect(url_for("main.index", tab="history"))

    try:
        imported = json.load(file)
    except (json.JSONDecodeError, UnicodeDecodeError):
        flash("The selected file is not valid JSON.", "error")
        return redirect(url_for("main.index", tab="history"))

    if not _valid_import(imported):
        flash("The backup must contain workout and exercise lists in the expected format.", "error")
        return redirect(url_for("main.index", tab="history"))

    validated_data: WorkoutData = {
        "workouts": imported["workouts"],
        "exercises": imported["exercises"],
        "routines": imported.get("routines", []),
        "measurements": imported.get("measurements", []),
    }
    save_data(validated_data)
    flash("Backup restored.", "success")
    return redirect(url_for("main.index", tab="history"))
