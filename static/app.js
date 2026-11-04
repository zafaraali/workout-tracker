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
}

function switchTab(tab) {
    ["log", "library", "history"].forEach((name) => {
        document.getElementById(`section-${name}`).classList.toggle("hidden", name !== tab);
        const button = document.getElementById(`tab-${name}`);
        button.classList.toggle("bg-emerald-600", name === tab);
        button.classList.toggle("text-white", name === tab);
        button.classList.toggle("text-slate-400", name !== tab);
    });
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
window.restTimer = null;
window.alarmAudioContext = null;
updateThemeLabel();
