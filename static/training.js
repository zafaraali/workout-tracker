function trainingProgress(records, repGoal, weightGoal, routines = []) {
    const eligible = records.filter(entry => ["working", "failure"].includes(entry.set_type || "working")
        && Number.isFinite(Number(entry.weight)) && Number(entry.weight) >= 0 && Number(entry.reps) > 0);
    if (!eligible.length) return null;
    repGoal = Math.max(1, Math.min(1000, Number(repGoal) || 12));
    const sessions = new Map();
    eligible.forEach(entry => {
        const key = entry.session_id || `${entry.date}:${entry.session_name || ""}`;
        if (!sessions.has(key)) sessions.set(key, []);
        sessions.get(key).push(entry);
    });
    const latest = [...sessions.values()][0];
    const unit = latest[0].unit || "kg";
    const load = entry => Number(entry.weight) * ((entry.unit || "kg") === unit ? 1 : unit === "kg" ? 0.45359237 : 1 / 0.45359237);
    const best = latest.reduce((a, b) => load(b) > load(a) ? b : a);
    const routine = routines.find(routine => routine.id === latest[0].routine_id);
    const plan = routine?.exercises.find((item, index) => latest[0].routine_slot !== undefined
        ? index === Number(latest[0].routine_slot) : item.exercise === latest[0].exercise);
    const expected = Math.max(latest.length, Number(plan?.target_sets || 0));
    const base = load(best);
    const hits = latest.filter(entry => load(entry) + 0.0001 >= base && Number(entry.reps) >= repGoal).length;
    const finished = latest.every(entry => entry.finished !== false);
    const ready = finished && hits >= expected && latest.every(entry => entry.rpe !== "" && entry.rpe != null && Number(entry.rpe) <= 8);
    const completed = [...sessions.values()].filter(sets => sets.every(entry => entry.finished !== false));
    const scores = completed.slice(0, 3).map(sets => Math.max(...sets.map(entry => load(entry) * (1 + Number(entry.reps) / 30))));
    const stalled = scores.length === 3 && scores[0] <= scores[2] + 0.0001 && scores[1] <= scores[2] + 0.0001;
    let weight = base + (ready ? (unit === "lb" ? 5 : 2.5) : 0);
    if (Number(weightGoal) > base) weight = Math.min(weight, Number(weightGoal));
    return {
        hits, expected, repGoal, stalled, ready,
        weight: Number(weight.toFixed(2)), unit,
        reps: ready ? Math.max(1, Math.min(repGoal, Number(best.reps))) : Math.min(repGoal, Number(best.reps) + 1),
        message: ready ? "Rep target met across every planned set at RPE 8 or below. Try the next load."
            : stalled ? "No estimated strength improvement across your last 3 completed sessions. Repeat the load and review your rep target."
            : !finished ? "Session in progress. Finish the workout before increasing the load."
            : "Build reps at your recent load before increasing weight.",
    };
}

function adjustLogger(fieldId, amount) {
    const field = document.getElementById(fieldId);
    const minimum = Number(field.min || 0);
    const next = Math.max(minimum, Number(field.value || 0) + amount);
    field.value = String(Number(next.toFixed(2)));
    field.dispatchEvent(new Event("input", {bubbles: true}));
    document.getElementById("quick-log-status").textContent = `${fieldId === "set-weight" ? "Weight" : "Reps"}: ${field.value}`;
}

function calculatePlates() {
    const weightField = document.getElementById("set-weight");
    const unit = document.getElementById("weight-unit").value;
    const output = document.getElementById("plate-calculator-result");
    if (!weightField || !output) return;
    const target = Number(weightField.value);
    const bar = unit === "lb" ? 45 : 20;
    const available = unit === "lb" ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
    let remainder = (target - bar) / 2;
    if (!Number.isFinite(remainder) || remainder <= 0) {
        output.textContent = target === bar ? `Empty bar (${bar} ${unit})` : `Below the ${bar} ${unit} bar`; 
        return;
    }
    const plates = [];
    available.forEach((plate) => {
        const count = Math.floor((remainder + 0.00001) / plate);
        if (count > 0) {
            plates.push(`${count}× ${plate} ${unit}`);
            remainder -= count * plate;
        }
    });
    output.textContent = remainder > 0.01
        ? `Per side: ${plates.join(", ")} (unmatched ${remainder.toFixed(2)} ${unit})`
        : `Per side: ${plates.join(", ")}`;
}

