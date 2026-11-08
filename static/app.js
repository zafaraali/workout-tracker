function updateExercises() {
    const muscleSelect = document.getElementById("muscle-select");
    const exerciseSelect = document.getElementById("exercise-select");
    const exercises = window.exercisesData || {};
    const muscle = muscleSelect.value;
    exerciseSelect.replaceChildren();

    [...(exercises[muscle] || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).forEach((exercise) => {
        const option = document.createElement("option");
        option.value = exercise;
        option.textContent = exercise;
        exerciseSelect.appendChild(option);
    });
    applyRestPresetForCurrentSelection();
    showExerciseHistory();
    renderQuickExercises();
}

function prepareLogExerciseForm(event) {
    const muscleSelect = document.getElementById("muscle-select");
    const muscleInput = document.getElementById("log-add-exercise-muscle");
    if (muscleSelect && muscleInput) muscleInput.value = muscleSelect.value;
    window.workoutSubmitInProgress = true;
}

window.libraryPage = 1;
const LIBRARY_PAGE_SIZE = 5;

function filterExerciseLibrary(resetPage = true) {
    const search = document.getElementById("library-search").value.trim().toLocaleLowerCase();
    const selectedCategory = document.getElementById("library-category-filter").value;
    const categories = document.querySelectorAll(".library-category");
    const matchingExercises = [];

    categories.forEach((categoryElement) => {
        const categoryName = categoryElement.dataset.category;
        const categoryMatches = !selectedCategory || categoryName === selectedCategory;

        categoryElement.querySelectorAll(".library-exercise").forEach((exerciseElement) => {
            const matches = categoryMatches
                && exerciseElement.dataset.exercise.toLocaleLowerCase().includes(search);
            if (matches) matchingExercises.push(exerciseElement);
        });
    });

    if (resetPage) window.libraryPage = 1;
    const pageCount = Math.max(1, Math.ceil(matchingExercises.length / LIBRARY_PAGE_SIZE));
    window.libraryPage = Math.min(Math.max(1, window.libraryPage), pageCount);
    const firstItem = (window.libraryPage - 1) * LIBRARY_PAGE_SIZE;
    const pageItems = new Set(matchingExercises.slice(firstItem, firstItem + LIBRARY_PAGE_SIZE));

    categories.forEach((categoryElement) => {
        const categoryItems = [...categoryElement.querySelectorAll(".library-exercise")];
        const visibleInCategory = categoryItems.some((exerciseElement) => pageItems.has(exerciseElement));
        categoryElement.classList.toggle("hidden", !visibleInCategory);
        categoryItems.forEach((exerciseElement) => {
            exerciseElement.classList.toggle("hidden", !pageItems.has(exerciseElement));
        });
    });

    const visibleCount = matchingExercises.length;
    document.getElementById("library-result-count").textContent =
        visibleCount
            ? `${firstItem + 1}–${Math.min(firstItem + LIBRARY_PAGE_SIZE, visibleCount)} of ${visibleCount} exercise${visibleCount === 1 ? "" : "s"}`
            : "0 exercises shown";
    document.getElementById("library-no-results").classList.toggle("hidden", visibleCount > 0);

    const pagination = document.getElementById("library-pagination");
    pagination.classList.toggle("hidden", pageCount <= 1 || visibleCount === 0);
    document.getElementById("library-page-status").textContent = `Page ${window.libraryPage} of ${pageCount}`;
    document.getElementById("library-previous").disabled = window.libraryPage <= 1;
    document.getElementById("library-next").disabled = window.libraryPage >= pageCount;
}

function goToLibraryPage(page) {
    window.libraryPage = page;
    filterExerciseLibrary(false);
    document.getElementById("library-results").scrollTop = 0;
}

function switchTab(tab) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    ["log", "library", "history", "progress", "routines", "measurements", "nutrition", "settings"].forEach((name) => {
        const panel = document.getElementById(`section-${name}`);
        panel.classList.toggle("hidden", name !== tab);
        panel.setAttribute("aria-hidden", String(name !== tab));
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

function toggleMobileHeaderControls() {
    const controls = document.getElementById("header-controls");
    const button = document.getElementById("mobile-header-toggle");
    if (!controls || !button) return;
    const open = controls.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(open));
}

function dismissToast(toast) {
    if (!toast) return;
    toast.classList.remove("toast-visible");
    window.setTimeout(() => toast.remove(), 220);
}

function initializeToasts() {
    document.querySelectorAll("[data-toast]").forEach((toast, index) => {
        window.setTimeout(() => toast.classList.add("toast-visible"), index * 60);
        const duration = toast.dataset.toastType === "error" ? 7000 : 4500;
        window.setTimeout(() => dismissToast(toast), duration + index * 60);
    });
}

function showClientToast(message, type = "success") {
    const container = document.getElementById("toast-container") || (() => {
        const element = document.createElement("div");
        element.id = "toast-container";
        element.className = "toast-container";
        element.setAttribute("aria-live", "polite");
        element.setAttribute("aria-atomic", "false");
        document.body.append(element);
        return element;
    })();
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "toast-error" : "toast-success"}`;
    toast.dataset.toastType = type;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = message;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "toast-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => dismissToast(toast));
    toast.append(text, dismiss);
    container.append(toast);
    window.requestAnimationFrame(() => toast.classList.add("toast-visible"));
    window.setTimeout(() => dismissToast(toast), type === "error" ? 7000 : 4500);
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

function initializeKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
        if (event.key === "/") {
            event.preventDefault();
            const input = document.getElementById("library-search");
            if (input) { switchTab("library"); input.focus(); }
        } else if (event.key.toLocaleLowerCase() === "l") {
            switchTab("log");
            document.getElementById("set-weight")?.focus();
        } else if (event.key.toLocaleLowerCase() === "h") {
            switchTab("history");
        } else if (event.key.toLocaleLowerCase() === "p") {
            switchTab("progress");
        } else if (event.key.toLocaleLowerCase() === "r") {
            switchTab("routines");
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

const WORKOUT_DRAFT_KEY = "irontrack-workout-draft";
const WORKOUT_DRAFT_FIELDS = [
    "muscle", "exercise", "set_type", "unit", "weight", "bodyweight", "reps", "rpe",
    "superset_group", "distance", "distance_unit", "duration", "notes",
];

function initializeWorkoutDraft() {
    const form = document.querySelector('#section-log form[action*="/log"]');
    if (!form) return;
    const date = document.getElementById("workout-date").value;
    try {
        const draft = JSON.parse(sessionStorage.getItem(WORKOUT_DRAFT_KEY) || "null");
        if (draft && draft.date === date && draft.values) {
            WORKOUT_DRAFT_FIELDS.forEach((name) => {
                const field = form.elements.namedItem(name);
                if (field && draft.values[name] !== undefined) field.value = draft.values[name];
            });
            updateExercises();
            document.getElementById("exercise-select").value = draft.values.exercise || "";
            toggleCardioFields();
            const status = document.getElementById("draft-status");
            if (status) status.textContent = "Draft restored from this session.";
        }
    } catch (error) {
        console.warn("Could not restore the workout draft.", error);
    }
    const saveDraft = () => {
        const values = {};
        WORKOUT_DRAFT_FIELDS.forEach((name) => {
            const field = form.elements.namedItem(name);
            if (field) values[name] = field.value;
        });
        sessionStorage.setItem(WORKOUT_DRAFT_KEY, JSON.stringify({date, values}));
    };
    form.addEventListener("input", saveDraft);
    form.addEventListener("change", saveDraft);
}

function clearWorkoutDraft() {
    sessionStorage.removeItem(WORKOUT_DRAFT_KEY);
}

function initializeWorkoutNavigationGuard() {
    // Kept as a compatibility hook for the shared page initializer. The old
    // unload prompt was intentionally removed; submitting a set must not
    // trigger a browser navigation warning.
}

function initializeCsrfForms() {
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) return;
    document.querySelectorAll('form[method="POST"], form[method="post"]').forEach((form) => {
        if (form.querySelector('input[name="csrf_token"]')) return;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "csrf_token";
        input.value = token;
        form.prepend(input);
    });
}

function filterMeasurements() {
    const input = document.getElementById("measurement-search");
    const status = document.getElementById("measurement-search-status");
    const empty = document.getElementById("measurement-search-empty");
    if (!input || !status || !empty) return;
    const query = input.value.trim().toLocaleLowerCase();
    const items = [...document.querySelectorAll(".measurement-history-item")];
    let visible = 0;
    items.forEach((item) => {
        const matches = !query || item.textContent.toLocaleLowerCase().includes(query);
        item.classList.toggle("hidden", !matches);
        if (matches) visible += 1;
    });
    empty.classList.toggle("hidden", !(query && visible === 0));
    status.textContent = query
        ? `${visible} measurement${visible === 1 ? "" : "s"} match${visible === 1 ? "es" : ""}`
        : `${items.length} measurement${items.length === 1 ? "" : "s"}`;
}

function initializeMeasurementSearch() {
    const input = document.getElementById("measurement-search");
    if (!input) return;
    input.addEventListener("input", filterMeasurements);
    filterMeasurements();
}

function initializeSubmitFeedback() {
    document.querySelectorAll('form[method="POST"], form[method="post"]').forEach((form) => {
        const action = form.getAttribute("action") || "";
        if (action.includes("/log") || action.includes("/delete") || action.includes("/restore") || form.hasAttribute("onsubmit")) return;
        form.addEventListener("submit", (event) => {
            if (event.defaultPrevented) return;
            if (form.dataset.submitting === "true") {
                event.preventDefault();
                return;
            }
            const button = event.submitter || form.querySelector('button[type="submit"]');
            if (!button) return;
            form.dataset.submitting = "true";
            form.setAttribute("aria-busy", "true");
            button.disabled = true;
            button.dataset.originalLabel = button.textContent;
            button.textContent = /import/i.test(button.textContent) ? "Importing…" : "Saving…";
        });
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
    const summaryDuration = document.getElementById("session-summary-duration");
    if (summaryDuration) summaryDuration.textContent = formatElapsed(saved);
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
    if (summaryDuration) summaryDuration.textContent = formatElapsed(elapsed);
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

    [...(window.exercisesData[category] || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).forEach((exercise) => {
        const option = document.createElement("option");
        option.value = exercise;
        option.textContent = exercise;
        exerciseSelect.appendChild(option);
    });
    if ((window.exercisesData[category] || []).includes(previousExercise)) {
        exerciseSelect.value = previousExercise;
    }
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

function toggleBodyweightSet() {
    const checkbox = document.getElementById("bodyweight-set");
    const weight = document.getElementById("set-weight");
    if (!checkbox || !weight) return;
    weight.readOnly = checkbox.checked;
    if (checkbox.checked) weight.value = "0";
    updateLoggerSetSummary();
}

function dismissFirstRunGuide() {
    const guide = document.getElementById("first-run-guide");
    if (guide) guide.remove();
    try { localStorage.setItem("irontrack-dismissed-first-run", "1"); } catch (_) {}
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
    const last = records[0];
    document.getElementById("last-performance").textContent = last
        ? `Last set: ${last.weight} ${last.unit || "kg"} × ${last.reps} · ${last.date}`
        : "No previous sets. Log your first set below.";
    updateProgressionSuggestion(records);
    document.getElementById("next-target").textContent =
        document.getElementById("progression-summary").textContent;
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
    const result = trainingProgress(records, document.getElementById("progression-rep-goal").value,
        document.getElementById("progression-weight-goal").value, window.routinesData || []);
    window.progressionTarget = result;
    const progress = document.getElementById("rep-target-progress");
    const status = document.getElementById("training-status");
    if (!result) {
        summary.textContent = "Log working strength sets to get a suggested next target.";
        status.textContent = "No working sets recorded yet.";
        progress.value = 0; progress.max = 1;
        return;
    }
    summary.textContent = `${result.message} Suggested next target: ${result.weight} ${result.unit} × ${result.reps} reps.`;
    status.textContent = `${result.hits}/${result.expected} sets reached ${result.repGoal} reps at the highest working load. ${result.stalled ? "Plateau flagged using estimated 1RM across 3 completed sessions." : result.ready ? "Ready to increase." : "Keep building."}`;
    progress.max = result.expected; progress.value = result.hits;
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
        showClientToast("This exercise is no longer in the library. Restore or add it before copying this set.", "error");
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
        const bodyweight = document.getElementById("bodyweight-set");
        if (bodyweight) {
            bodyweight.checked = Boolean(previous.bodyweight) || String(previous.weight || "") === "0";
            toggleBodyweightSet();
        }
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


function updateThemeLabel() {
    const themeLabel = document.getElementById("theme-label");
    if (themeLabel) themeLabel.textContent =
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
    const soundEnabled = document.getElementById("timer-sound-enabled");
    const vibrationEnabled = document.getElementById("timer-vibration-enabled");
    soundEnabled.checked = localStorage.getItem("irontrack-timer-sound") !== "false";
    vibrationEnabled.checked = localStorage.getItem("irontrack-timer-vibration") !== "false";
    soundEnabled.addEventListener("change", () => {
        localStorage.setItem("irontrack-timer-sound", String(soundEnabled.checked));
    });
    vibrationEnabled.addEventListener("change", () => {
        localStorage.setItem("irontrack-timer-vibration", String(vibrationEnabled.checked));
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
        showClientToast("Choose a rest duration between 1 and 3600 seconds.", "error");
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
    const accentInput = document.getElementById("settings-accent-color");
    if (accentInput) accentInput.value = color;
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
        || document.getElementById("settings-accent-color")?.value
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
            if (document.getElementById("timer-vibration-enabled")?.checked && "vibrate" in navigator) {
                navigator.vibrate([220, 100, 220]);
            }
            if (document.getElementById("timer-sound-enabled")?.checked) {
                playTimerAlarm();
            }
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
