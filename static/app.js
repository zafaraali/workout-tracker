function updateExercises() {
    const muscleSelect = document.getElementById("muscle-select");
    const exerciseSelect = document.getElementById("exercise-select");
    const exercises = window.exercisesData || {};
    const muscle = muscleSelect.value;
    exerciseSelect.replaceChildren();

    (exercises[muscle] || []).forEach((exercise) => {
        const option = document.createElement("option");
        option.value = exercise;
        option.textContent = exercise;
        exerciseSelect.appendChild(option);
    });
    showExerciseHistory();
}

function filterExerciseLibrary() {
    const search = document.getElementById("library-search").value.trim().toLocaleLowerCase();
    const selectedCategory = document.getElementById("library-category-filter").value;
    const categories = document.querySelectorAll(".library-category");
    let visibleCount = 0;

    categories.forEach((categoryElement) => {
        const categoryName = categoryElement.dataset.category;
        const categoryMatches = !selectedCategory || categoryName === selectedCategory;
        let visibleInCategory = 0;

        categoryElement.querySelectorAll(".library-exercise").forEach((exerciseElement) => {
            const matches = categoryMatches
                && exerciseElement.dataset.exercise.toLocaleLowerCase().includes(search);
            exerciseElement.classList.toggle("hidden", !matches);
            if (matches) {
                visibleInCategory += 1;
            }
        });

        categoryElement.classList.toggle("hidden", !categoryMatches || visibleInCategory === 0);
        visibleCount += visibleInCategory;
    });

    document.getElementById("library-result-count").textContent =
        `${visibleCount} exercise${visibleCount === 1 ? "" : "s"} shown`;
    document.getElementById("library-no-results").classList.toggle("hidden", visibleCount > 0);
}

function switchTab(tab) {
    ["log", "library", "history", "progress", "routines", "measurements"].forEach((name) => {
        document.getElementById(`section-${name}`).classList.toggle("hidden", name !== tab);
        const button = document.getElementById(`tab-${name}`);
        button.classList.toggle("bg-emerald-600", name === tab);
        button.classList.toggle("text-white", name === tab);
        button.classList.toggle("text-slate-400", name !== tab);
        if (name === tab) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });
}

function initializeWorkoutSession() {
    const idField = document.getElementById("session-id");
    const nameField = document.getElementById("session-name");
    const currentDate = document.getElementById("workout-date").value;
    if (sessionStorage.getItem("irontrack-session-date") !== currentDate) {
        sessionStorage.removeItem("irontrack-session-id");
        sessionStorage.removeItem("irontrack-session-name");
    }
    idField.value = idField.value || sessionStorage.getItem("irontrack-session-id") || createSessionId();
    sessionStorage.setItem("irontrack-session-id", idField.value);
    nameField.value = sessionStorage.getItem("irontrack-session-name") || nameField.value || "Workout";
    document.getElementById("routine-session-id").value = idField.value;
    document.getElementById("routine-session-name").value = nameField.value;

    nameField.addEventListener("input", () => {
        sessionStorage.setItem("irontrack-session-name", nameField.value);
        document.getElementById("routine-session-name").value = nameField.value;
    });
    document.getElementById("workout-date").addEventListener("change", () => {
        sessionStorage.removeItem("irontrack-session-id");
        sessionStorage.setItem("irontrack-session-date", document.getElementById("workout-date").value);
        sessionStorage.setItem("irontrack-session-name", "Workout");
        nameField.value = "Workout";
        idField.value = createSessionId();
        document.getElementById("routine-session-id").value = idField.value;
        document.getElementById("routine-session-name").value = nameField.value;
    });
}

function createSessionId() {
    const id = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem("irontrack-session-id", id);
    sessionStorage.setItem("irontrack-session-date", document.getElementById("workout-date").value);
    return id;
}

function startNewWorkoutSession() {
    document.getElementById("session-id").value = createSessionId();
    const nameField = document.getElementById("session-name");
    nameField.value = "Workout";
    sessionStorage.setItem("irontrack-session-name", nameField.value);
    document.getElementById("routine-session-id").value = document.getElementById("session-id").value;
    document.getElementById("routine-session-name").value = nameField.value;
    document.getElementById("muscle-select").focus();
}

