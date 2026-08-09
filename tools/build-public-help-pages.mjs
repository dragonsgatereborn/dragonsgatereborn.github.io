import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(root, "help");
const helpData = JSON.parse(await fs.readFile(path.join(root, "data/game-help/help-files.json"), "utf8"));

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const reviewFlags = new Set(["tempest-branding", "formatter-error", "legacy-class-reference", "legacy-feature-reference"]);
const flagLabels = {
  "ats-namespace": "ATS technical reference",
  "tempest-branding": "Tempest Season reference",
  "formatter-error": "Help formatter error",
  "legacy-class-reference": "Legacy class reference",
  "legacy-feature-reference": "Legacy feature reference",
};

function status(entry) {
  if (entry.flags.some((flag) => reviewFlags.has(flag))) return "review";
  if (entry.flags.length) return "technical";
  return "live";
}

function statusBadge(entry) {
  const state = status(entry);
  if (state === "review") return '<span class="status-badge status-legacy">Review required</span>';
  if (state === "technical") return '<span class="status-badge status-testing">Technical reference</span>';
  return '<span class="status-badge status-live">Captured live</span>';
}

function reviewNotice(entry) {
  if (!entry.flags.length) {
    return "<p>This help file was captured from the live game. Game behavior remains the final authority if implementation changes.</p>";
  }
  const labels = entry.flags.map((flag) => flagLabels[flag] || flag).join(", ");
  const strong = status(entry) === "review"
    ? "This entry may contain inherited or outdated material and should not be treated as confirmed DGR guidance without verification."
    : "The command information may be useful, but the entry contains an inherited internal ATS code reference.";
  return `<p><strong>${strong}</strong></p><p class="small">Review flags: ${escapeHtml(labels)}</p>`;
}

function baseHead(title, description) {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dragon's Gate Reborn | ${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=EB+Garamond:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css?v=20260809d">`;
}

function nav() {
  return `<nav class="site-nav">
          <a href="/index.html">Home</a>
          <a href="/manual.html">Manual</a>
          <a href="/help/">Game Help</a>
          <a href="/library.html">Library</a>
          <a href="/community.html">Community</a>
          <a href="/support.html">Support</a>
          <a href="/site-map.html">Site Map</a>
        </nav>`;
}

function footer() {
  return `<footer class="footer">
      <div class="footer-links">
        <a href="/index.html">Home</a><a href="/manual.html">Manual</a><a href="/help/">Game Help</a>
        <a href="/library.html">Library</a><a href="/community.html">Community</a><a href="/support.html">Support</a>
      </div>
      <p class="small">Help text captured from the live Dragon's Gate Reborn game on August 9, 2026.</p>
    </footer>`;
}

const entries = helpData.entries.map((entry) => ({ ...entry, slug: slugify(entry.title), status: status(entry) }));
const duplicateSlugs = entries.filter((entry, index) => entries.findIndex((candidate) => candidate.slug === entry.slug) !== index);
if (duplicateSlugs.length) throw new Error(`Duplicate help page slugs: ${duplicateSlugs.map((entry) => entry.title).join(", ")}`);

await fs.mkdir(outputRoot, { recursive: true });

