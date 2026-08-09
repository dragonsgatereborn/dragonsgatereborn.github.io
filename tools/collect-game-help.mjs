import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

const host = process.env.DGR_HOST || "game.dragonsgatereborn.com";
const port = Number(process.env.DGR_PORT || 8555);
const account = process.env.DGR_ACCOUNT;
const password = process.env.DGR_PASSWORD;
const characterSlot = process.env.DGR_CHARACTER_SLOT || "1";
const outputRoot = path.resolve(process.env.DGR_HELP_OUTPUT || "data/game-help/raw");

if (!account || !password) {
  console.error("DGR_ACCOUNT and DGR_PASSWORD are required.");
  process.exit(2);
}

const stripAnsi = (value) => value
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  .replace(/\r/g, "")
  .replace(/\0/g, "");

let transcript = "";
let lastDataAt = Date.now();
const socket = net.createConnection({ host, port });
socket.setEncoding("utf8");
socket.on("data", (chunk) => {
  transcript += stripAnsi(chunk);
  lastDataAt = Date.now();
});
socket.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(pattern, start, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = transcript.slice(start);
    if (pattern.test(current)) return current;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${pattern}`);
}

async function sendAfter(pattern, value, timeoutMs) {
  const start = transcript.length;
  await waitFor(pattern, start, timeoutMs);
  socket.write(`${value}\r\n`);
}

async function collectLetter(letter) {
  const start = transcript.length;
  socket.write(`help ${letter}\r\n`);
  let continued = 0;
  const deadline = Date.now() + 240_000;

  while (Date.now() < deadline) {
    const current = transcript.slice(start);
    const pageCount = (current.match(/Press Enter to continue/gi) || []).length;
    while (continued < pageCount) {
      socket.write("\r\n");
      continued += 1;
      await delay(75);
    }

    if (/\n>\s*$/.test(current) && Date.now() - lastDataAt > 250) {
      const cleaned = current
        .replace(new RegExp(`^help ${letter}\\s*\\n`, "i"), "")
        .replace(/\[\s*Press Enter to continue\s*\]/gi, "")
        .replace(/\n>\s*$/, "")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
      await fs.writeFile(path.join(outputRoot, `${letter}.txt`), `${cleaned}\n`, "utf8");
      return { letter, bytes: Buffer.byteLength(cleaned), pages: continued + 1 };
    }
    await delay(75);
  }
  throw new Error(`Timed out collecting HELP ${letter.toUpperCase()}`);
}

await fs.mkdir(outputRoot, { recursive: true });
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("error", reject);
});

await sendAfter(/Your selection\?/i, "1");
await sendAfter(/account name\?/i, account);
await sendAfter(/what is your password\?/i, password);
const characterMenuStart = transcript.length;
await waitFor(/Please select your choice/i, characterMenuStart, 30_000);
const enterStart = transcript.length;
socket.write(`${characterSlot}\r\n`);
await waitFor(/has entered the world!|Welcome to Dragon's Gate Reborn|Reconnecting/i, enterStart, 60_000);
await delay(750);

const results = [];
for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  const result = await collectLetter(letter);
  results.push(result);
  console.log(`${letter.toUpperCase()}: ${result.pages} pages, ${result.bytes} bytes`);
}

await fs.writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify({ capturedAt: new Date().toISOString(), host, port, results }, null, 2)}\n`,
  "utf8",
);

socket.write("quit\r\n");
await delay(250);
socket.end();
console.log(`Saved ${results.length} letter files to ${outputRoot}`);
