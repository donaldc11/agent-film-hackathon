// app.js — runs the film: asks each agent for a decision, applies it, animates it, logs it.
import { CHARACTERS, CHAR, LOCATIONS, RULES, createWorld, activeIds, buildPrompt, sanitize,
  applyDecision, endTurn, offlineDecide, namePrompt, sanitizeName, nameOf } from "./world.js";
import { PORTRAITS } from "./cast.js";

const $ = id => document.getElementById(id);
const canvas = $("stage"), ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let world, runId, runNo = 0, llm = false, running = false;
const sprites = {};              // id -> { x, y, bubble, bubbleUntil, thinking, alpha }
let car = { x: 112, y: 318, leaving: false };

// ---------- brain ----------
async function decide(id) {
  if (llm) {
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildPrompt(world, id) }) });
      if (r.ok) return { ...sanitize(await r.json()), brain: "gemini" };
    } catch { /* fall through */ }
  }
  return { ...sanitize(offlineDecide(world, id)), brain: "offline" };
}

async function chooseName(id) {
  if (llm) {
    try {
      const r = await fetch("/api/brain", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: namePrompt(id) }) });
      if (r.ok) return sanitizeName(await r.json(), id);
    } catch { /* fall through */ }
  }
  return sanitizeName(null, id);
}