function toggleEditSet(index) {
    document.getElementById(`edit-set-${index}`).classList.toggle("hidden");
}

function toggleEditCardioFields(index) {
    const form = document.getElementById(`edit-set-${index}`)
        || document.getElementById(`edit-active-set-${index}`);
    const cardio = form.querySelector('[name="set_type"]').value === "cardio";
    form.querySelector(".edit-strength-fields").classList.toggle("hidden", cardio);
    form.querySelector(".edit-cardio-fields").classList.toggle("hidden", !cardio);
    ["weight", "reps", "rpe"].forEach((name) => {
        form.querySelector(`[name="${name}"]`).required = !cardio;
    });
}

function updateEditExercises(index) {
    const form = document.getElementById(`edit-set-${index}`)
        || document.getElementById(`edit-active-set-${index}`);
    const category = form.querySelector('[name="muscle"]').value;
    const exerciseSelect = form.querySelector('[name="exercise"]');
    const previousExercise = exerciseSelect.value;
    exerciseSelect.replaceChildren();

    (window.exercisesData[category] || []).forEach((exercise) => {
        const option = document.createElement("option");
        option.value = exercise;
        option.textContent = exercise;
        exerciseSelect.appendChild(option);
    });
    if ((window.exercisesData[category] || []).includes(previousExercise)) {
        exerciseSelect.value = previousExercise;
    }
}

function renderProgressChart() {
    const chart = document.getElementById("progress-chart");
    if (!chart) {
        return;
    }

    const exercise = document.getElementById("progress-exercise").value;
    const metric = document.getElementById("progress-metric").value;
    const range = document.getElementById("progress-range").value;
    const emptyMessage = document.getElementById("progress-empty");
    const summary = document.getElementById("progress-summary");
    renderPersonalRecords(exercise);
    const svgNamespace = "http://www.w3.org/2000/svg";
    const cardioMetric = metric.startsWith("cardio-");
    const records = (window.progressData || []).filter(
        (entry) => entry.exercise === exercise
            && (cardioMetric ? entry.set_type === "cardio" : entry.set_type !== "cardio")
    );
    const cutoff = range === "all"
        ? null
        : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime() - Number(range) * 86400000;
    const byDate = new Map();

    records.forEach((entry) => {
        const dateValue = new Date(`${entry.date}T00:00:00Z`).getTime();
        if (!Number.isFinite(dateValue) || (cutoff !== null && dateValue < cutoff)) {
            return;
        }
        const point = byDate.get(entry.date) || { dateValue, value: 0 };
        if (metric === "cardio-distance") {
            if (!entry.distance) return;
            const distance = Number(entry.distance);
            if (Number.isFinite(distance)) {
                point.value += distance * (entry.distance_unit === "mi" ? 1.609344 : 1);
            }
        } else if (metric === "cardio-duration") {
            if (!entry.duration) return;
            const duration = Number(entry.duration);
            if (Number.isFinite(duration)) {
                point.value += duration;
            }
        } else {
            const unit = entry.unit || "kg";
            const weight = Number(entry.weight) * (unit === "lb" ? 0.45359237 : 1);
            const reps = Number(entry.reps);
            if (!Number.isFinite(weight) || !Number.isFinite(reps)) {
                return;
            }
            if (metric === "weight") {
                point.value = Math.max(point.value, weight);
            } else if (metric === "reps") {
                point.value = Math.max(point.value, reps);
            } else {
                point.value += weight * reps;
            }
        }
        byDate.set(entry.date, point);
    });

    const points = [...byDate.entries()]
        .map(([date, point]) => ({ date, ...point }))
        .sort((a, b) => a.dateValue - b.dateValue);
    chart.replaceChildren();

    if (!points.length) {
        emptyMessage.classList.remove("hidden");
        summary.textContent = "";
        return;
    }
    emptyMessage.classList.add("hidden");

    const maxValue = Math.max(...points.map((point) => point.value), 1);
    const chartWidth = 720;
    const chartHeight = 210;
    const left = 60;
    const top = 25;
    const bottom = top + chartHeight;
    const pointX = (index) => left + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1));
    const pointY = (value) => bottom - value / maxValue * chartHeight;

    for (let tick = 0; tick <= 4; tick += 1) {
        const value = maxValue * tick / 4;
        const y = pointY(value);
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", String(left));
        line.setAttribute("x2", String(left + chartWidth));
        line.setAttribute("y1", String(y));
        line.setAttribute("y2", String(y));
        line.setAttribute("class", "chart-gridline");
        chart.appendChild(line);

        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("x", String(left - 8));
        label.setAttribute("y", String(y + 4));
        label.setAttribute("text-anchor", "end");
        label.setAttribute("class", "chart-label");
        label.textContent = Number(value.toFixed(1)).toString();
        chart.appendChild(label);
    }

    const line = document.createElementNS(svgNamespace, "polyline");
    line.setAttribute("points", points.map((point, index) => `${pointX(index)},${pointY(point.value)}`).join(" "));
    line.setAttribute("class", "chart-line");
    chart.appendChild(line);

    points.forEach((point, index) => {
        const circle = document.createElementNS(svgNamespace, "circle");
        circle.setAttribute("cx", String(pointX(index)));
        circle.setAttribute("cy", String(pointY(point.value)));
        circle.setAttribute("r", "5");
        circle.setAttribute("class", "chart-point");
        chart.appendChild(circle);

        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("x", String(pointX(index)));
        label.setAttribute("y", String(bottom + 25));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "chart-label");
        label.textContent = point.date.slice(5);
        chart.appendChild(label);
    });

    const metricLabel = {
        weight: "Best weight (kg)",
        reps: "Best reps",
        volume: "Volume (kg x reps)",
        "cardio-distance": "Distance (km)",
        "cardio-duration": "Duration (minutes)",
    }[metric];
    const latest = points[points.length - 1].value;
    summary.textContent = `${points.length} workout date${points.length === 1 ? "" : "s"} · ${metricLabel} · Latest: ${Number(latest.toFixed(1))}`;
}

