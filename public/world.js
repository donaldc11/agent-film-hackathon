// world.js — the author's setup: world, characters, opening event, rules.
// Everything after the opening is decided by the agents, including their own names.

export const RULES = { seats: 4, windClose: 9, dispatchWind: 8, startWind: 4, maxTurns: 8, memorySize: 12 };

export const LOCATIONS = {
  upper_station: { x: 160, y: 372, label: "Upper cable station" },
  cafe:          { x: 410, y: 392, label: "Summit café" },
  viewpoint:     { x: 640, y: 360, label: "Lion's Head viewpoint" },
  gorge_top:     { x: 840, y: 400, label: "Top of Platteklip Gorge" },
};

// The cast exactly as the author defined them. Names are chosen by each agent at the start of a run.
export const CHARACTERS = [
  {
    id: "scholar", color: "#8E5BB5", start: "viewpoint", fallbackNames: ["Imani", "Danielle", "Keisha", "Simone"],
    who: "a 28-year-old African-American woman from Atlanta",
    traits: "Very book smart, with 5 PhDs in various fields. Extremely high anxiety.",
    goal: "Get off the mountain safely before the weather gets worse.",
    voice: "Precise and fast. Quotes probabilities, wind speeds and safety facts to calm herself down, then spirals into what-ifs. Apologizes for being anxious. Under real pressure her sentences get short and breathless.",
  },
  {
    id: "lucky", color: "#D98C2B", start: "cafe", fallbackNames: ["Djalma", "Tito", "Nelson", "Bernardo"],
    who: "a 68-year-old man from Cape Verde",
    traits: "Extremely happy-go-lucky and jovial. Extremely lucky, especially in unlucky circumstances: a cat with nine lives. Fun and charismatic to be around. Extremely broke, without a single dollar to his name.",
    goal: "Enjoy the adventure and get down the mountain one way or another.",
    voice: "Warm, playful, unhurried. Sprinkles in Cape Verdean Kriolu words (like 'nha amigu', 'sabe?', 'oi'). Tells quick tall tales about past disasters he walked away from. Laughs about having no money at all. Calm when everyone else panics, which can drive people crazy.",
  },
  {
    id: "mechanic", color: "#2F6DA8", start: "upper_station", fallbackNames: ["Marco", "Javier", "Danny", "Rico"],
    who: "a 38-year-old Latino man from the Bronx, New York",
    traits: "Auto mechanic who can fix cars, boats and planes. Gym rat. Cocky know-it-all who wants to be the dominant leader.",
    goal: "Take charge of the situation and get down the mountain.",
    voice: "Bronx swagger. Gives orders, calls people 'boss' or 'chief', says 'listen' a lot. Brags about what he has fixed (engines, boats, planes). Hates being second-guessed and pushes back hard, but respects anyone who stands up to him.",
  },
  {
    id: "mom", color: "#3E8E5E", start: "cafe", fallbackNames: ["Maureen", "Kathleen", "Siobhan", "Erin"],
    who: "a 35-year-old Boston Irish mother and housewife, with her two children (aged 7 and 10) always beside her",
    traits: "Former all-state high school volleyball player and former hotel employee. Extremely resourceful and athletic. Solves problems involving her children almost like a superpower. Her children are her reason for everything.",
    goal: "Get herself and her two children off the mountain safely.",
    voice: "Blunt Boston directness ('wicked', 'kid', 'no way'). Talks to her kids mid-sentence ('Hold my hand, hon'). Practical, hotel-trained problem solver who takes over logistics. Polite until her kids are at stake, then absolutely immovable.",
  },
];
export const CHAR = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));

export const OPENING =
  "Sunset on the summit of Table Mountain, Cape Town. The south-easter wind is rising fast and the 'tablecloth' cloud is pouring over the edge. " +
  "The operator announces that wind is closing the cableway: one last car will go down, and at this wind speed it can only take 4 people. " +
  "There are 6 people on the summit (the mother counts as 3 with her two children). A second cabin is stuck in the station with a jammed door. " +
  "Anyone left behind must shelter in the café overnight or risk the steep Platteklip Gorge trail on foot.";

