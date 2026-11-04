import datetime
import json
import math
import uuid
import calendar
import csv
import io
from copy import deepcopy

from flask import Blueprint, Response, current_app, flash, jsonify, redirect, render_template, request, send_from_directory, url_for

from data_types import WorkoutData, WorkoutEntry
from exercise_library import (
    DEFAULT_EXERCISES,
    add_exercise,
    delete_exercise,
    update_exercise,
)
from storage import automatic_backups, load_data, save_data, validate_data


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
        for key in ("routines", "measurements", "goals")
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
    superset_group = form.get("superset_group", "").strip().upper()
    try:
        elapsed_seconds = max(0, min(int(form.get("elapsed_seconds", "0") or "0"), 86400))
    except ValueError:
        raise ValueError("Workout duration must be valid.")

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
    if superset_group not in {"", "A", "B", "C", "D", "E"}:
        raise ValueError("Choose a valid superset group.")

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
        "entry_id": form.get("entry_id", "").strip(),
        "elapsed_seconds": elapsed_seconds,
        "superset_group": superset_group,
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


def _goal_progress(goals, measurements):
    progress = []
    fields = {
        "body_weight": ("body_weight", "unit"),
        "waist": ("waist", None),
        "chest": ("chest", None),
        "hips": ("hips", None),
    }
    for goal in goals:
        metric = goal.get("metric")
        if metric not in fields:
            continue
        value_field, unit_field = fields[metric]
        entries = sorted(
            (item for item in measurements if item.get(value_field)),
            key=lambda item: item.get("date", ""),
        )
        if not entries:
            progress.append({**goal, "current": None, "progress": 0, "complete": False})
            continue
        target = float(goal["target"])
        baseline = float(entries[0][value_field])
        latest = float(entries[-1][value_field])
        if metric == "body_weight" and goal.get("unit") == "kg":
            baseline = baseline * (0.45359237 if entries[0].get(unit_field) == "lb" else 1)
            latest = latest * (0.45359237 if entries[-1].get(unit_field) == "lb" else 1)
        elif metric == "body_weight" and goal.get("unit") == "lb":
            baseline = baseline / (0.45359237 if entries[0].get(unit_field) == "kg" else 1)
            latest = latest / (0.45359237 if entries[-1].get(unit_field) == "kg" else 1)
        direction = goal.get("direction", "decrease")
        denominator = target - baseline if direction == "increase" else baseline - target
        numerator = latest - baseline if direction == "increase" else baseline - latest
        percentage = 100 if (latest >= target if direction == "increase" else latest <= target) else (
            max(0, min(100, numerator / denominator * 100)) if denominator else 0
        )
        progress.append({
            **goal,
            "current": latest,
            "progress": round(percentage),
            "complete": percentage >= 100,
        })
    return progress


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
    measurements = list(reversed(data["measurements"]))
    for measurement_index, measurement in enumerate(reversed(data["measurements"])):
        if not measurement.get("id"):
            measurements[measurement_index]["id"] = f"legacy-measurement-{len(data['measurements']) - measurement_index - 1}"
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
        measurements=measurements,
        goals=_goal_progress(data["goals"], data["measurements"]),
        automatic_backups=[path.name for path in automatic_backups()],
        calendar_days=calendar_days,
        calendar_month=month_date.strftime("%B %Y"),
        calendar_month_value=selected_month,
        previous_month=(month_date - datetime.timedelta(days=1)).strftime("%Y-%m"),
        next_month=(month_date.replace(day=28) + datetime.timedelta(days=4)).replace(day=1).strftime("%Y-%m"),
        active_session_id=active_session_id,
        active_session_sets=active_session_sets,
        active_session_groups=[
            {
                "exercise": name,
                "sets": sets,
                "superset_group": next(
                    (item["workout"].get("superset_group", "") for item in sets if item["workout"].get("superset_group")),
                    "",
                ),
            }
            for name, sets in active_exercises.items()
        ],
        active_session_duration=max(
            (item["workout"].get("elapsed_seconds", 0) for item in active_session_sets),
            default=0,
        ),
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
    entry_id = request.form.get("entry_id", "").strip()
    if entry_id and any(workout.get("entry_id") == entry_id for workout in data["workouts"]):
        if request.headers.get("X-Offline-Sync"):
            return jsonify(ok=True, duplicate=True)
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
    data["workouts"].append(entry)
    save_data(data)
    if request.headers.get("X-Offline-Sync"):
        return jsonify(ok=True), 201
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
    updated["entry_id"] = previous.get("entry_id", "")
    updated["session_name"] = request.form.get("session_name", "").strip()[:100] or "Workout"
    updated["elapsed_seconds"] = previous.get("elapsed_seconds", 0)
    updated["superset_group"] = previous.get("superset_group", "")
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
        for (index, _), (_, updated) in zip(indexed_session, sorted_session):
            updated["superset_group"] = groups.get(updated.get("exercise", ""), "")
        ordered_items = [item for _, item in sorted_session]
        insert_at = min(index for index, _ in indexed_session)
        remaining = [item for item in data["workouts"] if item.get("session_id") != session_id]
        data["workouts"] = remaining[:insert_at] + ordered_items + remaining[insert_at:]
        save_data(data)
        flash("Workout exercise order and supersets updated.", "success")
        return redirect(url_for("main.index", tab="log", session_id=session_id))

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
    name = request.form.get("name", "").strip()[:100]
    if request.form.get("mode") == "builder":
        try:
            routine_exercises = _validated_routine_exercises(
                json.loads(request.form.get("exercises_json", "[]")),
                data["exercises"],
            )
        except (ValueError, TypeError, json.JSONDecodeError):
            flash("Add valid exercises and targets to the routine.", "error")
            return redirect(url_for("main.index", tab="routines"))
        if not name or not routine_exercises:
            flash("Enter a routine name and add at least one exercise.", "error")
            return redirect(url_for("main.index", tab="routines"))
        data["routines"].append(
            {"id": str(uuid.uuid4()), "name": name, "exercises": routine_exercises}
        )
        save_data(data)
        flash("Routine created.", "success")
        return redirect(url_for("main.index", tab="routines"))

    session_id = request.form.get("session_id", "").strip()
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
            routine_exercises.append(
                {
                    "muscle": key[0],
                    "exercise": key[1],
                    "target_sets": 3,
                    "target_reps": "8-12",
                    "target_weight": "",
                    "rest_seconds": 90,
                    "notes": "",
                }
            )
            seen.add(key)

    data["routines"].append(
        {"id": str(uuid.uuid4()), "name": name, "exercises": routine_exercises}
    )
    save_data(data)
    flash("Routine saved from this workout.", "success")
    return redirect(url_for("main.index", tab="routines"))


