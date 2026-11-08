function loadRoutine(routineId) {
    const routine = (window.routinesData || []).find((item) => item.id === routineId);
    if (!routine || !routine.exercises.length) {
        return;
    }
    sessionStorage.setItem("irontrack-routine-queue", JSON.stringify(routine.exercises.map((item, index) => ({...item, routine_slot: index, planned_exercise: item.exercise, planned_muscle: item.muscle}))));
    sessionStorage.setItem("irontrack-routine-index", "0");
    const sessionId = createSessionId();
    document.getElementById("session-id").value = sessionId;
    document.getElementById("workout-routine-id").value = routine.id;
    sessionStorage.setItem("irontrack-routine-id", routine.id);
    sessionStorage.setItem("irontrack-routine-session-id", sessionId);
    resetWorkoutClock();
    startWorkoutClock();
    document.getElementById("routine-session-id").value = sessionId;
    document.getElementById("session-name").value = routine.name;
    sessionStorage.setItem("irontrack-session-name", routine.name);
    document.getElementById("routine-session-name").value = routine.name;
    switchTab("log");
    window.activeSessionFinished = false;
    const firstItem = JSON.parse(sessionStorage.getItem("irontrack-routine-queue"))[0];
    selectRoutineExercise(firstItem);
    applyRoutineTarget(firstItem);
    document.getElementById("next-routine-exercise").classList.toggle("hidden", routine.exercises.length < 2);
    refreshRoutineProgress();
    renderSubstitutionChoices();
}

function initializeActiveRoutine() {
    let queue;
    try {
        queue = JSON.parse(sessionStorage.getItem("irontrack-routine-queue") || "[]");
    } catch (error) {
        console.error("Could not read the active routine.", error);
        sessionStorage.removeItem("irontrack-routine-queue");
        return;
    }
    const index = Number(sessionStorage.getItem("irontrack-routine-index") || "0");
    if (!Array.isArray(queue) || !queue.length || !queue[index]) return;
    if (!selectRoutineExercise(queue[index])) {
        sessionStorage.removeItem("irontrack-routine-queue");
        return;
    }
    applyRoutineTarget(queue[index]);
    document.getElementById("next-routine-exercise").classList.toggle("hidden", index >= queue.length - 1);
    refreshRoutineProgress();
    renderSubstitutionChoices();
}

function refreshRoutineProgress() {
    let queue;
    try {
        queue = JSON.parse(sessionStorage.getItem("irontrack-routine-queue") || "[]");
    } catch (error) {
        console.error("Could not update active routine progress.", error);
        return;
    }
    const index = Number(sessionStorage.getItem("irontrack-routine-index") || "0");
    const item = queue[index];
    const notice = document.getElementById("routine-target");
    if (!item || !notice) return;
    const sessionId = document.getElementById("session-id").value;
    const exerciseSets = routineLoggedSets().filter(
        (entry) => entry.session_id === sessionId
            && matchesRoutineSlot(entry, item)
            && entry.set_type !== "cardio"
    );
    const warmupCount = Number(item.warmup_sets || 0);
    const workingTarget = Number(item.target_sets || 3);
    const completedWarmups = exerciseSets.filter((entry) => entry.set_type === "warmup").length;
    const completedWorking = exerciseSets.filter((entry) => entry.set_type !== "warmup").length;
    const target = warmupCount + workingTarget;
    updateRoutineChecklist(item, sessionId, completedWarmups, completedWorking);
    notice.textContent =
        `Routine exercise ${index + 1} of ${queue.length}: ${item.exercise} · ${Math.min(completedWarmups, warmupCount)}/${warmupCount} warm-up · ${Math.min(completedWorking, workingTarget)}/${workingTarget} working sets logged`
        + `${completedWarmups >= warmupCount && completedWorking >= workingTarget ? " · Target met" : ""}`;
    notice.classList.remove("hidden");
}

