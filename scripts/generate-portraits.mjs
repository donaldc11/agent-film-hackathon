// Generates a front-facing, full-body concept portrait for each character with Runware.
// These portraits are the reference images for the 3D models (next step).
//
//   node scripts/generate-portraits.mjs                 all characters, 2 options each
//   node scripts/generate-portraits.mjs mechanic mom    only these characters
//   node scripts/generate-portraits.mjs --n 4           4 options per character
//   node scripts/generate-portraits.mjs --dry           print the requests, spend nothing
//
// Output: assets/portraits/<id>_<n>.png plus assets/portraits/manifest.json
// (the manifest keeps each image's Runware UUID so the 3D step can reuse it).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "portraits");

// Load .env without dependencies
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Same ending on every prompt so the whole cast looks like one film,
// and so the image-to-3D and rigging steps get a clean, readable body.
const STYLE =
  "full body head to toe, front view, standing in a relaxed A-pose with arms slightly away from the body, " +
  "neutral expression, plain light grey seamless background, even soft studio lighting, entire figure visible with margin around it, one person only, natural hands, " +
  "stylized realistic animated feature film character, high detail, sharp focus, no text";

// Names are left out on purpose: the agents choose their own names at the start of each run.
export const CAST = [
  {
    id: "scholar",
    prompt: "A 28-year-old African-American woman from Atlanta, scholarly and polished, smart casual travel outfit with a cardigan and comfortable shoes, small backpack, slightly tense posture",
  },
  {
    id: "lucky",
    prompt: "A 68-year-old Cape Verdean man, wiry build, grey stubble, deep smile lines and a big easy grin, well-worn but cheerful outfit with a faded colourful shirt, rolled-up trousers, scuffed sneakers and an old straw hat, no bag, relaxed carefree posture",
  },
  {
    id: "mechanic",
    prompt: "A 38-year-old Latino man from the Bronx, muscular gym build, work boots, utility pants and a fitted T-shirt, confident stance",
  },
  {
    id: "mom",
    prompt: "A 35-year-old Irish-American woman from Boston, athletic build, practical outfit with a windbreaker, leggings and trainers, crossbody bag",
  },
  {
    id: "kid10",
    prompt: "A 10-year-old child in casual tourist clothes with a light jacket, jeans and sneakers",
  },
  {
    id: "kid7",
    prompt: "A 7-year-old child in casual tourist clothes with a light jacket, shorts over leggings and sneakers",
  },
];

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const nIdx = args.indexOf("--n");
const perCharacter = nIdx >= 0 ? Math.max(1, Math.min(4, Number(args[nIdx + 1]) || 2)) : 2;
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--n");
const cast = wanted.length ? CAST.filter(c => wanted.includes(c.id)) : CAST;

const KEY = process.env.RUNWARE_API_KEY;
const MODEL = process.env.RUNWARE_IMAGE_MODEL || "runware:101@1"; // FLUX Dev

if (!cast.length) { console.error(`No matching characters. Use: ${CAST.map(c => c.id).join(", ")}`); process.exit(1); }
if (!KEY && !dry) { console.error("RUNWARE_API_KEY is missing. Add it to .env in the project root."); process.exit(1); }

function task(c) {
  return {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: MODEL,
    positivePrompt: `${c.prompt}, ${STYLE}`,
    width: 832,
    height: 1216,
    numberResults: perCharacter,
    outputType: "URL",
    outputFormat: "PNG",
    includeCost: true,
  };
}

async function run(c) {
  const t = task(c);
  if (dry) { console.log(JSON.stringify(t, null, 2)); return []; }
  const res = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify([t]),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) {
    throw new Error(`${c.id}: ${res.status} ${JSON.stringify(body.errors || body).slice(0, 300)}`);
  }
  const images = (body.data || []).filter(d => d.imageURL);
  const saved = [];
  for (const [i, img] of images.entries()) {
    const file = `${c.id}_${i + 1}.png`;
    const buf = Buffer.from(await (await fetch(img.imageURL)).arrayBuffer());
    fs.writeFileSync(path.join(OUT, file), buf);
    saved.push({ file, imageUUID: img.imageUUID, imageURL: img.imageURL, seed: img.seed, cost: img.cost });
    console.log(`  saved ${file}${img.cost != null ? ` ($${img.cost})` : ""}`);
  }
  return saved;
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};

console.log(`${dry ? "Dry run" : "Generating"}: ${cast.map(c => c.id).join(", ")} (${perCharacter} option${perCharacter > 1 ? "s" : ""} each, model ${MODEL})`);
const results = await Promise.allSettled(cast.map(async c => {
  const saved = await run(c);
  if (saved.length) manifest[c.id] = { prompt: c.prompt, model: MODEL, options: saved, chosen: manifest[c.id]?.chosen ?? null };
}));
for (const r of results) if (r.status === "rejected") console.error(`  failed: ${r.reason.message}`);
if (!dry) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDone. Look through assets/portraits/ and pick the best option for each character.`);
}
