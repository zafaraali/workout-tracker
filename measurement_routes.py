import datetime
import math
import uuid

from flask import flash, redirect, request, url_for

from storage import load_data, save_data


from routing import main


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
        "profile_id": request.form.get("profile_id", "default"),
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
        return redirect(url_for("main.index", tab="measurements"))
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
        return redirect(url_for("main.index", tab="measurements"))
    measurement_field = metric
    latest = next(
        (item for item in sorted(data["measurements"], key=lambda item: item.get("date", ""), reverse=True)
         if item.get(measurement_field)),
        None,
    )
    goal = {
        "id": str(uuid.uuid4()),
        "metric": metric,
        "target": str(numeric_target),
        "unit": unit,
        "direction": direction,
        "target_date": target_date,
        "profile_id": request.form.get("profile_id", "default"),
    }
    if latest:
        goal["baseline"] = latest[measurement_field]
        goal["baseline_unit"] = latest.get("unit", "")
    data["goals"].append(goal)
    save_data(data)
    flash("Goal saved.", "success")
    return redirect(url_for("main.index", tab="measurements"))


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
    return redirect(url_for("main.index", tab="measurements"))