function updateRoutineChecklist(item, sessionId, completedWarmups, completedWorking) {
    const list = document.getElementById("routine-set-checklist");
    const summary = document.getElementById("routine-checklist-summary");
    if (!list || !summary) return;
    list.replaceChildren();
    const warmupTarget = Number(item.warmup_sets || 0);
    const workingTarget = Number(item.target_sets || 3);
    if (warmupTarget + workingTarget === 0) {
        list.classList.add("hidden");
        summary.classList.add("hidden");
        return;
    }
    let manualChecks = {};
    const storageKey = `irontrack-routine-checks-${sessionId}`;
    try {
        const savedChecks = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
        if (savedChecks && typeof savedChecks === "object" && !Array.isArray(savedChecks)) {
            manualChecks = savedChecks;
        }
    } catch (error) {
        console.error("Could not read routine set checkmarks.", error);
    }
    const exerciseId = `slot:${item.routine_slot ?? item.exercise}`;
    let checkedCount = 0;
    const addPhase = (phase, count, actualCount) => {
        for (let setNumber = 0; setNumber < count; setNumber += 1) {
            const key = `${exerciseId}\u0000${phase}\u0000${setNumber}`;
            const logged = setNumber < actualCount;
            const label = document.createElement("label");
            label.className = "routine-check-item";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = logged || Boolean(manualChecks[key]);
            checkbox.disabled = logged;
            checkbox.setAttribute("aria-label", `${phase === "warmup" ? "Warm-up" : "Working"} set ${setNumber + 1} of ${count}`);
            if (checkbox.checked) checkedCount += 1;
            checkbox.addEventListener("change", () => {
                manualChecks[key] = checkbox.checked;
                sessionStorage.setItem(storageKey, JSON.stringify(manualChecks));
                refreshRoutineProgress();
            });
            const text = document.createElement("span");
            text.textContent = `${phase === "warmup" ? "Warm-up" : "Working"} set ${setNumber + 1}${logged ? " · logged" : ""}`;
            label.append(checkbox, text);
            list.append(label);
        }
    };
    addPhase("warmup", warmupTarget, completedWarmups);
    addPhase("working", workingTarget, completedWorking);
    list.classList.remove("hidden");
    summary.textContent = `${checkedCount} of ${warmupTarget + workingTarget} planned sets checked off. Logged sets are checked automatically.`;
    summary.classList.remove("hidden");
}

function applyRoutineTarget(item) {
    const sessionId = document.getElementById("session-id").value;
    const loggedSets = routineLoggedSets().filter(
        (entry) => entry.session_id === sessionId
            && matchesRoutineSlot(entry, item)
            && entry.set_type !== "cardio"
    );
    const warmupsDone = loggedSets.filter((entry) => entry.set_type === "warmup").length;
    const workingDone = loggedSets.filter((entry) => entry.set_type !== "warmup").length;
    const warmupTarget = Number(item.warmup_sets || 0);
    const isWarmup = warmupsDone < warmupTarget;
    const reps = Number.parseInt(String(item.target_reps || "10").match(/\d+/)?.[0] || "10", 10);
    document.getElementById("set-type").value = isWarmup ? "warmup" : "working";
    toggleCardioFields();
    document.getElementById("set-reps").value = String(reps);
    const baseWeight = Number(item.target_weight || 0);
    const perSetIncrement = Number(item.weight_increment || 0);
    const nextWeight = isWarmup
        ? Number(item.warmup_weight || 0)
        : baseWeight + Math.max(0, workingDone) * perSetIncrement;
    document.getElementById("set-weight").value = String(nextWeight);
    const timerDuration = document.getElementById("timer-duration");
    const restSeconds = String(item.rest_seconds ?? 90);
    if (![...timerDuration.options].some((option) => option.value === restSeconds)) {
        timerDuration.add(new Option(`Custom (${restSeconds} seconds)`, restSeconds));
    }
    timerDuration.value = restSeconds;
    const notice = document.getElementById("routine-target");
    const phaseText = isWarmup
        ? `Warm-up ${warmupsDone + 1}/${warmupTarget}`
        : `Working set ${workingDone + 1}/${item.target_sets || 3}`
            + (perSetIncrement > 0 ? ` · +${perSetIncrement} ${document.getElementById("weight-unit").value}/set` : "");
    notice.textContent =
        `${phaseText} · ${item.target_reps || "8-12"} reps`
        + `${nextWeight ? ` at ${nextWeight} ${document.getElementById("weight-unit").value}` : ""}`
        + ` · Rest ${item.rest_seconds ?? 90}s${item.notes ? ` · ${item.notes}` : ""}`;
    notice.classList.remove("hidden");
}

