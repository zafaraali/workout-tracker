import json
import math
import uuid

from flask import flash, redirect, request, url_for

from storage import load_data, save_data


from routing import main


@main.route("/save_routine", methods=["POST"])
def save_routine():
    data = load_data()
    name = request.form.get("name", "").strip()[:100]
    schedule_days = _validated_schedule_days(request.form.getlist("schedule_days"))
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
            {"id": str(uuid.uuid4()), "name": name, "exercises": routine_exercises, "schedule_days": schedule_days, "profile_id": request.form.get("profile_id", "default")}
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
        {"id": str(uuid.uuid4()), "name": name, "exercises": routine_exercises, "schedule_days": schedule_days, "profile_id": request.form.get("profile_id", "default")}
    )
    save_data(data)
    flash("Routine saved from this workout.", "success")
    return redirect(url_for("main.index", tab="routines"))


def _validated_schedule_days(values):
    return sorted({str(value) for value in values if str(value) in {"0", "1", "2", "3", "4", "5", "6"}})


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
        warmup_sets = int(item.get("warmup_sets", 0))
        rest_seconds = int(item.get("rest_seconds", 90))
        target_reps = str(item.get("target_reps", "8-12")).strip()[:30]
        target_weight = str(item.get("target_weight", "")).strip()
        warmup_weight = str(item.get("warmup_weight", "")).strip()
        weight_increment = str(item.get("weight_increment", "0")).strip() or "0"
        notes = str(item.get("notes", "")).strip()[:300]
        if (
            not 1 <= target_sets <= 30
            or not 0 <= warmup_sets <= 10
            or not 0 <= rest_seconds <= 3600
            or not target_reps
        ):
            raise ValueError("Routine targets are outside the allowed range.")
        numeric_weights = {}
        for field, value in (
            ("target_weight", target_weight),
            ("warmup_weight", warmup_weight),
            ("weight_increment", weight_increment),
        ):
            if value:
                number = float(value)
                if not math.isfinite(number) or number < 0:
                    raise ValueError("Routine weights and progression increments must be non-negative numbers.")
                numeric_weights[field] = str(number)
        validated.append(
            {
                "muscle": muscle,
                "exercise": exercise,
                "target_sets": target_sets,
                "warmup_sets": warmup_sets,
                "warmup_weight": numeric_weights.get("warmup_weight", ""),
                "target_reps": target_reps,
                "target_weight": numeric_weights.get("target_weight", ""),
                "weight_increment": numeric_weights.get("weight_increment", "0"),
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
    routine["schedule_days"] = _validated_schedule_days(request.form.getlist("schedule_days"))
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

