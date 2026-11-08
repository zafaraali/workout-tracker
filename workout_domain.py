import datetime
import json
import math
from copy import deepcopy
from data_types import WorkoutData, WorkoutEntry
from exercise_library import DEFAULT_EXERCISES
from storage import validate_data


def _valid_import(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    workouts = data.get("workouts")
    exercises = data.get("exercises")
    optional_lists_valid = all(
        key not in data or (isinstance(data[key], list) and all(isinstance(item, dict) for item in data[key]))
        for key in ("routines", "measurements", "goals")
    )
    settings_valid = "settings" not in data or isinstance(data["settings"], dict)
    nutrition_valid = "nutrition" not in data or (isinstance(data["nutrition"], list) and all(isinstance(item, dict) for item in data["nutrition"]))
    return settings_valid and nutrition_valid and optional_lists_valid and (
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


def _reject_json_constant(value):
    raise ValueError(f"Unsupported JSON constant: {value}")


def _merge_records(existing, incoming, identity, fallback=None):
    merged = list(existing)
    key_for = lambda value: json.dumps(value, sort_keys=True) if value else None
    seen = {key_for(identity(item)) for item in existing if identity(item)}
    fallback_seen = {
        key_for(fallback(item)) for item in existing
        if fallback and fallback(item) is not None
    }
    for item in incoming:
        key = key_for(identity(item))
        alternate_key = key_for(fallback(item)) if fallback else None
        if (key and key in seen) or (
            alternate_key is not None and alternate_key in fallback_seen
        ):
            continue
        merged.append(item)
        if key:
            seen.add(key)
        if alternate_key is not None:
            fallback_seen.add(alternate_key)
    return merged


def _merge_backup_data(existing, imported):
    merged_exercises = {category: list(names) for category, names in existing["exercises"].items()}
    category_names = {category.casefold(): category for category in merged_exercises}
    for category, names in imported["exercises"].items():
        target_category = category_names.get(category.casefold())
        if target_category is None:
            target_category = category
            category_names[category.casefold()] = category
            merged_exercises[target_category] = []
        seen_exercises = {name.casefold() for name in merged_exercises[target_category]}
        for name in names:
            if name.casefold() not in seen_exercises:
                merged_exercises[target_category].append(name)
                seen_exercises.add(name.casefold())

    return {
        "workouts": _merge_records(
            existing["workouts"], imported["workouts"], lambda item: item.get("entry_id")
        ),
        "exercises": merged_exercises,
        "routines": _merge_records(
            existing["routines"],
            imported["routines"],
            lambda item: item.get("id"),
            lambda item: item.get("name", "").strip().casefold()
            if isinstance(item.get("name"), str) else None,
        ),
        "measurements": _merge_records(
            existing["measurements"],
            imported["measurements"],
            lambda item: item.get("id"),
        ),
        "goals": _merge_records(
            existing["goals"],
            imported["goals"],
            lambda item: item.get("id"),
            lambda item: (
                item.get("metric"), item.get("target"), item.get("unit"),
                item.get("direction"), item.get("target_date"),
            ),
        ),
        "settings": imported.get("settings", existing.get("settings", {"gym_name": "Home gym", "equipment": []})),
        "nutrition": _merge_records(existing.get("nutrition", []), imported.get("nutrition", []), lambda item: item.get("id")),
        "profiles": imported.get("profiles", existing.get("profiles", [{"id": "default", "name": "Default profile"}])),
    }


def _validated_backup_data(imported):
    if not _valid_import(imported):
        raise ValueError("Invalid backup structure.")
    data = validate_data(imported)
    for workout in data["workouts"]:
        workout_date = workout.get("date")
        datetime.date.fromisoformat(workout_date)
        if (
            not isinstance(workout.get("muscle"), str)
            or not workout["muscle"].strip()
            or not isinstance(workout.get("exercise"), str)
            or not workout["exercise"].strip()
        ):
            raise ValueError("Workout entries must include a category and exercise.")
        set_type = workout.setdefault("set_type", "working")
        unit = workout.setdefault("unit", "kg")
        if set_type not in {"working", "warmup", "drop", "failure", "cardio"} or unit not in {"kg", "lb"}:
            raise ValueError("Workout entries contain an unsupported set type or unit.")
        if set_type == "cardio":
            distance = workout.get("distance", "")
            duration = workout.get("duration", "")
            if distance not in ("", None):
                if not math.isfinite(float(distance)) or float(distance) < 0:
                    raise ValueError("Cardio distance must be a non-negative number.")
            if duration not in ("", None) and int(duration) < 1:
                raise ValueError("Cardio duration must be positive.")
            if not distance and not duration:
                raise ValueError("Cardio entries must include distance or duration.")
        else:
            weight = float(workout.get("weight"))
            reps = int(workout.get("reps"))
            if weight == 0 and "bodyweight" not in workout:
                workout["bodyweight"] = True
            if not math.isfinite(weight) or weight < 0 or reps < 1:
                raise ValueError("Strength entries contain an invalid weight or rep count.")
            if weight == 0 and not workout.get("bodyweight"):
                raise ValueError("Zero-weight strength entries must be marked as bodyweight.")
        for field in ("entry_id", "session_id", "session_name"):
            if field in workout and not isinstance(workout[field], str):
                raise ValueError(f"Workout {field} values must be text.")

    for routine in data["routines"]:
        if (
            not isinstance(routine.get("name"), str)
            or not routine["name"].strip()
            or not isinstance(routine.get("exercises", []), list)
            or not all(isinstance(item, dict) for item in routine.get("exercises", []))
        ):
            raise ValueError("Routines must have a name and an exercise list.")
        if any(
            not isinstance(item.get("muscle"), str)
            or not isinstance(item.get("exercise"), str)
            for item in routine.get("exercises", [])
        ):
            raise ValueError("Routine exercises must include a category and exercise.")
        if "id" in routine and not isinstance(routine["id"], str):
            raise ValueError("Routine IDs must be text.")

    for measurement in data["measurements"]:
        if not isinstance(measurement.get("date"), str):
            raise ValueError("Measurements must include a date.")
        datetime.date.fromisoformat(measurement["date"])
        if measurement.get("unit", "kg") not in {"kg", "lb"}:
            raise ValueError("Measurement weight units must be kg or lb.")
        for field in ("body_weight", "waist", "chest", "hips"):
            value = measurement.get(field)
            if value not in ("", None):
                number = float(value)
                if not math.isfinite(number) or number < 0:
                    raise ValueError(f"Measurement {field} must be a non-negative number.")

    for goal in data["goals"]:
        metric = goal.get("metric")
        unit = goal.get("unit")
        direction = goal.get("direction")
        if (
            metric not in {"body_weight", "waist", "chest", "hips"}
            or (metric == "body_weight" and unit not in {"kg", "lb"})
            or (metric != "body_weight" and unit != "cm")
            or direction not in {"increase", "decrease"}
            or (metric != "body_weight" and direction == "increase")
            or not math.isfinite(float(goal.get("target")))
            or float(goal["target"]) <= 0
        ):
            raise ValueError("Goals contain an unsupported metric or target.")
        target_date = goal.get("target_date", "")
        if target_date:
            datetime.date.fromisoformat(target_date)
    return data


def _validated_workout(form, exercises) -> WorkoutEntry:
    workout_date = form.get("date", "").strip()
    category = form.get("muscle", "").strip()
    exercise = form.get("exercise", "").strip()
    weight = form.get("weight", "").strip()
    reps = form.get("reps", "").strip()
    rpe = form.get("rpe", "").strip()
    unit = form.get("unit", "kg").strip()
    notes = form.get("notes", "").strip()
    bodyweight = form.get("bodyweight") in {"1", "true", "on"}
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
        if numeric_weight == 0 and not bodyweight:
            raise ValueError("Use the bodyweight option when no external weight is used.")
        if not 1 <= int(rpe) <= 10:
            raise ValueError("RPE must be between 1 and 10.")

    return {
        "date": workout_date,
        "muscle": category,
        "exercise": exercise,
        "weight": weight,
        "bodyweight": bodyweight,
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
                "duration": 0,
            }
            grouped[session_id] = group
            groups.append(group)
        grouped[session_id]["sets"].append({"index": index, "workout": workout})
        grouped[session_id]["duration"] = max(
            grouped[session_id]["duration"], _elapsed_seconds(workout.get("elapsed_seconds", 0))
        )
    return list(reversed(groups))


def _elapsed_seconds(value):
    try:
        return max(0, min(int(value), 86400))
    except (TypeError, ValueError):
        return 0


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
            (
                item for item in measurements
                if _valid_positive_number(item.get(value_field)) is not None
            ),
            key=lambda item: item.get("date", ""),
        )
        if not entries:
            progress.append({**goal, "current": None, "progress": 0, "complete": False})
            continue
        target = _valid_positive_number(goal.get("target"))
        latest = _valid_positive_number(entries[-1].get(value_field))
        baseline = _valid_positive_number(goal.get("baseline", entries[0].get(value_field)))
        if target is None or latest is None or baseline is None:
            progress.append({**goal, "current": None, "progress": 0, "complete": False})
            continue
        baseline_unit = goal.get("baseline_unit", entries[0].get(unit_field, ""))
        if metric == "body_weight" and goal.get("unit") == "kg":
            baseline = baseline * (0.45359237 if baseline_unit == "lb" else 1)
            latest = latest * (0.45359237 if entries[-1].get(unit_field) == "lb" else 1)
        elif metric == "body_weight" and goal.get("unit") == "lb":
            baseline = baseline / (0.45359237 if baseline_unit == "kg" else 1)
            latest = latest / (0.45359237 if entries[-1].get(unit_field) == "kg" else 1)
        direction = goal.get("direction", "decrease")
        denominator = target - baseline if direction == "increase" else baseline - target
        numerator = latest - baseline if direction == "increase" else baseline - latest
        percentage = 100 if (latest >= target if direction == "increase" else latest <= target) else (
            max(0, min(100, numerator / denominator * 100)) if denominator > 0 else 0
        )
        progress.append({
            **goal,
            "current": latest,
            "progress": round(percentage),
            "complete": percentage >= 100,
        })
    return progress


def _valid_positive_number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result > 0 else None


def _training_insights(workouts, today):
    daily_dates = set()
    weekly_volume = {}
    weekly_sets = 0
    recent_volumes = [0.0, 0.0, 0.0, 0.0]
    for workout in workouts:
        try:
            workout_date = datetime.date.fromisoformat(workout.get("date", ""))
        except (TypeError, ValueError):
            continue
        if workout_date > today:
            continue
        daily_dates.add(workout_date)
        days_ago = (today - workout_date).days
        if not 0 <= days_ago < 28:
            continue
        week_index = days_ago // 7
        if workout.get("set_type") not in {"cardio", "warmup"}:
            weight = _valid_positive_number(workout.get("weight")) or 0
            if workout.get("unit") == "lb":
                weight *= 0.45359237
            try:
                reps = max(0, int(workout.get("reps", 0)))
            except (TypeError, ValueError):
                reps = 0
            volume = weight * reps
            recent_volumes[week_index] += volume
            if week_index == 0:
                weekly_sets += 1
                muscle = workout.get("muscle") or "Other"
                item = weekly_volume.setdefault(muscle, {"volume": 0.0, "sets": 0})
                item["volume"] += volume
                item["sets"] += 1

    streak = 0
    streak_date = today if today in daily_dates else today - datetime.timedelta(days=1)
    while streak_date in daily_dates:
        streak += 1
        streak_date -= datetime.timedelta(days=1)

    last_workout = max(daily_dates, default=None)
    days_since = (today - last_workout).days if last_workout else None
    prior_average = sum(recent_volumes[1:]) / 3
    recovery_note = ""
    if days_since is None:
        recovery_note = "Log a workout to start tracking consistency."
    elif days_since >= 7:
        recovery_note = f"It has been {days_since} days since your last workout."
    elif prior_average > 0 and recent_volumes[0] > prior_average * 1.5:
        recovery_note = "Your last 7 days were over 150% of your prior 3-week average volume. Consider recovery or a deload if you feel you need it."
    else:
        recovery_note = "No inactivity or unusually high-volume reminder right now."

    deload_recommendation = ""
    if prior_average > 0 and recent_volumes[0] > prior_average * 1.5:
        deload_recommendation = "Consider a deload: reduce working sets by 30–40% for your next week while keeping movement quality high."
    elif days_since is not None and days_since >= 7:
        deload_recommendation = "Ease back in with one or two lighter sessions before returning to normal volume."

    return {
        "weekly_volume": [
            {
                "muscle": muscle,
                "volume": round(values["volume"], 1),
                "sets": values["sets"],
            }
            for muscle, values in sorted(
                weekly_volume.items(), key=lambda item: (-item[1]["volume"], item[0].casefold())
            )
        ],
        "training_days": sum(
            1 for workout_date in daily_dates if 0 <= (today - workout_date).days < 7
        ),
        "weekly_sets": weekly_sets,
        "streak": streak,
        "days_since": days_since,
        "recovery_note": recovery_note,
        "deload_recommendation": deload_recommendation,
        "recent_week_volume": round(recent_volumes[0], 1),
        "prior_week_average": round(prior_average, 1),
    }


