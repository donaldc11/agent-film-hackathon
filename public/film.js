// film.js — Film mode.
// 1) WRITE: the agents play out the whole story first (they decide every line and beat).
// 2) DIRECT: a director turns that screenplay into a shot list (it frames, never changes the plot).
// 3) PERFORM: the player shoots it: camera, close-ups, subtitles, voices, wind.
import { CHARACTERS, CHAR, LOCATIONS, RULES, createWorld, activeIds, buildPrompt, sanitize,
  applyDecision, endTurn, offlineDecide, namePrompt, sanitizeName, nameOf } from "./world.js";
import { PORTRAITS } from "./cast.js";

const $ = id => document.getElementById(id);
const canvas = $("film"), ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height, S = W / 960;   // world coords are 960x540
const BAR = 64;                                             // letterbox bars
let llm = false, soundOn = true, film = null, playing = false, runId = "";

// ---------- assets ----------
const art = {}, scene = {};
function cutout(img, targetH) {
  const h = targetH, w = Math.round(img.width * h / img.height);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), px = d.data, seen = new Uint8Array(w * h), stack = [];
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  const bg = [0, 1, 2].map(i => corners.reduce((a, k) => a + px[k * 4 + i], 0) / 4);
  const dist = k => Math.abs(px[k * 4] - bg[0]) + Math.abs(px[k * 4 + 1] - bg[1]) + Math.abs(px[k * 4 + 2] - bg[2]);
  for (let i = 0; i < w; i++) stack.push(i, (h - 1) * w + i);
  for (let j = 0; j < h; j++) stack.push(j * w, j * w + w - 1);
  while (stack.length) {
    const k = stack.pop(); if (seen[k]) continue; seen[k] = 1; if (dist(k) > 75) continue;
    px[k * 4 + 3] = 0; const x = k % w, y = (k / w) | 0;
    if (x > 0) stack.push(k - 1); if (x < w - 1) stack.push(k + 1); if (y > 0) stack.push(k - w); if (y < h - 1) stack.push(k + w);
  }
  // clean the grey halo: two passes eating background-coloured edge pixels, then feather what's left
  const edge = k => { const x = k % w, y = (k / w) | 0;
    return (x > 0 && !px[(k - 1) * 4 + 3]) || (x < w - 1 && !px[(k + 1) * 4 + 3]) || (y > 0 && !px[(k - w) * 4 + 3]) || (y < h - 1 && !px[(k + w) * 4 + 3]); };
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    for (let k = 0; k < w * h; k++) if (px[k * 4 + 3] && edge(k) && dist(k) < 140) kill.push(k);
    for (const k of kill) px[k * 4 + 3] = 0;
  }
  const soft = [];
  for (let k = 0; k < w * h; k++) if (px[k * 4 + 3] && edge(k)) soft.push(k);
  for (const k of soft) px[k * 4 + 3] = 128;
  g.putImageData(d, 0, 0);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let k = 0; k < w * h; k++) if (px[k * 4 + 3]) { const x = k % w, y = (k / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  const t = document.createElement("canvas"); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
  t.getContext("2d").drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
  return t;
}
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const assetsReady = (async () => {
  await Promise.all(Object.entries(PORTRAITS).map(async ([id, file]) => {
    const img = await loadImg(`/assets/portraits/${file}`);
    if (img) try { art[id] = cutout(img, 720); } catch { /* fallback figure */ }
  }));
  scene.summit = await loadImg("/assets/scenes/summit.png");
  const car = await loadImg("/assets/scenes/cablecar.png");
  if (car) try { scene.cablecar = cutout(car, 360); } catch { /* fallback car */ }
})();

// ---------- brain ----------
async function ask(prompt) {
  if (!llm) return null;
  try {
    const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const post = body => fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

// ---------- 1) WRITE: the agents play the whole story ----------
const snap = w => ({
  agents: Object.fromEntries(Object.entries(w.agents).map(([k, a]) => [k, { loc: a.loc, status: a.status }])),
  kids: w.kids, car: w.car, seats: w.seats, wind: w.wind, repaired: w.repaired, turn: w.turn,
});

async function writeStory(progress) {
  const w = createWorld(); runId = `film_${Date.now().toString(36)}`;
  progress("The characters are choosing their names…");
  const names = await Promise.all(CHARACTERS.map(async c => sanitizeName(await ask(namePrompt(c.id)), c.id)));
  CHARACTERS.forEach((c, i) => (w.names[c.id] = names[i]));
  const beats = [{ kind: "start", snap: snap(w) }];
  let count = 0;
  while (!w.ended) {
    progress(`The characters are writing the story… turn ${w.turn + 1}, ${count} decisions so far`);
    const ids = activeIds(w);
    const ds = await Promise.all(ids.map(async id => {
      const r = await ask(buildPrompt(w, id));
      return [id, r ? { ...sanitize(r), brain: "llm" } : { ...sanitize(offlineDecide(w, id)), brain: "offline" }];
    }));
    ds.sort(() => Math.random() - 0.5);
    const records = [];
    for (const [id, d] of ds) {
      const o = applyDecision(w, id, d); if (!o) continue; count++;
      beats.push({ kind: "act", id, d, o, turn: w.turn + 1, snap: snap(w) });
      records.push({ run_id: runId, turn: w.turn + 1, agent: id, agent_name: nameOf(w, id), action: d.action, target: d.target,
        say: d.say, reason: d.reason, ok: o.ok, outcome: o.text, brain: d.brain, wind: w.wind, location: w.agents[id].loc, ts: new Date().toISOString() });
    }
    const events = endTurn(w);
    beats.push({ kind: "world", events, snap: snap(w) });
    post({ decisions: records });
  }
  const e = w.ending;
  post({ run: { run_id: runId, title: e.title, car: e.car, rode_down: e.rode.join(","), hikers: e.hikers.join(","), stayed: e.stayed.join(","),
    kids: e.kids, repaired: e.repaired, turns: e.turns, names: JSON.stringify(e.names), mode: "film", ts: new Date().toISOString() } });
  return { names: { ...w.names }, beats, ending: e };
}

// ---------- 2) DIRECT: screenplay -> shot list ----------
const BIG = ["board", "send_kids", "give_seat", "repair", "hike", "shelter", "leave_car"];
const home = { scholar: "Atlanta", lucky: "Cape Verde", mechanic: "the Bronx", mom: "Boston" };
const words = s => s.trim().split(/\s+/).length;

function direct(story) {
  const shots = [], N = id => story.names[id], first = story.beats[0].snap;
  shots.push({ type: "title", title: "The Last Car Down", sub: "Table Mountain, Cape Town", dur: 3800 });
  shots.push({ type: "wide", snap: first, z0: 1.0, z1: 1.12, caption: "Sunset on the summit. The south-easter is rising.", dur: 5000 });
  shots.push({ type: "wide", snap: first, z0: 1.12, z1: 1.18, speaker: "OPERATOR (over the loudspeaker)",
    line: "Wind is closing the cableway. One last car will go down. Four seats only.", voice: "operator", dur: 5200 });
  for (const c of CHARACTERS) shots.push({ type: "close", id: c.id, snap: first, card: N(c.id), cardSub: `from ${home[c.id]}`, dur: 2400 });

  let lastFocus = null;
  for (const b of story.beats) {
    if (b.kind === "act") {
      const { id, d, o } = b;
      if (d.say) {
        shots.push({ type: "close", id, snap: b.snap, speaker: N(id), line: d.say, voice: id, note: d.reason,
          dur: Math.min(6500, Math.max(2400, 1200 + words(d.say) * 360)) });
        lastFocus = id;
      }
      if (!o.ok) continue;
      if (d.action === "move") shots.push({ type: "follow", id, snap: b.snap, dur: 2600 });
      else if (BIG.includes(d.action)) {
        shots.push({ type: "medium", id, snap: b.snap, caption: o.text, dur: 3400 });
        const others = CHARACTERS.map(c => c.id).filter(o2 => o2 !== id && ["free", "aboard", "sheltered"].includes(b.snap.agents[o2].status));
        if (["send_kids", "give_seat", "hike"].includes(d.action) || (d.action === "repair" && b.snap.repaired)) {
          const r = others[Math.floor(Math.random() * others.length)];
          if (r) shots.push({ type: "close", id: r, snap: b.snap, reaction: true, dur: 1500 });
        }
      }
    } else if (b.kind === "world") {
      for (const ev of b.events) {
        if (ev.includes("sends the last car")) shots.push({ type: "departure", snap: b.snap, caption: "The last car goes down.", dur: 6000 });
        else if (ev.includes("closes the cableway")) shots.push({ type: "wide", snap: b.snap, z0: 1.2, z1: 1.0, caption: "The wind closes the cableway. No car tonight.", dur: 4200 });
        else if (b.snap.wind >= 6) shots.push({ type: "wide", snap: b.snap, z0: 1.0, z1: 1.05, caption: `The wind rises: ${b.snap.wind} out of 10.`, dur: 2200 });
      }
    }
  }
  // keep it a short film: trim the least important shots first
  const total = () => shots.reduce((a, s) => a + s.dur, 0);
  const budget = 170000;
  for (const kind of ["follow", "reaction", "windcaption"]) {
    for (let i = shots.length - 1; i >= 0 && total() > budget; i--) {
      const s = shots[i];
      if ((kind === "follow" && s.type === "follow") || (kind === "reaction" && s.reaction) || (kind === "windcaption" && s.caption?.startsWith("The wind rises"))) shots.splice(i, 1);
    }
  }
  const e = story.ending;
  shots.push({ type: "title", title: e.title, sub: "", dur: 3600 });
  for (const l of e.lines) shots.push({ type: "epilogue", text: l, dur: 3400 });
  shots.push({ type: "credits", names: story.names, dur: 6500 });
  return shots;
}

// ---------- 3) PERFORM ----------
const pos = {};               // live on-screen positions, eased toward each shot's targets
const cam = { x: W / 2, y: H / 2, z: 1 };
let carPos = null;

function targetFor(sn, id) {
  const a = sn.agents[id];
  const stationCar = carHome();
  if (a.status === "aboard" || a.status === "departed") return { x: stationCar.x, y: stationCar.y + 40, hidden: true };
  if (a.status === "hiking") return { x: W + 120, y: 560, hidden: false };
  const group = CHARACTERS.map(c => c.id).filter(o => sn.agents[o].loc === a.loc && ["free", "sheltered"].includes(sn.agents[o].status));
  const i = group.indexOf(id), n = group.length, L = LOCATIONS[a.loc];
  return { x: (L.x + (i - (n - 1) / 2) * 78) * S + (a.loc === "upper_station" ? 60 : 0), y: L.y * S + (i % 2) * 10 };
}
function carHome() { const L = LOCATIONS.upper_station; return { x: (L.x - 95) * S, y: (L.y - 70) * S }; }

function drawBackdrop(zoomBlur = 0) {
  if (scene.summit) {
    const img = scene.summit, sc = Math.max(W / img.width, H / img.height);
    if (zoomBlur && "filter" in ctx) ctx.filter = `blur(${zoomBlur}px)`;
    ctx.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
    ctx.filter = "none";
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#3F6E8C"); g.addColorStop(0.55, "#F2A65A"); g.addColorStop(0.56, "#9C8357"); g.addColorStop(1, "#6E5A3C");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}
function drawFigure(id, x, y, height, walking, now) {
  const bob = walking ? -Math.abs(Math.sin(now / 120)) * 5 : Math.sin(now / 800) * 1.2;
  ctx.save(); ctx.translate(x, y + bob);
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0, 2, height * 0.17, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (walking) ctx.rotate(Math.sin(now / 120) * 0.04);
  if (art[id]) { const t = art[id], w = height * t.width / t.height; ctx.drawImage(t, -w / 2, -height, w, height); }
  else { ctx.fillStyle = CHAR[id]?.color || "#888"; ctx.beginPath(); ctx.roundRect(-14, -height, 28, height, 10); ctx.fill(); }
  ctx.restore();
}
function drawCar(x, y, sn) {
  if (scene.cablecar) { const t = scene.cablecar, h = 150, w = h * t.width / t.height; ctx.drawImage(t, x - w / 2, y - h * 0.55, w, h); }
  else {
    ctx.strokeStyle = "#20262B"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y - 60); ctx.lineTo(x, y - 30); ctx.stroke();
    ctx.fillStyle = "#B8312F"; ctx.beginPath(); ctx.roundRect(x - 60, y - 30, 120, 70, 12); ctx.fill();
    ctx.fillStyle = "#CFE3F0"; ctx.fillRect(x - 50, y - 20, 100, 34);
  }
  const riders = CHARACTERS.map(c => c.id).filter(id => ["aboard", "departed"].includes(sn.agents[id].status));
  if (["aboard", "riding_with_mom", "departed"].includes(sn.kids)) riders.push("kid10", "kid7");
  riders.slice(0, 6).forEach((id, i) => {
    if (!art[id]) return; const t = art[id], fh = t.height * 0.19;
    ctx.save(); ctx.beginPath(); ctx.arc(x - 45 + i * 18, y - 2, 9, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(t, (t.width - fh) / 2, 0, fh, fh, x - 54 + i * 18, y - 11, 18, 18); ctx.restore();
  });
}
function drawWind(wind, now, strength = 1) {
  const drift = (now / 25) % 260;
  ctx.fillStyle = `rgba(244,246,247,${(0.04 + wind * 0.02) * strength})`;
  for (let i = -1; i < 7; i++) { ctx.beginPath(); ctx.ellipse(i * 260 + drift * (1 + wind / 7), 170 + (i % 3) * 55, 210, 26, 0, 0, Math.PI * 2); ctx.fill(); }
}

function drawWorld(shot, t, now) {
  const sn = shot.snap;
  for (const c of CHARACTERS) {
    const tg = targetFor(sn, c.id), p = pos[c.id] || (pos[c.id] = { x: tg.x, y: tg.y });
    const dx = tg.x - p.x, dy = tg.y - p.y, d = Math.hypot(dx, dy), step = 2.6;
    if (d > 1) { p.x += dx / d * Math.min(step, d); p.y += dy / d * Math.min(step, d); }
    p.walking = d > 2; p.hidden = tg.hidden;
  }
  // camera
  let tx = W / 2, ty = H / 2, tz = 1;
  if (shot.type === "wide") tz = shot.z0 + (shot.z1 - shot.z0) * t;
  if (shot.type === "follow" || shot.type === "medium") { const p = pos[shot.id]; tx = p.x; ty = p.y - 90; tz = shot.type === "medium" ? 1.9 : 1.45; }
  if (shot.type === "departure") { tx = carPos.x + 120; ty = carPos.y; tz = 1.5; }
  const ease = shot.type === "follow" ? 0.08 : 0.12;
  cam.x += (tx - cam.x) * ease; cam.y += (ty - cam.y) * ease; cam.z += (tz - cam.z) * ease;
  const cx = Math.min(Math.max(cam.x, W / (2 * cam.z)), W - W / (2 * cam.z)), cy = Math.min(Math.max(cam.y, H / (2 * cam.z)), H - H / (2 * cam.z));

  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cx, -cy);
  drawBackdrop();
  ctx.fillStyle = `rgba(14,28,40,${Math.min(sn.turn / RULES.maxTurns, 1) * 0.45})`; ctx.fillRect(0, 0, W, H);
  // cable
  const home0 = carHome();
  ctx.strokeStyle = "rgba(25,30,35,.9)"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(home0.x + 30, home0.y - 80); ctx.lineTo(-400, home0.y + 500); ctx.stroke();
  if (shot.type === "departure") { carPos.x -= 1.6; carPos.y += 1.25; }
  else if (sn.car !== "departed") carPos = { ...home0 };
  if (carPos && carPos.y < H + 200) drawCar(carPos.x, carPos.y, sn);
  const order = CHARACTERS.map(c => c.id).filter(id => !pos[id].hidden).sort((a, b) => pos[a].y - pos[b].y);
  for (const id of order) {
    const p = pos[id], st = sn.agents[id].status;
    ctx.globalAlpha = st === "sheltered" ? 0.6 : 1;
    if (id === "mom" && sn.kids === "with_mom") { drawFigure("kid10", p.x + 44, p.y + 4, 92, p.walking, now + 140); drawFigure("kid7", p.x + 72, p.y + 8, 78, p.walking, now + 300); }
    drawFigure(id, p.x, p.y, 150, p.walking, now);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  drawWind(sn.wind, now);
}

function drawClose(shot, t, now) {
  const sn = shot.snap, id = shot.id, L = LOCATIONS[sn.agents[id].loc] || LOCATIONS.upper_station;
  // soft, zoomed background behind the character
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(2.2, 2.2); ctx.translate(-L.x * S, -(L.y * S - 120));
  drawBackdrop(6); ctx.restore();
  ctx.fillStyle = `rgba(14,28,40,${0.25 + Math.min(sn.turn / RULES.maxTurns, 1) * 0.35})`; ctx.fillRect(0, 0, W, H);
  drawWind(sn.wind, now, 0.6);
  // the character, framed head to waist, slow push in
  const push = 1 + t * 0.04, h = H * 2.0 * push, x = W * (shot.reaction ? 0.5 : 0.36), breathe = Math.sin(now / 900) * 3;
  if (art[id]) {
    const tImg = art[id], w = h * tImg.width / tImg.height;
    ctx.drawImage(tImg, x - w / 2, BAR + 34 + breathe, w, h);
    if (id === "mom" && sn.kids === "with_mom" && art.kid10) {
      const k = art.kid10, kh = h * 0.62, kw = kh * k.width / k.height; ctx.drawImage(k, x + w * 0.42, H - BAR - kh * 0.5, kw, kh);
    }
  } else { ctx.fillStyle = CHAR[id]?.color || "#888"; ctx.beginPath(); ctx.arc(x, H * 0.45, 120, 0, Math.PI * 2); ctx.fill(); }
  // name card for introductions
  if (shot.card) {
    const a = Math.min(1, t * 4);
    ctx.globalAlpha = a; ctx.textAlign = "left";
    ctx.fillStyle = CHAR[id].color; ctx.fillRect(W * 0.62, H * 0.42, 6, 86);
    ctx.fillStyle = "#F4F6F7"; ctx.font = "800 54px Bricolage Grotesque, system-ui"; ctx.fillText(shot.card, W * 0.62 + 22, H * 0.42 + 50);
    ctx.font = "italic 26px Newsreader, Georgia, serif"; ctx.fillStyle = "#E8DCC4"; ctx.fillText(shot.cardSub, W * 0.62 + 24, H * 0.42 + 84);
    ctx.globalAlpha = 1;
  }
}

function drawCard(shot, t) {
  ctx.fillStyle = "#0B141C"; ctx.fillRect(0, 0, W, H);
  const a = Math.min(1, t * 3, (1 - t) * 4);
  ctx.globalAlpha = Math.max(0, a); ctx.textAlign = "center";
  if (shot.type === "title") {
    ctx.fillStyle = "#C9A66B"; ctx.font = "800 76px Bricolage Grotesque, system-ui"; ctx.fillText(shot.title, W / 2, H / 2);
    if (shot.sub) { ctx.fillStyle = "#E8DCC4"; ctx.font = "italic 30px Newsreader, Georgia, serif"; ctx.fillText(shot.sub, W / 2, H / 2 + 54); }
  } else if (shot.type === "epilogue") {
    ctx.fillStyle = "#F4F6F7"; ctx.font = "italic 34px Newsreader, Georgia, serif";
    wrap(shot.text, 900, 34).forEach((l, i, arr) => ctx.fillText(l, W / 2, H / 2 - (arr.length - 1) * 23 + i * 46));
  } else if (shot.type === "credits") {
    ctx.fillStyle = "#C9A66B"; ctx.font = "800 40px Bricolage Grotesque, system-ui"; ctx.fillText("Written by its characters", W / 2, 170);
    ctx.font = "26px Bricolage Grotesque, system-ui"; ctx.fillStyle = "#F4F6F7";
    CHARACTERS.forEach((c, i) => ctx.fillText(`${shot.names[c.id]}, ${c.who.split(",")[0].replace(/^an? /, "")}`, W / 2, 250 + i * 46));
    ctx.font = "italic 24px Newsreader, Georgia, serif"; ctx.fillStyle = "#E8DCC4";
    ctx.fillText("No script. Every line and every outcome was decided by the agents.", W / 2, 500);
    ctx.fillText("Portraits and scenery: Runware", W / 2, 540);
  }
  ctx.globalAlpha = 1;
}

function wrap(text, max, size) {
  const out = []; let line = "";
  for (const wd of text.split(" ")) { const t = line ? line + " " + wd : wd; if (ctx.measureText(t).width > max && line) { out.push(line); line = wd; } else line = t; }
  if (line) out.push(line); return out;
}
function drawOverlay(shot, t) {
  // letterbox
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, BAR); ctx.fillRect(0, H - BAR, W, BAR);
  if (shot.caption) {
    ctx.globalAlpha = Math.min(1, t * 5); ctx.textAlign = "left"; ctx.font = "italic 26px Newsreader, Georgia, serif";
    ctx.fillStyle = "rgba(0,0,0,.5)"; const w = ctx.measureText(shot.caption).width + 28; ctx.fillRect(40, BAR + 24, w, 42);
    ctx.fillStyle = "#F4F6F7"; ctx.fillText(shot.caption, 54, BAR + 53); ctx.globalAlpha = 1;
  }
  if (shot.line) {
    ctx.textAlign = "center"; ctx.font = "600 30px Bricolage Grotesque, system-ui";
    const lines = wrap(`“${shot.line}”`, W - 260, 30), base = H - BAR - 26 - (lines.length - 1) * 38;
    ctx.font = "700 18px Bricolage Grotesque, system-ui"; ctx.fillStyle = shot.voice && CHAR[shot.voice] ? lighten(CHAR[shot.voice].color) : "#C9A66B";
    ctx.fillText(shot.speaker.toUpperCase(), W / 2, base - 40);
    ctx.font = "600 30px Bricolage Grotesque, system-ui";
    lines.forEach((l, i) => { ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(l, W / 2, base + i * 38); ctx.fillStyle = "#FFFFFF"; ctx.fillText(l, W / 2, base + i * 38); });
  }
}
const lighten = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return `rgb(${v.map(c => Math.round(c + (255 - c) * 0.4)).join(",")})`; };

// ---------- sound: voices + wind ----------
let audio = null;
function startWind() {
  if (audio || !window.AudioContext) return;
  const ac = new AudioContext(), len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  const filter = ac.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 500;
  const gain = ac.createGain(); gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(ac.destination); src.start();
  audio = { ac, gain, filter };
}
function setWind(wind, closeUp) {
  if (!audio) return;
  const v = soundOn ? Math.min(0.5, wind * 0.04) * (closeUp ? 0.45 : 1) : 0;
  audio.gain.gain.setTargetAtTime(v, audio.ac.currentTime, 0.4);
  audio.filter.frequency.setTargetAtTime(300 + wind * 90, audio.ac.currentTime, 0.6);
}
const VOICE = { scholar: { pitch: 1.15, rate: 1.12 }, lucky: { pitch: 0.85, rate: 0.95 }, mechanic: { pitch: 0.75, rate: 1.0 }, mom: { pitch: 1.05, rate: 1.06 }, operator: { pitch: 0.9, rate: 0.95 } };
function pickVoice(key) {
  const voices = (speechSynthesis?.getVoices() || []).filter(v => v.lang?.startsWith("en"));
  if (!voices.length) return null;
  const order = ["scholar", "lucky", "mechanic", "mom", "operator"];
  return voices[(order.indexOf(key) * 3) % voices.length];
}
function speak(key, text) {
  return new Promise(res => {
    if (!soundOn || !window.speechSynthesis || !text) return res();
    const u = new SpeechSynthesisUtterance(text), cfg = VOICE[key] || {};
    u.voice = pickVoice(key); u.pitch = cfg.pitch || 1; u.rate = cfg.rate || 1;
    const done = () => res(); u.onend = done; u.onerror = done;
    setTimeout(done, 12000);   // never let a voice hang the film
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}

// ---------- play loop ----------
async function play(shots) {
  playing = true; $("again").disabled = true; $("replay").disabled = true;
  for (const c of CHARACTERS) delete pos[c.id];
  carPos = null; cam.x = W / 2; cam.y = H / 2; cam.z = 1;
  for (let i = 0; i < shots.length && playing; i++) {
    const shot = shots[i];
    if (["wide", "follow", "medium", "departure"].includes(shot.type) && !carPos) carPos = { ...carHome() };
    setWind(shot.snap?.wind || 0, shot.type === "close");
    const voiceDone = shot.line ? speak(shot.voice, shot.line) : Promise.resolve();
    await runShot(shot);
    await Promise.race([voiceDone, new Promise(r => setTimeout(r, 4000))]);
  }
  setWind(0, false);
  playing = false; $("again").disabled = false; $("replay").disabled = false;
}
function runShot(shot) {
  return new Promise(res => {
    const start = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - start) / shot.dur);
      if (["title", "epilogue", "credits"].includes(shot.type)) drawCard(shot, t);
      else if (shot.type === "close") drawClose(shot, t, now);
      else drawWorld(shot, t, now);
      if (!["title", "epilogue", "credits"].includes(shot.type)) drawOverlay(shot, t);
      if (t < 1 && playing) requestAnimationFrame(frame); else res();
    };
    requestAnimationFrame(frame);
  });
}

// ---------- screenplay panel (the decision log, written like a script) ----------
function renderScript(story) {
  const N = id => story.names[id], el = $("script");
  let html = `<h3>THE LAST CAR DOWN</h3><p class="slug">EXT. TABLE MOUNTAIN SUMMIT, CAPE TOWN. SUNSET.</p>`;
  let turn = 0;
  for (const b of story.beats) {
    if (b.kind === "act") {
      if (b.turn !== turn) { turn = b.turn; html += `<p class="slug">TURN ${turn}. WIND ${b.snap.wind}/10.</p>`; }
      const { id, d, o } = b;
      html += `<div class="beat"><p class="who" style="color:${lighten(CHAR[id].color)}">${esc(N(id).toUpperCase())}</p>` +
        (d.say ? `<p class="line">${esc(d.say)}</p>` : "") +
        `<p class="act">(${esc(o.text)})</p>` +
        (d.reason ? `<p class="why">Why: ${esc(d.reason)}</p>` : "") + `</div>`;
    } else if (b.kind === "world") for (const ev of b.events) html += `<p class="ev">${esc(ev)}</p>`;
  }
  html += `<p class="slug">THE END: ${esc(story.ending.title.toUpperCase())}</p>` + story.ending.lines.map(l => `<p class="ev">${esc(l)}</p>`).join("");
  el.innerHTML = html;
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// ---------- controls ----------
async function newFilm() {
  if (playing) return;
  startWind();
  $("again").disabled = true; $("replay").disabled = true;
  await assetsReady;
  const progress = msg => { $("status").textContent = msg; drawWriting(msg); };
  const story = await writeStory(progress);
  renderScript(story);
  film = direct(story);
  const secs = Math.round(film.reduce((a, s) => a + s.dur, 0) / 1000);
  $("status").textContent = `Story written: ${story.beats.filter(b => b.kind === "act").length} decisions, ${film.length} shots, about ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}.`;
  await play(film);
}
function drawWriting(msg) {
  ctx.fillStyle = "#0B141C"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.fillStyle = "#C9A66B"; ctx.font = "800 44px Bricolage Grotesque, system-ui"; ctx.fillText("The Last Car Down", W / 2, H / 2 - 30);
  ctx.fillStyle = "#E8DCC4"; ctx.font = "italic 26px Newsreader, Georgia, serif"; ctx.fillText(msg, W / 2, H / 2 + 26);
}
$("again").addEventListener("click", newFilm);
$("replay").addEventListener("click", () => { if (film && !playing) { startWind(); play(film); } });
$("sound").addEventListener("click", () => { soundOn = !soundOn; $("sound").textContent = soundOn ? "Sound on" : "Sound off"; if (!soundOn) speechSynthesis?.cancel(); });
$("toggle-script").addEventListener("click", () => { $("script-wrap").hidden = !$("script-wrap").hidden; });
fetch("/api/status").then(r => r.json()).then(s => { llm = s.llm; $("brain").textContent = llm ? `Brain: ${s.model}` : "Brain: offline rules"; }).catch(() => {});
drawWriting("Press New film. The characters will write it, then it plays.");
