// Makes a complete animated short:  writers' room -> director -> production -> edit.
//
//   npm run film                       a brand-new film, start to finish
//   npm run film:story                 only write the screenplay and shot list (free, about a minute)
//   npm run film -- --from <folder>    shoot a story you already wrote (e.g. after reading it)
//   npm run film -- --from <folder> --resume    retry any shots that failed
//   add --mock to any of these to test the pipeline offline without spending anything
import fs from "node:fs";
import path from "node:path";
import { ROOT, MOCK, log, readJSON, writeJSON } from "./film/env.mjs";
import { writeScreenplay, screenplayMarkdown } from "./film/writers-room.mjs";
import { directShots } from "./film/director.mjs";
import { produce } from "./film/producer.mjs";

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const storyOnly = args.includes("--story-only");
const from = opt("--from");

if (!MOCK && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) { console.error("No brain key: add OPENAI_API_KEY (with BRAIN=openai) or GEMINI_API_KEY to .env"); process.exit(1); }
if (!MOCK && !storyOnly && !process.env.RUNWARE_API_KEY) { console.error("RUNWARE_API_KEY is missing from .env"); process.exit(1); }

let dir, sp, shots;
if (from) {
  dir = path.resolve(from);
  sp = readJSON(path.join(dir, "screenplay.json"));
  shots = readJSON(path.join(dir, "shots.json"));
  if (!sp || !shots) { console.error(`No screenplay.json / shots.json in ${dir}`); process.exit(1); }
  log(`Using the story in ${path.relative(ROOT, dir)}`);
} else {
  dir = path.join(ROOT, "assets", "films", `film-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  fs.mkdirSync(dir, { recursive: true });
  log("WRITERS' ROOM: the characters are writing the film…\n");
  sp = await writeScreenplay();
  writeJSON(path.join(dir, "screenplay.json"), sp);
  fs.writeFileSync(path.join(dir, "screenplay.md"), screenplayMarkdown(sp));
  log(`\nENDING: ${sp.ending.title}\n  ${sp.ending.lines.join("\n  ")}`);
  log("\nDIRECTOR: planning the shots…");
  shots = await directShots(sp);
  writeJSON(path.join(dir, "shots.json"), shots);
}

const secs = shots.reduce((a, s) => a + s.duration, 0);
log(`\nSHOT LIST: ${shots.length} shots, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} long`);
for (const s of shots) log(`  ${String(s.n).padStart(2)}. ${s.duration}s ${s.location} | ${s.camera}${s.dialogue.length ? ` | ${s.dialogue.map(d => `${sp.names[d.speaker]}: "${d.line}"`).join(" / ")}` : ""}`);
log(`\nScreenplay: ${path.relative(ROOT, path.join(dir, "screenplay.md"))}`);

if (storyOnly) {
  log(`\nStory only, nothing spent. To shoot this exact story:\n  npm run film -- --from ${path.relative(ROOT, dir)}`);
  process.exit(0);
}
log("\nPRODUCTION: shooting with Runware…");
const { film, failed } = await produce(dir, sp, shots);
log(`\nOpen the film: ${film ? path.relative(ROOT, film) : path.relative(ROOT, path.join(dir, "index.html"))}`);
if (failed.length) log(`Retry failed shots: npm run film -- --from ${path.relative(ROOT, dir)} --resume`);
