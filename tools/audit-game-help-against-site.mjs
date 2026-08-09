import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const helpData = JSON.parse(await fs.readFile(path.join(root, "data/game-help/help-files.json"), "utf8"));
const hiddenFiles = new Set(["game-help-library.html"]);
const ignoredDirectories = new Set([".git", "node_modules", "tools", "data"]);

async function htmlFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name) || hiddenFiles.has(entry.name)) continue;
    const filepath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await htmlFiles(filepath));
    else if (entry.name.endsWith(".html")) results.push(filepath);
  }
  return results;
}

function textOnly(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|quot|#39);/g, " ").replace(/\s+/g, " ").toLowerCase();
}

const publicPages = [];
for (const filepath of await htmlFiles(root)) {
  const html = await fs.readFile(filepath, "utf8");
  publicPages.push({
    path: `/${path.relative(root, filepath).replaceAll("\\", "/")}`,
    text: textOnly(html),
  });
}

const racePageMap = {
  "ANTHIAN": "/races/race-anthian.html", "ARACHNIAN": "/races/race-arachnian.html",
  "DRACO": "/races/race-dragon.html", "DRAG-AL": "/races/race-dragal.html",
  "FIR ELF": "/races/race-firian.html", "FLERIAN": "/races/race-flerian.html",
  "FRONTACIAN": "/races/race-frontacian.html", "GO-BLIN": "/races/race-goblin.html",
  "GO-BLIN-AL": "/races/race-goblin.html", "HITHUAL": "/races/race-hithual.html",
  "HUMAN": "/races/race-human.html", "LEUIAN": "/races/race-leuian.html",
  "MONITANIAN": "/races/race-monitanian.html", "MUATANA-AL": "/races/race-muatanaal.html",
  "OOG-RA": "/races/race-oogra.html", "PENTHANIAN": "/races/race-penthanian.html",
  "PSYCIAN": "/races/race-psycian.html", "SAN ELF": "/races/race-sanene.html",
  "SECIAN": "/races/race-secian.html", "THUGIAN": "/races/race-thugian.html",
  "USILIN": "/races/race-usilin.html",
};

const entries = helpData.entries.map((entry) => {
  const needle = entry.title.toLowerCase();
  const mentionedOn = publicPages.filter((page) => page.text.includes(needle)).map((page) => page.path);
  const dgrLinks = [...entry.body.matchAll(/https?:\/\/(?:www\.)?dragonsgatereborn\.com([^\s)>]*)/gi)].map((match) => match[1] || "/");
  const staleExternalLinks = [...entry.body.matchAll(/https?:\/\/[^\s)>]+/gi)].map((match) => match[0])
    .filter((url) => /tempestseason\.com/i.test(url));
  return {
    title: entry.title,
    type: entry.type,
    flags: entry.flags,
    publicMentionCount: mentionedOn.length,
    mentionedOn,
    linkedDgrPages: dgrLinks,
    staleExternalLinks,
  };
});

const raceEntries = entries.filter((entry) => racePageMap[entry.title]).map((entry) => ({
  ...entry,
  expectedPage: racePageMap[entry.title],
  expectedPageExists: publicPages.some((page) => page.path === racePageMap[entry.title]),
  liveCreationSectionPresent: publicPages.find((page) => page.path === racePageMap[entry.title])?.text.includes("live character creation") || false,
}));

const report = {
  generatedAt: new Date().toISOString(),
  helpCapture: helpData.capturedAt,
  publicPageCount: publicPages.length,
  helpEntryCount: entries.length,
  helpEntriesMentionedOnPublicSite: entries.filter((entry) => entry.publicMentionCount).length,
  helpEntriesNotMentionedOnPublicSite: entries.filter((entry) => !entry.publicMentionCount).map((entry) => entry.title),
  explicitTempestLinkEntries: entries.filter((entry) => entry.staleExternalLinks.length).map((entry) => ({ title: entry.title, links: entry.staleExternalLinks })),
  raceSummary: {
    expectedPlayableRaces: Object.keys(racePageMap).length,
    mappedRaceEntries: raceEntries.length,
    missingPages: raceEntries.filter((entry) => !entry.expectedPageExists).map((entry) => entry.title),
    missingLiveCreationSections: raceEntries.filter((entry) => !entry.liveCreationSectionPresent).map((entry) => entry.title),
  },
  raceEntries,
  entries,
};

const output = path.join(root, "data/game-help/site-cross-reference.json");
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Audited ${entries.length} help entries against ${publicPages.length} public pages.`);
console.log(`${report.helpEntriesMentionedOnPublicSite} help titles appear on at least one public page.`);
console.log(`${raceEntries.length}/${Object.keys(racePageMap).length} playable race help entries mapped; ${report.raceSummary.missingLiveCreationSections.length} missing live creation sections.`);
