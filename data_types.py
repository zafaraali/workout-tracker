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
    entry_id: NotRequired[str]
    elapsed_seconds: NotRequired[int]
    superset_group: NotRequired[str]
    finished: NotRequired[bool]
    routine_id: NotRequired[str]
    routine_slot: NotRequired[int]
    routine_exercise: NotRequired[str]

class RoutineExercise(TypedDict):
    muscle: str
    exercise: str
    target_sets: NotRequired[int]
    warmup_sets: NotRequired[int]
    warmup_weight: NotRequired[str]
    target_reps: NotRequired[str]
    target_weight: NotRequired[str]
    weight_increment: NotRequired[str]
    rest_seconds: NotRequired[int]
    notes: NotRequired[str]


class Routine(TypedDict):
    id: str
    name: str
    exercises: list[RoutineExercise]
    schedule_days: NotRequired[list[str]]


class Measurement(TypedDict):
    id: NotRequired[str]
    date: str
    body_weight: str
    unit: str
    waist: str
    chest: str
    hips: str
    notes: str


class FitnessGoal(TypedDict):
    id: str
    metric: str
    target: str
    unit: str
    direction: str
    target_date: NotRequired[str]


class WorkoutData(TypedDict):
    workouts: list[WorkoutEntry]
    exercises: ExerciseLibrary
    routines: list[Routine]
    measurements: list[Measurement]
    goals: list[FitnessGoal]
    settings: dict
    nutrition: list[dict]
    profiles: list[dict]