export const ACTIONS = {
  move:      "walk to a location (target = location id)",
  talk:      "speak to someone here (target = character id, or null for everyone here)",
  board:     "take a seat on the last car (at upper_station; the mother with her children needs 3 seats)",
  leave_car: "get off the car and free your seat(s)",
  give_seat: "give your seat to someone at the station (target = character id)",
  send_kids: "MOTHER ONLY: put just the two children on the car without you (at upper_station, needs 2 seats)",
  repair:    "work on the jammed second cabin (at upper_station); fixing it adds 2 more seats. A mechanic is far better at this",
  hike:      "start down Platteklip Gorge on foot (at gorge_top)",
  shelter:   "settle in at the café for the night (at cafe)",
  wait:      "do nothing this turn",
};

// ---------- state ----------
export function createWorld() {
  const agents = {};
  for (const c of CHARACTERS) agents[c.id] = { loc: c.start, status: "free", memory: [] };
  return {
    turn: 0, wind: RULES.startWind, seats: RULES.seats, car: "waiting",
    kids: "with_mom", repair: 0, repaired: false, hikeWind: {},
    names: Object.fromEntries(CHARACTERS.map(c => [c.id, c.fallbackNames[0]])),
    ended: false, ending: null, agents,
  };
}
export const isActive = (w, id) => ["free", "aboard", "sheltered"].includes(w.agents[id].status);
export const activeIds = w => CHARACTERS.map(c => c.id).filter(id => isActive(w, id));
const here = (w, id) => activeIds(w).filter(o => o !== id && w.agents[o].loc === w.agents[id].loc);
const aboardIds = w => CHARACTERS.map(c => c.id).filter(id => w.agents[id].status === "aboard");
const seatsFor = (w, id) => (id === "mom" && w.kids === "with_mom" ? 3 : 1);
export const nameOf = (w, id) => w.names[id] || id;

function remember(w, id, text) {
  const m = w.agents[id].memory; m.push(`[turn ${w.turn + 1}] ${text}`);
  if (m.length > RULES.memorySize) m.shift();
}
function perceive(w, loc, text, except = []) {
  for (const id of activeIds(w)) if (w.agents[id].loc === loc && !except.includes(id)) remember(w, id, text);
}
function announce(w, text) { for (const id of activeIds(w)) remember(w, id, text); }

