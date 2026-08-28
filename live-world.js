window.addEventListener("DOMContentLoaded", () => {
  const dashboard = document.querySelector("[data-live-dashboard]");
  if (!dashboard) return;

  const statusEndpoint = dashboard.dataset.statusEndpoint;
  const historyEndpoint = dashboard.dataset.historyEndpoint;
  const statusText = dashboard.querySelector("[data-dashboard-status]");
  const countText = dashboard.querySelector("[data-dashboard-count]");
  const updatedText = dashboard.querySelector("[data-dashboard-updated]");
  const pulse = dashboard.querySelector("[data-dashboard-pulse]");
  const roster = dashboard.querySelector("[data-dashboard-roster]");
  const coverage = dashboard.querySelector("[data-history-coverage]");
  const hourlyChart = dashboard.querySelector("[data-hourly-chart]");
  const dailyHistory = dashboard.querySelector("[data-daily-history]");
  const weeklyHistory = dashboard.querySelector("[data-weekly-history]");
  const monthlyHistory = dashboard.querySelector("[data-monthly-history]");
  const yearlyHistory = dashboard.querySelector("[data-yearly-history]");
  const allTimeHistory = dashboard.querySelector("[data-all-time-history]");
  const weekTrend = dashboard.querySelector("[data-trend-week]");
  const monthTrend = dashboard.querySelector("[data-trend-month]");

  const metric = (name) => dashboard.querySelector(`[data-metric-${name}]`);
  const metricContext = (name) => dashboard.querySelector(`[data-metric-${name}-context]`);
  const sampleLabel = (samples) => `${samples} five-minute sample${samples === 1 ? "" : "s"}`;
  const valueOrDash = (value, suffix = "") => value === null || value === undefined ? "—" : `${value}${suffix}`;

  const replaceList = (element, values, emptyMessage) => {
    element.replaceChildren();
    const items = values.length ? values : [emptyMessage];
    items.forEach((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      element.appendChild(item);
    });
  };

  const renderStatus = (data) => {
    const online = data.online === true && Number.isInteger(data.playerCount);
    statusText.textContent = online
      ? (data.stale ? "Last known world signal" : "The world is online")
      : "Signal temporarily unavailable";
    countText.textContent = online ? String(data.playerCount) : "Unavailable";
    metric("current").textContent = online ? String(data.playerCount) : "—";
    pulse.classList.toggle("is-online", online && !data.stale);

    const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    updatedText.textContent = updatedAt && !Number.isNaN(updatedAt.getTime())
      ? updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "Unavailable";

    const names = Array.isArray(data.playerNames)
      ? data.playerNames.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim())
      : [];
    replaceList(roster, names, online && data.playerCount === 0 ? "No adventurers are online." : "Character names are temporarily unavailable.");
  };

  const renderHourly = (rows) => {
    hourlyChart.replaceChildren();
    if (!rows.length) {
      const message = document.createElement("p");
      message.className = "small";
      message.textContent = "The first hourly activity sample is still being collected.";
      hourlyChart.appendChild(message);
      return;
    }

    const highest = Math.max(1, ...rows.map((row) => row.peakPlayers || 0));
    rows.forEach((row) => {
      const column = document.createElement("div");
      column.className = "live-activity-column";
      const peak = row.peakPlayers || 0;
      column.setAttribute("aria-label", `${new Date(row.timestamp).toLocaleString()}: peak ${peak} players, ${valueOrDash(row.uptimePercentage, "%")} uptime`);

      const value = document.createElement("span");
      value.className = "live-activity-value";
      value.textContent = String(peak);
      const track = document.createElement("span");
      track.className = "live-activity-track";
      const bar = document.createElement("span");
      bar.className = "live-activity-bar";
      bar.style.height = `${Math.max(6, Math.round((peak / highest) * 100))}%`;
      track.appendChild(bar);
      const label = document.createElement("time");
      label.dateTime = new Date(row.timestamp).toISOString();
      label.textContent = new Date(row.timestamp).toLocaleTimeString([], { hour: "numeric" });
      column.append(value, track, label);
      hourlyChart.appendChild(column);
    });
  };

  const renderPeriodRows = (element, rows, labelFor, emptyMessage) => {
    element.replaceChildren();
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.textContent = emptyMessage;
      row.appendChild(cell);
      element.appendChild(row);
      return;
    }

    rows.forEach((entry) => {
      const row = document.createElement("tr");
      const values = [
        labelFor(entry),
        valueOrDash(entry.uptimePercentage, "%"),
        valueOrDash(entry.averagePlayers),
        valueOrDash(entry.peakPlayers),
        valueOrDash(entry.playerHours),
        valueOrDash(entry.activePercentage, "%"),
      ];
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      element.appendChild(row);
    });
  };

  const periodChange = (current, previous, periodName) => {
    if (!current || !previous || current.averagePlayers === null || previous.averagePlayers === null) {
      return `${periodName} comparison will appear after enough history is collected.`;
    }
    const difference = current.averagePlayers - previous.averagePlayers;
    if (previous.averagePlayers === 0) {
      return difference > 0
        ? `${periodName} average is ${current.averagePlayers}; the preceding period had no recorded activity.`
        : `${periodName} average remains at 0.`;
    }
    const percentage = Math.abs(100 * difference / previous.averagePlayers).toFixed(1);
    const direction = difference > 0 ? "up" : difference < 0 ? "down" : "unchanged";
    return direction === "unchanged"
      ? `${periodName} average is unchanged at ${current.averagePlayers}.`
      : `${periodName} average is ${current.averagePlayers}, ${direction} ${percentage}% from the preceding period.`;
  };

  const renderRecords = (records = {}) => {
    const set = (name, value) => {
      const element = dashboard.querySelector(`[data-record-${name}]`);
      if (element) element.textContent = value;
    };
    set("peak", valueOrDash(records.allTimePeak));

    if (records.busiestDay) {
      set("day", new Date(records.busiestDay.timestamp).toLocaleDateString([], {
        month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
      }));
      set("day-detail", `${valueOrDash(records.busiestDay.playerHours)} player-hours · peak ${valueOrDash(records.busiestDay.peakPlayers)}`);
    }

    if (records.busiestHour) {
      set("hour", new Date(records.busiestHour.timestamp).toLocaleString([], {
        month: "short", day: "numeric", hour: "numeric", timeZoneName: "short",
      }));
      set("hour-detail", `${valueOrDash(records.busiestHour.averagePlayers)} average · peak ${valueOrDash(records.busiestHour.peakPlayers)}`);
    }

    if (records.popularWeekday) {
      set("weekday", records.popularWeekday.name);
      set("weekday-detail", `${valueOrDash(records.popularWeekday.averagePlayers)} average players`);
    }

    if (records.popularHour && Number.isInteger(records.popularHour.hourUtc)) {
      const now = new Date();
      const example = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), records.popularHour.hourUtc));
      set("time", example.toLocaleTimeString([], { hour: "numeric" }));
      set("time-detail", `${valueOrDash(records.popularHour.averagePlayers)} average players · converted from UTC`);
    }
  };

  const renderHistory = (data) => {
    const day = data.summary.last24Hours;
    const week = data.summary.last7Days;
    const month = data.summary.last30Days;
    metric("peak24").textContent = valueOrDash(day.peakPlayers);
    metric("average7").textContent = valueOrDash(week.averagePlayers);
    metric("average30").textContent = valueOrDash(month.averagePlayers);
    metric("hours30").textContent = valueOrDash(month.playerHours);
    metric("active30").textContent = valueOrDash(month.activePercentage, "%");
    metric("uptime30").textContent = valueOrDash(month.uptimePercentage, "%");
    metric("peak-all").textContent = valueOrDash(data.records?.allTimePeak);
    metricContext("peak24").textContent = sampleLabel(day.samples);
    metricContext("average7").textContent = sampleLabel(week.samples);
    metricContext("average30").textContent = sampleLabel(month.samples);
    metricContext("hours30").textContent = `${sampleLabel(month.samples)} represented`;
    metricContext("active30").textContent = "Samples with players online";
    metricContext("uptime30").textContent = "Successful world checks";

    weekTrend.textContent = periodChange(week, data.summary.previous7Days, "Seven-day");
    monthTrend.textContent = periodChange(month, data.summary.previous30Days, "30-day");

    if (data.trackingSince) {
      const since = new Date(data.trackingSince);
      coverage.textContent = `Tracking began ${since.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. ${data.totalSamples} sample${data.totalSamples === 1 ? " has" : "s have"} been collected; percentages reflect collected samples only.`;
    } else {
      coverage.textContent = "Preparing the first historical sample…";
    }
    renderHourly(data.hourly || []);
    renderPeriodRows(
      dailyHistory,
      data.daily || [],
      (entry) => new Date(entry.timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
      "The first daily activity sample is still being collected.",
    );
    renderPeriodRows(
      weeklyHistory,
      data.weekly || [],
      (entry) => {
        const start = new Date(entry.timestamp);
        const end = new Date(entry.timestamp + 6 * 86400000);
        const startLabel = start.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
        const endLabel = end.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
        return `${startLabel}–${endLabel}`;
      },
      "The first weekly activity summary is still being collected.",
    );
    renderPeriodRows(
      monthlyHistory,
      data.monthly || [],
      (entry) => new Date(entry.timestamp).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" }),
      "The first monthly activity summary is still being collected.",
    );
    renderPeriodRows(
      yearlyHistory,
      data.yearly || [],
      (entry) => new Date(entry.timestamp).toLocaleDateString([], { year: "numeric", timeZone: "UTC" }),
      "The first yearly activity summary is still being collected.",
    );
    allTimeHistory.replaceChildren();
    const allTimeRow = document.createElement("tr");
    const allTime = data.summary.allTime || {};
    const allTimeValues = [
      data.trackingSince
        ? `Since ${new Date(data.trackingSince).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
        : "All recorded history",
      valueOrDash(allTime.uptimePercentage, "%"),
      valueOrDash(allTime.averagePlayers),
      valueOrDash(allTime.peakPlayers),
      valueOrDash(allTime.playerHours),
      valueOrDash(allTime.activePercentage, "%"),
      String(allTime.samples || 0),
    ];
    allTimeValues.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      allTimeRow.appendChild(cell);
    });
    allTimeHistory.appendChild(allTimeRow);
    renderRecords(data.records);
  };

  const fetchJson = async (url) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Live World request failed");
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const refresh = async () => {
    const [statusResult, historyResult] = await Promise.allSettled([
      fetchJson(statusEndpoint),
      fetchJson(historyEndpoint),
    ]);

    if (statusResult.status === "fulfilled") {
      renderStatus(statusResult.value);
    } else {
      renderStatus({ online: false, playerCount: null, playerNames: [] });
    }

    if (historyResult.status === "fulfilled") {
      renderHistory(historyResult.value);
    } else {
      coverage.textContent = "Historical activity is temporarily unavailable. Live status will continue to refresh.";
    }
  };

  refresh();
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);
});
