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
    applyRestPresetForCurrentSelection();
    showExerciseHistory();
    renderQuickExercises();
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
        const selected = name === tab;
        button.classList.toggle("bg-emerald-600", name === tab);
        button.classList.toggle("text-white", name === tab);
        button.classList.toggle("text-slate-400", name !== tab);
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        if (selected) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });
}

function initializeAccessibleNavigation() {
    const navigation = document.querySelector(".app-nav");
    if (!navigation) return;
    navigation.addEventListener("keydown", (event) => {
        const tabs = [...navigation.querySelectorAll('[role="tab"]')];
        const currentIndex = tabs.indexOf(event.target);
        if (currentIndex < 0) return;
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = tabs.length - 1;
        }
        if (nextIndex === null) return;
        event.preventDefault();
        const tab = tabs[nextIndex];
        tab.focus();
        switchTab(tab.id.replace(/^tab-/, ""));
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
    const savedRoutineId = sessionStorage.getItem("irontrack-routine-session-id") === idField.value
        ? sessionStorage.getItem("irontrack-routine-id")
        : "";
    const routineId = window.activeSessionRoutineId || savedRoutineId || "";
    document.getElementById("workout-routine-id").value = routineId;
    if (routineId) {
        sessionStorage.setItem("irontrack-routine-id", routineId);
        sessionStorage.setItem("irontrack-routine-session-id", idField.value);
    } else {
        sessionStorage.removeItem("irontrack-routine-id");
        sessionStorage.removeItem("irontrack-routine-session-id");
    }
    nameField.value = sessionStorage.getItem("irontrack-session-name") || nameField.value || "Workout";
    document.getElementById("routine-session-id").value = idField.value;
    document.getElementById("routine-session-name").value = nameField.value;
    const startKey = `irontrack-session-start-${idField.value}`;
    if (!sessionStorage.getItem(startKey) && (window.activeSessionStarted || Number(document.getElementById("session-duration").dataset.elapsed))) {
        const savedDuration = Number(document.getElementById("session-duration").dataset.elapsed || 0);
        sessionStorage.setItem(startKey, String(Date.now() - savedDuration * 1000));
    }
    if (window.activeSessionFinished) {
        document.getElementById("session-duration").textContent =
            `Finished · ${formatElapsed(Number(document.getElementById("session-duration").dataset.elapsed || 0))}`;
        document.getElementById("start-workout").classList.add("hidden");
    } else {
        updateSessionDuration();
        document.getElementById("start-workout").classList.toggle("hidden", Boolean(sessionStorage.getItem(startKey)));
        window.sessionDurationInterval = window.setInterval(updateSessionDuration, 1000);
    }
    document.querySelector('#section-log form[action*="/log"]').addEventListener("submit", updateElapsedField);
    const finishForm = document.getElementById("finish-session-form");
    if (finishForm) {
        finishForm.addEventListener("submit", (event) => {
            updateElapsedField(event);
            sessionStorage.removeItem("irontrack-routine-queue");
            sessionStorage.removeItem("irontrack-routine-index");
            sessionStorage.removeItem("irontrack-routine-id");
            sessionStorage.removeItem("irontrack-routine-session-id");
            sessionStorage.removeItem(`irontrack-session-start-${idField.value}`);
            sessionStorage.removeItem("irontrack-session-id");
            sessionStorage.removeItem("irontrack-session-name");
        });
    }

    nameField.addEventListener("input", () => {
        sessionStorage.setItem("irontrack-session-name", nameField.value);
        document.getElementById("routine-session-name").value = nameField.value;
    });
    document.getElementById("workout-date").addEventListener("change", () => {
        sessionStorage.removeItem("irontrack-routine-queue");
        sessionStorage.removeItem("irontrack-routine-index");
        sessionStorage.removeItem("irontrack-routine-id");
        sessionStorage.removeItem("irontrack-routine-session-id");
        document.getElementById("workout-routine-id").value = "";
        document.getElementById("routine-target").classList.add("hidden");
        document.getElementById("next-routine-exercise").classList.add("hidden");
        sessionStorage.removeItem("irontrack-session-id");
        sessionStorage.setItem("irontrack-session-date", document.getElementById("workout-date").value);
        sessionStorage.setItem("irontrack-session-name", "Workout");
        nameField.value = "Workout";
        idField.value = createSessionId();
        resetWorkoutClock();
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

function startWorkoutClock() {
    const sessionId = document.getElementById("session-id").value;
    sessionStorage.setItem(`irontrack-session-start-${sessionId}`, String(Date.now()));
    document.getElementById("start-workout").classList.add("hidden");
    updateSessionDuration();
}

function resetWorkoutClock() {
    const sessionId = document.getElementById("session-id").value;
    sessionStorage.removeItem(`irontrack-session-start-${sessionId}`);
    const durationElement = document.getElementById("session-duration");
    durationElement.dataset.elapsed = "0";
    document.getElementById("start-workout").classList.remove("hidden");
    updateSessionDuration();
}

function updateElapsedField(event) {
    const sessionId = document.getElementById("session-id").value;
    const startKey = `irontrack-session-start-${sessionId}`;
    if (!sessionStorage.getItem(startKey)) {
        sessionStorage.setItem(startKey, String(Date.now()));
    }
    document.getElementById("start-workout").classList.add("hidden");
    const start = Number(sessionStorage.getItem(startKey));
    const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const field = event.currentTarget.querySelector('[name="elapsed_seconds"]');
    if (field) field.value = String(elapsed);
}

function updateSessionDuration() {
    const durationElement = document.getElementById("session-duration");
    if (!durationElement) return;
    const sessionId = document.getElementById("session-id").value;
    const start = Number(sessionStorage.getItem(`irontrack-session-start-${sessionId}`));
    const saved = Number(durationElement.dataset.elapsed || 0);
    if (!start) {
        durationElement.textContent = `Not started · ${formatElapsed(saved)}`;
        const field = document.getElementById("elapsed-seconds");
        if (field) field.value = String(saved);
        return;
    }
    const elapsed = Math.max(saved, Math.floor((Date.now() - start) / 1000));
    durationElement.textContent = `In progress · ${formatElapsed(elapsed)}`;
    const field = document.getElementById("elapsed-seconds");
    if (field) field.value = String(elapsed);
}

function formatElapsed(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours
        ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
        : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function startNewWorkoutSession() {
    sessionStorage.removeItem("irontrack-routine-queue");
    sessionStorage.removeItem("irontrack-routine-index");
    sessionStorage.removeItem("irontrack-routine-id");
    sessionStorage.removeItem("irontrack-routine-session-id");
    document.getElementById("workout-routine-id").value = "";
    document.getElementById("routine-target").classList.add("hidden");
    document.getElementById("next-routine-exercise").classList.add("hidden");
    document.getElementById("session-id").value = createSessionId();
    resetWorkoutClock();
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
    const metricLabel = {
        weight: "Best weight (kg)",
        reps: "Best reps",
        volume: "Volume (kg x reps)",
        "estimated-1rm": "Estimated 1RM (kg, Epley estimate)",
        "cardio-distance": "Distance (km)",
        "cardio-duration": "Duration (minutes)",
    }[metric];
    chart.setAttribute("aria-label", `${exercise} ${metricLabel} progress chart`);
    renderPersonalRecords(exercise);
    const svgNamespace = "http://www.w3.org/2000/svg";
    const cardioMetric = metric.startsWith("cardio-");
    const records = (window.progressData || []).filter(
        (entry) => entry.exercise === exercise
            && (cardioMetric
                ? entry.set_type === "cardio"
                : entry.set_type !== "cardio"
                    && (metric !== "estimated-1rm"
                        || (entry.set_type !== "warmup"
                            && Number(entry.weight) > 0
                            && Number(entry.reps) >= 1
                            && Number(entry.reps) <= 15)))
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
            } else if (metric === "estimated-1rm") {
                if (weight > 0 && reps >= 1 && reps <= 15) {
                    point.value = Math.max(point.value, weight * (1 + reps / 30));
                }
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
        const message = document.getElementById("progress-empty-message");
        if (message) {
            message.textContent = (window.progressData || []).length
                ? "No records match this exercise, metric, and date range. Try another exercise or range, or log another set."
                : "Log your first set to start building exercise trends and personal records.";
        }
        summary.textContent = "";
        document.getElementById("progress-chart-data").replaceChildren();
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

    const latest = points[points.length - 1].value;
    summary.textContent = `${points.length} workout date${points.length === 1 ? "" : "s"} · ${metricLabel} · Latest: ${Number(latest.toFixed(1))}`;
    const dataList = document.getElementById("progress-chart-data");
    dataList.replaceChildren();
    points.forEach((point) => {
        const item = document.createElement("li");
        item.textContent = `${point.date}: ${Number(point.value.toFixed(1))} ${metricLabel}`;
        dataList.append(item);
    });
}

function renderMuscleVolumeChart() {
    const chart = document.getElementById("muscle-volume-chart");
    const categorySelect = document.getElementById("muscle-volume-category");
    const summary = document.getElementById("muscle-volume-summary");
    const dataList = document.getElementById("muscle-volume-data");
    if (!chart || !categorySelect || !summary || !dataList) return;

    const category = categorySelect.value;
    const today = new Date();
    const currentMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    currentMonday.setUTCDate(currentMonday.getUTCDate() - ((currentMonday.getUTCDay() + 6) % 7));
    const weeks = Array.from({length: 8}, (_, index) => {
        const start = new Date(currentMonday);
        start.setUTCDate(start.getUTCDate() - (7 * (7 - index)));
        return {start, key: start.toISOString().slice(0, 10), volume: 0};
    });
    const weekByKey = new Map(weeks.map((week) => [week.key, week]));
    (window.progressData || []).forEach((entry) => {
        if (entry.muscle !== category || !["working", "drop", "failure"].includes(entry.set_type || "working")) return;
        const date = new Date(`${entry.date}T00:00:00Z`);
        if (!Number.isFinite(date.getTime())) return;
        const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        const bucket = weekByKey.get(monday.toISOString().slice(0, 10));
        const weight = Number(entry.weight) * (entry.unit === "lb" ? 0.45359237 : 1);
        const reps = Number(entry.reps);
        if (bucket && Number.isFinite(weight) && Number.isFinite(reps)) bucket.volume += weight * reps;
    });

    chart.replaceChildren();
    dataList.replaceChildren();
    const svgNamespace = "http://www.w3.org/2000/svg";
    const left = 60;
    const top = 25;
    const chartWidth = 720;
    const chartHeight = 210;
    const bottom = top + chartHeight;
    const maxVolume = Math.max(...weeks.map((week) => week.volume), 1);
    for (let tick = 0; tick <= 4; tick += 1) {
        const y = bottom - chartHeight * tick / 4;
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", String(left));
        line.setAttribute("x2", String(left + chartWidth));
        line.setAttribute("y1", String(y));
        line.setAttribute("y2", String(y));
        line.setAttribute("class", "chart-gridline");
        chart.append(line);
    }
    const slot = chartWidth / weeks.length;
    weeks.forEach((week, index) => {
        const height = week.volume / maxVolume * chartHeight;
        const bar = document.createElementNS(svgNamespace, "rect");
        bar.setAttribute("x", String(left + index * slot + slot * 0.2));
        bar.setAttribute("y", String(bottom - height));
        bar.setAttribute("width", String(slot * 0.6));
        bar.setAttribute("height", String(height));
        bar.setAttribute("rx", "4");
        bar.setAttribute("class", "chart-point");
        chart.append(bar);
        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("x", String(left + index * slot + slot / 2));
        label.setAttribute("y", String(bottom + 25));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "chart-label");
        label.textContent = week.key.slice(5);
        chart.append(label);
        const item = document.createElement("li");
        item.textContent = `Week starting ${week.key}: ${week.volume.toFixed(1)} kg × reps`;
        dataList.append(item);
    });
    const thisWeek = weeks[7].volume;
    const previousWeek = weeks[6].volume;
    const difference = thisWeek - previousWeek;
    const comparison = previousWeek
        ? `${difference >= 0 ? "+" : ""}${((difference / previousWeek) * 100).toFixed(1)}% vs last week`
        : "No prior-week volume to compare";
    summary.textContent = `${category}: this week ${thisWeek.toFixed(1)} kg × reps; last week ${previousWeek.toFixed(1)} kg × reps (${comparison}). Eight weekly totals are listed below.`;
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

    const history = document.getElementById("personal-record-history");
    const empty = document.getElementById("personal-record-empty");
    if (!history || !empty) return;
    const milestones = getPersonalRecordMilestones(exercise);
    history.replaceChildren();
    empty.classList.toggle("hidden", milestones.length > 0);
    milestones.slice(-12).reverse().forEach((milestone) => {
        const item = document.createElement("li");
        item.className = "flex flex-wrap justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2";
        const label = document.createElement("span");
        label.textContent = milestone.label;
        const value = document.createElement("span");
        value.className = "font-medium text-emerald-400";
        value.textContent = milestone.value;
        item.append(label, value);
        const date = document.createElement("time");
        date.className = "w-full text-xs text-slate-500";
        date.dateTime = milestone.date;
        date.textContent = milestone.date;
        item.append(date);
        history.append(item);
    });
}

function getPersonalRecordMilestones(exercise) {
    const sessions = new Map();
    (window.progressData || []).forEach((entry, index) => {
        if (entry.exercise !== exercise) return;
        const key = entry.session_id || entry.date;
        const session = sessions.get(key) || {date: entry.date, strength: [], cardio: []};
        if (entry.set_type === "cardio") session.cardio.push(entry);
        else session.strength.push(entry);
        session.index = index;
        sessions.set(key, session);
    });

    const ordered = [...sessions.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.index - b.index
    );
    const records = new Map();
    const milestones = [];
    const consider = (metric, label, value, date, format) => {
        if (!Number.isFinite(value) || value <= 0 || value <= (records.get(metric) || 0)) return;
        records.set(metric, value);
        milestones.push({label, value: format(value), date});
    };
    ordered.forEach((session) => {
        session.strength.forEach((entry) => {
            const weight = Number(entry.weight) * (entry.unit === "lb" ? 0.45359237 : 1);
            const reps = Number(entry.reps);
            consider("weight", "Best weight", weight, session.date, (value) => `${value.toFixed(1)} kg`);
            consider("reps", "Best reps", reps, session.date, (value) => `${Math.round(value)} reps`);
        });
        if (session.strength.length) {
            const volume = session.strength.reduce((total, entry) => {
                const weight = Number(entry.weight) * (entry.unit === "lb" ? 0.45359237 : 1);
                const reps = Number(entry.reps);
                return Number.isFinite(weight) && Number.isFinite(reps) ? total + weight * reps : total;
            }, 0);
            consider("volume", "Best session volume", volume, session.date, (value) => `${value.toFixed(1)} kg × reps`);
        }
        if (session.cardio.length) {
            const distance = session.cardio.reduce((total, entry) => {
                const value = Number(entry.distance || 0);
                return Number.isFinite(value)
                    ? total + value * (entry.distance_unit === "mi" ? 1.609344 : 1)
                    : total;
            }, 0);
            const duration = session.cardio.reduce((total, entry) => {
                const value = Number(entry.duration || 0);
                return Number.isFinite(value) ? total + value : total;
            }, 0);
            consider("cardio-distance", "Best cardio distance", distance, session.date, (value) => `${value.toFixed(2)} km`);
            consider("cardio-duration", "Best cardio duration", duration, session.date, (value) => `${Math.round(value)} min`);
        }
    });
    return milestones;
}

function toggleCardioFields() {
    const cardio = document.getElementById("set-type").value === "cardio";
    document.getElementById("strength-fields").classList.toggle("hidden", cardio);
    document.getElementById("cardio-fields").classList.toggle("hidden", !cardio);
    if (cardio) document.querySelector(".set-options").open = true;
    ["set-weight", "set-reps", "set-rpe"].forEach((id) => {
        document.getElementById(id).required = !cardio;
    });
    document.getElementById("weight-unit").disabled = cardio;
    updateLoggerSetSummary();
    applyRestPresetForCurrentSelection();
}

function updateLoggerSetSummary() {
    const summary = document.getElementById("logger-set-type");
    if (!summary) return;
    const setType = document.getElementById("set-type").selectedOptions[0].textContent;
    const unit = document.getElementById("weight-unit").value;
    const rpe = document.getElementById("set-rpe").value;
    summary.textContent = setType === "Cardio"
        ? "Cardio · distance or duration"
        : `${setType} · ${unit} · RPE ${rpe}`;
}

function showExerciseHistory() {
    const exerciseSelect = document.getElementById("exercise-select");
    const list = document.getElementById("exercise-history-list");
    const summary = document.getElementById("exercise-record-summary");
    if (!exerciseSelect || !list || !summary) {
        return;
    }

    const records = (window.progressData || [])
        .map((entry, index) => ({entry, index}))
        .filter(({entry}) => entry.exercise === exerciseSelect.value && entry.set_type !== "cardio")
        .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.index - a.index)
        .map(({entry}) => entry);
    list.replaceChildren();
    window.previousExerciseSet = records[0] || null;
    updateProgressionSuggestion(records);
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

function updateProgressionSuggestion(records) {
    const summary = document.getElementById("progression-summary");
    const weightGoalInput = document.getElementById("progression-weight-goal");
    if (!summary || !weightGoalInput) return;
    const strength = records.filter((entry) => entry.set_type !== "cardio");
    if (!strength.length) {
        summary.textContent = "Log strength sets to get a suggested next target.";
        window.progressionTarget = null;
        return;
    }
    const latest = strength[0];
    const latestSession = latest.session_id || latest.date;
    const latestSets = strength.filter((entry) => (entry.session_id || entry.date) === latestSession);
    const unit = latestSets[0].unit || "kg";
    const convertedSets = latestSets.map((entry) => ({
        ...entry,
        weightInUnit: Number(entry.weight) * (
            (entry.unit || "kg") === unit ? 1
                : unit === "kg" ? 0.45359237 : 1 / 0.45359237
        ),
    }));
    const bestSet = convertedSets.reduce((best, entry) =>
        entry.weightInUnit > best.weightInUnit ? entry : best, convertedSets[0]);
    const repGoal = Number(document.getElementById("progression-rep-goal").value) || 12;
    const achieved = convertedSets.length > 0
        && convertedSets.every((entry) => Number(entry.reps) >= repGoal && Number(entry.rpe || 10) <= 8);
    const increment = unit === "lb" ? 5 : 2.5;
    let targetWeight = Number(bestSet.weightInUnit);
    let targetReps = Math.min(repGoal, Number(bestSet.reps) + 1);
    if (achieved) {
        targetWeight += increment;
        targetReps = Math.max(1, Math.min(repGoal, Number(bestSet.reps)));
    }
    const userWeightGoal = Number(weightGoalInput.value);
    if (userWeightGoal > 0) {
        targetWeight = Math.min(targetWeight, Math.max(Number(bestSet.weightInUnit), userWeightGoal));
        if (userWeightGoal <= Number(bestSet.weightInUnit)) {
            targetReps = Math.min(repGoal, Number(bestSet.reps) + 1);
        }
    }
    window.progressionTarget = {weight: targetWeight, reps: targetReps, unit};
    summary.textContent = `${achieved ? "You met your rep goal at a controlled effort." : "Build reps at your recent load."} Suggested next target: ${targetWeight} ${unit} × ${targetReps} reps.`;
}

function applyProgressionSuggestion() {
    const target = window.progressionTarget;
    if (!target) return;
    document.getElementById("set-type").value = "working";
    toggleCardioFields();
    document.getElementById("weight-unit").value = target.unit;
    document.getElementById("set-weight").value = String(target.weight);
    document.getElementById("set-reps").value = String(target.reps);
}

function updateGoalMetricUnit() {
    const metric = document.getElementById("goal-metric").value;
    const unit = document.getElementById("goal-unit");
    const direction = document.getElementById("goal-direction");
    const isWeight = metric === "body_weight";
    unit.replaceChildren(
        new Option(isWeight ? "kg" : "cm", isWeight ? "kg" : "cm"),
        ...(isWeight ? [new Option("lb", "lb")] : [])
    );
    direction.querySelector('[value="increase"]').disabled = !isWeight;
    if (!isWeight) direction.value = "decrease";
}

function initializeSessionStructure() {
    const container = document.getElementById("active-session-exercises");
    const form = document.getElementById("session-structure-form");
    if (!container || !form) return;
    container.querySelectorAll(".move-exercise-up").forEach((button) => {
        button.addEventListener("click", () => {
            const group = button.closest(".active-exercise-group");
            if (group.previousElementSibling) container.insertBefore(group, group.previousElementSibling);
        });
    });
    container.querySelectorAll(".move-exercise-down").forEach((button) => {
        button.addEventListener("click", () => {
            const group = button.closest(".active-exercise-group");
            if (group.nextElementSibling) container.insertBefore(group.nextElementSibling, group);
        });
    });
    form.addEventListener("submit", (event) => {
        const groups = [...container.querySelectorAll(".active-exercise-group")];
        form.querySelector('[name="exercise_order"]').value = JSON.stringify(
            groups.map((group) => group.dataset.exercise)
        );
        form.querySelector('[name="superset_groups"]').value = JSON.stringify(
            Object.fromEntries(groups.map((group) => [
                group.dataset.exercise,
                group.querySelector(".exercise-superset").value,
            ]))
        );
        if (!groups.length) event.preventDefault();
    });
}

function copyPreviousSet() {
    const previous = window.previousExerciseSet;
    if (previous) copyWorkoutEntry(previous);
}

function copyWorkoutSet(index) {
    const entry = (window.progressData || [])[index];
    if (!entry) return;
    const category = Object.keys(window.exercisesData || {}).find(
        (name) => window.exercisesData[name].includes(entry.exercise)
    );
    if (!category) {
        window.alert("This exercise is no longer in the library. Restore or add it before copying this set.");
        return;
    }
    document.getElementById("muscle-select").value = category;
    updateExercises();
    document.getElementById("exercise-select").value = entry.exercise;
    copyWorkoutEntry(entry);
    switchTab("log");
    document.getElementById("set-weight").focus();
}

function copyWorkoutEntry(previous) {
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
    applyRestPresetForCurrentSelection();
}

function favoriteExercises() {
    try {
        const value = JSON.parse(localStorage.getItem("irontrack-favorite-exercises") || "[]");
        return Array.isArray(value) ? value : [];
    } catch (error) {
        console.error("Could not read favorite exercises.", error);
        return [];
    }
}

function exerciseKey(muscle, exercise) {
    return `${muscle}\u0000${exercise}`;
}

function toggleFavoriteExercise() {
    const key = exerciseKey(
        document.getElementById("muscle-select").value,
        document.getElementById("exercise-select").value
    );
    const favorites = favoriteExercises();
    const updated = favorites.includes(key)
        ? favorites.filter((item) => item !== key)
        : [...favorites, key];
    localStorage.setItem("irontrack-favorite-exercises", JSON.stringify(updated));
    renderQuickExercises();
}

function selectQuickExercise(muscle, exercise) {
    document.getElementById("muscle-select").value = muscle;
    updateExercises();
    document.getElementById("exercise-select").value = exercise;
    showExerciseHistory();
}

function renderQuickExercises() {
    const container = document.getElementById("quick-exercises");
    if (!container) return;
    const favorites = favoriteExercises();
    const entries = [];
    const seen = new Set();
    const append = (muscle, exercise, isFavorite) => {
        const key = exerciseKey(muscle, exercise);
        if (seen.has(key) || !(window.exercisesData[muscle] || []).includes(exercise)) return;
        seen.add(key);
        entries.push({muscle, exercise, isFavorite});
    };
    favorites.forEach((key) => {
        const [muscle, exercise] = key.split("\u0000");
        if (muscle && exercise) append(muscle, exercise, true);
    });
    [...(window.progressData || [])].reverse().forEach((entry) => {
        const muscle = entry.muscle || Object.keys(window.exercisesData || {}).find(
            (category) => (window.exercisesData[category] || []).includes(entry.exercise)
        );
        if (muscle) append(muscle, entry.exercise, false);
    });
    const selectedMuscle = document.getElementById("muscle-select").value;
    (window.exercisesData[selectedMuscle] || []).forEach((exercise) => append(selectedMuscle, exercise, false));
    container.replaceChildren();
    entries.slice(0, 8).forEach(({muscle, exercise, isFavorite}) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "quick-exercise-chip";
        button.textContent = `${isFavorite ? "★ " : ""}${exercise}`;
        button.title = `${muscle}: ${exercise}`;
        button.addEventListener("click", () => selectQuickExercise(muscle, exercise));
        container.append(button);
    });
    const currentKey = exerciseKey(
        document.getElementById("muscle-select").value,
        document.getElementById("exercise-select").value
    );
    const isFavorite = favorites.includes(currentKey);
    const toggle = document.getElementById("favorite-exercise-toggle");
    toggle.textContent = isFavorite ? "★ Remove favorite" : "☆ Favorite this exercise";
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
    selectRoutineExercise(routine.exercises[0]);
    applyRoutineTarget(routine.exercises[0]);
    document.getElementById("next-routine-exercise").classList.toggle("hidden", routine.exercises.length < 2);
    refreshRoutineProgress();
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
    const exerciseSets = (window.progressData || []).filter(
        (entry) => entry.session_id === sessionId
            && entry.exercise === item.exercise
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
    const exerciseId = `${item.muscle}\u0000${item.exercise}`;
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
    const loggedSets = (window.progressData || []).filter(
        (entry) => entry.session_id === sessionId
            && entry.exercise === item.exercise
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
        refreshRoutineProgress();
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
                window.alert("Add at least one valid exercise to the routine.");
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
    routine.exercises.forEach((planned) => {
        const measures = (session) => {
            const sets = session.sets.filter((entry) => entry.exercise === planned.exercise);
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

function renderMeasurementChart() {
    const chart = document.getElementById("measurement-chart");
    if (!chart) return;
    const metric = document.getElementById("measurement-metric").value;
    const metricName = {
        body_weight: "Body weight",
        waist: "Waist",
        chest: "Chest",
        hips: "Hips",
    }[metric];
    chart.setAttribute("aria-label", `${metricName} measurement history chart`);
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
    const summary = document.getElementById("measurement-chart-summary");
    const dataList = document.getElementById("measurement-chart-data");
    dataList.replaceChildren();
    if (!points.length) {
        empty.classList.remove("hidden");
        summary.textContent = `No ${metric.replace("_", " ")} measurements have been recorded.`;
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
        const listItem = document.createElement("li");
        const unit = metric === "body_weight" ? "kg" : "cm";
        listItem.textContent = `${point.date}: ${point.value.toFixed(1)} ${unit}`;
        dataList.append(listItem);
    });
    const unit = metric === "body_weight" ? "kg" : "cm";
    summary.textContent =
        `${points.length} measurement${points.length === 1 ? "" : "s"} · Latest: ${points[points.length - 1].value.toFixed(1)} ${unit} on ${points[points.length - 1].date}`;
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
                if (document.getElementById("auto-start-rest").checked) {
                    sessionStorage.setItem(
                        "irontrack-pending-rest-timer",
                        document.getElementById("timer-duration").value
                    );
                }
                window.location.assign(response.url);
                return;
            }
            queueOfflineWorkout(formData);
            if (document.getElementById("auto-start-rest").checked) startTimer();
        } catch (error) {
            console.warn("Workout submission could not reach the server; it was queued locally.", error);
            try {
                queueOfflineWorkout(formData);
            } catch (queueError) {
                console.error("Workout could not be saved to the local queue.", queueError);
                setOfflineStatus("Could not save this workout locally. Keep this page open and reconnect before retrying.");
                return;
            }
            if (document.getElementById("auto-start-rest").checked) startTimer();
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

function initializeRestPresets() {
    const typePresets = readRestPresetMap("irontrack-rest-set-type");
    const type = document.getElementById("set-type").value;
    const select = document.getElementById("set-type-rest-preset");
    if (typePresets[type]) {
        ensureTimerOption(select, typePresets[type]);
        select.value = String(typePresets[type]);
    }
    const autoStart = document.getElementById("auto-start-rest");
    autoStart.checked = localStorage.getItem("irontrack-auto-start-rest") === "true";
    autoStart.addEventListener("change", () => {
        localStorage.setItem("irontrack-auto-start-rest", String(autoStart.checked));
    });
    document.getElementById("set-type").addEventListener("change", updateLoggerSetSummary);
    document.getElementById("weight-unit").addEventListener("change", updateLoggerSetSummary);
    document.getElementById("set-rpe").addEventListener("input", updateLoggerSetSummary);
    document.getElementById("set-type-rest-preset").addEventListener("change", () => {
        const timer = document.getElementById("timer-duration");
        ensureTimerOption(timer, select.value);
        timer.value = select.value;
    });
    const pending = sessionStorage.getItem("irontrack-pending-rest-timer");
    if (pending) {
        sessionStorage.removeItem("irontrack-pending-rest-timer");
        ensureTimerOption(document.getElementById("timer-duration"), pending);
        document.getElementById("timer-duration").value = pending;
        startTimer();
    }
    applyRestPresetForCurrentSelection();
}

function readRestPresetMap(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "{}");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
        console.error(`Could not read rest presets from ${key}.`, error);
        return {};
    }
}

function ensureTimerOption(select, value) {
    if (![...select.options].some((option) => option.value === String(value))) {
        select.add(new Option(`Custom (${value} seconds)`, String(value)));
    }
}

function applyRestPresetForCurrentSelection() {
    const timer = document.getElementById("timer-duration");
    const setType = document.getElementById("set-type");
    const muscle = document.getElementById("muscle-select");
    const exercise = document.getElementById("exercise-select");
    if (!timer || !setType || !muscle || !exercise) return;
    const exercisePresets = readRestPresetMap("irontrack-rest-exercises");
    const typePresets = readRestPresetMap("irontrack-rest-set-type");
    const selected = exercisePresets[exerciseKey(muscle.value, exercise.value)]
        || typePresets[setType.value];
    if (selected === undefined) return;
    ensureTimerOption(timer, selected);
    timer.value = String(selected);
}

function saveRestPreset(scope) {
    const duration = Number(document.getElementById("timer-duration").value);
    if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
        window.alert("Choose a rest duration between 1 and 3600 seconds.");
        return;
    }
    const key = scope === "exercise" ? "irontrack-rest-exercises" : "irontrack-rest-set-type";
    const presets = readRestPresetMap(key);
    const presetKey = scope === "exercise"
        ? exerciseKey(document.getElementById("muscle-select").value, document.getElementById("exercise-select").value)
        : document.getElementById("set-type").value;
    presets[presetKey] = duration;
    localStorage.setItem(key, JSON.stringify(presets));
    if (scope === "set-type") {
        document.getElementById("set-type-rest-preset").value = String(duration);
    }
    document.getElementById("rest-preset-status").textContent =
        `Saved ${duration}-second ${scope === "exercise" ? "exercise" : "set-type"} rest preset.`;
}

function scheduleAutomaticRestTimer() {
    if (document.getElementById("auto-start-rest").checked) startTimer();
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
    display.textContent = "Timer starting";
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