def _validated_routine_exercises(items, exercises):
    if not isinstance(items, list) or len(items) > 100:
        raise ValueError("A routine must contain a valid exercise list.")

    validated = []
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Routine exercise must be an object.")
        muscle = str(item.get("muscle", "")).strip()
        exercise = str(item.get("exercise", "")).strip()
        if muscle not in exercises or exercise not in exercises[muscle]:
            raise ValueError("Choose an exercise from the library.")
        if (muscle, exercise) in seen:
            raise ValueError("Remove duplicate exercises from the routine.")
        target_sets = int(item.get("target_sets", 3))
        rest_seconds = int(item.get("rest_seconds", 90))
        target_reps = str(item.get("target_reps", "8-12")).strip()[:30]
        target_weight = str(item.get("target_weight", "")).strip()
        notes = str(item.get("notes", "")).strip()[:300]
        if not 1 <= target_sets <= 30 or not 0 <= rest_seconds <= 3600 or not target_reps:
            raise ValueError("Routine targets are outside the allowed range.")
        if target_weight and (
            not math.isfinite(float(target_weight)) or float(target_weight) < 0
        ):
            raise ValueError("Target weight must be a non-negative number.")
        validated.append(
            {
                "muscle": muscle,
                "exercise": exercise,
                "target_sets": target_sets,
                "target_reps": target_reps,
                "target_weight": target_weight,
                "rest_seconds": rest_seconds,
                "notes": notes,
            }
        )
        seen.add((muscle, exercise))
    return validated


@main.route("/update_routine/<routine_id>", methods=["POST"])
def update_routine(routine_id):
    data = load_data()
    routine = next(
        (item for item in data["routines"] if item.get("id") == routine_id), None
    )
    if routine is None:
        flash("Routine could not be found.", "error")
        return redirect(url_for("main.index", tab="routines"))
    name = request.form.get("name", "").strip()[:100]
    try:
        exercises = _validated_routine_exercises(
            json.loads(request.form.get("exercises_json", "[]")),
            data["exercises"],
        )
        if not name or not exercises:
            raise ValueError("Routine name and exercises are required.")
    except (ValueError, TypeError, json.JSONDecodeError):
        flash("Enter a routine name and at least one valid exercise.", "error")
        return redirect(url_for("main.index", tab="routines"))
    routine["name"] = name
    routine["exercises"] = exercises
    save_data(data)
    flash("Routine updated.", "success")
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

    measurement = {
        "id": str(uuid.uuid4()),
        "date": measurement_date,
        **values,
        "unit": unit,
        "notes": notes,
    }
    data["measurements"].append(measurement)
    save_data(data)
    flash("Body measurements saved.", "success")
    return redirect(url_for("main.index", tab="measurements"))


