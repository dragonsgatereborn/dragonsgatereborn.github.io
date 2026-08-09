window.addEventListener("DOMContentLoaded", () => {
  const page = document.querySelector(".page");
  if (page) {
    page.classList.add("loaded");
  }

  const path = window.location.pathname.replace(/\/$/, "");

  document.querySelectorAll(".site-nav, .top-nav").forEach((nav) => {
    if (nav.querySelector('a[href="/search.html"]')) {
      return;
    }
    const searchLink = document.createElement("a");
    searchLink.href = "/search.html";
    searchLink.textContent = "Search";
    const siteMapLink = nav.querySelector('a[href="/site-map.html"]');
    nav.insertBefore(searchLink, siteMapLink || null);
  });
  const sectionMap = [
    { match: (p) => p === "" || p === "/" || p === "/index.html", hide: ["/index.html", "/"] },
    { match: (p) => p === "/manual.html" || p.startsWith("/manual/"), hide: ["/manual.html"] },
    { match: (p) => p === "/library.html" || p.startsWith("/library/"), hide: ["/library.html"] },
    { match: (p) => p === "/community.html" || p.startsWith("/community/"), hide: ["/community.html"] },
    { match: (p) => p === "/events.html" || p.startsWith("/events/"), hide: ["/events.html"] },
    { match: (p) => p === "/support.html" || p.startsWith("/support/"), hide: ["/support.html"] },
    { match: (p) => p === "/contact.html", hide: ["/contact.html"] },
    { match: (p) => p === "/site-map.html", hide: ["/site-map.html"] },
    { match: (p) => p === "/search.html", hide: ["/search.html"] },
    { match: (p) => p === "/forums" || p.startsWith("/forums/"), hide: ["/forums"] },
  ];

  const matches = sectionMap.filter((entry) => entry.match(path));
  if (matches.length > 0) {
    const hideHrefs = new Set(matches.flatMap((entry) => entry.hide));
    const navLinks = document.querySelectorAll(".site-nav a, .top-nav a");
    navLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (hideHrefs.has(href)) {
        link.remove();
      }
    });
  }

  const contentPath = path.startsWith("/manual/") || path.startsWith("/classes/") ||
    path.startsWith("/races/") || path.startsWith("/library/");
  if (contentPath) {
    const candidates = Array.from(document.querySelectorAll("main article.card"))
      .filter((article) => !article.querySelector(".section-grid"))
      .map((article) => ({
        article,
        headings: Array.from(article.querySelectorAll("h2, h3"))
          .filter((heading) => heading.textContent.trim().length > 0),
      }))
      .filter(({ article, headings }) => headings.length >= 3 && article.textContent.length >= 900)
      .sort((a, b) => b.headings.length - a.headings.length);

    if (candidates.length > 0) {
      const { article, headings } = candidates[0];
      const usedIds = new Set(Array.from(document.querySelectorAll("[id]"), (node) => node.id));
      const contents = document.createElement("nav");
      contents.className = "page-contents";
      contents.setAttribute("aria-label", "On this page");
      contents.innerHTML = '<p class="caps">On this page</p>';
      const list = document.createElement("ol");

      headings.forEach((heading, index) => {
        if (!heading.id) {
          const base = heading.textContent.toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `section-${index + 1}`;
          let id = base;
          let suffix = 2;
          while (usedIds.has(id)) {
            id = `${base}-${suffix++}`;
          }
          heading.id = id;
          usedIds.add(id);
        }
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${heading.id}`;
        link.textContent = heading.textContent.trim();
        item.appendChild(link);
        list.appendChild(item);
      });

      contents.appendChild(list);
      article.insertBefore(contents, article.firstElementChild);
    }
  }

  const isRacePage = path.startsWith("/races/race-");
  const isClassPage = path.startsWith("/classes/class-");
  const isSkillPage = path.startsWith("/skills/skill-");
  if (isRacePage || isClassPage || isSkillPage) {
    const firstCard = document.querySelector("main article.card");
    if (firstCard && !firstCard.querySelector(".content-status-note")) {
      const note = document.createElement("div");
      note.className = "status-row content-status-note";
      if (path === "/races/race-wyvern.html") {
        note.innerHTML = '<span class="status-badge status-legacy">Legacy reference</span><span class="small">Wyvern is not currently selectable in live character creation. Archive details are retained for reference.</span>';
      } else if (isRacePage) {
        note.innerHTML = '<span class="status-badge status-live">Selectable in beta</span><span class="status-badge status-testing">Racial abilities may be incomplete</span><a class="small" href="/race-class-guide.html">Current compatibility</a>';
      } else if (isClassPage) {
        note.innerHTML = '<span class="status-badge status-live">Selectable in beta</span><span class="status-badge status-testing">Abilities under active testing</span><a class="small" href="/beta-status.html">Current status</a>';
      } else {
        note.innerHTML = '<span class="status-badge status-testing">Availability varies in beta</span><span class="small">This page may combine current behavior with reconstruction notes.</span><a class="small" href="/systems.html">Verified quick guides</a>';
      }
      firstCard.insertBefore(note, firstCard.firstElementChild);
    }
  }
});

// Homepage status card backed by the public game menu. It displays the
// aggregate adventurer count and the same character names shown by that menu.
window.addEventListener("DOMContentLoaded", () => {
  const card = document.querySelector("[data-live-world]");
  if (!card) return;

  const endpoint = card.dataset.liveWorldEndpoint;
  const status = card.querySelector("[data-live-world-status]");
  const count = card.querySelector("[data-live-world-count]");
  const updated = card.querySelector("[data-live-world-updated]");
  const pulse = card.querySelector("[data-live-world-pulse]");
  const playerList = card.querySelector("[data-live-world-players]");
  let lastUpdatedAt = null;

  const renderPlayerNames = (names, emptyMessage) => {
    if (!playerList) return;
    playerList.replaceChildren();

    if (names.length === 0) {
      const item = document.createElement("li");
      item.textContent = emptyMessage;
      playerList.appendChild(item);
      return;
    }

    names.forEach((name) => {
      const item = document.createElement("li");
      item.textContent = name;
      playerList.appendChild(item);
    });
  };

  const formatAge = () => {
    if (!lastUpdatedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt.getTime()) / 1000));
    if (seconds < 60) {
      updated.textContent = "Updated just now";
    } else {
      const minutes = Math.floor(seconds / 60);
      updated.textContent = `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    }
  };

  const refresh = async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Live status request failed");
      const data = await response.json();

      if (data.online === true && Number.isInteger(data.playerCount)) {
        status.textContent = data.stale ? "Last known online" : "Online";
        count.textContent = `${data.playerCount} adventurer${data.playerCount === 1 ? "" : "s"} ${data.stale ? "at last check" : "online"}`;
        pulse.classList.toggle("is-online", !data.stale);
        const names = Array.isArray(data.playerNames)
          ? data.playerNames.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim())
          : [];
        renderPlayerNames(
          names,
          data.playerCount === 0 ? "No adventurers are currently online." : "Character names are temporarily unavailable.",
        );
      } else {
        status.textContent = "Status unavailable";
        count.textContent = "Player count unavailable";
        pulse.classList.remove("is-online");
        renderPlayerNames([], "Character names are temporarily unavailable.");
      }

      lastUpdatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
      if (Number.isNaN(lastUpdatedAt.getTime())) lastUpdatedAt = new Date();
      formatAge();
    } catch {
      status.textContent = "Status unavailable";
      count.textContent = "Player count unavailable";
      updated.textContent = "Unable to reach the live world service";
      pulse.classList.remove("is-online");
      renderPlayerNames([], "Character names are temporarily unavailable.");
      lastUpdatedAt = null;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  refresh();
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);
  window.setInterval(formatAge, 30000);
});