function selectRoutineExercise(item) {
    if (!(window.exercisesData[item.muscle] || []).includes(item.exercise)) {
            showClientToast(`${item.exercise} is no longer in the ${item.muscle} library category.`, "error");
        return false;
    }
    const muscleSelect = document.getElementById("muscle-select");
    muscleSelect.value = item.muscle;
    updateExercises();
    document.getElementById("exercise-select").value = item.exercise;
    showExerciseHistory();
    document.getElementById("workout-routine-slot").value = item.routine_slot ?? "";
    document.getElementById("workout-routine-exercise").value = item.planned_exercise || item.exercise;
    return true;
}

function advanceRoutine() {
    const queue = JSON.parse(sessionStorage.getItem("irontrack-routine-queue") || "[]");
    const currentIndex = Number(sessionStorage.getItem("irontrack-routine-index") || "0");
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
        document.getElementById("next-routine-exercise").classList.add("hidden");
        return;
    }
    if (selectRoutineExercise(queue[nextIndex])) {
        sessionStorage.setItem("irontrack-routine-index", String(nextIndex));
        applyRoutineTarget(queue[nextIndex]);
        document.getElementById("next-routine-exercise").classList.toggle("hidden", nextIndex >= queue.length - 1);
        refreshRoutineProgress();
        renderSubstitutionChoices();
    }
}

function initializeRoutineEditors() {
    document.querySelectorAll(".routine-editor").forEach((form) => {
        let initialExercises = [];
        try {
            initialExercises = JSON.parse(form.dataset.initial || "[]");
        } catch (error) {
            console.error("Could not read the saved routine exercises.", error);
        }
        initialExercises.forEach((item) => addRoutineExercise(form, item));
        form.addEventListener("submit", (event) => {
            const exercises = [...form.querySelectorAll(".routine-exercise-row")].map((row) => ({
                muscle: row.querySelector('[name="routine-muscle"]').value,
                exercise: row.querySelector('[name="routine-exercise"]').value,
                warmup_sets: row.querySelector('[name="warmup_sets"]').value,
                warmup_weight: row.querySelector('[name="warmup_weight"]').value,
                target_sets: row.querySelector('[name="target_sets"]').value,
                target_reps: row.querySelector('[name="target_reps"]').value,
                target_weight: row.querySelector('[name="target_weight"]').value,
                weight_increment: row.querySelector('[name="weight_increment"]').value,
                rest_seconds: row.querySelector('[name="rest_seconds"]').value,
                notes: row.querySelector('[name="routine-notes"]').value,
            }));
            if (!exercises.length || exercises.some((item) => !item.muscle || !item.exercise)) {
                event.preventDefault();
                showClientToast("Add at least one valid exercise to the routine.", "error");
                return;
            }
            form.querySelector('[name="exercises_json"]').value = JSON.stringify(exercises);
        });
    });
}