for (let index = 0; index < entries.length; index += 1) {
  const entry = entries[index];
  const previous = entries[index - 1];
  const next = entries[index + 1];
  const displayBody = entry.body.replace(/[ \t]+$/gm, "");
  const page = `<!doctype html>
<html lang="en">
<head>
  ${baseHead(`${entry.title} Help`, `${entry.title} in-game help for Dragon's Gate Reborn.`)}
</head>
<body>
  <div class="page">
    <header class="hero hero--inner"><div class="hero-inner">
      <a class="brand brand-link" href="/help/"><div class="sigil"></div><div><p class="eyebrow">In-Game Help · ${escapeHtml(entry.type)}</p><h1>${escapeHtml(entry.title)}</h1><p class="tagline">Captured help-file reference for Dragon's Gate Reborn.</p></div></a>
      ${nav()}
    </div></header>
    <main class="layout single"><section class="content">
      <article class="card">
        <div class="inline-links"><a class="btn ghost" href="/help/">← All Help Files</a></div>
        <div class="status-row">${statusBadge(entry)}<span class="small">Type: ${escapeHtml(entry.type)}</span></div>
        <h2>${escapeHtml(entry.title)}</h2>
        ${entry.keywords ? `<p><strong>Keywords:</strong> ${escapeHtml(entry.keywords)}</p>` : ""}
        ${reviewNotice(entry)}
      </article>
      <article class="card help-file-card">
        <h2>In-Game Help Text</h2>
        <pre>${escapeHtml(displayBody)}</pre>
      </article>
      <nav class="card help-page-nav" aria-label="Adjacent help files">
        ${previous ? `<a class="btn ghost" href="/help/${previous.slug}.html">← ${escapeHtml(previous.title)}</a>` : "<span></span>"}
        ${next ? `<a class="btn ghost" href="/help/${next.slug}.html">${escapeHtml(next.title)} →</a>` : "<span></span>"}
      </nav>
    </section></main>
    ${footer()}
  </div>
  <script src="/script.js?v=20260809b"></script>
</body>
</html>`;
  await fs.writeFile(path.join(outputRoot, `${entry.slug}.html`), `${page}\n`, "utf8");
}

const typeCounts = Object.entries(entries.reduce((counts, entry) => {
  counts[entry.type] = (counts[entry.type] || 0) + 1;
  return counts;
}, {})).sort(([a], [b]) => a.localeCompare(b));
const letters = [...new Set(entries.map((entry) => entry.title[0].toUpperCase()))];
const groups = letters.map((letter) => {
  const cards = entries.filter((entry) => entry.title.startsWith(letter)).map((entry) => `
            <a class="section-card help-index-entry" href="/help/${entry.slug}.html" data-help-index-entry data-search="${escapeHtml(`${entry.title} ${entry.type} ${entry.keywords}`.toLowerCase())}" data-status="${entry.status}">
              <span class="status-row">${statusBadge(entry)}<span class="small">${escapeHtml(entry.type)}</span></span>
              <h3>${escapeHtml(entry.title)}</h3>
              ${entry.keywords ? `<p class="small">${escapeHtml(entry.keywords)}</p>` : ""}
            </a>`).join("");
  return `<section class="help-letter-group" id="letter-${letter.toLowerCase()}" data-help-letter-group><h2>${letter}</h2><div class="section-grid">${cards}
          </div></section>`;
}).join("\n");

const indexPage = `<!doctype html>
<html lang="en">
<head>
  ${baseHead("Game Help Files", "Search and browse every captured Dragon's Gate Reborn in-game help file.")}
</head>
<body>
  <div class="page">
    <header class="hero hero--inner"><div class="hero-inner">
      <a class="brand brand-link" href="/index.html"><div class="sigil"></div><div><p class="eyebrow">Player Reference</p><h1>Game Help Files</h1><p class="tagline">Browse the commands, races, classes, skills, spells, and systems documented by the live game.</p></div></a>
      ${nav()}
    </div></header>
    <main class="layout single"><section class="content">
      <article class="card feature">
        <p class="caps">Live capture · August 9, 2026</p>
        <h2>${entries.length} Help Files</h2>
        <p>Choose any title to open its complete help file. Entries containing inherited ATS, Tempest Season, legacy class, or unfinished formatter references are marked so they are not mistaken for confirmed current guidance.</p>
        <div class="status-row"><span class="status-badge status-live">Captured live</span><span class="status-badge status-testing">Technical reference</span><span class="status-badge status-legacy">Review required</span></div>
      </article>
      <article class="card help-directory-controls">
        <label for="help-directory-search"><strong>Search help files</strong></label>
        <input id="help-directory-search" type="search" placeholder="Try inventory, magick, race, or train…" autocomplete="off">
        <p class="small"><span id="help-directory-count">${entries.length}</span> help files shown.</p>
        <div class="inline-links help-letter-links">${letters.map((letter) => `<a class="btn ghost" href="#letter-${letter.toLowerCase()}">${letter}</a>`).join("")}</div>
        <p class="small">${typeCounts.map(([type, count]) => `${escapeHtml(type)}: ${count}`).join(" · ")}</p>
      </article>
      ${groups}
    </section></main>
    ${footer()}
  </div>
  <script src="/script.js?v=20260809b"></script>
  <script>(()=>{const input=document.querySelector('#help-directory-search');const entries=[...document.querySelectorAll('[data-help-index-entry]')];const groups=[...document.querySelectorAll('[data-help-letter-group]')];const count=document.querySelector('#help-directory-count');input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();let shown=0;for(const entry of entries){const match=!query||entry.dataset.search.includes(query);entry.hidden=!match;if(match)shown+=1}for(const group of groups){group.hidden=!group.querySelector('[data-help-index-entry]:not([hidden])')}count.textContent=shown})})();</script>
</body>
</html>`;

await fs.writeFile(path.join(outputRoot, "index.html"), `${indexPage}\n`, "utf8");
console.log(`Built public help directory with ${entries.length} individual pages.`);
