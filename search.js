(function () {
  const form = document.querySelector("[data-search-form]");
  const input = form && form.querySelector('input[name="q"]');
  const status = document.querySelector("[data-search-status]");
  const resultsCard = document.querySelector("[data-search-results-card]");
  const resultsList = document.querySelector("[data-search-results]");
  if (!form || !input || !status || !resultsCard || !resultsList) return;

  let pages = [];

  function normalize(value) {
    return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function termsFor(query) {
    return normalize(query).split(/\s+/).filter((term) => term.length > 1);
  }

  function scorePage(page, terms) {
    const title = normalize(page.title);
    const description = normalize(page.description || "");
    const headings = normalize((page.headings || []).join(" "));
    const text = normalize(page.text || "");
    if (!terms.every((term) => `${title} ${description} ${headings} ${text}`.includes(term))) return 0;
    return terms.reduce((score, term) => score +
      (title.includes(term) ? 20 : 0) +
      (headings.includes(term) ? 8 : 0) +
      (description.includes(term) ? 5 : 0) +
      Math.min(5, text.split(term).length - 1), 0);
  }

  function excerpt(page, terms) {
    const source = page.text || page.description || "";
    const lower = normalize(source);
    const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
    const position = positions.length ? Math.min(...positions) : 0;
    const start = Math.max(0, position - 85);
    const end = Math.min(source.length, start + 230);
    return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${end < source.length ? "…" : ""}`;
  }

  function render(query) {
    const terms = termsFor(query);
    resultsList.replaceChildren();
    if (!terms.length) {
      resultsCard.hidden = true;
      status.textContent = "Enter at least two characters to search.";
      return;
    }
    const matches = pages.map((page) => ({ page, score: scorePage(page, terms) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
      .slice(0, 60);

    status.textContent = matches.length
      ? `${matches.length}${matches.length === 60 ? "+" : ""} result${matches.length === 1 ? "" : "s"} for “${query}”.`
      : `No results found for “${query}”. Try fewer or broader words.`;
    resultsCard.hidden = matches.length === 0;

    matches.forEach(({ page }) => {
      const item = document.createElement("li");
      item.className = "search-result";
      const heading = document.createElement("h3");
      const link = document.createElement("a");
      link.href = page.url;
      link.textContent = page.title;
      heading.appendChild(link);
      const summary = document.createElement("p");
      summary.textContent = excerpt(page, terms);
      const path = document.createElement("p");
      path.className = "search-result-path";
      path.textContent = page.url;
      item.append(heading, summary, path);
      resultsList.appendChild(item);
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    const url = new URL(window.location.href);
    url.searchParams.set("q", query);
    window.history.replaceState({}, "", url);
    render(query);
  });

  fetch("/search-index.json")
    .then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    })
    .then((data) => {
      pages = data;
      const query = new URLSearchParams(window.location.search).get("q") || "";
      input.value = query;
      status.textContent = `Ready to search ${pages.length} pages.`;
      if (query.trim()) render(query.trim());
    })
    .catch(() => {
      status.textContent = "Search is temporarily unavailable. Please use the Site Map or Manual index.";
    });
}());
