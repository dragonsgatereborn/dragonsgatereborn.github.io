(() => {
  const months = [
  {
    "key": "2026-01",
    "name": "January",
    "quarter": "Q1"
  },
  {
    "key": "2026-02",
    "name": "February",
    "quarter": "Q1"
  },
  {
    "key": "2026-03",
    "name": "March",
    "quarter": "Q1"
  },
  {
    "key": "2026-04",
    "name": "April",
    "quarter": "Q2"
  },
  {
    "key": "2026-05",
    "name": "May",
    "quarter": "Q2"
  },
  {
    "key": "2026-06",
    "name": "June",
    "quarter": "Q2"
  },
  {
    "key": "2026-07",
    "name": "July",
    "quarter": "Q3"
  },
  {
    "key": "2026-08",
    "name": "August",
    "quarter": "Q3"
  }
];

  const page = document.querySelector("[data-update-month]");
  if (!page) return;

  const current = page.dataset.updateMonth;
  const currentIndex = months.findIndex((month) => month.key === current);
  const monthHref = (month) => `/updates/${month.key}.html`;

  const navHtml = ["Q1", "Q2", "Q3"].map((quarter) => {
    const links = months
      .filter((month) => month.quarter === quarter)
      .map((month) => {
        const active = month.key === current;
        const attributes = active
          ? ' class="is-current" aria-current="page"'
          : "";
        return `<a href="${monthHref(month)}"${attributes}>${month.name.slice(0, 3)}</a>`;
      })
      .join("");
    return `<span class="updates-quarter-links"><strong>${quarter}</strong>${links}</span>`;
  }).join("");

  document.querySelectorAll("[data-updates-nav]").forEach((nav) => {
    nav.innerHTML = `<span class="updates-year">2026</span>${navHtml}`;
  });

  const older = currentIndex > 0 ? months[currentIndex - 1] : null;
  const newer =
    currentIndex >= 0 && currentIndex < months.length - 1
      ? months[currentIndex + 1]
      : null;

  const pagerHtml = `
    ${older
      ? `<a class="pager-link pager-link--older" href="${monthHref(older)}"><span>← Older</span><strong>${older.name} 2026</strong></a>`
      : '<span class="pager-link is-disabled"><span>← Older</span><strong>Start of archive</strong></span>'}
    <a class="pager-archive" href="/updates/index.html">All months</a>
    ${newer
      ? `<a class="pager-link pager-link--newer" href="${monthHref(newer)}"><span>Newer →</span><strong>${newer.name} 2026</strong></a>`
      : '<a class="pager-link pager-link--newer" href="/roadmap-updates.html"><span>Latest</span><strong>Current month</strong></a>'}
  `;

  document.querySelectorAll("[data-updates-pager]").forEach((pager) => {
    pager.innerHTML = pagerHtml;
  });
})();