function renderRoutineComparison(routineId) {
    const routine = (window.routinesData || []).find((item) => item.id === routineId);
    const panel = [...document.querySelectorAll(".routine-comparison")]
        .find((item) => item.dataset.routineId === routineId);
    if (!routine || !panel) return;
    const sessions = new Map();
    (window.progressData || []).forEach((entry) => {
        const belongs = entry.routine_id === routineId
            || String(entry.session_name || "").trim().toLocaleLowerCase()
                === String(routine.name || "").trim().toLocaleLowerCase();
        if (!belongs || entry.set_type === "cardio") return;
        const sessionKey = entry.session_id || `${entry.date}\u0000${entry.session_name || ""}`;
        const session = sessions.get(sessionKey) || {date: entry.date, sets: []};
        session.sets.push(entry);
        if (entry.date > session.date) session.date = entry.date;
        sessions.set(sessionKey, session);
    });
    const recent = [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
    panel.replaceChildren();
    panel.classList.remove("hidden");
    if (!recent.length) {
        panel.textContent = "No logged sessions match this routine yet. New routine workouts will be linked automatically.";
        return;
    }
    const heading = document.createElement("p");
    heading.className = "mb-2 font-medium";
    heading.textContent = recent.length > 1
        ? `Comparing ${recent[0].date} with ${recent[1].date}`
        : `Latest session: ${recent[0].date} · No earlier session to compare`;
    panel.append(heading);
    routine.exercises.forEach((planned, slot) => {
        const measures = (session) => {
            const sets = session.sets.filter((entry) => entry.routine_slot !== undefined ? Number(entry.routine_slot) === slot : (entry.routine_exercise || entry.exercise) === planned.exercise);
            const warmupSets = sets.filter((entry) => entry.set_type === "warmup");
            const workingSets = sets.filter((entry) => entry.set_type !== "warmup");
            const workingVolume = workingSets
                .reduce((sum, entry) => sum + Number(entry.weight || 0)
                    * (entry.unit === "lb" ? 0.45359237 : 1) * Number(entry.reps || 0), 0);
            const averageWeight = workingSets.length
                ? workingSets.reduce((sum, entry) => sum + Number(entry.weight || 0)
                    * (entry.unit === "lb" ? 0.45359237 : 1), 0) / workingSets.length
                : 0;
            const averageReps = workingSets.length
                ? workingSets.reduce((sum, entry) => sum + Number(entry.reps || 0), 0) / workingSets.length
                : 0;
            return {
                completedWarmups: warmupSets.length,
                plannedWarmups: Number(planned.warmup_sets || 0),
                completedWorking: workingSets.length,
                plannedWorking: Number(planned.target_sets || 0),
                workingVolume,
                averageWeight,
                averageReps,
            };
        };
        const latest = measures(recent[0]);
        const line = document.createElement("p");
        const previous = recent.length > 1 ? measures(recent[1]) : null;
        let text = `${planned.exercise}: warm-up ${latest.completedWarmups}/${latest.plannedWarmups}, working ${latest.completedWorking}/${latest.plannedWorking} sets · avg ${latest.averageWeight.toFixed(1)} kg × ${latest.averageReps.toFixed(1)} reps · ${latest.workingVolume.toFixed(1)} kg × reps`;
        if (previous) {
            const delta = latest.workingVolume - previous.workingVolume;
            text += `; previous warm-up ${previous.completedWarmups}/${previous.plannedWarmups}, working ${previous.completedWorking}/${previous.plannedWorking} sets, avg ${previous.averageWeight.toFixed(1)} kg × ${previous.averageReps.toFixed(1)} reps; volume ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} kg × reps`;
        }
        line.textContent = text;
        panel.append(line);
    });
}

function initializeRoutineComparisons() {
    document.querySelectorAll(".routine-comparison-toggle").forEach((button) => {
        button.addEventListener("click", () => renderRoutineComparison(button.dataset.routineId));
    });
}

function initializeRoutineStarts() {
    document.querySelectorAll(".start-routine-button").forEach((button) => {
        button.addEventListener("click", () => loadRoutine(button.dataset.startRoutine));
    });
}

function addRoutineExercise(form, initial = {}) {
    const row = document.createElement("div");
    row.className = "routine-exercise-row grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 rounded-lg border border-slate-800 p-3";
    const category = document.createElement("select");
    category.name = "routine-muscle";
    category.className = "form-control";
    category.setAttribute("aria-label", "Routine muscle group");
    Object.keys(window.exercisesData || {}).forEach((name) => {
        const option = new Option(name, name);
        category.add(option);
    });
    const exercise = document.createElement("select");
    exercise.name = "routine-exercise";
    exercise.className = "form-control";
    exercise.setAttribute("aria-label", "Routine exercise");
    const refreshExercises = () => {
        const previous = exercise.value;
        exercise.replaceChildren();
        [...(window.exercisesData[category.value] || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).forEach((name) => exercise.add(new Option(name, name)));
        if ([...exercise.options].some((option) => option.value === previous)) {
            exercise.value = previous;
        }
    };
    category.addEventListener("change", refreshExercises);
    if (initial.muscle && (window.exercisesData[initial.muscle] || []).length) {
        category.value = initial.muscle;
    }
    refreshExercises();
    if (initial.exercise && [...exercise.options].some((option) => option.value === initial.exercise)) {
        exercise.value = initial.exercise;
    }
    row.append(category, exercise);
    [
        ["Warm-up sets", "warmup_sets", initial.warmup_sets ?? 0, "number", 0, 10],
        ["Warm-up weight", "warmup_weight", initial.warmup_weight || "", "number", 0, ""],
        ["Sets", "target_sets", initial.target_sets || 3, "number", 1, 30],
        ["Target reps", "target_reps", initial.target_reps || "8-12", "text"],
        ["Target weight", "target_weight", initial.target_weight || "", "number", 0, ""],
        ["Weight increase per working set", "weight_increment", initial.weight_increment || "0", "number", 0, ""],
        ["Rest seconds", "rest_seconds", initial.rest_seconds ?? 90, "number", 0, 3600],
        ["Notes", "routine-notes", initial.notes || "", "text"],
    ].forEach(([labelText, name, value, type, min, max]) => {
        const label = document.createElement("label");
        label.className = "field-label";
        label.append(document.createTextNode(labelText));
        const input = document.createElement("input");
        input.className = "form-control";
        input.name = name;
        input.type = type;
        input.value = value;
        if (min !== undefined && min !== "") input.min = min;
        if (max !== undefined && max !== "") input.max = max;
        if (["target_weight", "warmup_weight", "weight_increment"].includes(name)) input.step = "0.5";
        if (name === "target_reps") input.maxLength = 30;
        label.append(input);
        row.append(label);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-sm text-rose-400";
    remove.textContent = "Remove exercise";
    const orderControls = document.createElement("div");
    orderControls.className = "flex gap-2";
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "text-sm text-slate-300";
    moveUp.textContent = "Move up";
    moveUp.addEventListener("click", () => {
        const previous = row.previousElementSibling;
        if (previous) row.parentElement.insertBefore(row, previous);
        updateRoutineOrderControls(row.parentElement);
    });
    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "text-sm text-slate-300";
    moveDown.textContent = "Move down";
    moveDown.addEventListener("click", () => {
        const next = row.nextElementSibling;
        if (next) row.parentElement.insertBefore(next, row);
        updateRoutineOrderControls(row.parentElement);
    });
    remove.addEventListener("click", () => {
        const container = row.parentElement;
        row.remove();
        updateRoutineOrderControls(container);
    });
    orderControls.append(moveUp, moveDown, remove);
    row.append(orderControls);
    const container = form.querySelector(".routine-exercise-rows");
    container.append(row);
    updateRoutineOrderControls(container);
}

function updateRoutineOrderControls(container) {
    [...container.querySelectorAll(".routine-exercise-row")].forEach((row, index, rows) => {
        row.querySelectorAll("button")[0].disabled = index === 0;
        row.querySelectorAll("button")[1].disabled = index === rows.length - 1;
    });
}

function filterRoutines() {
    const input = document.getElementById("routine-search");
    const status = document.getElementById("routine-search-status");
    const empty = document.getElementById("routine-search-empty");
    if (!input || !status || !empty) return;
    const query = input.value.trim().toLocaleLowerCase();
    const routines = [...document.querySelectorAll(".routine-card")];
    let visible = 0;
    routines.forEach((routine) => {
        const matches = !query || routine.textContent.toLocaleLowerCase().includes(query);
        routine.classList.toggle("hidden", !matches);
        if (matches) visible += 1;
    });
    const searching = Boolean(query);
    empty.classList.toggle("hidden", !(searching && visible === 0));
    status.textContent = searching
        ? `${visible} routine${visible === 1 ? "" : "s"} match${visible === 1 ? "es" : ""}`
        : `${routines.length} routine${routines.length === 1 ? "" : "s"}`;
}

function initializeRoutineSearch() {
    const input = document.getElementById("routine-search");
    if (!input) return;
    input.addEventListener("input", filterRoutines);
    filterRoutines();
}



function matchesRoutineSlot(entry, item) {
    return entry.routine_slot !== undefined && item.routine_slot !== undefined
        ? Number(entry.routine_slot) === Number(item.routine_slot)
        : (entry.routine_exercise || entry.exercise) === (item.planned_exercise || item.exercise);
}

function routineLoggedSets() {
    let pending = [];
    try { pending = readOfflineQueue(); } catch (_) {}
    const saved = window.progressData || [];
    const ids = new Set(saved.map(entry => entry.entry_id));
    return [...saved, ...pending.filter(entry => !ids.has(entry.entry_id))];
}

function renderSubstitutionChoices() {
    const panel = document.getElementById("routine-substitution");
    const queue = JSON.parse(sessionStorage.getItem("irontrack-routine-queue") || "[]");
    const item = queue[Number(sessionStorage.getItem("irontrack-routine-index") || 0)];
    panel.classList.toggle("hidden", !item || window.activeSessionFinished);
    if (!item) return;
    const select = document.getElementById("substitution-exercise");
    select.replaceChildren();
    const categories = Object.keys(window.exercisesData).sort((a, b) => (b === item.muscle) - (a === item.muscle) || a.localeCompare(b));
    categories.forEach(muscle => (window.exercisesData[muscle] || []).forEach(exercise => {
        if (exercise !== item.exercise) select.add(new Option(`${exercise} · ${muscle}`, JSON.stringify({muscle, exercise})));
    }));
    document.getElementById("substitution-status").textContent = item.exercise !== (item.planned_exercise || item.exercise)
        ? `${item.exercise} replaces ${item.planned_exercise} for this workout. Set targets are shared across both exercises.` : "Your saved routine stays unchanged.";
}

function substituteRoutineExercise(restore = false) {
    const queue = JSON.parse(sessionStorage.getItem("irontrack-routine-queue") || "[]");
    const index = Number(sessionStorage.getItem("irontrack-routine-index") || 0);
    const item = queue[index];
    if (!item) return;
    if (!item.planned_exercise) { item.planned_exercise = item.exercise; item.planned_muscle = item.muscle; }
    if (!item.original_loads) item.original_loads = {target_weight: item.target_weight || "", warmup_weight: item.warmup_weight || "", weight_increment: item.weight_increment || ""};
    if (restore) {
        Object.assign(item, {exercise: item.planned_exercise, muscle: item.planned_muscle}, item.original_loads);
    } else {
        const value = document.getElementById("substitution-exercise").value;
        if (!value) return;
        const replacement = JSON.parse(value);
        if (!(window.exercisesData[replacement.muscle] || []).includes(replacement.exercise)) return;
        Object.assign(item, replacement, {target_weight: "", warmup_weight: "", weight_increment: ""});
    }
    item.routine_slot = index;
    sessionStorage.setItem("irontrack-routine-queue", JSON.stringify(queue));
    selectRoutineExercise(item); applyRoutineTarget(item); refreshRoutineProgress(); renderSubstitutionChoices();
}
