// Adds the guaranteed ending to a film you already shot, without re-shooting anything else:
// a resolution shot, the characters' closing lines and an end card (about 30 to 35 seconds).
// It also retries any shot that failed before, then rebuilds film.mp4.
//
//   npm run film:extend -- --from assets/films/<film folder>
//   add --dry to see the new shots without spending anything
import fs from "node:fs";
import path from "node:path";
import { ROOT, log, readJSON, writeJSON } from "./film/env.mjs";
import { finaleShots } from "./film/director.mjs";
import { produce } from "./film/producer.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--from");
if (i < 0) { console.error("Usage: npm run film:extend -- --from assets/films/<film folder>"); process.exit(1); }
const dir = path.resolve(args[i + 1]);
const sp = readJSON(path.join(dir, "screenplay.json"));
const shots = readJSON(path.join(dir, "shots.json"));
if (!sp || !shots) { console.error(`No screenplay.json / shots.json in ${dir}`); process.exit(1); }

if (shots.some(s => s.titleText)) {
  log("This film already has its ending shots. Rebuilding with any missing shots retried.");
} else {
  if (!fs.existsSync(path.join(dir, "shots.before-ending.json"))) writeJSON(path.join(dir, "shots.before-ending.json"), shots);
  const extra = finaleShots(sp).map((s, k) => ({ ...s, n: shots.length + k + 1 }));
  shots.push(...extra);
  const secs = extra.reduce((a, s) => a + s.duration, 0);
  log(`Ending: ${sp.ending.title}. Adding ${extra.length} shots, ${secs} seconds:`);
  for (const s of extra) log(`  ${s.n}. ${s.duration}s ${s.location} | ${s.camera}${s.dialogue.length ? ` | ${s.dialogue.map(d => `${sp.names[d.speaker]}: "${d.line}"`).join(" / ")}` : ""}${s.titleText ? ` | title: ${s.titleText}` : ""}`);
  if (args.includes("--dry")) { log("\nDry run: nothing saved or spent."); process.exit(0); }
  writeJSON(path.join(dir, "shots.json"), shots);
}
const missing = shots.filter(s => !fs.existsSync(path.join(dir, "clips", `shot-${String(s.n).padStart(2, "0")}.mp4`)));
log(`\nShooting ${missing.length} shot(s): ${missing.map(s => s.n).join(", ")}`);
const { film, failed } = await produce(dir, sp, shots);
log(`\nOpen the film: ${film ? path.relative(ROOT, film) : path.relative(ROOT, path.join(dir, "index.html"))}`);
if (failed.length) log(`Some shots failed; run the same command again to retry them.`);
