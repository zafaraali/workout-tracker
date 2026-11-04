from typing import TypedDict


ExerciseLibrary = dict[str, list[str]]


class WorkoutEntry(TypedDict):
    date: str
    muscle: str
    exercise: str
    weight: str
    reps: str
    rpe: str


class WorkoutData(TypedDict):
    workouts: list[WorkoutEntry]
    exercises: ExerciseLibrary