function renderPersonalRecords(exercise) {
    const strength = (window.progressData || [])
        .filter((entry) => entry.exercise === exercise && entry.set_type !== "cardio")
        .map((entry) => ({
            entry,
            weight: Number(entry.weight) * (entry.unit === "lb" ? 0.45359237 : 1),
            reps: Number(entry.reps),
        }))
        .filter((item) => Number.isFinite(item.weight) && Number.isFinite(item.reps));
    const bestWeight = strength.reduce((best, item) => Math.max(best, item.weight), 0);
    const bestReps = strength.reduce((best, item) => Math.max(best, item.reps), 0);
    const volumeBySession = new Map();
    strength.forEach((item) => {
        const key = item.entry.session_id || item.entry.date;
        volumeBySession.set(key, (volumeBySession.get(key) || 0) + item.weight * item.reps);
    });
    const bestVolume = Math.max(0, ...volumeBySession.values());
    const cardio = (window.progressData || []).filter(
        (entry) => entry.exercise === exercise && entry.set_type === "cardio"
    );
    const cardioBySession = new Map();
    cardio.forEach((item) => {
        const key = item.session_id || item.date;
        const session = cardioBySession.get(key) || {distance: 0, duration: 0};
        session.distance += Number(item.distance || 0)
            * (item.distance_unit === "mi" ? 1.609344 : 1);
        session.duration += Number(item.duration || 0);
        cardioBySession.set(key, session);
    });
    const cardioDistanceBest = Math.max(0, ...[...cardioBySession.values()].map((item) => item.distance));
    const cardioDurationBest = Math.max(0, ...[...cardioBySession.values()].map((item) => item.duration));
    const strengthSummary = strength.length
        ? `${bestWeight.toFixed(1)} kg · ${bestReps} reps · ${bestVolume.toFixed(1)} kg x reps`
        : "";
    const cardioSummary = cardio.length
        ? `${cardioDistanceBest.toFixed(2)} km / ${cardioDurationBest} min`
        : "";
    const records = [
        strengthSummary ? `Strength PRs: ${strengthSummary}` : "",
        cardioSummary ? `Cardio PRs: ${cardioSummary}` : "",
    ].filter(Boolean);
    document.getElementById("progress-records").textContent =
        records.join(" · ") || "No personal records for this exercise yet.";
}

