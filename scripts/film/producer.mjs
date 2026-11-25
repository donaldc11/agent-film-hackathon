// The producer shoots the shot list with Runware:
// 1) a keyframe per shot (Qwen Image 3.0 with the character portraits as references, so faces stay consistent)
// 2) an animated clip per shot (FLUX 3 Video: motion, lip-synced dialogue, ambient sound and music in one MP4)
// 3) the edit: clips joined into one film with subtitles (ffmpeg), plus a browser player that needs no ffmpeg.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CHAR } from "../../public/world.js";
import { PORTRAITS } from "../../public/cast.js";
import { ROOT, MOCK, log, sleep, runware, uuid, download, dataURI, readJSON, writeJSON } from "./env.mjs";
import { LOCATIONS, LIGHT, LOOK, LOOK_SHORT } from "./director.mjs";

const IMAGE_MODEL = process.env.FILM_IMAGE_MODEL || "alibaba:qwen-image@3.0";
const VIDEO_MODEL = process.env.FILM_VIDEO_MODEL || "bfl:flux@3-video";
const ORD = ["first", "second", "third"];

// ---------- references: upload each portrait once and reuse its id ----------
async function references() {
  const cacheFile = path.join(ROOT, "assets", "films", "ref-cache.json");
  const cache = readJSON(cacheFile, {});
  const refs = {};
  const files = Object.fromEntries(Object.entries(PORTRAITS).map(([id, f]) => [id, path.join(ROOT, "assets", "portraits", f)]));
  for (const [id, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) { log(`  ! missing portrait for ${id}: ${file}`); continue; }
    const key = `${file}:${fs.statSync(file).mtimeMs}`;
    if (cache[key]) { refs[id] = cache[key]; continue; }
    if (MOCK) { refs[id] = `mock-${id}`; continue; }
    try {
      const [res] = await runware([{ taskType: "imageUpload", taskUUID: uuid(), image: dataURI(file) }]);
      refs[id] = res.imageUUID; cache[key] = res.imageUUID;
      log(`  uploaded ${id} portrait`);
    } catch (e) {
      log(`  (upload failed for ${id}, sending the image inline: ${e.message.slice(0, 80)})`);
      refs[id] = dataURI(file);
    }
  }
  writeJSON(cacheFile, cache);
  return refs;
}

export function refsFor(shot) {
  const order = [...shot.dialogue.map(d => d.speaker), ...shot.in_frame];
  const ids = [...new Set(order)].slice(0, 3);
  if (ids.includes("mom") && ids.length < 3) ids.push("kid10");
  if (ids.includes("mom") && ids.length < 3) ids.push("kid7");
  return ids;
}

export function keyframePrompt(shot, names, refIds) {
  const who = refIds.filter(id => CHAR[id]).map(id => {
    const i = refIds.indexOf(id);
    return `${names[id]}, ${LOOK[id]} (keep the exact face, hair, skin tone and clothes of the person in the ${ORD[i]} image)`;
  });
  const kids = refIds.filter(id => id.startsWith("kid")).map(id => `the ${id === "kid10" ? "10" : "7"}-year-old child from the ${ORD[refIds.indexOf(id)]} image beside their mother`);
  const people = [...who, ...kids];
  return `A single cinematic frame from a stylized realistic animated feature film. Setting: ${LOCATIONS[shot.location]}. Lighting: ${LIGHT[shot.light]}. ` +
    `Camera: ${shot.camera}. ${people.length ? `In frame: ${people.join("; ")}. ` : "No people in frame. "}` +
    `${shot.action} Natural expressions, mouths at rest, everyone clearly separated and readable. 16:9 widescreen composition. No text, no subtitles, no watermark.`;
}