@main.route("/update_measurement/<measurement_id>", methods=["POST"])
def update_measurement(measurement_id):
    data = load_data()
    measurement = next(
        (
            item for index, item in enumerate(data["measurements"])
            if (item.get("id") or f"legacy-measurement-{index}") == measurement_id
        ),
        None,
    )
    if measurement is None:
        flash("Measurement could not be found.", "error")
        return redirect(url_for("main.index", tab="measurements"))
    form = request.form
    try:
        measurement_date = form.get("date", "").strip()
        datetime.date.fromisoformat(measurement_date)
        unit = form.get("unit", "kg").strip()
        if unit not in {"kg", "lb"}:
            raise ValueError("Invalid weight unit.")
        values = {
            key: form.get(key, "").strip()
            for key in ("body_weight", "waist", "chest", "hips")
        }
        if any(
            value and (not math.isfinite(float(value)) or float(value) < 0)
            for value in values.values()
        ):
            raise ValueError("Invalid measurement value.")
        notes = form.get("notes", "").strip()
        if len(notes) > 500 or not any(values.values()):
            raise ValueError("At least one valid measurement is required.")
    except (ValueError, TypeError):
        flash("Enter a valid date and at least one valid body measurement.", "error")
        return redirect(url_for("main.index", tab="measurements"))
    measurement.update({"date": measurement_date, **values, "unit": unit, "notes": notes})
    measurement.setdefault("id", measurement_id)
    save_data(data)
    flash("Measurement updated.", "success")
    return redirect(url_for("main.index", tab="measurements"))


@main.route("/delete_measurement/<measurement_id>", methods=["POST"])
def delete_measurement(measurement_id):
    data = load_data()
    original_count = len(data["measurements"])
    data["measurements"] = [
        item
        for index, item in enumerate(data["measurements"])
        if (item.get("id") or f"legacy-measurement-{index}") != measurement_id
    ]
    if len(data["measurements"]) == original_count:
        flash("Measurement could not be found.", "error")
    else:
        save_data(data)
        flash("Measurement deleted.", "success")
    return redirect(url_for("main.index", tab="measurements"))


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


@main.route("/service-worker.js")
def service_worker():
    return send_from_directory(
        current_app.static_folder,
        "service-worker.js",
        mimetype="application/javascript",
    )


@main.route("/save_goal", methods=["POST"])
def save_goal():
    data = load_data()
    metric = request.form.get("metric", "").strip()
    target = request.form.get("target", "").strip()
    unit = request.form.get("unit", "").strip()
    direction = request.form.get("direction", "").strip()
    target_date = request.form.get("target_date", "").strip()
    if metric not in {"body_weight", "waist", "chest", "hips"}:
        flash("Choose a supported goal metric.", "error")
        return redirect(url_for("main.index", tab="goals"))
    try:
        numeric_target = float(target)
        if not math.isfinite(numeric_target) or numeric_target <= 0:
            raise ValueError("Goal must be a positive number.")
        if metric == "body_weight":
            if unit not in {"kg", "lb"}:
                raise ValueError("Choose kg or lb.")
        elif unit != "cm":
            raise ValueError("Measurements use centimeters.")
        if direction not in {"increase", "decrease"}:
            raise ValueError("Choose an increase or decrease goal.")
        if metric != "body_weight" and direction == "increase":
            raise ValueError("Measurement goals support reduction targets.")
        if target_date:
            datetime.date.fromisoformat(target_date)
    except (ValueError, TypeError):
        flash("Enter a valid goal target, direction, unit, and optional date.", "error")
        return redirect(url_for("main.index", tab="goals"))
    data["goals"].append({
        "id": str(uuid.uuid4()),
        "metric": metric,
        "target": str(numeric_target),
        "unit": unit,
        "direction": direction,
        "target_date": target_date,
    })
    save_data(data)
    flash("Goal saved.", "success")
    return redirect(url_for("main.index", tab="goals"))


@main.route("/delete_goal/<goal_id>", methods=["POST"])
def delete_goal(goal_id):
    data = load_data()
    initial_count = len(data["goals"])
    data["goals"] = [goal for goal in data["goals"] if goal.get("id") != goal_id]
    if len(data["goals"]) == initial_count:
        flash("Goal could not be found.", "error")
    else:
        save_data(data)
        flash("Goal deleted.", "success")
    return redirect(url_for("main.index", tab="goals"))


def _csv_safe(value):
    text = "" if value is None else str(value)
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text
    return text


@main.route("/export/workouts.csv")
def export_workouts_csv():
    data = load_data()
    columns = [
        "date", "session_name", "muscle", "exercise", "set_type",
        "weight", "unit", "reps", "rpe", "distance", "distance_unit",
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
        "goals": imported.get("goals", []),
    }
    save_data(validated_data)
    flash("Backup restored.", "success")
    return redirect(url_for("main.index", tab="history"))