// Privacy-first, site-wide page-view tracking through Cloudflare Web Analytics.
const analyticsHosts = ["dragonsgatereborn.com", "www.dragonsgatereborn.com"];
if (
  analyticsHosts.includes(window.location.hostname) &&
  !document.querySelector("script[data-cf-beacon]")
) {
  const analytics = document.createElement("script");
  analytics.type = "module";
  analytics.src = "https://static.cloudflareinsights.com/beacon.min.js";
  analytics.dataset.cfBeacon = JSON.stringify({
    token: "ae2c2d51d159493fbdc1b9828076272c",
  });
  document.body.appendChild(analytics);
}

// Public, privacy-friendly counters rendered as lightweight badges.
window.addEventListener("DOMContentLoaded", () => {
  if (!analyticsHosts.includes(window.location.hostname)) {
    return;
  }

  const footer = document.querySelector(".footer");
  if (!footer || footer.querySelector("[data-view-counter]")) {
    return;
  }

  const counter = document.createElement("p");
  counter.className = "view-counter small";
  counter.dataset.viewCounter = "";
  counter.setAttribute("aria-label", "Website view counters");

  const pagePath = window.location.pathname === "/index.html"
    ? "/"
    : window.location.pathname || "/";
  const pageSlug = (pagePath === "/" ? "home" : pagePath)
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  const badgeOptions = "style=flat-square&color=b88a44&labelColor=2b2118";

  const pageBadge = document.createElement("img");
  pageBadge.src = `https://hits.sh/dragonsgatereborn.com/pages/${pageSlug}.svg?label=Page%20views&${badgeOptions}`;
  pageBadge.alt = "Page views";
  pageBadge.decoding = "async";

  const totalBadge = document.createElement("img");
  totalBadge.src = `https://hits.sh/dragonsgatereborn.com/all-pages.svg?label=Total%20website%20views&${badgeOptions}`;
  totalBadge.alt = "Total website views";
  totalBadge.decoding = "async";

  counter.append(pageBadge, totalBadge);
  footer.appendChild(counter);
});
