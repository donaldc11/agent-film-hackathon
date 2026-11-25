// One realistic summit backdrop and one cable-car cutout for the film stage.
//   node scripts/generate-scenery.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "scenery");
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

const jobs = [
  {
    file: "backdrop.png",
    width: 1344,
    height: 768,
    prompt:
      "Eye-level wide theatre backdrop, camera standing on the flat sandstone summit of Table Mountain at sunset. " +
      "The bottom third is empty flat ground with no people, so actors can stand there. " +
      "Midground left: the upper cable station, a low building, and a steel cable running off the left cliff. " +
      "Midground center: a small sandstone summit café with warm windows. Midground right: a viewpoint railing. " +
      "Behind the buildings, the white tablecloth cloud spills over the plateau edge. " +
      "Far horizon shows the Atlantic and the Cape of Good Hope coastline. " +
      "Realistic animated-film matte painting, no people, no text, no close-up of a cliff face in the foreground.",
  },
  {
    file: "cablecar.png",
    width: 768,
    height: 768,
    prompt:
      "A single red Table Mountain cable-car gondola, side view, slightly facing the camera, white window band, empty, centered, " +
      "isolated on a flat pure chroma-key green background, no landscape, no sky, no cable, no people, no text, product photo.",
  },
];

async function run(job) {
  const task = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: MODEL,
    positivePrompt: job.prompt,
    width: job.width,
    height: job.height,
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
    throw new Error(`${job.file}: ${res.status} ${JSON.stringify(body.errors || body).slice(0, 400)}`);
  }
  const img = (body.data || []).find(d => d.imageURL);
  if (!img) throw new Error(`${job.file}: no image URL`);
  const buf = Buffer.from(await (await fetch(img.imageURL)).arrayBuffer());
  fs.writeFileSync(path.join(OUT, job.file), buf);
  console.log(`saved ${job.file} (${buf.length} bytes${img.cost != null ? `, $${img.cost}` : ""})`);
}

const wanted = process.argv.slice(2);
const selected = wanted.length ? jobs.filter(j => wanted.includes(j.file.replace(".png", ""))) : jobs;
fs.mkdirSync(OUT, { recursive: true });
console.log(`Generating scenery with ${MODEL}`);
const results = await Promise.allSettled(selected.map(run));
let failed = 0;
for (const r of results) {
  if (r.status === "rejected") {
    failed++;
    console.error(r.reason.message);
  }
}
if (failed) process.exit(1);