export function videoPrompt(shot, names) {
  const speech = shot.dialogue.map(d => `${names[d.speaker]}, ${LOOK_SHORT[d.speaker]}, says ${d.delivery}: "${d.line}"`).join(" Then ");
  const title = shot.titleText ? ` The title "${shot.titleText}" fades in elegantly in clean white serif type, with "${shot.subtitleText || ""}" in smaller type beneath it, and holds to the end.`
    : shot.n === 1 && !/title/i.test(shot.action) ? ` The title "THE LAST CAR DOWN" fades in elegantly in clean white serif type over the view and holds.` : "";
  const an = [8, 11, 18].includes(shot.duration) ? "An" : "A";
  return `Use this image as the first frame. ${an} ${shot.duration}-second shot from a stylized realistic animated film set on Table Mountain, Cape Town. ` +
    `${shot.action}${title} ${speech ? speech + " " : ""}Camera: ${shot.camera}. ` +
    `Audio: ${shot.dialogue.length ? "the voices clear and natural, " : ""}${shot.audio}. ` +
    `${shot.n === 1 || shot.titleText ? "" : "No on-screen text, no subtitles."}`;
}

// ---------- Runware video tasks run async: submit, then poll ----------
async function submitVideo(shot, keyframe, names) {
  const taskUUID = uuid();
  await runware([{ taskType: "videoInference", taskUUID, model: VIDEO_MODEL, positivePrompt: videoPrompt(shot, names),
    inputs: { frameImages: [{ image: keyframe, frame: "first" }] }, resolution: "720p", duration: shot.duration,
    deliveryMethod: "async", includeCost: true }]);
  return taskUUID;
}
async function pollVideo(taskUUID, label) {
  const start = Date.now();
  while (Date.now() - start < 20 * 60 * 1000) {
    await sleep(6000);
    let items = [];
    try { items = await runware([{ taskType: "getResponse", taskUUID }]); }
    catch (e) { if (/not.?found|pending|processing/i.test(e.message)) continue; throw e; }
    const done = items.find(i => i.videoURL);
    if (done) return done;
    const failed = items.find(i => /error|fail/i.test(i.status || ""));
    if (failed) throw new Error(`${label} failed: ${JSON.stringify(failed).slice(0, 200)}`);
  }
  throw new Error(`${label} timed out`);
}

async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(e => ({ error: e.message })); }
  }));
  return out;
}

export async function produce(dir, sp, shots) {
  const kfDir = path.join(dir, "keyframes"), clipDir = path.join(dir, "clips");
  fs.mkdirSync(kfDir, { recursive: true }); fs.mkdirSync(clipDir, { recursive: true });
  const state = readJSON(path.join(dir, "production.json"), { keyframes: {}, clips: {}, cost: 0 });
  const save = () => writeJSON(path.join(dir, "production.json"), state);

  log("\nReferences");
  const refs = await references();

  log("\nKeyframes");
  await pool(shots, 4, async shot => {
    if (state.keyframes[shot.n]) return;
    const ids = refsFor(shot).filter(id => refs[id]);
    const task = { taskType: "imageInference", taskUUID: uuid(), model: IMAGE_MODEL, positivePrompt: keyframePrompt(shot, sp.names, ids),
      width: 1792, height: 1008, numberResults: 1, outputType: "URL", outputFormat: "JPG", includeCost: true,
      ...(ids.length ? { inputs: { referenceImages: ids.map(id => refs[id]) }, promptExtend: false } : {}) };
    if (MOCK) { state.keyframes[shot.n] = { uuid: `mock-kf-${shot.n}`, url: "", prompt: task.positivePrompt }; return; }
    const [img] = await runware([task]);
    await download(img.imageURL, path.join(kfDir, `shot-${String(shot.n).padStart(2, "0")}.jpg`));
    state.keyframes[shot.n] = { uuid: img.imageUUID, url: img.imageURL }; state.cost += img.cost || 0; save();
    log(`  shot ${shot.n} keyframe ready`);
  });

  log("\nAnimating shots (each takes a few minutes; they run in parallel)");
  const results = await pool(shots, Number(process.env.FILM_PARALLEL || 4), async shot => {
    const file = path.join(clipDir, `shot-${String(shot.n).padStart(2, "0")}.mp4`);
    if (fs.existsSync(file)) return file;
    const kf = state.keyframes[shot.n];
    if (!kf) throw new Error(`shot ${shot.n} has no keyframe`);
    if (MOCK) return null;
    const taskUUID = state.clips[shot.n]?.taskUUID || await submitVideo(shot, kf.uuid || kf.url, sp.names);
    state.clips[shot.n] = { taskUUID }; save();
    let v;
    try { v = await pollVideo(taskUUID, `shot ${shot.n}`); }
    catch (e) { delete state.clips[shot.n]; save(); throw e; }
    await download(v.videoURL, file);
    state.clips[shot.n] = { taskUUID, url: v.videoURL }; state.cost += v.cost || 0; save();
    log(`  shot ${shot.n} animated`);
    return file;
  });
  const failed = results.map((r, i) => (r?.error ? `shot ${i + 1}: ${r.error}` : null)).filter(Boolean);
  if (failed.length) log(`\n! ${failed.length} shot(s) failed. Run the same command with --resume to retry them:\n  ${failed.join("\n  ")}`);

  writeSubtitles(dir, shots, sp.names);
  writePlayer(dir, shots, sp);
  const film = edit(dir, shots);
  log(`\nRunware spend this film: about $${state.cost.toFixed(2)}`);
  return { film, failed, cost: state.cost };
}