function validateLoggerFields() {
    const type = document.getElementById("set-type")?.value;
    const message = document.getElementById("logger-validation-message");
    if (!message) return true;
    const fields = ["set-weight", "set-reps", "set-rpe"]
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    fields.forEach((field) => field.setCustomValidity(""));
    if (type === "cardio") { message.textContent = ""; return true; }
    const weight = Number(document.getElementById("set-weight")?.value);
    const reps = Number(document.getElementById("set-reps")?.value);
    const rpe = Number(document.getElementById("set-rpe")?.value);
    let error = "";
    let field = null;
    if (!Number.isFinite(weight) || weight < 0) {
        error = "Enter a weight of 0 or more.";
        field = document.getElementById("set-weight");
    } else if (!Number.isInteger(reps) || reps < 1) {
        error = "Enter at least 1 rep.";
        field = document.getElementById("set-reps");
    } else if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) {
        error = "RPE must be a whole number from 1 to 10.";
        field = document.getElementById("set-rpe");
    }
    message.textContent = error;
    if (field && error) field.setCustomValidity(error);
    return !error;
}

function initializeLoggerValidation() {
    const form = document.querySelector('#section-log form[action*="/log"]');
    if (!form) return;
    ["set-type", "set-weight", "set-reps", "set-rpe"].forEach((id) => {
        const field = document.getElementById(id);
        field?.addEventListener("input", validateLoggerFields);
        field?.addEventListener("change", validateLoggerFields);
        field?.addEventListener("invalid", validateLoggerFields);
    });
    form.addEventListener("submit", (event) => {
        if (!validateLoggerFields()) {
            event.preventDefault();
            document.querySelector("#logger-validation-message")?.scrollIntoView({block: "nearest"});
        }
    });
}

function toggleCompactLog(force) {
    const enabled = typeof force === "boolean"
        ? force
        : !document.body.classList.contains("compact-log");
    document.body.classList.toggle("compact-log", enabled);
    const button = document.getElementById("compact-log-toggle");
    if (button) {
        button.textContent = enabled ? "Full mode" : "Compact mode";
        button.setAttribute("aria-pressed", String(enabled));
    }
    localStorage.setItem("irontrack-compact-log", String(enabled));
}

function initializeCompactLog() {
    toggleCompactLog(localStorage.getItem("irontrack-compact-log") === "true");
}

function initializeFastLogging() {
    document.getElementById("set-weight").inputMode = "decimal";
    document.getElementById("set-reps").inputMode = "numeric";
    const step = document.getElementById("weight-increment");
    try { step.value = localStorage.getItem("irontrack-weight-increment") || "2.5"; } catch (_) {}
    if (!step.value) step.value = "2.5";
    step.addEventListener("change", () => localStorage.setItem("irontrack-weight-increment", step.value));
    document.querySelectorAll("[data-swipe-set]").forEach(row => {
        const actions = document.createElement("div");
        actions.className = "swipe-actions hidden";
        const index = Number(row.dataset.swipeSet);
        const add = (text, action) => {
            const button = document.createElement("button");
            button.type = "button"; button.textContent = text;
            button.addEventListener("click", action); actions.append(button);
        };
        add("Repeat set", () => copyWorkoutSet(index));
        add("Edit set", () => toggleEditSet(index));
        add("Delete set", () => row.querySelector('form[action$="/delete"]').requestSubmit());
        add("Close actions", () => actions.classList.add("hidden"));
        row.append(actions);
        let start = null;
        row.addEventListener("touchstart", event => {
            if (event.target.closest("input, select, textarea, button, a, form")) return;
            start = {x: event.touches[0].clientX, y: event.touches[0].clientY};
        }, {passive: true});
        row.addEventListener("touchend", event => {
            if (!start) return;
            const end = event.changedTouches[0];
            if (Math.abs(end.clientX - start.x) > 70 && Math.abs(end.clientY - start.y) < 30) actions.classList.remove("hidden");
            start = null;
        }, {passive: true});
        row.addEventListener("touchcancel", () => { start = null; });
    });
}

function prepareSignOut(event) {
    try {
        if (readOfflineQueue().length) {
            event.preventDefault();
            setOfflineStatus("Sync your pending sets before signing out so they are not lost.");
            return false;
        }
    } catch (_) {
        event.preventDefault();
        setOfflineStatus("Your pending queue could not be checked. Resolve it before signing out.");
        return false;
    }
    window.workoutSubmitInProgress = true;
    return true;
}
