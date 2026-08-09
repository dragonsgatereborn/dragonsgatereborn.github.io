import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rawRoot = path.join(root, "data/game-help/raw");
const outputRoot = path.join(root, "data/game-help");
const separator = /\n-{40,}\n/g;
const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const flagRules = [
  ["ats-namespace", /\bats\.[A-Za-z0-9_.@$]+/i],
  ["tempest-branding", /A Tempest Season|tempestseason\.com/i],
  ["formatter-error", /HelpTextFormatter@[a-f0-9]+/i],
  ["legacy-class-reference", /\b(?:Arcanist|Explorer|Rogue|Templar|Agent|Blood Shaman|Ranger|Wizard|Lunar Sage|Mystic Knight|Necromancer|Solar Magus|Cosmic Herald|Oblivion Lord|Arcane Inquisitor|Ethari|Shaman|Assassin|Classless)\b/i],
  ["legacy-feature-reference", /\b(?:PatreonPet|PatreonMount|Patreon command|anima convergence|resonance)\b/i],
];

const byKey = new Map();
const titleVariants = new Map();

for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  const file = path.join(rawRoot, `${letter}.txt`);
  const raw = await fs.readFile(file, "utf8");
  if (/^No help file exists with those key words\.?\s*$/i.test(raw.trim())) continue;

  for (const part of raw.split(separator)) {
    const body = part.trim();
    if (!body || /^No help file exists with those key words\.?$/i.test(body)) continue;
    const title = body.split("\n").find((line) => line.trim())?.trim() || `Untitled ${letter.toUpperCase()}`;
    const comparisonBody = body.replace(/\s+/g, " ").trim();
    const key = `${title.toLowerCase()}\n${comparisonBody}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.matchedLetters.includes(letter)) existing.matchedLetters.push(letter);
      continue;
    }

    const type = body.match(/^Type:\s*(.+)$/mi)?.[1]?.trim() || "General";
    const keywords = body.match(/^Keywords:\s*(.+)$/mi)?.[1]?.trim() || "";
    const flags = flagRules.filter(([, pattern]) => pattern.test(body)).map(([name]) => name);
    const entry = { title, type, keywords, matchedLetters: [letter], flags, body };
    byKey.set(key, entry);
    const variants = titleVariants.get(title.toLowerCase()) || [];
    variants.push(entry);
    titleVariants.set(title.toLowerCase(), variants);
  }
}

const entries = [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title) || a.body.localeCompare(b.body));
const duplicateTitles = [...titleVariants.entries()]
  .filter(([, variants]) => variants.length > 1)
  .map(([title, variants]) => ({ title, variants: variants.map((entry) => ({ type: entry.type, letters: entry.matchedLetters, bytes: Buffer.byteLength(entry.body) })) }));
const reviewEntries = entries.filter((entry) => entry.flags.length);
const manifest = JSON.parse(await fs.readFile(path.join(rawRoot, "manifest.json"), "utf8"));

await fs.writeFile(
  path.join(outputRoot, "help-files.json"),
  `${JSON.stringify({ capturedAt: manifest.capturedAt, source: `${manifest.host}:${manifest.port}`, entryCount: entries.length, entries }, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(outputRoot, "review-needed.json"),
  `${JSON.stringify({ capturedAt: manifest.capturedAt, flaggedCount: reviewEntries.length, duplicateTitles, entries: reviewEntries.map(({ title, type, flags, matchedLetters, body }) => ({ title, type, flags, matchedLetters, body })) }, null, 2)}\n`,
  "utf8",
);

const cards = entries.map((entry, index) => {
  const flags = entry.flags.length ? `<p class="small"><strong>Review flags:</strong> ${entry.flags.map(escapeHtml).join(", ")}</p>` : "";
  return `<details class="card help-entry" data-help-entry data-search="${escapeHtml(`${entry.title} ${entry.type} ${entry.keywords}`.toLowerCase())}"${index < 2 ? " open" : ""}><summary><strong>${escapeHtml(entry.title)}</strong> <span class="small">${escapeHtml(entry.type)}</span></summary>${flags}<pre>${escapeHtml(entry.body)}</pre></details>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Dragon's Gate Reborn | Internal Live Help Archive</title><meta name="description" content="Unlisted snapshot of live in-game help files for documentation validation."><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=EB+Garamond:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="/styles.css?v=20260809c"><style>.help-controls{position:sticky;top:0;z-index:4}.help-controls input{width:100%;padding:.85rem 1rem;border:1px solid rgba(184,138,68,.55);border-radius:.5rem;background:#17120f;color:#f5ead8;font:inherit}.help-entry summary{cursor:pointer}.help-entry pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5;background:#17120f;padding:1rem;border-radius:.5rem}.help-entry[hidden]{display:none}</style></head><body><div class="page">
<header class="hero hero--inner"><div class="hero-inner"><a class="brand brand-link" href="/index.html"><div class="sigil"></div><div><p class="eyebrow">Unlisted Validation Archive</p><h1>Live Game Help Files</h1><p class="tagline">Exact captured text for documentation comparison—not automatically approved guidance.</p></div></a></div></header>
<main class="layout single"><section class="content"><article class="card feature"><p class="caps">Captured ${escapeHtml(manifest.capturedAt)}</p><h2>${entries.length} unique help records</h2><p>This unlisted page preserves what the live game returned for <code>HELP A</code> through <code>HELP Z</code>. Entries with ATS remnants or questionable references are visibly flagged and should not be treated as DGR policy without review.</p></article>
<article class="card help-controls"><label for="help-filter"><strong>Filter the archive</strong></label><input id="help-filter" type="search" placeholder="Search title, type, or keyword…"><p class="small"><span id="help-count">${entries.length}</span> records shown.</p></article>
${cards}</section></main><footer class="footer"><p class="small">Unlisted documentation-validation archive. The live game and approved DGR updates remain authoritative.</p></footer></div><script src="/script.js?v=20260809b"></script><script>(()=>{const input=document.querySelector('#help-filter');const cards=[...document.querySelectorAll('[data-help-entry]')];const count=document.querySelector('#help-count');input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();let shown=0;for(const card of cards){const match=!q||card.dataset.search.includes(q)||card.innerText.toLowerCase().includes(q);card.hidden=!match;if(match)shown+=1}count.textContent=shown})})();</script></body></html>`;

await fs.writeFile(path.join(root, "game-help-library.html"), `${html}\n`, "utf8");
console.log(`Built ${entries.length} unique entries; ${reviewEntries.length} flagged; ${duplicateTitles.length} duplicate-title groups.`);