// ---------- portraits: cut the figure out of its plain background ----------
const art = {};
function cutout(img) {
  const H = 260, W = Math.round(img.width * H / img.height);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H), px = d.data, seen = new Uint8Array(W * H), stack = [];
  const corner = [0, W - 1, (H - 1) * W, H * W - 1].map(k => [px[k * 4], px[k * 4 + 1], px[k * 4 + 2]]);
  const bg = [0, 1, 2].map(i => corner.reduce((a, c2) => a + c2[i], 0) / 4);
  const near = k => Math.abs(px[k * 4] - bg[0]) + Math.abs(px[k * 4 + 1] - bg[1]) + Math.abs(px[k * 4 + 2] - bg[2]) < 75;
  for (let i = 0; i < W; i++) stack.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) stack.push(j * W, j * W + W - 1);
  while (stack.length) {
    const k = stack.pop(); if (seen[k]) continue; seen[k] = 1; if (!near(k)) continue;
    px[k * 4 + 3] = 0; const x = k % W, y = (k / W) | 0;
    if (x > 0) stack.push(k - 1); if (x < W - 1) stack.push(k + 1); if (y > 0) stack.push(k - W); if (y < H - 1) stack.push(k + W);
  }
  g.putImageData(d, 0, 0);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let k = 0; k < W * H; k++) if (px[k * 4 + 3]) { const x = k % W, y = (k / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  const t = document.createElement("canvas"); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
  t.getContext("2d").drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
  const th = document.createElement("canvas"); th.width = th.height = 72;
  const fh = t.height * 0.19; th.getContext("2d").drawImage(t, (t.width - fh) / 2, 0, fh, fh, 0, 0, 72, 72);
  return { sprite: t, thumb: th.toDataURL() };
}
const artReady = Promise.all(Object.entries(PORTRAITS).map(([id, file]) => new Promise(res => {
  const img = new Image();
  img.onload = () => { try { art[id] = cutout(img); } catch { /* keep fallback figure */ } res(); };
  img.onerror = () => res();
  img.src = `/assets/portraits/${file}`;
})));

const scene = {};
for (const id of ["summit", "cablecar"]) {
  const img = new Image();
  img.onload = () => { scene[id] = id === "cablecar" ? (cutout(img)?.sprite || null) : img; };
  img.src = `/assets/scenes/${id}.png`;
}

// ---------- run loop ----------
const sleep = ms => new Promise(r => setTimeout(r, reducedMotion ? Math.min(ms, 200) : ms));

function reset() {
  world = createWorld();
  runId = `run_${Date.now().toString(36)}`;
  runNo++;
  car = { x: 112, y: 318, leaving: false };
  for (const c of CHARACTERS) {
    const p = targetPos(c.id);
    sprites[c.id] = { x: p.x, y: p.y, bubble: "", bubbleUntil: 0, thinking: false, alpha: 1 };
  }
  sprites.kids = { x: sprites.mom.x + 30, y: sprites.mom.y };
  $("log").innerHTML = "";
  $("ending").hidden = true;
  updateGauges();
}

async function roll() {
  if (running) return;
  running = true; $("play").disabled = true; $("again").disabled = true;
  reset();
  await artReady;
  CHARACTERS.forEach(c => (sprites[c.id].thinking = true));
  const names = await Promise.all(CHARACTERS.map(c => chooseName(c.id)));
  CHARACTERS.forEach((c, i) => { world.names[c.id] = names[i]; sprites[c.id].thinking = false; });
  logWorld(`Tonight's cast, named by themselves: ${CHARACTERS.map(c => `${world.names[c.id]} (${c.who.split(",")[0].replace(/^an? /, "")})`).join("; ")}.`);
  await sleep(1200);

  while (!world.ended) {
    const ids = activeIds(world);
    logTurnHead();
    ids.forEach(id => (sprites[id].thinking = true));
    // Every agent decides at the same moment, from the same world state.
    const decisions = await Promise.all(ids.map(async id => [id, await decide(id)]));
    ids.forEach(id => (sprites[id].thinking = false));

    // Resolve in random order so nobody always goes first.
    decisions.sort(() => Math.random() - 0.5);
    const records = [];
    for (const [id, d] of decisions) {
      const outcome = applyDecision(world, id, d);
      if (!outcome) continue;
      if (d.say) { sprites[id].bubble = d.say; sprites[id].bubbleUntil = performance.now() + 4200; }
      logEntry(id, d, outcome);
      records.push({ run_id: runId, run_no: runNo, turn: world.turn + 1, agent: id, agent_name: nameOf(world, id), action: d.action, target: d.target,
        say: d.say, reason: d.reason, ok: outcome.ok, outcome: outcome.text, brain: d.brain,
        wind: world.wind, location: world.agents[id].loc, ts: new Date().toISOString() });
      updateGauges();
      await sleep(900);
    }
    for (const e of endTurn(world)) logWorld(e);
    if (world.car === "departed" && !car.leaving) car.leaving = true;
    updateGauges();
    post({ decisions: records });
    await sleep(1200);
  }

  const e = world.ending;
  post({ run: { run_id: runId, run_no: runNo, title: e.title, car: e.car, rode_down: e.rode.join(","), hikers: e.hikers.join(","),
    stayed: e.stayed.join(","), kids: e.kids, repaired: e.repaired, turns: e.turns, names: JSON.stringify(e.names),
    brain: llm ? "gemini" : "offline", ts: new Date().toISOString() } });
  await sleep(2500);
  showEnding(e);
  running = false; $("again").disabled = false;
}

const post = body => fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

// ---------- log panel ----------
function logTurnHead() {
  const h = document.createElement("div");
  h.className = "turn-head";
  h.textContent = `Turn ${world.turn + 1}, wind ${world.wind}/10`;
  $("log").append(h);
}
function logEntry(id, d, outcome) {
  const c = CHAR[id], el = document.createElement("div");
  el.className = "entry";
  const tgt = d.target ? ` ${CHAR[d.target] ? nameOf(world, d.target) : LOCATIONS[d.target]?.label || d.target}` : "";
  el.innerHTML = (art[id] ? `<img class="face" src="${art[id].thumb}" alt="">` : "") +
    `<span class="who" style="color:${lighten(c.color)}">${esc(nameOf(world, id))}</span>` +
    `<span class="act ${d.brain === "offline" ? "offline" : ""}" title="${d.brain} brain">${d.action}${esc(tgt)}</span>` +
    (d.say ? `<p class="say">“${esc(d.say)}”</p>` : "") +
    (d.reason ? `<p class="why">${esc(d.reason)}</p>` : "") +
    (!outcome.ok ? `<p class="fail">${esc(outcome.text)}</p>` : "");
  $("log").append(el);
  $("log").scrollTop = $("log").scrollHeight;
}
function logWorld(text) {
  const p = document.createElement("p");
  p.className = "world-event"; p.textContent = text;
  $("log").append(p); $("log").scrollTop = $("log").scrollHeight;
}
const lighten = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return `rgb(${[r, g, b].map(v => Math.round(v + (255 - v) * 0.35)).join(",")})`; };
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function updateGauges() {
  $("wind").innerHTML = Array.from({ length: 10 }, (_, i) =>
    `<i class="${i < world.wind ? "on" : ""} ${i < world.wind && world.wind >= RULES.windClose - 1 ? "danger" : ""}"></i>`).join("");
  $("wind").setAttribute("aria-valuenow", world.wind);
  const total = RULES.seats + (world.repaired ? 2 : 0), taken = world.car === "cancelled" ? 0 : total - world.seats;
  $("seats").innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < taken ? "taken" : "free"}"></i>`).join("");
  $("seats").setAttribute("aria-label", `${total - taken} of ${total} seats free`);
  $("turn").textContent = `${Math.min(world.turn + (world.ended ? 0 : 1), RULES.maxTurns)} of ${RULES.maxTurns}`;
}

