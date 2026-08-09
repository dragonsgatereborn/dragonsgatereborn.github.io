import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

const host = process.env.DGR_HOST || "game.dragonsgatereborn.com";
const port = Number(process.env.DGR_PORT || 8555);
const account = process.env.DGR_ACCOUNT;
const password = process.env.DGR_PASSWORD;
const outputRoot = path.resolve(process.env.DGR_RACE_OUTPUT || "data/race-creation/raw");
const requested = (process.env.DGR_RACES || "abcdefghijklmnopqrstu").toLowerCase();

if (!account || !password) {
  console.error("DGR_ACCOUNT and DGR_PASSWORD are required.");
  process.exit(2);
}

const races = [
  ["a", "Anthian"], ["b", "Arachnian"], ["c", "Draco"], ["d", "Drag-al"],
  ["e", "Fir Elf"], ["f", "Flerian"], ["g", "Frontacian"], ["h", "Go-blin"],
  ["i", "Go-blin-al"], ["j", "Hithual"], ["k", "Human"], ["l", "Leuian"],
  ["m", "Monitanian"], ["n", "Muatana-al"], ["o", "Oog-ra"], ["p", "Penthanian"],
  ["q", "Psycian"], ["r", "San Elf"], ["s", "Secian"], ["t", "Thugian"], ["u", "Usilin"],
].filter(([letter]) => requested.includes(letter));

const stripAnsi = (value) => value
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  .replace(/\r/g, "")
  .replace(/\0/g, "");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureRace(letter, raceName) {
  let transcript = "";
  const socket = net.createConnection({ host, port });
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => { transcript += stripAnsi(chunk); });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });

  async function waitFor(pattern, start, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = transcript.slice(start);
      if (pattern.test(current)) return current;
      await delay(40);
    }
    throw new Error(`${raceName}: timed out waiting for ${pattern}`);
  }
  async function respond(pattern, value, timeoutMs) {
    const start = transcript.length;
    await waitFor(pattern, start, timeoutMs);
    socket.write(`${value}\r\n`);
  }
  async function promptAfter(value, timeoutMs = 30_000) {
    const start = transcript.length;
    socket.write(`${value}\r\n`);
    await waitFor(/\n>\s*$/, start, timeoutMs);
    return transcript.slice(start);
  }

  await respond(/Your selection\?/i, "1");
  await respond(/account name\?/i, account);
  await respond(/what is your password\?/i, password);
  await respond(/Please select your choice/i, "c");
  await respond(/Press Enter to Continue/i, "");
  await respond(/first name/i, `Audit${raceName.replace(/[^A-Za-z]/g, "")}`);
  await respond(/Is that correct\?/i, "y");
  await respond(/last name/i, "Racecheck");
  await respond(/Is that right\?/i, "y");
  await respond(/Please select your race/i, letter);

  const appearanceStart = transcript.length;
  await respond(/Is that correct\?/i, "y");

  let prompts = 0;
  while (prompts < 40) {
    const start = transcript.length;
    const block = await waitFor(/\n>\s*$/, start, 30_000);
    prompts += 1;

    if (/Is everything correct\?/i.test(block)) break;

    let answer;
    if (/How old are you\?/i.test(block)) {
      answer = block.match(/must be at least\s+(\d+)/i)?.[1]
        || block.match(/between\s+(\d+)\s+and\s+\d+\s+years/i)?.[1]
        || "18";
    } else if (/What is your weight\?/i.test(block)) {
      answer = block.match(/between\s+(\d+)\s+and\s+\d+\s+pounds/i)?.[1] || "100";
    } else if (/What is your height\?/i.test(block)) {
      const height = block.match(/between\s+(\d+)'(\d+)/i);
      answer = height ? `${height[1]} ${height[2]}` : "5 0";
    } else if (/Please select/i.test(block)) {
      answer = "a";
    } else {
      await fs.mkdir(outputRoot, { recursive: true });
      await fs.writeFile(path.join(outputRoot, `${letter}-error.txt`), transcript, "utf8");
      socket.destroy();
      throw new Error(`${raceName}: unrecognized creation prompt: ${block.slice(-500)}`);
    }
    socket.write(`${answer}\r\n`);
  }

  const captured = transcript.slice(appearanceStart)
    .replace(/\n>\s*/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, `${letter}-${raceName.toLowerCase().replace(/[^a-z]+/g, "-")}.txt`), `${captured}\n`, "utf8");
  socket.destroy();
  await delay(1_500);
  return { letter, race: raceName, prompts, bytes: Buffer.byteLength(captured) };
}

await fs.mkdir(outputRoot, { recursive: true });
const results = [];
for (const [letter, raceName] of races) {
  const result = await captureRace(letter, raceName);
  results.push(result);
  console.log(`${raceName}: ${result.prompts} prompts, ${result.bytes} bytes`);
}
let priorResults = [];
try {
  priorResults = JSON.parse(await fs.readFile(path.join(outputRoot, "manifest.json"), "utf8")).results || [];
} catch {
  priorResults = [];
}
const mergedResults = [...priorResults.filter((prior) => !results.some((current) => current.letter === prior.letter)), ...results]
  .sort((a, b) => a.letter.localeCompare(b.letter));
await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify({ capturedAt: new Date().toISOString(), host, port, results: mergedResults }, null, 2)}\n`, "utf8");
console.log(`Saved ${results.length} race creation captures to ${outputRoot}`);
