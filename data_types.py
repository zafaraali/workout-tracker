from typing import NotRequired, TypedDict


ExerciseLibrary = dict[str, list[str]]


class WorkoutEntry(TypedDict):
    date: str
    muscle: str
    exercise: str
    weight: str
    reps: str
    rpe: str
    session_id: NotRequired[str]
    session_name: NotRequired[str]
    unit: NotRequired[str]
    notes: NotRequired[str]
    set_type: NotRequired[str]
    distance: NotRequired[str]
    duration: NotRequired[str]

class RoutineExercise(TypedDict):
    muscle: str
    exercise: str
    target_sets: NotRequired[int]
    target_reps: NotRequired[str]
    target_weight: NotRequired[str]
    rest_seconds: NotRequired[int]
    notes: NotRequired[str]


class Routine(TypedDict):
    id: str
    name: str
    exercises: list[RoutineExercise]


class Measurement(TypedDict):
    id: NotRequired[str]
    date: str
    body_weight: str
    unit: str
    waist: str
    chest: str
    hips: str
    notes: str


class WorkoutData(TypedDict):
    workouts: list[WorkoutEntry]
    exercises: ExerciseLibrary
    routines: list[Routine]
    measurements: list[Measurement]
