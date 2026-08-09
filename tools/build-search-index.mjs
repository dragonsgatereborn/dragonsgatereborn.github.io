import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", "tools"]);

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return extname(entry.name) === ".html" ? [path] : [];
  }));
  return nested.flat();
}

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function plainText(value) {
  return decode(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

const pages = [];
for (const file of await htmlFiles(root)) {
  const html = await readFile(file, "utf8");
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!titleMatch) continue;
  const descriptionMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  const headings = Array.from((mainMatch?.[0] || html).matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi), (match) => plainText(match[1]));
  const path = relative(root, file).replaceAll("\\", "/");
  pages.push({
    url: `/${path === "index.html" ? "" : path}`,
    title: plainText(titleMatch[1]).replace(/^Dragon's Gate Reborn\s*\|\s*/i, ""),
    description: descriptionMatch ? decode(descriptionMatch[1]) : "",
    headings,
    text: plainText(mainMatch?.[0] || html).slice(0, 12000),
  });
}

pages.sort((a, b) => a.title.localeCompare(b.title));
await writeFile(resolve(root, "search-index.json"), `${JSON.stringify(pages)}\n`);
console.log(`Indexed ${pages.length} HTML pages.`);