// ---------- subtitles, player, edit ----------
const ts = s => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
function writeSubtitles(dir, shots, names) {
  let t = 0, n = 1, srt = "";
  for (const s of shots) {
    const per = s.duration / Math.max(1, s.dialogue.length);
    s.dialogue.forEach((d, i) => { srt += `${n++}\n${ts(t + i * per + 0.3)} --> ${ts(t + (i + 1) * per - 0.2)}\n${names[d.speaker]}: ${d.line}\n\n`; });
    t += s.duration;
  }
  fs.writeFileSync(path.join(dir, "film.srt"), srt);
}
function writePlayer(dir, shots, sp) {
  const clips = shots.map(s => `clips/shot-${String(s.n).padStart(2, "0")}.mp4`);
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Last Car Down</title>
<style>body{margin:0;background:#000;color:#eee;font-family:system-ui,sans-serif}video{display:block;width:100%;max-height:92vh;background:#000}p{padding:.5rem 1rem;color:#aaa}</style></head>
<body><video id="v" controls autoplay playsinline></video><p id="info"></p>
<script>const clips=${JSON.stringify(clips)};let i=0;const v=document.getElementById("v"),info=document.getElementById("info");
function play(){if(i>=clips.length){info.textContent="The end: ${sp.ending.title.replace(/"/g, "")}";return;}v.src=clips[i];info.textContent="Shot "+(i+1)+" of "+clips.length;v.play().catch(()=>{});}
v.addEventListener("ended",()=>{i++;play();});v.addEventListener("error",()=>{i++;play();});play();</script></body></html>`);
}
function hasFfmpeg() { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } }
function hasAudio(file) {
  try { return execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]).toString().trim().length > 0; }
  catch { return false; }
}
function edit(dir, shots) {
  const clips = shots.map(s => path.join(dir, "clips", `shot-${String(s.n).padStart(2, "0")}.mp4`)).filter(f => fs.existsSync(f));
  if (!clips.length) { log("\nNo clips yet, so no edit."); return null; }
  if (!hasFfmpeg()) { log(`\nffmpeg isn't installed, so the clips weren't joined into one file. Install it with: brew install ffmpeg\nMeanwhile, watch the film in order at: ${path.join(dir, "index.html")}`); return null; }
  const norm = path.join(dir, "norm"); fs.mkdirSync(norm, { recursive: true });
  const parts = clips.map((c, i) => {
    const out = path.join(norm, `p${String(i).padStart(2, "0")}.mp4`);
    const vf = ["-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p"];
    const args = hasAudio(c)
      ? ["-y", "-i", c, ...vf, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", out]
      : ["-y", "-i", c, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", ...vf, "-shortest", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", out];
    execFileSync("ffmpeg", args, { stdio: "ignore" });
    return out;
  });
  const list = path.join(norm, "list.txt");
  fs.writeFileSync(list, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const joined = path.join(norm, "joined.mp4"), film = path.join(dir, "film.mp4");
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-i", joined, "-i", path.join(dir, "film.srt"), "-c", "copy", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", film], { stdio: "ignore" });
  log(`\nFILM READY: ${film}`);
  return film;
}
