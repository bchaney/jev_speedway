// Regenerates the "Jev's world view" and "The questions" tables in README.md from public/world.mjs, so the README
// cannot drift from what the game sends. `node scripts/readme-world.mjs` rewrites the README; `--check` only reports.
import { readFileSync, writeFileSync } from "node:fs";
import { WORLD, QUESTIONS } from "../public/world.mjs";

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const tick = (s) => `\`${s}\``;
const phrase = (k) => (typeof k.say === "string" ? k.say : k.sample ?? "(computed)");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

const world = table(["Field", "About", "Cases, in the order they are tried"],
  Object.entries(WORLD).map(([key, f]) => [tick(key), f.about, f.cases.map((k) => `**${k.when}:** ${tick(phrase(k))}`).join(" · ")]));

const questions = table(["Question", "Type", "Asked", "Answers"],
  Object.entries(QUESTIONS).map(([id, q]) => [tick(id), q.type === "noul" ? "Noul" : "Choice", q.instructions,
    Object.entries(q.criteria).map(([k, v]) => `${tick(k)}: ${v}`).join(" · ")]));

const README = new URL("../README.md", import.meta.url);
let text = readFileSync(README, "utf8");
const fill = (name, body) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`README.md has no <!-- ${name}:start --> … <!-- ${name}:end --> markers`);
  text = text.replace(re, `$1\n${body}\n$2`);
};
fill("world", world);
fill("questions", questions);

if (process.argv.includes("--check")) {
  if (text !== readFileSync(README, "utf8")) { console.error("README.md is out of date: run `npm run readme`"); process.exit(1); }
  console.log("README.md is in sync with public/world.mjs");
} else { writeFileSync(README, text); console.log("README.md tables regenerated from public/world.mjs"); }
