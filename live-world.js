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
    statusText.textContent = online ? "The world is online" : "Signal temporarily unavailable";
    countText.textContent = online ? String(data.playerCount) : "Unavailable";
    metric("current").textContent = online ? String(data.playerCount) : "—";
    pulse.classList.toggle("is-online", online);

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

  const renderDaily = (rows) => {
    dailyHistory.replaceChildren();
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "The first daily activity sample is still being collected.";
      row.appendChild(cell);
      dailyHistory.appendChild(row);
      return;
    }

    rows.forEach((entry) => {
      const row = document.createElement("tr");
      const values = [
        new Date(entry.timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
        valueOrDash(entry.uptimePercentage, "%"),
        valueOrDash(entry.averagePlayers),
        valueOrDash(entry.peakPlayers),
        String(entry.samples),
      ];
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      dailyHistory.appendChild(row);
    });
  };

  const renderHistory = (data) => {
    const day = data.summary.last24Hours;
    const week = data.summary.last7Days;
    metric("peak").textContent = valueOrDash(day.peakPlayers);
    metric("average").textContent = valueOrDash(day.averagePlayers);
    metric("uptime24").textContent = valueOrDash(day.uptimePercentage, "%");
    metric("uptime7").textContent = valueOrDash(week.uptimePercentage, "%");
    metricContext("peak").textContent = sampleLabel(day.samples);
    metricContext("average").textContent = sampleLabel(day.samples);
    metricContext("uptime24").textContent = sampleLabel(day.samples);
    metricContext("uptime7").textContent = sampleLabel(week.samples);

    if (data.trackingSince) {
      const since = new Date(data.trackingSince);
      coverage.textContent = `Tracking began ${since.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. ${data.totalSamples} sample${data.totalSamples === 1 ? " has" : "s have"} been collected; percentages reflect collected samples only.`;
    } else {
      coverage.textContent = "Preparing the first historical sample…";
    }
    renderHourly(data.hourly || []);
    renderDaily(data.daily || []);
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
