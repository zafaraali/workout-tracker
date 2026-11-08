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
        document.getElementById("progress-chart-content").classList.add("hidden");
        const message = document.getElementById("progress-empty-message");
        if (message) {
            message.textContent = (window.progressData || []).length
                ? "No records match this exercise, metric, and date range. Try another exercise or range, or log another set."
                : "Log your first set to start building exercise trends and personal records.";
        }
        summary.textContent = "";
        ["progress-kpi-latest", "progress-kpi-best", "progress-kpi-dates"].forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.textContent = "—";
        });
        document.getElementById("progress-chart-data").replaceChildren();
        return;
    }
    emptyMessage.classList.add("hidden");
    document.getElementById("progress-chart-content").classList.remove("hidden");

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
        circle.setAttribute("tabindex", "0");
        const pointTitle = document.createElementNS(svgNamespace, "title");
        pointTitle.textContent = `${point.date}: ${Number(point.value.toFixed(1))} ${metricLabel}`;
        circle.append(pointTitle);
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
    const best = Math.max(...points.map((point) => point.value));
    summary.textContent = `${points.length} workout date${points.length === 1 ? "" : "s"} · ${metricLabel}. Latest is shown separately from the best value in this range.`;
    const latestKpi = document.getElementById("progress-kpi-latest");
    const bestKpi = document.getElementById("progress-kpi-best");
    const datesKpi = document.getElementById("progress-kpi-dates");
    if (latestKpi) latestKpi.textContent = `${Number(latest.toFixed(1))}`;
    if (bestKpi) bestKpi.textContent = `${Number(best.toFixed(1))}`;
    if (datesKpi) datesKpi.textContent = `${points.length}`;
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
        bar.setAttribute("tabindex", "0");
        const barTitle = document.createElementNS(svgNamespace, "title");
        barTitle.textContent = `Week starting ${week.key}: ${week.volume.toFixed(1)} kg x reps`;
        bar.append(barTitle);
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

function renderMuscleBalanceInsight() {
    const balance = document.getElementById("muscle-balance-insight");
    if (balance) {
        const cutoff = Date.now() - (28 * 24 * 60 * 60 * 1000);
        const volumeByMuscle = new Map();
        (window.progressData || []).forEach((entry) => {
            const date = new Date(`${entry.date}T00:00:00Z`).getTime();
            if (!entry.muscle || !Number.isFinite(date) || date < cutoff) return;
            if (!["working", "drop", "failure"].includes(entry.set_type || "working")) return;
            const weight = Number(entry.weight) * (entry.unit === "lb" ? 0.45359237 : 1);
            const reps = Number(entry.reps);
            if (!Number.isFinite(weight) || !Number.isFinite(reps)) return;
            volumeByMuscle.set(entry.muscle, (volumeByMuscle.get(entry.muscle) || 0) + (weight * reps));
        });
        const ranked = [...volumeByMuscle.entries()].sort((left, right) => right[1] - left[1]);
        if (ranked.length < 2) {
            balance.textContent = "Log working sets across multiple muscle groups to see a balance comparison.";
        } else {
            const highest = ranked[0];
            const lowest = ranked[ranked.length - 1];
            const ratio = lowest[1] ? highest[1] / lowest[1] : Infinity;
            balance.textContent = ratio >= 3
                ? `Recent volume is concentrated on ${highest[0]} (${highest[1].toFixed(0)} kg × reps); ${lowest[0]} is currently lowest (${lowest[1].toFixed(0)} kg × reps).`
                : `Recent volume is distributed across ${ranked.length} muscle groups; highest is ${highest[0]}.`;
        }
    }
}

renderMuscleBalanceInsight();

function initializeProgressDetails() {
    const details = document.getElementById("progress-more-details");
    if (details) details.classList.toggle("hidden", !(window.progressData || []).length);
}