function toggleCardioFields() {
    const cardio = document.getElementById("set-type").value === "cardio";
    document.getElementById("strength-fields").classList.toggle("hidden", cardio);
    document.getElementById("cardio-fields").classList.toggle("hidden", !cardio);
    ["set-weight", "set-reps", "set-rpe"].forEach((id) => {
        document.getElementById(id).required = !cardio;
    });
    document.getElementById("weight-unit").disabled = cardio;
}

function showExerciseHistory() {
    const exerciseSelect = document.getElementById("exercise-select");
    const list = document.getElementById("exercise-history-list");
    const summary = document.getElementById("exercise-record-summary");
    if (!exerciseSelect || !list || !summary) {
        return;
    }

    const records = (window.progressData || [])
        .filter((entry) => entry.exercise === exerciseSelect.value && entry.set_type !== "cardio")
        .sort((a, b) => b.date.localeCompare(a.date));
    list.replaceChildren();
    window.previousExerciseSet = records[0] || null;
    if (!records.length) {
        summary.textContent = "No previous strength sets for this exercise.";
        return;
    }

    const best = records.reduce((current, entry) => {
        const weight = Number(entry.weight) * (entry.unit === "lb" ? 0.45359237 : 1);
        return weight > current.weight ? {weight, entry} : current;
    }, {weight: -1, entry: records[0]});
    summary.textContent = `Best recorded weight: ${best.entry.weight} ${best.entry.unit || "kg"} × ${best.entry.reps} · ${best.entry.date}`;

    records.slice(0, 5).forEach((entry) => {
        const item = document.createElement("li");
        item.className = "rounded-lg border border-slate-800 bg-slate-950 px-3 py-2";
        item.textContent = `${entry.date} · ${entry.weight} ${entry.unit || "kg"} × ${entry.reps}${entry.rpe ? ` · RPE ${entry.rpe}` : ""}`;
        list.appendChild(item);
    });
}

function copyPreviousSet() {
    const previous = window.previousExerciseSet;
    if (!previous) {
        return;
    }
    document.getElementById("set-type").value = previous.set_type || "working";
    toggleCardioFields();
    if (previous.set_type === "cardio") {
        document.getElementById("set-distance").value = previous.distance || "";
        document.getElementById("set-duration").value = previous.duration || "";
        document.getElementById("distance-unit").value = previous.distance_unit || "km";
    } else {
        document.getElementById("set-weight").value = previous.weight || "0";
        document.getElementById("set-reps").value = previous.reps || "10";
        document.getElementById("set-rpe").value = previous.rpe || "7";
        document.getElementById("weight-unit").value = previous.unit || "kg";
    }
    document.querySelector('#section-log textarea[name="notes"]').value = previous.notes || "";
}

function loadRoutine(routineId) {
    const routine = (window.routinesData || []).find((item) => item.id === routineId);
    if (!routine || !routine.exercises.length) {
        return;
    }
    sessionStorage.setItem("irontrack-routine-queue", JSON.stringify(routine.exercises));
    sessionStorage.setItem("irontrack-routine-index", "0");
    const sessionId = createSessionId();
    document.getElementById("session-id").value = sessionId;
    document.getElementById("routine-session-id").value = sessionId;
    document.getElementById("session-name").value = routine.name;
    sessionStorage.setItem("irontrack-session-name", routine.name);
    document.getElementById("routine-session-name").value = routine.name;
    switchTab("log");
    selectRoutineExercise(routine.exercises[0]);
    applyRoutineTarget(routine.exercises[0]);
    document.getElementById("next-routine-exercise").classList.toggle("hidden", routine.exercises.length < 2);
}

