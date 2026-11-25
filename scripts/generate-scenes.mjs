// Summit plates for the film. Pass scene ids to generate a subset.
//   node scripts/generate-scenes.mjs ascent
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "scenes");
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.RUNWARE_API_KEY;
const MODEL = process.env.RUNWARE_IMAGE_MODEL || "runware:101@1";
if (!KEY) {
  console.error("RUNWARE_API_KEY is missing. Add it to .env in the project root.");
  process.exit(1);
}

const SCENES = [
  {
    id: "ascent",
    file: "ascent.png",
    width: 1344,
    height: 768,
    prompt:
      "view from beside the Table Mountain cableway looking up the sheer sandstone cliff at sunset, the cable rising to the upper station, Cape Town and the Atlantic below, no people, stylized realistic animated film background, no text",
  },
  {
    id: "summit",
    file: "summit.png",
    width: 1344,
    height: 768,
    prompt:
      "Wide cinematic eye-level view across the flat sandstone summit of Table Mountain, Cape Town, at golden-hour sunset. On the far left at the cliff edge, the upper cable car station building with the steel cable dropping away towards the city far below. In the centre, a small stone summit café with warm lit windows. On the right, a rocky lookout point facing Lion's Head and the Atlantic Ocean. On the far right, the top of a rocky hiking trail. Behind, the white 'tablecloth' cloud spilling over the mountain edge. Fynbos shrubs and boulders, the Cape Peninsula stretching away to the Cape of Good Hope on the hazy horizon. Open, empty foreground path for characters to walk on, no people, stylized realistic animated feature film background, detailed matte painting, no text",
  },
  {
    id: "cablecar",
    file: "cablecar.png",
    width: 1024,
    height: 1024,
    prompt:
      "A single round red and white rotating cable car cabin of the Table Mountain Aerial Cableway, large panoramic windows, hanging from its metal grip arm, side view, entire cabin and arm visible with margin around it, isolated on a plain light grey seamless background, even soft studio lighting, stylized realistic animated feature film prop, high detail, no people, no text",
  },
];

async function run(scene) {
  const task = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: MODEL,
    positivePrompt: scene.prompt,
    width: scene.width,
    height: scene.height,
    numberResults: 1,
    outputType: "URL",
    outputFormat: "PNG",
    includeCost: true,
  };
  const res = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify([task]),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) {
    throw new Error(`${scene.id}: ${res.status} ${JSON.stringify(body.errors || body).slice(0, 400)}`);
  }
  const img = (body.data || []).find(d => d.imageURL);
  if (!img) throw new Error(`${scene.id}: no image URL`);
  const buf = Buffer.from(await (await fetch(img.imageURL)).arrayBuffer());
  fs.writeFileSync(path.join(OUT, scene.file), buf);
  console.log(`saved ${scene.file} (${buf.length} bytes${img.cost != null ? `, $${img.cost}` : ""})`);
}

const wanted = process.argv.slice(2);
const selected = wanted.length ? SCENES.filter(s => wanted.includes(s.id)) : SCENES;
if (!selected.length) {
  console.error(`No matching scene. Use: ${SCENES.map(s => s.id).join(", ")}`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
console.log(`Generating ${selected.map(s => s.id).join(", ")} with ${MODEL}`);
const results = await Promise.allSettled(selected.map(run));
let failed = 0;
for (const r of results) if (r.status === "rejected") { failed++; console.error(r.reason.message); }
if (failed) process.exit(1);
