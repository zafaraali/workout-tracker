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
        renderPendingWorkouts();
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
    if (!workoutForm) return;
    const submitButton = workoutForm.querySelector('button[type="submit"]');
    workoutForm.addEventListener("submit", async (event) => {
        if (event.defaultPrevented || window.workoutSubmitInProgress) return;
        event.preventDefault();
        window.workoutSubmitInProgress = true;
        workoutForm.setAttribute("aria-busy", "true");
        const originalSubmitLabel = submitButton?.textContent || "Log Set";
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Saving…";
        }
        const restoreSubmitButton = () => {
            window.workoutSubmitInProgress = false;
            workoutForm.removeAttribute("aria-busy");
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalSubmitLabel;
            }
        };
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
                    headers: {"X-Offline-Sync": "true"},
                });
                const result = await response.json();
                if (!response.ok || !result.ok) {
                    document.getElementById("sign-in-to-sync").classList.toggle("hidden", response.status !== 401);
                    setOfflineStatus(result.error || "Could not save this set. Refresh the page and retry.");
                    restoreSubmitButton();
                    return;
                }
                if (document.getElementById("auto-start-rest").checked) {
                    sessionStorage.setItem(
                        "irontrack-pending-rest-timer",
                        document.getElementById("timer-duration").value
                    );
                }
                clearWorkoutDraft();
                window.location.assign(`/?tab=log&date=${encodeURIComponent(formData.get("date"))}&session_id=${encodeURIComponent(formData.get("session_id"))}`);
                return;
            }
            queueOfflineWorkout(formData);
            restoreSubmitButton();
            clearWorkoutDraft();
            if (document.getElementById("auto-start-rest").checked) startTimer();
        } catch (error) {
            console.warn("Workout submission could not reach the server; it was queued locally.", error);
            try {
                queueOfflineWorkout(formData);
                restoreSubmitButton();
            } catch (queueError) {
                console.error("Workout could not be saved to the local queue.", queueError);
                restoreSubmitButton();
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
    window.addEventListener("storage", refreshOfflineStatus);
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
    const installButton = document.getElementById("install-app");
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        window.installPrompt = event;
        installButton?.classList.remove("hidden");
    });
    installButton?.addEventListener("click", async () => {
        if (!window.installPrompt) return;
        await window.installPrompt.prompt();
        window.installPrompt = null;
        installButton.classList.add("hidden");
    });
    window.addEventListener("appinstalled", () => {
        window.installPrompt = null;
        installButton?.classList.add("hidden");
        showClientToast("IronTrack was installed successfully.");
    });
}

function queueOfflineWorkout(formData) {
    const workout = Object.fromEntries(formData.entries());
    delete workout.csrf_token;
    const queue = readOfflineQueue();
    if (!queue.some((entry) => entry.entry_id === workout.entry_id)) queue.push(workout);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    showClientToast("Set saved on this device and queued to sync when you reconnect.");
    document.querySelector(".entry-id").value = "";
    refreshOfflineStatus();
    refreshRoutineProgress();
    const queueItems = JSON.parse(sessionStorage.getItem("irontrack-routine-queue") || "[]");
    const item = queueItems[Number(sessionStorage.getItem("irontrack-routine-index") || 0)];
    if (item) applyRoutineTarget(item);
}

async function syncOfflineWorkouts() {
    if (!navigator.onLine || offlineSyncInProgress) return;
    const run = async () => {
        offlineSyncInProgress = true;
        try {
            const tokenResponse = await fetch("/csrf-token", {cache: "no-store"});
            if (!tokenResponse.ok) {
                document.getElementById("sign-in-to-sync").classList.toggle("hidden", tokenResponse.status !== 401);
                throw new Error("Sign in to refresh your security token.");
            }
            document.getElementById("sign-in-to-sync").classList.add("hidden");
            const {csrf_token} = await tokenResponse.json();
            for (const workout of readOfflineQueue()) {
                const payload = {...workout, csrf_token};
                delete payload.sync_error;
                const response = await fetch("/log", {
                    method: "POST", body: new URLSearchParams(payload),
                    headers: {"X-Offline-Sync": "true"},
                });
                const result = await response.json().catch(() => ({}));
                // Re-read after every request so newly queued sets are preserved.
                const current = readOfflineQueue();
                if (response.ok && result.ok) {
                    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(current.filter(entry => entry.entry_id !== workout.entry_id)));
                    showClientToast(`${workout.exercise || "Workout set"} synced successfully.`);
                } else {
                    const failed = current.find(entry => entry.entry_id === workout.entry_id);
                    if (failed) failed.sync_error = result.error || `Server returned ${response.status}. Retry after reconnecting.`;
                    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(current));
                    if (response.status === 401) document.getElementById("sign-in-to-sync").classList.remove("hidden");
                    if (response.status >= 500 || response.status === 403 || response.status === 401) break;
                }
            }
        } catch (error) {
            console.error("Queued workouts could not be synchronized.", error);
            setOfflineStatus("Pending sets remain on this device. Reconnect and retry.");
        } finally {
            offlineSyncInProgress = false;
            refreshOfflineStatus();
        }
    };
    // Coordinate tabs as well as retries within this page.
    if (navigator.locks) await navigator.locks.request("irontrack-sync", {ifAvailable: true}, lock => lock ? run() : undefined);
    else await run();
}

function renderPendingWorkouts() {
    const panel = document.getElementById("queued-workouts");
    const list = document.getElementById("queued-workouts-list");
    if (!panel || !list) return;
    const queue = readOfflineQueue();
    panel.classList.toggle("hidden", !queue.length);
    list.replaceChildren();
    queue.forEach(workout => {
        const item = document.createElement("li");
        const label = document.createElement("p");
        label.textContent = `${workout.exercise} · ${workout.date}${workout.sync_error ? ` · ${workout.sync_error}` : " · Pending"}`;
        item.append(label);
        const form = document.createElement("form");
        ["date", "muscle", "exercise", "set_type", "weight", "unit", "reps", "rpe", "distance", "distance_unit", "duration", "notes"].forEach(name => {
            const fieldLabel = document.createElement("label");
            fieldLabel.textContent = name.replaceAll("_", " ");
            fieldLabel.className = "field-label";
            const field = document.createElement("input");
            field.name = name;
            field.value = workout[name] || ({set_type: "working", unit: "kg", distance_unit: "km"}[name] || "");
            field.className = "form-control";
            fieldLabel.append(field);
            form.append(fieldLabel);
        });
        const keepRoutine = document.createElement("input");
        keepRoutine.type = "checkbox";
        keepRoutine.checked = Boolean(workout.routine_id);
        if (workout.routine_id) {
            const label = document.createElement("label");
            label.append(keepRoutine, document.createTextNode(" Keep this set linked to its routine"));
            form.append(label);
        }
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = "Save changes and retry";
        save.className = "underline p-2";
        form.append(save);
        form.addEventListener("submit", event => {
            event.preventDefault();
            const current = readOfflineQueue();
            const entry = current.find(entry => entry.entry_id === workout.entry_id);
            if (entry) {
                Object.assign(entry, Object.fromEntries(new FormData(form)), {sync_error: ""});
                if (!keepRoutine.checked) { delete entry.routine_id; delete entry.routine_slot; delete entry.routine_exercise; }
            }
            localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(current));
            syncOfflineWorkouts();
        });
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Edit pending set";
        details.append(summary, form);
        item.append(details);
        list.append(item);
    });
}