function initializeHistoryLayout() {
    const calendar = document.getElementById("history-calendar");
    if (!calendar) return;
    if (window.matchMedia("(max-width: 640px)").matches) {
        calendar.open = Boolean(new URLSearchParams(window.location.search).get("date"));
        document.querySelectorAll(".history-workout-actions").forEach((details) => {
            details.open = false;
        });
    }
}

function filterHistory() {
    const input = document.getElementById("history-search");
    const typeFilter = document.getElementById("history-type-filter");
    const muscleFilter = document.getElementById("history-muscle-filter");
    const status = document.getElementById("history-search-status");
    const clear = document.getElementById("history-search-clear");
    const empty = document.getElementById("history-search-empty");
    if (!input || !status || !clear || !empty) return;
    const query = input.value.trim().toLocaleLowerCase();
    const selectedType = typeFilter?.value || "";
    const selectedMuscle = muscleFilter?.value || "";
    const workouts = [...document.querySelectorAll(".history-workout")];
    let visible = 0;
    workouts.forEach((workout) => {
        const sets = [...workout.querySelectorAll("[data-history-set]")];
        const matchesSearch = !query || workout.textContent.toLocaleLowerCase().includes(query);
        const matchesFilters = sets.some((set) => {
            const matchesType = !selectedType || set.dataset.setType === selectedType;
            const matchesMuscle = !selectedMuscle || set.dataset.muscle === selectedMuscle;
            return matchesType && matchesMuscle;
        });
        const matches = matchesSearch && matchesFilters;
        workout.classList.toggle("hidden", !matches);
        if (matches) visible += 1;
    });
    const hasFilter = Boolean(query || selectedType || selectedMuscle);
    clear.classList.toggle("hidden", !hasFilter);
    empty.classList.toggle("hidden", !(hasFilter && visible === 0));
    const selectAll = document.getElementById("history-select-all");
    if (selectAll) {
        const visibleCheckboxes = [...document.querySelectorAll(".history-workout:not(.hidden) .history-set-checkbox")];
        const selectedVisible = visibleCheckboxes.filter((checkbox) => checkbox.checked).length;
        selectAll.checked = visibleCheckboxes.length > 0 && selectedVisible === visibleCheckboxes.length;
        selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleCheckboxes.length;
    }
    status.textContent = hasFilter
        ? `${visible} workout${visible === 1 ? "" : "s"} match${visible === 1 ? "es" : ""}`
        : `${workouts.length} workout${workouts.length === 1 ? "" : "s"}`;
}

function clearHistorySearch() {
    const input = document.getElementById("history-search");
    if (!input) return;
    input.value = "";
    const typeFilter = document.getElementById("history-type-filter");
    const muscleFilter = document.getElementById("history-muscle-filter");
    if (typeFilter) typeFilter.value = "";
    if (muscleFilter) muscleFilter.value = "";
    filterHistory();
    input.focus();
}

function initializeHistorySearch() {
    const input = document.getElementById("history-search");
    if (!input) return;
    input.addEventListener("input", filterHistory);
    document.getElementById("history-type-filter")?.addEventListener("change", filterHistory);
    document.getElementById("history-muscle-filter")?.addEventListener("change", filterHistory);
    filterHistory();
}

function parseCsvPreview(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '"') {
            if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
            else quoted = !quoted;
        } else if (character === "," && !quoted) {
            row.push(field); field = "";
        } else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && text[index + 1] === "\n") index += 1;
            row.push(field); field = "";
            if (row.some((value) => value.trim())) rows.push(row);
            row = [];
        } else field += character;
    }
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
}

