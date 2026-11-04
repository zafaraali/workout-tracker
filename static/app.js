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
    const svgNamespace = "http://www.w3.org/2000/svg";
    const records = (window.progressData || []).filter(
        (entry) => entry.exercise === exercise && entry.set_type !== "cardio"
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
        const unit = entry.unit || "kg";
        const weight = Number(entry.weight) * (unit === "lb" ? 0.45359237 : 1);
        const reps = Number(entry.reps);
        if (!Number.isFinite(weight) || !Number.isFinite(reps)) {
            return;
        }

        const point = byDate.get(entry.date) || { dateValue, value: 0 };
        if (metric === "weight") {
            point.value = Math.max(point.value, weight);
        } else if (metric === "reps") {
            point.value = Math.max(point.value, reps);
        } else {
            point.value += weight * reps;
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

    const metricLabel = metric === "weight" ? "Best weight (kg)" : metric === "reps" ? "Best reps" : "Volume (kg × reps)";
    const latest = points[points.length - 1].value;
    summary.textContent = `${points.length} workout date${points.length === 1 ? "" : "s"} · ${metricLabel} · Latest: ${Number(latest.toFixed(1))}`;
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
    document.getElementById("next-routine-exercise").classList.toggle("hidden", routine.exercises.length < 2);
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
        document.getElementById("next-routine-exercise").classList.toggle("hidden", nextIndex >= queue.length - 1);
    }
}

function updateThemeLabel() {
    document.getElementById("theme-label").textContent =
        document.documentElement.classList.contains("dark") ? "☀️ Light mode" : "🌙 Dark mode";
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("irontrack-theme", isDark ? "dark" : "light");
    updateThemeLabel();
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