// ---------- prompts ----------
export function namePrompt(id) {
  const c = CHAR[id];
  return `You are ${c.who}. ${c.traits}\nChoose the first name you go by. It should fit who you are and where you are from.\nReply with JSON only: {"name": "<first name>"}`;
}
export function sanitizeName(v, id) {
  const n = String(v?.name || "").replace(/[^\p{L}' -]/gu, "").trim().split(/\s+/)[0] || "";
  return n.length >= 2 && n.length <= 14 ? n : CHAR[id].fallbackNames[Math.floor(Math.random() * 4)];
}

export function buildPrompt(w, id) {
  const c = CHAR[id], me = w.agents[id], N = o => nameOf(w, o);
  const others = CHARACTERS.filter(o => o.id !== id).map(o => {
    const a = w.agents[o.id];
    const where = a.status === "departed" ? "gone down in the car" : a.status === "hiking" ? "hiking down the gorge"
      : `${a.loc}${a.status === "aboard" ? " (seated in the car)" : a.status === "sheltered" ? " (sheltering)" : ""}`;
    return `- ${N(o.id)} (${o.id}), ${o.who}: ${where}`;
  }).join("\n");
  const kids = id === "mom" ? `\nYour children are: ${w.kids === "with_mom" ? "beside you" : w.kids === "aboard" ? "seated in the car without you" : "safely gone down in the car"}.` : "";
  return `You are ${N(id)}, ${c.who}. You are a character in an animated short film. Stay fully in character.

WHO YOU ARE: ${c.traits}
YOUR GOAL: ${c.goal}${kids}

OPENING: ${OPENING}

NOW (turn ${w.turn + 1} of at most ${RULES.maxTurns}):
- Wind: ${w.wind}/10. The operator sends the car at ${RULES.dispatchWind}/10 or when it is full. The cableway closes for good at ${RULES.windClose}/10. Wind rises every turn.
- Last car: ${w.car}, ${w.seats} seat(s) left, aboard: ${aboardIds(w).map(N).join(", ") || "nobody"}${w.kids === "aboard" ? " plus the two children" : ""}.
- Jammed second cabin: ${w.repaired ? "FIXED (added 2 seats)" : `repair progress ${w.repair}/2`}.
- You are at ${me.loc}${me.status !== "free" ? ` (${me.status})` : ""}. Locations: ${Object.keys(LOCATIONS).join(", ")}.
- Everyone else (you can see them all):
${others}

YOUR MEMORY (oldest first):
${me.memory.join("\n") || "(nothing yet)"}

ACTIONS (pick exactly one):
${Object.entries(ACTIONS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Decide what you do next, true to who you are. You may cooperate, argue, sacrifice or put yourself first.
Reply with JSON only, no markdown:
{"action": "<one action>", "target": "<location id, character id, or null>", "say": "<one line spoken aloud, under 20 words, or empty>", "reason": "<one sentence of private reasoning>"}`;
}

export function sanitize(d) {
  const out = { action: "wait", target: null, say: "", reason: "" };
  if (d && typeof d === "object") {
    if (ACTIONS[d.action]) out.action = d.action;
    if (typeof d.target === "string" && d.target !== "null") out.target = d.target.toLowerCase().trim();
    if (typeof d.say === "string") out.say = d.say.slice(0, 140);
    if (typeof d.reason === "string") out.reason = d.reason.slice(0, 240);
  }
  return out;
}

// ---------- rules ----------
export function applyDecision(w, id, d) {
  if (!isActive(w, id)) return null;
  const me = w.agents[id], name = nameOf(w, id), t = d.target;
  const tn = t && CHAR[t] ? nameOf(w, t) : t;
  const present = t && CHAR[t] && here(w, id).includes(t);
  const fail = why => ({ ok: false, text: `${name} tried to ${d.action.replace("_", " ")} but ${why}.` });
  if (d.say) { perceive(w, me.loc, `${name} said${CHAR[t] ? " to " + tn : ""}: "${d.say}"`, [id]); remember(w, id, `You said: "${d.say}"`); }
  const free = n => { w.seats += n; };
  let text;
  switch (d.action) {
    case "move":
      if (!LOCATIONS[t]) return fail("there is no such place");
      if (me.status === "aboard") free(seatsFor(w, id));
      perceive(w, me.loc, `${name} walked off towards ${LOCATIONS[t].label}.`, [id]);
      me.loc = t; me.status = "free";
      perceive(w, t, `${name} arrived.`, [id]);
      text = `${name} heads to ${LOCATIONS[t].label}.`; break;
    case "talk":
      text = d.say ? `${name} speaks${CHAR[t] ? " to " + tn : ""}.` : `${name} hesitates.`; break;
    case "board": {
      const need = seatsFor(w, id);
      if (me.loc !== "upper_station") return fail("is not at the station");
      if (w.car !== "waiting") return fail("the car is not running");
      if (me.status === "aboard") return fail("is already aboard");
      if (w.seats < need) return fail(`there ${w.seats === 1 ? "is" : "are"} only ${w.seats} seat${w.seats === 1 ? "" : "s"} left`);
      w.seats -= need; me.status = "aboard";
      if (id === "mom" && w.kids === "with_mom") w.kids = "riding_with_mom";
      perceive(w, me.loc, `${name} boarded the last car${need > 1 ? " with her children" : ""}. Seats left: ${w.seats}.`, [id]);
      text = `${name} boards${need > 1 ? " with her kids" : ""} (${w.seats} left).`; break;
    }
    case "leave_car":
      if (me.status !== "aboard") return fail("is not in the car");
      if (id === "mom" && w.kids === "riding_with_mom") { w.kids = "with_mom"; free(3); } else free(1);
      me.status = "free";
      perceive(w, me.loc, `${name} got off the car. Seats left: ${w.seats}.`, [id]);
      text = `${name} gets off the car.`; break;
    case "give_seat": {
      if (me.status !== "aboard") return fail("has no seat to give");
      if (!present) return fail("they are not here");
      const need = seatsFor(w, t), have = seatsFor(w, id) + w.seats;
      if (have < need) return fail(`${tn} needs ${need} seats`);
      if (id === "mom" && w.kids === "riding_with_mom") w.kids = "with_mom";
      w.seats = have - need; me.status = "free"; w.agents[t].status = "aboard";
      if (t === "mom" && w.kids === "with_mom") w.kids = "riding_with_mom";
      perceive(w, me.loc, `${name} gave up their seat for ${tn}.`);
      text = `${name} gives their seat to ${tn}.`; break;
    }
    case "send_kids":
      if (id !== "mom") return fail("only the mother can do that");
      if (w.kids !== "with_mom") return fail("the children are not with her");
      if (me.loc !== "upper_station" || w.car !== "waiting") return fail("the car is not here");
      if (w.seats < 2) return fail("there are not 2 seats left");
      w.seats -= 2; w.kids = "aboard";
      announce(w, `${name} put her two children on the last car without her.`);
      text = `${name} puts her children on the car without her.`; break;
    case "repair": {
      if (me.loc !== "upper_station") return fail("is not at the station");
      if (w.repaired) return fail("it is already fixed");
      if (w.car !== "waiting") return fail("the cableway is shut");
      const gain = id === "mechanic" ? 1 : Math.random() < 0.3 ? 1 : 0;
      w.repair += gain;
      if (w.repair >= 2) { w.repaired = true; w.repairedBy = id; w.seats += 2; announce(w, `${name} fixed the jammed cabin! The car now has 2 more seats.`); text = `${name} fixes the jammed cabin: 2 more seats!`; }
      else { perceive(w, me.loc, `${name} worked on the jammed cabin (${w.repair}/2).`, [id]); text = gain ? `${name} makes progress on the jammed cabin.` : `${name} fiddles with the jammed cabin. No luck.`; }
      break;
    }
    case "hike":
      if (me.loc !== "gorge_top") return fail("is not at the top of the gorge");
      me.status = "hiking"; w.hikeWind[id] = w.wind;
      announce(w, `${name} started down Platteklip Gorge on foot${id === "mom" && w.kids === "with_mom" ? " with her children" : ""}.`);
      text = `${name} starts down the gorge on foot.`; break;
    case "shelter":
      if (me.loc !== "cafe") return fail("is not at the café");
      me.status = "sheltered";
      perceive(w, me.loc, `${name} settled in at the café for the night.`, [id]);
      text = `${name} settles in at the café.`; break;
    default: text = `${name} waits.`;
  }
  remember(w, id, `You: ${text}`);
  return { ok: true, text };
}

export function endTurn(w) {
  w.turn++;
  const events = [];
  const loaded = () => aboardIds(w).length + (w.kids === "aboard" ? 1 : 0) > 0;
  const send = () => {
    for (const id of aboardIds(w)) w.agents[id].status = "departed";
    if (w.kids === "aboard" || w.kids === "riding_with_mom") w.kids = "departed";
    w.car = "departed";
    events.push("The operator sends the last car down.");
  };
  if (w.car === "waiting" && loaded() && (w.seats === 0 || w.wind >= RULES.dispatchWind)) send();
  // wind rises one step at a time near the limit, so the operator always gets a last chance
  const step = w.wind < RULES.dispatchWind - 2 && Math.random() < 0.4 ? 2 : 1;
  w.wind = Math.min(10, w.wind + step);
  events.push(`The wind rises to ${w.wind}/10.`);
  if (w.car === "waiting" && w.wind >= RULES.windClose) {
    if (loaded()) send();                       // a loaded car always goes before the line shuts
    if (w.car === "waiting") {
      w.car = "cancelled";
      if (w.kids === "aboard" || w.kids === "riding_with_mom") w.kids = "with_mom";
      announce(w, "The cableway is CLOSED. The last car will not run.");
      events.push("The wind closes the cableway. The last car will not run.");
    }
  }
  if (w.car !== "waiting" || w.turn >= RULES.maxTurns || activeIds(w).length === 0) { w.ended = true; w.ending = buildEnding(w); }
  return events;
}

export function buildEnding(w) {
  const ids = CHARACTERS.map(c => c.id), N = id => nameOf(w, id);
  const rode = ids.filter(id => w.agents[id].status === "departed");
  const hikers = ids.filter(id => w.agents[id].status === "hiking");
  const stayed = ids.filter(id => isActive(w, id));
  const lines = []; let title = "The last car down";
  if (w.car === "departed") lines.push(`The last car went down with ${[...rode.map(N), ...(w.kids === "departed" && !rode.includes("mom") ? ["the two children"] : [])].join(", ")}.`);
  else if (w.car === "cancelled") { lines.push("The wind closed the cableway before the last car could leave."); title = "Nobody went down"; }
  else lines.push("Night fell before the last car left.");
  if (w.repaired && w.car === "departed") { lines.push(`${N(w.repairedBy || "mechanic")}'s repair of the jammed cabin bought two extra seats.`); title = "The fix"; }
  else if (w.repaired) lines.push(`The jammed cabin was fixed, but the wind won anyway.`);
  for (const h of hikers) {
    if (h === "lucky") lines.push(`${N(h)} strolled down the gorge in the dark and, somehow, didn't get a scratch.`);
    else if (w.hikeWind[h] >= 7) lines.push(`${N(h)} got stuck in the gorge${h === "mom" && w.kids === "with_mom" ? " with the children" : ""} and was brought down by mountain rescue at midnight.`);
    else lines.push(`${N(h)} made it down the gorge${h === "mom" && w.kids === "with_mom" ? " with the children" : ""}, scraped and shaking.`);
  }
  if (stayed.length) lines.push(`${stayed.map(N).join(", ")} spent the night on the summit in the café.`);
  if (w.kids === "departed" && !rode.includes("mom")) { lines.push(`${N("mom")} sent her children down first and stayed behind.`); title = "She sent them first"; }
  if (rode.length + (hikers.includes("lucky") ? 1 : 0) === 4 && w.kids === "departed") title = "Everyone made it";
  return { title, lines, car: w.car, rode, hikers, stayed, kids: w.kids, repaired: w.repaired, turns: w.turn, names: { ...w.names } };
}

// ---------- offline brain ----------
const pick = a => a[Math.floor(Math.random() * a.length)];
export function offlineDecide(w, id) {
  const me = w.agents[id], r = Math.random();
  const go = (loc, say, reason) => ({ action: "move", target: loc, say, reason });
  const atStation = me.loc === "upper_station";
  switch (id) {
    case "scholar":
      if (me.status === "aboard") return { action: "talk", target: null, say: pick(["Is this cable rated for this wind?", "Statistically we're fine. Probably."]), reason: "Talking keeps the panic down." };
      if (w.car === "waiting" && w.seats >= 1) return atStation ? { action: "board", target: null, say: "I need to be on this car.", reason: "Every minute up here raises the risk." } : go("upper_station", "We need to get to the station. Now.", "The car is the safest option by far.");
      if (me.loc !== "cafe") return go("cafe", "Okay. Breathe. The café is sheltered.", "Hiking in this wind is statistically insane.");
      return { action: "shelter", target: null, say: "I'll wait it out.", reason: "Shelter is the rational choice." };
    case "lucky":
      if (me.status === "aboard" && w.agents.mom.loc === "upper_station" && w.agents.mom.status === "free") return { action: "give_seat", target: "mom", say: "Take it, mamãe. Luck always finds me.", reason: "Those kids need it more than I do." };
      if (w.wind >= 6 && r < 0.5) return me.loc === "gorge_top" ? { action: "hike", target: null, say: "Nine lives, my friends!", reason: "I've walked out of worse." } : go("gorge_top", "Who needs a cable car?", "The mountain has a path. Luck will do the rest.");
      return { action: "talk", target: null, say: pick(["What a view to be stranded with!", "No money, no problem!", "Something good always turns up."]), reason: "Keep spirits high." };
    case "mechanic":
      if (!atStation) return go("upper_station", "Everybody, follow me.", "I'm the one who can fix things.");
      if (!w.repaired && w.car === "waiting") return { action: "repair", target: null, say: pick(["Step back, I got this.", "This door's just jammed. Easy."]), reason: "Fixing the cabin makes me the guy who saved everyone." };
      if (me.status !== "aboard" && w.seats >= 1 && w.car === "waiting") return { action: "board", target: null, say: "Fixed it. I'm riding.", reason: "Earned my seat." };
      return { action: "talk", target: null, say: "Listen to me and nobody gets hurt.", reason: "Someone has to lead." };
    case "mom":
      if (me.status === "aboard") return { action: "wait", target: null, say: "Hold my hand, both of you.", reason: "We're on. Keep them calm." };
      if (!atStation && w.car === "waiting") return go("upper_station", "Kids, with me. Now.", "The car is the safest way down for them.");
      if (w.car === "waiting" && w.seats >= 3) return { action: "board", target: null, say: "Three of us. In we go.", reason: "We all go together." };
      if (w.car === "waiting" && w.seats >= 2 && w.wind >= 7) return { action: "send_kids", target: null, say: "Go. I'll be right behind you.", reason: "They go first. Always." };
      if (w.car !== "waiting") return me.loc === "cafe" ? { action: "shelter", target: null, say: "Blankets, cocoa, we're fine.", reason: "Keep them warm and safe." } : go("cafe", "Café. Now.", "Shelter beats the gorge with kids.");
      return { action: "talk", target: null, say: "I need seats for my kids.", reason: "Push for seats while there's time." };
  }
  return { action: "wait", target: null, say: "", reason: "" };
}
