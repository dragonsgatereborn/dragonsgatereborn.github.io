import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const data = JSON.parse(await fs.readFile(path.join(root, "data/race-creation/races.json"), "utf8"));
const begin = "        <!-- LIVE-RACE-CREATION:BEGIN -->";
const end = "        <!-- LIVE-RACE-CREATION:END -->";

const pageMap = new Map([
  ["race-anthian.html", ["Anthian"]], ["race-arachnian.html", ["Arachnian"]],
  ["race-dragon.html", ["Draco"]], ["race-dragal.html", ["Drag-al"]],
  ["race-firian.html", ["Fir Elf"]], ["race-flerian.html", ["Flerian"]],
  ["race-frontacian.html", ["Frontacian"]], ["race-goblin.html", ["Go-blin", "Go-blin-al"]],
  ["race-hithual.html", ["Hithual"]], ["race-human.html", ["Human"]],
  ["race-leuian.html", ["Leuian"]], ["race-monitanian.html", ["Monitanian"]],
  ["race-muatanaal.html", ["Muatana-al"]], ["race-oogra.html", ["Oog-ra"]],
  ["race-penthanian.html", ["Penthanian"]], ["race-psycian.html", ["Psycian"]],
  ["race-sanene.html", ["San Elf"]], ["race-secian.html", ["Secian"]],
  ["race-thugian.html", ["Thugian"]], ["race-usilin.html", ["Usilin"]],
]);

const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const range = (value) => value ? `${value.min}–${value.max} ${value.unit}` : "Not requested by the current creator";
const height = (value) => value ? `${value.min.feet}'${value.min.inches}\"–${value.max.feet}'${value.max.inches}\"` : "Not requested by the current creator";
const join = (items) => items.map(escapeHtml).join(", ");

function appearanceDetails(race) {
  const labels = {
    eyeColor: "Eye colors", hairColor: "Hair colors", hairLength: "Hair lengths",
    hairStyle: "Hair styles", skinColor: "Skin colors", mood: "Demeanors",
  };
  return Object.entries(race.appearance).map(([key, values]) => `
            <details class="creation-options">
              <summary>${labels[key]} (${values.length})</summary>
              <p>${join(values)}</p>
            </details>`).join("");
}

function helpDetails(race) {
  const help = race.inGameHelp;
  if (!help) return "";
  const details = [];
  if (help.allowedClasses?.length) details.push([`Classes listed by HELP ${race.race.toUpperCase()} (${help.allowedClasses.length})`, help.allowedClasses.join(", ")]);
  if (help.racialAbilities) details.push(["Racial abilities listed by in-game help", help.racialAbilities]);
  if (help.racialTensions) details.push(["Racial tensions listed by in-game help", help.racialTensions]);
  return details.map(([label, value]) => `
            <details class="creation-options help-verified-options">
              <summary>${escapeHtml(label)}</summary>
              <p>${escapeHtml(value)}</p>
            </details>`).join("");
}

function raceBlock(race, multi) {
  return `${multi ? `
          <h3>${escapeHtml(race.race)}</h3>` : ""}
          <div class="section-grid creation-facts">
            <div class="section-card"><h3>Alignment</h3><p>${join(race.alignments) || "Not requested"}</p></div>
            <div class="section-card"><h3>Sex</h3><p>${join(race.sexes) || "Not requested"}</p></div>
            <div class="section-card"><h3>Typical Lifespan</h3><p>${range(race.typicalLifespan)}</p></div>
            <div class="section-card"><h3>Creation Age</h3><p>${range(race.allowedAge)}</p></div>
            <div class="section-card"><h3>Weight</h3><p>${range(race.weight)}</p></div>
            <div class="section-card"><h3>Height</h3><p>${height(race.height)}</p></div>
          </div>
          <div class="creation-option-list">${appearanceDetails(race)}${helpDetails(race)}
          </div>`;
}

function card(races) {
  const multi = races.length > 1;
  return `${begin}
        <article class="card live-creation-card">
          <p class="caps">Verified in the live game · August 9, 2026</p>
          <h2>Live Character Creation</h2>
          <p>These are the ranges and selectable appearance options currently offered when creating ${multi ? "these races" : `a ${escapeHtml(races[0].race)}`}. Descriptive lore elsewhere on this page adds roleplay context; where an older archival value differs, use this live-verified section for current character creation.</p>${races.map((race) => raceBlock(race, multi)).join("\n")}
        </article>
${end}`;
}

for (const [filename, names] of pageMap) {
  const filepath = path.join(root, "races", filename);
  let html = await fs.readFile(filepath, "utf8");
  const races = names.map((name) => data.races.find((race) => race.race === name));
  if (races.some((race) => !race)) throw new Error(`Missing creation data for ${filename}`);

  const existing = new RegExp(`${begin}[\\s\\S]*?${end}`);
  if (existing.test(html)) {
    html = html.replace(existing, card(races));
  } else {
    const firstArticleEnd = html.indexOf("        </article>", html.indexOf('<section class="content">'));
    if (firstArticleEnd < 0) throw new Error(`Could not locate first article in ${filename}`);
    const insertAt = firstArticleEnd + "        </article>".length;
    html = `${html.slice(0, insertAt)}\n${card(races)}${html.slice(insertAt)}`;
  }
  await fs.writeFile(filepath, html, "utf8");
  console.log(`Updated races/${filename}`);
}