function initializeCsvPreview() {
    const input = document.getElementById("workouts-file");
    const preview = document.getElementById("csv-import-preview");
    if (!input || !preview) return;
    const form = input.closest("form");
    form?.addEventListener("submit", (event) => {
        if (input.dataset.csvReady === "false") {
            event.preventDefault();
            showClientToast("Choose a CSV with both a date and exercise column before importing.", "error");
        }
    });
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.dataset.csvReady = "false";
        if (!file) { preview.classList.add("hidden"); preview.replaceChildren(); return; }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            const rows = parseCsvPreview(String(reader.result || "")).slice(0, 6);
            preview.replaceChildren();
            if (!rows.length) { preview.textContent = "No CSV rows detected."; preview.classList.remove("hidden"); return; }
            const normalizedHeaders = rows[0].map((header) => header.trim().toLocaleLowerCase());
            const hasDate = ["date", "workout date", "start time"].some((name) => normalizedHeaders.includes(name));
            const hasExercise = ["exercise name", "exercise", "name"].some((name) => normalizedHeaders.includes(name));
            const status = document.createElement("p");
            status.className = `csv-preview-status ${hasDate && hasExercise ? "csv-preview-ready" : "csv-preview-warning"}`;
            status.setAttribute("role", hasDate && hasExercise ? "status" : "alert");
            status.textContent = hasDate && hasExercise
                ? "Ready to import. Existing workouts will be kept."
                : "This file needs both a date and exercise column to import.";
            input.dataset.csvReady = String(hasDate && hasExercise);
            const heading = document.createElement("p");
            heading.className = "csv-preview-heading";
            heading.textContent = `Detected ${rows[0].length} columns · showing up to ${Math.max(0, rows.length - 1)} sample rows`;
            const table = document.createElement("table");
            table.className = "csv-preview-table";
            rows.forEach((values, rowIndex) => {
                const tr = document.createElement("tr");
                values.forEach((value) => {
                    const cell = document.createElement(rowIndex === 0 ? "th" : "td");
                    cell.textContent = value;
                    tr.append(cell);
                });
                table.append(tr);
            });
            preview.append(status, heading, table);
            preview.classList.remove("hidden");
        });
        reader.readAsText(file);
    });
}

function updateBulkHistorySelection() {
    const checkboxes = [...document.querySelectorAll(".history-set-checkbox:checked")];
    const count = document.getElementById("bulk-history-count");
    const deleteButton = document.getElementById("bulk-history-delete");
    const ids = document.getElementById("bulk-history-entry-ids");
    if (!count || !deleteButton || !ids) return;
    count.textContent = `${checkboxes.length} set${checkboxes.length === 1 ? "" : "s"} selected`;
    deleteButton.disabled = checkboxes.length === 0;
    ids.value = checkboxes.map((checkbox) => checkbox.value).join(",");
}

function initializeBulkHistorySelection() {
    const checkboxes = [...document.querySelectorAll(".history-set-checkbox")];
    checkboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", updateBulkHistorySelection);
    });
    const selectAll = document.getElementById("history-select-all");
    selectAll?.addEventListener("change", () => {
        const query = document.getElementById("history-search")?.value.trim().toLocaleLowerCase() || "";
        checkboxes.forEach((checkbox) => {
            const row = checkbox.closest("[data-swipe-set]");
            const visible = row && !row.classList.contains("hidden")
                && (!query || row.closest(".history-workout")?.textContent.toLocaleLowerCase().includes(query));
            if (visible) checkbox.checked = selectAll.checked;
        });
        updateBulkHistorySelection();
    });
    updateBulkHistorySelection();
}

function confirmBulkHistoryDelete(event) {
    const count = document.querySelectorAll(".history-set-checkbox:checked").length;
    if (!count) { event.preventDefault(); return false; }
    return window.confirm(`Delete ${count} selected workout set${count === 1 ? "" : "s"}? You can undo this action once.`);
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
    const recordsSummary = document.getElementById("progress-records");
    recordsSummary.textContent = records.join(" · ");
    recordsSummary.classList.toggle("hidden", records.length === 0);

    const history = document.getElementById("personal-record-history");
    const empty = document.getElementById("personal-record-empty");
    if (!history || !empty) return;
    const milestones = getPersonalRecordMilestones(exercise);
    history.replaceChildren();
    document.getElementById("personal-records-section").classList.toggle("hidden", milestones.length === 0);
    empty.classList.add("hidden");
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

