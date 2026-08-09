import fs from "node:fs/promises";
import path from "node:path";

const inputRoot = path.resolve(process.env.DGR_RACE_INPUT || "data/race-creation/raw");
const outputFile = path.resolve(process.env.DGR_RACE_DATA || "data/race-creation/races.json");

const manifest = JSON.parse(await fs.readFile(path.join(inputRoot, "manifest.json"), "utf8"));
const helpData = JSON.parse(await fs.readFile(path.resolve("data/game-help/help-files.json"), "utf8"));

function choicesBetween(text, startPattern, endPattern = /Please select/i) {
  const start = text.search(startPattern);
  if (start < 0) return [];
  const remainder = text.slice(start);
  const endMatch = remainder.match(endPattern);
  const block = endMatch ? remainder.slice(0, endMatch.index) : remainder;
  return [...block.matchAll(/^([A-Z])\)\s+(.+)$/gm)].map((match) => ({
    key: match[1].toLowerCase(),
    label: match[2].trim(),
  }));
}

function firstMatch(text, pattern, mapper = (match) => match[1]) {
  const match = text.match(pattern);
  return match ? mapper(match) : null;
}

function parseRace(capture, result) {
  const description = firstMatch(
    capture,
    /Mort scribbles[^\n]*\n\n([\s\S]*?)\n\nMort peers at you/,
    (match) => match[1].replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
  );
  const typicalLifespan = firstMatch(
    capture,
    /typically live between\s+(\d+)\s+and\s+(\d+)\s+years/i,
    (match) => ({ min: Number(match[1]), max: Number(match[2]), unit: "years" }),
  );
  const allowedAge = firstMatch(
    capture,
    /must be at least\s+(\d+),\s+and no more than\s+(\d+)/i,
    (match) => ({ min: Number(match[1]), max: Number(match[2]), unit: "years" }),
  );
  const weight = firstMatch(
    capture,
    /typically weigh between\s+(\d+)\s+and\s+(\d+)\s+pounds/i,
    (match) => ({ min: Number(match[1]), max: Number(match[2]), unit: "pounds" }),
  );
  const height = firstMatch(
    capture,
    /stand between\s+(\d+)'(\d+)\s+and\s+(\d+)'(\d+)/i,
    (match) => ({
      min: { feet: Number(match[1]), inches: Number(match[2]) },
      max: { feet: Number(match[3]), inches: Number(match[4]) },
    }),
  );

  const fieldSpecs = [
    ["eyeColor", /record your eye color/i],
    ["hairColor", /record your hair color/i],
    ["hairLength", /record your hair length/i],
    ["hairStyle", /record your hair style/i],
    ["skinColor", /record your skin color/i],
    ["mood", /what of your demeanor/i],
  ];
  const appearance = Object.fromEntries(
    fieldSpecs
      .map(([key, pattern]) => [key, choicesBetween(capture, pattern).map((choice) => choice.label)])
      .filter(([, values]) => values.length),
  );

  const alignmentChoices = choicesBetween(capture, /question of character/i).map((choice) => choice.label);
  const fixedAlignment = firstMatch(capture, /notes (?:your )?disposition\.\s+"([A-Za-z-]+)/i);

  const helpEntry = helpData.entries.find((entry) => entry.title === result.race.toUpperCase());
  const helpField = (pattern, mapper = (value) => value) => {
    const match = helpEntry?.body.match(pattern);
    return match ? mapper(match[1].replace(/\s+/g, " ").trim()) : null;
  };
  const helpClasses = helpField(/^Allowed Classes:\s*([\s\S]*?)^Racial Tensions:/mi,
    (value) => value.split(/,\s*/).map((item) => item.trim()).filter(Boolean));
  const inGameHelp = helpEntry ? {
    title: helpEntry.title,
    genders: helpField(/^Genders:\s*(.+)$/mi, (value) => value.split(/,\s*/)),
    difficulty: helpField(/^Difficulty:\s*(.+)$/mi),
    role: helpField(/^Role:\s*(.+)$/mi),
    allowedClasses: helpClasses,
    racialTensions: helpField(/^Racial Tensions:\s*(.+)$/mi),
    racialAbilities: helpField(/^Racial Abilities:\s*(.+)$/mi),
  } : null;

  return {
    letter: result.letter,
    race: result.race,
    description,
    alignments: alignmentChoices.length ? alignmentChoices : (fixedAlignment ? [fixedAlignment] : []),
    sexes: choicesBetween(capture, /record your sex/i).map((choice) => choice.label),
    typicalLifespan,
    allowedAge,
    weight,
    height,
    appearance,
    inGameHelp,
    source: `data/race-creation/raw/${result.letter}-${result.race.toLowerCase().replace(/[^a-z]+/g, "-")}.txt`,
  };
}

const races = [];
for (const result of manifest.results) {
  const filename = `${result.letter}-${result.race.toLowerCase().replace(/[^a-z]+/g, "-")}.txt`;
  const capture = await fs.readFile(path.join(inputRoot, filename), "utf8");
  races.push(parseRace(capture, result));
}

const output = {
  capturedAt: manifest.capturedAt,
  verifiedAgainst: `${manifest.host}:${manifest.port}`,
  source: "Live character creation flow; drafts were not finalized.",
  races,
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Saved structured creation data for ${races.length} races to ${outputFile}`);