function applyRoutineTarget(item) {
    const reps = Number.parseInt(String(item.target_reps || "10").match(/\d+/)?.[0] || "10", 10);
    document.getElementById("set-type").value = "working";
    toggleCardioFields();
    document.getElementById("set-reps").value = String(reps);
    document.getElementById("set-weight").value = item.target_weight || "0";
    const timerDuration = document.getElementById("timer-duration");
    const restSeconds = String(item.rest_seconds ?? 90);
    if (![...timerDuration.options].some((option) => option.value === restSeconds)) {
        timerDuration.add(new Option(`Custom (${restSeconds} seconds)`, restSeconds));
    }
    timerDuration.value = restSeconds;
    const notice = document.getElementById("routine-target");
    notice.textContent =
        `Routine target: ${item.target_sets || 3} sets x ${item.target_reps || "8-12"}`
        + `${item.target_weight ? ` at ${item.target_weight} ${document.getElementById("weight-unit").value}` : ""}`
        + ` · Rest ${item.rest_seconds ?? 90}s${item.notes ? ` · ${item.notes}` : ""}`;
    notice.classList.remove("hidden");
}

function selectRoutineExercise(item) {
    if (!(window.exercisesData[item.muscle] || []).includes(item.exercise)) {
        window.alert(`${item.exercise} is no longer in the ${item.muscle} library category.`);
        return false;
    }
    const muscleSelect = document.getElementById("muscle-select");
    muscleSelect.value = item.muscle;
    updateExercises();
    document.getElementById("exercise-select").value = item.exercise;
    showExerciseHistory();
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
                target_sets: row.querySelector('[name="target_sets"]').value,
                target_reps: row.querySelector('[name="target_reps"]').value,
                target_weight: row.querySelector('[name="target_weight"]').value,
                rest_seconds: row.querySelector('[name="rest_seconds"]').value,
                notes: row.querySelector('[name="routine-notes"]').value,
            }));
            if (!exercises.length || exercises.some((item) => !item.muscle || !item.exercise)) {
                event.preventDefault();
                window.alert("Add at least one valid exercise to the routine.");
                return;
            }
            form.querySelector('[name="exercises_json"]').value = JSON.stringify(exercises);
        });
    });
}

