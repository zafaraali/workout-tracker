import datetime
import json

from flask import Blueprint, flash, redirect, render_template, request, url_for

from data_types import WorkoutData, WorkoutEntry
from exercise_library import add_exercise, delete_exercise, update_exercise
from storage import load_data, save_data


main = Blueprint("main", __name__)


def _redirect_to_library():
    return redirect(url_for("main.index", tab="library"))


def _valid_import(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    workouts = data.get("workouts")
    exercises = data.get("exercises")
    return (
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


@main.route("/")
def index():
    data = load_data()
    selected_date = request.args.get("date", "").strip()
    if selected_date:
        try:
            datetime.date.fromisoformat(selected_date)
        except ValueError:
            flash("Choose a valid date to filter workout history.", "error")
            selected_date = ""

    workouts = data["workouts"]
    if selected_date:
        workouts = [workout for workout in workouts if workout.get("date") == selected_date]

    return render_template(
        "index.html",
        workouts=workouts,
        exercises=data["exercises"],
        today=datetime.date.today().isoformat(),
        selected_date=selected_date,
        selected_tab=request.args.get("tab", "log"),
    )


@main.route("/log", methods=["POST"])
def log_workout():
    data = load_data()
    category = request.form.get("muscle", "").strip()
    exercise = request.form.get("exercise", "").strip()
    workout_date = request.form.get("date", "").strip()
    weight = request.form.get("weight", "").strip()
    reps = request.form.get("reps", "").strip()
    rpe = request.form.get("rpe", "").strip()

    try:
        datetime.date.fromisoformat(workout_date)
        if category not in data["exercises"] or exercise not in data["exercises"][category]:
            raise ValueError("Choose an exercise from the library.")
        if float(weight) < 0 or int(reps) < 1:
            raise ValueError("Weight must be non-negative and reps must be at least one.")
        if not 1 <= int(rpe) <= 10:
            raise ValueError("RPE must be between 1 and 10.")
    except (ValueError, TypeError):
        flash("Enter a valid date, exercise, weight, reps, and RPE.", "error")
        return redirect(url_for("main.index"))

    entry: WorkoutEntry = {
        "date": workout_date,
        "muscle": category,
        "exercise": exercise,
        "weight": weight,
        "reps": reps,
        "rpe": rpe,
    }
    data["workouts"].append(entry)
    save_data(data)
    flash("Workout set recorded.", "success")
    return redirect(url_for("main.index", date=workout_date))


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
    }
    save_data(validated_data)
    flash("Backup restored.", "success")
    return redirect(url_for("main.index", tab="history"))
