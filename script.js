window.addEventListener("DOMContentLoaded", () => {
  const page = document.querySelector(".page");
  if (page) {
    page.classList.add("loaded");
  }

  const path = window.location.pathname.replace(/\/$/, "");
  const sectionMap = [
    { match: (p) => p === "" || p === "/" || p === "/index.html", hide: ["/index.html", "/"] },
    { match: (p) => p === "/manual.html" || p.startsWith("/manual/"), hide: ["/manual.html"] },
    { match: (p) => p === "/library.html" || p.startsWith("/library/"), hide: ["/library.html"] },
    { match: (p) => p === "/community.html" || p.startsWith("/community/"), hide: ["/community.html"] },
    { match: (p) => p === "/events.html" || p.startsWith("/events/"), hide: ["/events.html"] },
    { match: (p) => p === "/support.html" || p.startsWith("/support/"), hide: ["/support.html"] },
    { match: (p) => p === "/contact.html", hide: ["/contact.html"] },
    { match: (p) => p === "/site-map.html", hide: ["/site-map.html"] },
    { match: (p) => p === "/forums" || p.startsWith("/forums/"), hide: ["/forums"] },
  ];

  const matches = sectionMap.filter((entry) => entry.match(path));
  if (matches.length === 0) {
    return;
  }
  const hideHrefs = new Set(matches.flatMap((entry) => entry.hide));
  const navLinks = document.querySelectorAll(".site-nav a, .top-nav a");
  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (hideHrefs.has(href)) {
      link.remove();
    }
  });
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