function addRoutineExercise(form, initial = {}) {
    const row = document.createElement("div");
    row.className = "routine-exercise-row grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 rounded-lg border border-slate-800 p-3";
    const category = document.createElement("select");
    category.name = "routine-muscle";
    category.className = "form-control";
    Object.keys(window.exercisesData || {}).forEach((name) => {
        const option = new Option(name, name);
        category.add(option);
    });
    const exercise = document.createElement("select");
    exercise.name = "routine-exercise";
    exercise.className = "form-control";
    const refreshExercises = () => {
        const previous = exercise.value;
        exercise.replaceChildren();
        (window.exercisesData[category.value] || []).forEach((name) => exercise.add(new Option(name, name)));
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
        ["Sets", "target_sets", initial.target_sets || 3, "number", 1, 30],
        ["Target reps", "target_reps", initial.target_reps || "8-12", "text"],
        ["Target weight", "target_weight", initial.target_weight || "", "number", 0, ""],
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
        if (name === "target_weight") input.step = "0.5";
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

function renderMeasurementChart() {
    const chart = document.getElementById("measurement-chart");
    if (!chart) return;
    const metric = document.getElementById("measurement-metric").value;
    const points = (window.measurementsData || [])
        .filter((entry) => entry[metric] !== "" && Number.isFinite(Number(entry[metric])))
        .map((entry) => ({
            date: entry.date,
            value: metric === "body_weight"
                ? Number(entry.body_weight) * (entry.unit === "lb" ? 0.45359237 : 1)
                : Number(entry[metric]),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    chart.replaceChildren();
    const empty = document.getElementById("measurement-chart-empty");
    if (!points.length) {
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");
    const ns = "http://www.w3.org/2000/svg";
    const left = 60;
    const top = 25;
    const width = 720;
    const height = 210;
    const max = Math.max(...points.map((point) => point.value), 1);
    const x = (index) => left + (points.length === 1 ? width / 2 : index * width / (points.length - 1));
    const y = (value) => top + height - value / max * height;
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", points.map((point, index) => `${x(index)},${y(point.value)}`).join(" "));
    line.setAttribute("class", "chart-line");
    chart.append(line);
    points.forEach((point, index) => {
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", String(x(index)));
        dot.setAttribute("cy", String(y(point.value)));
        dot.setAttribute("r", "5");
        dot.setAttribute("class", "chart-point");
        chart.append(dot);
        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", String(x(index)));
        label.setAttribute("y", String(top + height + 25));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "chart-label");
        label.textContent = point.date.slice(5);
        chart.append(label);
    });
}

const OFFLINE_QUEUE_KEY = "irontrack-pending-workouts";
let offlineSyncInProgress = false;

function readOfflineQueue() {
    const queue = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return queue ? JSON.parse(queue) : [];
}

function setOfflineStatus(message, visible = true) {
    const status = document.getElementById("offline-status");
    if (!status) return;
    document.getElementById("offline-status-text").textContent = message;
    status.classList.toggle("hidden", !visible);
}

function refreshOfflineStatus() {
    try {
        const count = readOfflineQueue().length;
        if (count) {
            setOfflineStatus(`${count} workout${count === 1 ? "" : "s"} waiting to sync.`);
        } else if (!navigator.onLine) {
            setOfflineStatus("You are offline. Workout submissions will be saved on this device.");
        } else {
            setOfflineStatus("", false);
        }
    } catch (error) {
        console.error("Could not read locally queued workouts.", error);
        setOfflineStatus("Local workout queue is unavailable. Do not close this page until your workout is saved.");
    }
}

function initializeOfflineSupport() {
    const workoutForm = document.querySelector('#section-log form[action*="/log"]');
    workoutForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const entryId = workoutForm.querySelector(".entry-id");
        entryId.value = entryId.value || (
            typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        );
        const formData = new FormData(workoutForm);
        try {
            if (navigator.onLine) {
                const response = await fetch(workoutForm.action, {
                    method: "POST",
                    body: formData,
                    redirect: "follow",
                });
                if (!response.ok) throw new Error(`Server returned ${response.status}.`);
                window.location.assign(response.url);
                return;
            }
            queueOfflineWorkout(formData);
        } catch (error) {
            console.warn("Workout submission could not reach the server; it was queued locally.", error);
            try {
                queueOfflineWorkout(formData);
            } catch (queueError) {
                console.error("Workout could not be saved to the local queue.", queueError);
                setOfflineStatus("Could not save this workout locally. Keep this page open and reconnect before retrying.");
            }
        }
    });

    window.addEventListener("online", () => {
        refreshOfflineStatus();
        syncOfflineWorkouts();
    });
    window.addEventListener("offline", refreshOfflineStatus);
    window.addEventListener("focus", () => {
        if (navigator.onLine) syncOfflineWorkouts();
    });
    window.setInterval(() => {
        if (navigator.onLine) syncOfflineWorkouts();
    }, 60000);
    refreshOfflineStatus();
    if (navigator.onLine) syncOfflineWorkouts();

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service-worker.js").catch((error) => {
            console.error("Offline app shell could not be registered.", error);
        });
    }
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        window.installPrompt = event;
        document.getElementById("install-app").classList.remove("hidden");
    });
    document.getElementById("install-app").addEventListener("click", async () => {
        if (!window.installPrompt) return;
        await window.installPrompt.prompt();
        window.installPrompt = null;
        document.getElementById("install-app").classList.add("hidden");
    });
}

function queueOfflineWorkout(formData) {
    const workout = Object.fromEntries(formData.entries());
    const queue = readOfflineQueue();
    if (!queue.some((entry) => entry.entry_id === workout.entry_id)) queue.push(workout);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    document.querySelector(".entry-id").value = "";
    refreshOfflineStatus();
}

async function syncOfflineWorkouts() {
    if (!navigator.onLine || offlineSyncInProgress) {
        refreshOfflineStatus();
        return;
    }
    offlineSyncInProgress = true;
    const button = document.getElementById("sync-offline-workouts");
    if (button) button.disabled = true;
    try {
        const queue = readOfflineQueue();
        while (queue.length) {
            const workout = queue[0];
            const response = await fetch("/log", {
                method: "POST",
                body: new URLSearchParams(workout),
                headers: {"X-Offline-Sync": "true"},
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.error || `Server returned ${response.status}.`);
            }
            queue.shift();
            localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        }
        refreshOfflineStatus();
    } catch (error) {
        console.error("Queued workouts could not be synchronized.", error);
        setOfflineStatus("Some workouts are still waiting to sync. They remain saved on this device.");
    } finally {
        offlineSyncInProgress = false;
        if (button) button.disabled = false;
    }
}