function showEnding(e) {
  $("ending-title").textContent = e.title;
  $("ending-lines").innerHTML = e.lines.map(l => `<li>${esc(l)}</li>`).join("");
  $("ending").hidden = false;
  const li = document.createElement("li");
  li.innerHTML = `Run ${runNo}: <b>${esc(e.title)}</b>`;
  $("history").append(li);
}

// ---------- animation ----------
function targetPos(id) {
  const a = world.agents[id];
  if (a.status === "aboard" || a.status === "departed") return { x: car.x, y: car.y + 18 };
  if (a.status === "hiking") return { x: W + 60, y: 470 };
  const group = activeIds(world).filter(o => world.agents[o].loc === a.loc && world.agents[o].status !== "aboard");
  const i = group.indexOf(id), n = group.length;
  const L = LOCATIONS[a.loc];
  return { x: L.x + (i - (n - 1) / 2) * 70 - (n > 1 && group.includes("mom") ? 14 : 0), y: L.y + (i % 2) * 8 };
}

function frame(now) {
  drawScene(now);
  if (world) {
    if (car.leaving) { car.x -= 1.4; car.y += 1.1; }
    for (const c of CHARACTERS) {
      const s = sprites[c.id], st = world.agents[c.id].status, t = targetPos(c.id);
      const dx = t.x - s.x, dy = t.y - s.y, dist = Math.hypot(dx, dy);
      const speed = reducedMotion ? dist : 2.2;
      if (dist > 1) { s.x += (dx / dist) * Math.min(speed, dist); s.y += (dy / dist) * Math.min(speed, dist); }
      const walking = dist > 1.5;
      s.alpha = st === "sheltered" ? 0.55 : 1;
      if (st === "aboard" || st === "departed") continue; // drawn in the car
      if (st === "hiking" && s.x > W + 40) continue;
      drawCharacter(c, s, walking, now);
    }
    drawKids(now);
    drawCar(now);
    for (const c of CHARACTERS) drawBubble(c, sprites[c.id], now);
  }
  requestAnimationFrame(frame);
}

