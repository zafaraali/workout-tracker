"""Calendar-week summaries derived from recorded sets, without changing history."""
from collections import defaultdict
from datetime import date, timedelta
import math


def _number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else 0
    except (TypeError, ValueError):
        return 0


def weekly_review(workouts, routines, today):
    start = today - timedelta(days=today.weekday())
    previous = start - timedelta(days=7)
    sessions = defaultdict(list)
    volume = previous_volume = 0
    records = []
    best = {}
    dated = []
    for index, entry in enumerate(workouts):
        try:
            day = date.fromisoformat(entry.get("date", ""))
        except (ValueError, TypeError):
            continue
        if day <= today:
            dated.append((day, index, entry))
    for day, _, entry in sorted(dated, key=lambda item: (item[0], item[1])):
        key = entry.get("session_id") or f"legacy:{day}:{entry.get('session_name', '')}"
        if day >= start:
            sessions[(day, key)].append(entry)
        if entry.get("set_type", "working") not in {"working", "drop", "failure"}:
            continue
        weight = _number(entry.get("weight")) * (0.45359237 if entry.get("unit") == "lb" else 1)
        reps = _number(entry.get("reps"))
        if reps < 1:
            continue
        if day >= start:
            volume += weight * reps
        elif day >= previous:
            previous_volume += weight * reps
        exercise = entry.get("exercise", "Exercise")
        old = best.get(exercise)
        if old is not None and day >= start and weight > old + 0.00001:
            records.append({"exercise": exercise, "date": day.isoformat(), "weight": round(weight, 2)})
        best[exercise] = max(old or 0, weight)
    completed = [(day, entries) for (day, _), entries in sessions.items() if all(e.get("finished") for e in entries)]
    due = matched = 0
    adherence = []
    for routine in routines:
        scheduled = set(routine.get("schedule_days", []))
        if not scheduled:
            continue
        planned_days = [start + timedelta(days=i) for i in range(today.weekday() + 1) if str(i) in scheduled]
        done = sum(any(day == planned and any(e.get("routine_id") == routine.get("id") for e in entries)
                       for day, entries in completed) for planned in planned_days)
        due += len(planned_days)
        matched += done
        adherence.append({"name": routine.get("name", "Routine"), "done": done, "due": len(planned_days)})
    return {
        "start": start.isoformat(), "end": today.isoformat(),
        "previous_start": previous.isoformat(), "previous_end": (start - timedelta(days=1)).isoformat(),
        "completed": len(completed), "in_progress": len(sessions) - len(completed),
        "volume": round(volume, 1), "previous_volume": round(previous_volume, 1),
        "volume_change": round((volume / previous_volume - 1) * 100, 1) if previous_volume else None,
        "records": records, "due": due, "matched": matched, "adherence": adherence,
    }