function updateThemeLabel() {
    document.getElementById("theme-label").textContent =
        document.documentElement.classList.contains("dark") ? "☀️ Light mode" : "🌙 Dark mode";
}

function setAccentColor(color) {
    if (!/^#[\da-f]{6}$/i.test(color)) {
        return;
    }

    const root = document.documentElement;
    const [red, green, blue] = color.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16));
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    root.style.setProperty("--accent-color", color);
    root.style.setProperty("--accent-hover", `color-mix(in srgb, ${color} 82%, ${luminance > 0.5 ? "black" : "white"})`);
    root.style.setProperty("--accent-contrast", luminance > 0.58 ? "#0f172a" : "#ffffff");
    localStorage.setItem("irontrack-accent", color);
    document.getElementById("accent-color").value = color;
    document.querySelector('meta[name="theme-color"]').content = color;
}

function resetAccentColor() {
    setAccentColor("#10b981");
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("irontrack-theme", isDark ? "dark" : "light");
    updateThemeLabel();
    setAccentColor(
        localStorage.getItem("irontrack-accent")
        || document.getElementById("accent-color").value
    );
}

function openDatePicker(inputId) {
    const input = document.getElementById(inputId);
    if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
    }

    input.focus();
    input.click();
}

function startTimer() {
    if (window.restTimer !== null) {
        return;
    }

    const duration = Number.parseInt(document.getElementById("timer-duration").value, 10);
    const display = document.getElementById("timer-display");
    const headerTimer = document.getElementById("active-timer");
    const startButton = document.getElementById("timer-start");
    const stopButton = document.getElementById("timer-stop");
    display.classList.remove("hidden");
    startButton.disabled = true;
    stopButton.disabled = false;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
        window.alarmAudioContext = window.alarmAudioContext || new AudioContext();
        if (window.alarmAudioContext.state === "suspended") {
            window.alarmAudioContext.resume().catch((error) => {
                console.error("Could not enable the timer alarm audio.", error);
            });
        }
    }

    const finishAt = Date.now() + duration * 1000;
    const renderTime = () => {
        const remaining = Math.max(0, Math.ceil((finishAt - Date.now()) / 1000));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const formattedTime = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        display.textContent = formattedTime;
        headerTimer.textContent = `⏱ ${formattedTime}`;
    };

    headerTimer.classList.remove("hidden");
    renderTime();
    window.restTimer = window.setInterval(() => {
        if (Date.now() >= finishAt) {
            window.clearInterval(window.restTimer);
            window.restTimer = null;
            headerTimer.classList.add("hidden");
            startButton.disabled = false;
            stopButton.disabled = true;
            display.textContent = "⏱️ Rest finished!";
            playTimerAlarm();
            return;
        }
        renderTime();
    }, 250);
}

function playTimerAlarm() {
    const audioContext = window.alarmAudioContext;
    if (!audioContext || audioContext.state !== "running") {
        return;
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startAt = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, startAt);

    for (let beep = 0; beep < 4; beep += 1) {
        const beepStart = startAt + beep * 0.45;
        gain.gain.setTargetAtTime(0.2, beepStart, 0.01);
        gain.gain.setTargetAtTime(0.0001, beepStart + 0.2, 0.02);
    }

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 1.65);
}

function stopTimer() {
    if (window.restTimer === null) {
        return;
    }

    window.clearInterval(window.restTimer);
    window.restTimer = null;
    document.getElementById("timer-start").disabled = false;
    document.getElementById("timer-stop").disabled = true;
    document.getElementById("active-timer").classList.add("hidden");
    document.getElementById("timer-display").textContent = "Timer stopped";
}

window.exercisesData = {};
window.progressData = [];
window.restTimer = null;
window.alarmAudioContext = null;
updateThemeLabel();