function drawScene(now) {
  const progress = world ? Math.min(world.turn / RULES.maxTurns, 1) : 0;
  const wind = world ? world.wind : RULES.startWind;
  if (scene.summit) {
    const img = scene.summit, sc = Math.max(W / img.width, H / img.height);
    ctx.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
    ctx.fillStyle = `rgba(14,28,40,${progress * 0.45})`; ctx.fillRect(0, 0, W, H);       // dusk falls as turns pass
    const drift = (now / 30) % 200;                                                          // wind-driven cloud wisps
    ctx.fillStyle = `rgba(244,246,247,${0.04 + wind * 0.018})`;
    for (let i = -1; i < 7; i++) { ctx.beginPath(); ctx.ellipse(i * 200 + drift * (1 + wind / 8), 150 + (i % 3) * 40, 160, 22, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = "13px Bricolage Grotesque, system-ui"; ctx.textAlign = "center";
    for (const L of Object.values(LOCATIONS)) {
      ctx.fillStyle = "rgba(29,52,70,.75)"; const w = ctx.measureText(L.label).width + 14;
      ctx.fillRect(L.x - w / 2, L.y + 70, w, 20); ctx.fillStyle = "#F4F6F7"; ctx.fillText(L.label, L.x, L.y + 84);
    }
    return;
  }
  // sky: sunset deepening into night as turns pass
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, mix("#3F6E8C", "#0E1C28", progress));
  sky.addColorStop(1, mix("#F2A65A", "#5A3A4A", progress));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // sun sinking into the Atlantic
  ctx.fillStyle = mix("#FFD38A", "#C86B4A", progress);
  ctx.beginPath(); ctx.arc(720, 200 + progress * 90, 26, 0, Math.PI * 2); ctx.fill();
  // ocean + Lion's Head on the horizon
  ctx.fillStyle = mix("#2F5873", "#132634", progress); ctx.fillRect(0, 250, W, 60);
  ctx.fillStyle = mix("#4D5B45", "#1B231C", progress);
  ctx.beginPath(); ctx.moveTo(540, 262); ctx.quadraticCurveTo(600, 238, 625, 205); ctx.quadraticCurveTo(645, 190, 668, 214);
  ctx.quadraticCurveTo(700, 250, 760, 262); ctx.closePath(); ctx.fill();
  // tablecloth cloud rolling across the back edge, thicker as the wind rises
  const drift = (now / 40) % 120;
  for (let i = -2; i < 12; i++) {
    const x = i * 120 + drift * (1 + wind / 10), r = 26 + wind * 2.2 + ((i * 7) % 5) * 7;
    ctx.fillStyle = `rgba(244,246,247,${0.18 + wind * 0.045})`;
    ctx.beginPath(); ctx.ellipse(x, 292 - ((i * 13) % 4) * 5, r * 1.6, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the plateau, with a cliff edge on the left where the cable drops to the city
  ctx.fillStyle = mix("#9C8357", "#4B3F2C", progress);
  ctx.beginPath(); ctx.moveTo(60, 300); ctx.lineTo(W, 290); ctx.lineTo(W, H); ctx.lineTo(60, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = mix("#5E7D4F", "#2B3A25", progress);
  for (let i = 0; i < 26; i++) { const x = 80 + ((i * 137) % 860), y = 420 + ((i * 53) % 110); ctx.beginPath(); ctx.ellipse(x, y, 14, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#0B1620"; ctx.fillRect(0, 300, 60, H - 300);  // the drop
  for (let i = 0; i < 18; i++) { ctx.fillStyle = `rgba(255,210,140,${0.4 + 0.4 * progress})`; ctx.fillRect(6 + (i * 7) % 50, 330 + (i * 29) % 200, 2, 2); }
  // locations
  drawStation(progress); drawCafe(progress);
  ctx.font = "13px Bricolage Grotesque, system-ui"; ctx.textAlign = "center";
  for (const L of Object.values(LOCATIONS)) {
    ctx.fillStyle = "rgba(29,52,70,.75)"; const w = ctx.measureText(L.label).width + 14;
    ctx.fillRect(L.x - w / 2, L.y + 70, w, 20);
    ctx.fillStyle = "#F4F6F7"; ctx.fillText(L.label, L.x, L.y + 84);
  }
}
function drawStation() {
  ctx.fillStyle = "#6E7F8B"; ctx.fillRect(70, 290, 150, 40);
  ctx.fillStyle = "#3B4A55"; ctx.fillRect(70, 284, 150, 8);
  // cable from the station down off the cliff
  ctx.strokeStyle = "#20262B"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(150, 290); ctx.lineTo(-200, 560); ctx.stroke();
}
function drawCafe(progress) {
  ctx.fillStyle = "#B49464"; ctx.fillRect(340, 320, 120, 52);
  ctx.fillStyle = "#6B4F33"; ctx.beginPath(); ctx.moveTo(330, 322); ctx.lineTo(400, 296); ctx.lineTo(470, 322); ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,205,120,${0.3 + progress * 0.7})`;
  ctx.fillRect(352, 334, 22, 16); ctx.fillRect(426, 334, 22, 16);
}
function drawCar() {
  if (car.y > H + 80) return;
  ctx.strokeStyle = "#20262B"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(car.x + 30, car.y - 10); ctx.lineTo(car.x + 30, car.y); ctx.stroke();
  if (scene.cablecar) { const t = scene.cablecar, h = 96, w = h * t.width / t.height; ctx.drawImage(t, car.x + 30 - w / 2, car.y - 46, w, h); }
  else {
    ctx.fillStyle = "#B8312F"; roundRect(car.x - 12, car.y, 84, 50, 9); ctx.fill();
    ctx.fillStyle = "#F4F6F7"; ctx.fillRect(car.x - 12, car.y + 38, 84, 5);
    ctx.fillStyle = "#CFE3F0"; ctx.fillRect(car.x - 5, car.y + 7, 70, 26);
  }
  const riders = CHARACTERS.filter(c => ["aboard", "departed"].includes(world.agents[c.id].status)).map(c => c.id);
  if (["aboard", "riding_with_mom", "departed"].includes(world.kids)) riders.push("kid10", "kid7");
  riders.slice(0, 6).forEach((id, i) => {
    const x = car.x - 2 + (i % 4) * 17, y = car.y + 9 + Math.floor(i / 4) * 10;
    if (art[id]) { const t = art[id].sprite, fh = t.height * 0.19; ctx.drawImage(t, (t.width - fh) / 2, 0, fh, fh, x, y, 16, 16); }
    else { ctx.fillStyle = CHAR[id]?.color || "#999"; ctx.beginPath(); ctx.arc(x + 8, y + 8, 6, 0, Math.PI * 2); ctx.fill(); }
  });
}
function drawFigure(id, x, y, height, walking, now, alpha, color) {
  const bob = walking ? Math.abs(Math.sin(now / 110)) * -4 : Math.sin(now / 700) * 0.8;
  const tilt = walking ? Math.sin(now / 110) * 0.05 : 0;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y + 40 + bob); ctx.rotate(tilt);
  ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(0, 0, height * 0.18, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (art[id]) { const t = art[id].sprite, w = height * t.width / t.height; ctx.drawImage(t, -w / 2, -height, w, height); }
  else { ctx.fillStyle = color; roundRect(-11, -height, 22, height, 8); ctx.fill(); }
  ctx.restore();
}
function drawCharacter(c, s, walking, now) {
  drawFigure(c.id, s.x, s.y, 104, walking, now, s.alpha, c.color);
  ctx.save(); ctx.globalAlpha = s.alpha; ctx.textAlign = "center";
  if (s.thinking) {
    ctx.fillStyle = "rgba(244,246,247,.95)";
    for (let i = 0; i < 3; i++) { const a = (Math.sin(now / 200 - i) + 1) / 2; ctx.globalAlpha = 0.3 + a * 0.7; ctx.beginPath(); ctx.arc(s.x - 8 + i * 8, s.y - 74, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = s.alpha;
  }
  ctx.font = "600 12px Bricolage Grotesque, system-ui";
  const label = nameOf(world, c.id), lw = ctx.measureText(label).width + 10;
  ctx.fillStyle = "rgba(29,52,70,.8)"; ctx.fillRect(s.x - lw / 2, s.y + 44, lw, 17);
  ctx.fillStyle = c.color; ctx.fillRect(s.x - lw / 2, s.y + 44, 3, 17);
  ctx.fillStyle = "#F4F6F7"; ctx.fillText(label, s.x, s.y + 57);
  ctx.restore();
}
function drawKids(now) {
  const mom = world.agents.mom, s = sprites.mom, k = sprites.kids;
  if (!["with_mom"].includes(world.kids) || ["aboard", "departed"].includes(mom.status)) return;
  if (mom.status === "hiking" && s.x > W + 40) return;
  const tx = s.x + 34, ty = s.y + 4, dx = tx - k.x, dy = ty - k.y, dist = Math.hypot(dx, dy);
  if (dist > 1) { k.x += dx / dist * Math.min(2.4, dist); k.y += dy / dist * Math.min(2.4, dist); }
  const walking = dist > 1.5;
  drawFigure("kid10", k.x, k.y, 72, walking, now + 120, s.alpha, "#888");
  drawFigure("kid7", k.x + 22, k.y + 4, 60, walking, now + 260, s.alpha, "#999");
}
function drawBubble(c, s, now) {
  if (!s.bubble || now > s.bubbleUntil) return;
  const st = world.agents[c.id].status;
  const x = st === "aboard" || st === "departed" ? car.x + 20 : s.x, y = (st === "aboard" || st === "departed" ? car.y : s.y - 44) - 40;
  if (x > W + 20 || y > H) return;
  ctx.font = "13px Bricolage Grotesque, system-ui";
  const lines = wrap(s.bubble, 170), lh = 16, bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18, bh = lines.length * lh + 12;
  const bx = Math.min(Math.max(x - bw / 2, 6), W - bw - 6), by = Math.max(y - bh, 6);
  ctx.fillStyle = "#F4F6F7"; roundRect(bx, by, bw, bh, 8); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 5, by + bh); ctx.lineTo(x + 5, by + bh); ctx.lineTo(x, by + bh + 7); ctx.fill();
  ctx.fillStyle = c.color === "#C9A66B" ? "#7A5A2A" : c.color; ctx.fillRect(bx, by + 6, 3, bh - 12);
  ctx.fillStyle = "#1D3446"; ctx.textAlign = "left";
  lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 18 + i * lh));
}
function wrap(text, max) {
  const words = text.split(" "), out = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [A, B] = [p(a), p(b)];
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
}

// ---------- boot ----------
$("play").addEventListener("click", roll);
$("again").addEventListener("click", roll);
fetch("/api/status").then(r => r.json()).then(s => {
  llm = s.llm; $("brain").textContent = llm ? `Brain: ${s.model}` : "Brain: offline rules (add GEMINI_API_KEY to .env)";
}).catch(() => ($("brain").textContent = "Brain: offline rules"));
world = createWorld(); reset(); runNo = 0;
requestAnimationFrame(frame);
