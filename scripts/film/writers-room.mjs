// The writers' room. The agents play four scenes one line at a time, each hearing everything said so far.
// The AUTHOR sets the world, the cast, the catalyst (the last car stalls halfway down) and the physical rules.
// The AGENTS decide every line and every attempt: who leads, who panics, who helps whom, and in what order.
// The OUTCOME emerges from their choices under those rules (plus a little chance). Nobody writes the ending.
import { CHARACTERS, CHAR, namePrompt, sanitizeName } from "../../public/world.js";
import { llmJSON, log } from "./env.mjs";

const IDS = CHARACTERS.map(c => c.id);
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- the author's world ----------
// Deeper characters, built from the author's traits.
const DEPTH = {
  scholar: {
    skills: "Her five PhDs are in atmospheric physics, mechanical engineering, medicine, statistics and linguistics. She can read the wind, reason through machinery, and treat a medical emergency.",
    fear: "She is terrified of heights. The ride up nearly broke her. Looking down makes her freeze.",
  },
  lucky: {
    skills: "Seventy years of walking away from disasters. He stays calm when others panic, makes people laugh, and things just seem to break his way, sometimes absurdly.",
    fear: "He has no return ticket and not one coin. He hates being a burden, so he jokes about it.",
  },
  mechanic: {
    skills: "He can fix almost any engine, motor or radio with his hands and a pocket tool. Strong from the gym.",
    fear: "He needs to be the one in charge. Taking orders, especially from someone more educated, makes him bristle.",
  },
  mom: {
    skills: "Former all-state volleyball player: strong, fast, great balance and reach. Ex-hotel staff: calm in a crisis, organizes people. When her kids are at stake, she becomes almost superhuman.",
    fear: "Her 7-year-old has asthma and the inhaler is nearly empty. A night stuck up here could be dangerous for him.",
  },
};

export const SCENES = [
  {
    id: "ride_up", title: "The Ride Up", location: "cable_car_interior", turns: 5,
    setup: "Late afternoon. The four strangers (the mother with her two kids) ride up in one of Table Mountain's round Swiss-made Rotair cable cars. The floor slowly turns so everyone gets the 360-degree view: Cape Town's city bowl, Lion's Head, Signal Hill, Robben Island in Table Bay, the Atlantic glittering. The sheer sandstone cliff slides past the windows. Nobody knows anyone yet.",
  },
  {
    id: "summit", title: "Last Car Down", location: "upper_station", turns: 5,
    setup: "Golden hour on the summit. The south-easter has come up fast and the white 'tablecloth' cloud is pouring over the edge. A loudspeaker crackles: the wind is closing the cableway, this is the LAST car down, everyone aboard now. The four of them (and the kids) are the last passengers. The attendant waves them all in, even the one without a ticket. The doors seal. The car swings out over the cliff.",
  },
  {
    id: "stall", title: "Halfway", location: "stalled_car_night", maxDecisions: 18,
    setup: "Halfway down the cliff, with a bang and a lurch, the car stops dead. The lights die. The drive has lost power and the car hangs swinging over a 400-metre drop, the city lights coming on far below. The operator is out of contact. The wind is getting worse. They are on their own.",
  },
  {
    id: "aftermath", title: "After", location: "varies", turns: 0,
    setup: "The night is over, one way or another.",
  },
];

// The physical problems in the stalled car. Each needs a certain amount of real effort; some people are far better at some jobs.
const PROBLEMS = {
  hatch: { title: "the roof hatch", desc: "Open the roof hatch in the gale and hold the safety line steady so someone can climb out to the motor housing on the roof", need: 2,
    fit: { mom: 2, mechanic: 1.1, lucky: 0.9, scholar: 0.6 } },
  motor: { title: "the backup motor", desc: "Restart the backup motor in the roof housing by hand (only possible once the hatch is open)", need: 3,
    fit: { mechanic: 2, scholar: 1.2, mom: 0.5, lucky: 0.5 } },
  signal: { title: "the signal", desc: "The radio is dead and there's no phone signal. Get word to the lower station by any means (rewire the radio, signal with lights, anything)", need: 2,
    fit: { scholar: 1.8, mechanic: 1.1, lucky: 1, mom: 0.8 } },
  asthma: { title: "the boy's asthma", desc: "The 7-year-old is wheezing hard and the inhaler is nearly empty. Calm his breathing and keep him safe", need: 2, appearsAt: 3,
    fit: { mom: 2, scholar: 1.6, lucky: 1, mechanic: 0.5 } },
};

function newCrisis() {
  return { wind: 7, decisions: 0, problems: Object.fromEntries(Object.keys(PROBLEMS).map(k => [k, { progress: 0, done: false, open: !PROBLEMS[k].appearsAt }])),
    contrib: Object.fromEntries(IDS.map(id => [id, []])), luckyBreaks: 0, ended: false };
}

function attempt(c, id, problemId) {
  const P = PROBLEMS[problemId], st = c.problems[problemId];
  if (!P || !st?.open) return { ok: false, text: "there's nothing like that to work on yet" };
  if (st.done) return { ok: false, text: `${P.title} is already sorted` };
  if (problemId === "motor" && !c.problems.hatch.done) {
    st.progress = Math.min(st.progress + 0.3, 0.6);
    return { ok: false, text: "can't reach the motor until the roof hatch is open" };
  }
  let gain = P.fit[id] * rnd(0.6, 1.2);
  if (problemId === "hatch" && c.wind >= 9 && Math.random() < 0.3 && id !== "mom") gain = -0.5;   // a gust can undo the work
  let lucky = false;
  if (id === "lucky" && Math.random() < 0.35) { gain += 1.5; lucky = true; c.luckyBreaks++; }
  st.progress = Math.max(0, st.progress + gain);
  if (st.progress >= P.need) st.done = true;
  if (gain > 0) c.contrib[id].push(problemId);
  const text = st.done ? `${P.title}: DONE` : gain < 0 ? `a gust slams the car and undoes the work on ${P.title}` : `progress on ${P.title} (${Math.min(99, Math.round(st.progress / P.need * 100))}%)`;
  return { ok: gain > 0, text: lucky ? `${text}, through a ridiculous stroke of luck` : text };
}

function crisisStatus(c) {
  return Object.entries(PROBLEMS).filter(([k]) => c.problems[k].open).map(([k, P]) => {
    const st = c.problems[k];
    return `- ${k}: ${P.desc}. ${st.done ? "DONE." : `${Math.min(99, Math.round(st.progress / P.need * 100))}% done.`}`;
  }).join("\n");
}

function tick(c) {
  const events = [];
  c.wind = Math.min(10, c.wind + 1);
  events.push(c.wind >= 9 ? `A violent gust slams the cabin sideways. Wind ${c.wind}/10.` : `The wind howls harder. Wind ${c.wind}/10.`);
  if (c.decisions >= PROBLEMS.asthma.appearsAt && !c.problems.asthma.open) {
    c.problems.asthma.open = true;
    events.push("The 7-year-old starts wheezing hard. His mother digs for the inhaler: it's nearly empty.");
  }
  return events;
}

function crisisEnding(c, names) {
  const N = id => names[id];
  const heroes = IDS.map(id => [id, c.contrib[id].length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const did = id => [...new Set(c.contrib[id].map(p => PROBLEMS[p].title))].join(" and ");
  const lines = [];
  let title;
  if (c.problems.motor.done) {
    title = "Down Together";
    lines.push("The backup motor coughs to life, and the cabin creeps down through the dark to the lower station on Tafelberg Road.");
  } else if (c.problems.signal.done) {
    title = "The Long Night";
    lines.push("Their signal reached the lower station. Mountain rescue crawled out along the cable after midnight and brought them down one by one.");
  } else {
    title = "Dawn on the Wire";
    lines.push("No motor, no signal. They hung in the dark all night, and at dawn, when the wind dropped, the cableway crew winched the car down.");
  }
  lines.push(c.problems.asthma.done ? "The boy's breathing settled; he slept against his mother." : "The boy's breathing got worse through the night; paramedics were waiting at the bottom.");
  for (const id of heroes.slice(0, 3)) lines.push(`${N(id)} worked on ${did(id)}.`);
  const idle = IDS.filter(id => !c.contrib[id].length);
  if (idle.length) lines.push(`${idle.map(N).join(" and ")} never managed to make a difference.`);
  if (c.luckyBreaks) lines.push(`${N("lucky")}'s luck broke their way ${c.luckyBreaks === 1 ? "once" : `${c.luckyBreaks} times`}, absurdly.`);
  return { title, lines, outcome: { motor: c.problems.motor.done, signal: c.problems.signal.done, asthma: c.problems.asthma.done, hatch: c.problems.hatch.done }, heroes };
}

// ---------- conversation machinery ----------
function transcript(lines, names) {
  if (!lines.length) return "(nobody has spoken yet in this scene)";
  return lines.map(l => {
    if (l.world) return `   ~ ${l.say}`;
    const to = l.to && names[l.to] ? ` (to ${names[l.to]})` : "";
    const act = l.outcome ? `\n   [${l.outcome}]` : "";
    return `${names[l.speaker].toUpperCase()}${to}: "${l.say}"${act}`;
  }).join("\n");
}
function nextSpeaker(lines, candidates) {
  const spoken = lines.filter(l => !l.world);
  const last = spoken[spoken.length - 1];
  if (last?.to && candidates.includes(last.to) && last.to !== last.speaker) return last.to;
  const counts = Object.fromEntries(candidates.map(id => [id, spoken.filter(l => l.speaker === id).length]));
  const min = Math.min(...Object.values(counts));
  const quiet = candidates.filter(id => counts[id] === min && id !== last?.speaker);
  return pick(quiet.length ? quiet : candidates);
}
function persona(id, names) {
  const c = CHAR[id], d = DEPTH[id];
  return `You are ${names[id]}, ${c.who}.
WHO YOU ARE: ${c.traits}
WHAT YOU'RE GOOD AT: ${d.skills}
WHAT YOU'RE CARRYING: ${d.fear}
HOW YOU TALK: ${c.voice}`;
}
const cast = (names, except) => IDS.filter(i => i !== except).map(i => `- ${names[i]} (id: ${i}), ${CHAR[i].who}`).join("\n");
const DRAMA = `HOW TO WRITE YOUR LINE
- Sound unmistakably like yourself (HOW YOU TALK). Someone reading only your line should know it's you.
- Let what you're carrying show when it's relevant. Real people under pressure snap, joke, freeze, take charge, apologize.
- Respond to something specific that was just said or done, and use people's names.
- Disagree when your nature says so. Don't just agree to be nice.
- Never use clichés like "adventure awaits", "safety first", "stay positive", "we can make it", "we've got this", "let's stay calm".
- Never repeat a phrase anyone has already said.
- Natural spoken dialogue, 6 to 22 words. No narration or stage directions inside the line.`;

const MOCK = {
  scholar: ["Wind's gusting past sixty. That's... statistically not great. Sorry. I'm fine.", "Don't look down. Don't look down. I looked down."],
  lucky: ["Oi, nha amigu, I once fell off a ferry and landed in a fishing net!", "No ticket, no money, but look, still here, sabe?"],
  mechanic: ["Listen, boss, nobody touches that housing but me.", "Chief, hold the line steady and I'll have it running."],
  mom: ["Hold my hand, hon. Breathe with me. In, and out.", "No way I'm sitting here. Give me that line."],
};
const parseLine = (r, id) => ({ speaker: id, say: String(r.say || "").slice(0, 200), to: IDS.includes(r.to) ? r.to : "all",
  delivery: String(r.delivery || "").slice(0, 40), gesture: String(r.gesture || "").slice(0, 90), thought: String(r.thought || "").slice(0, 240) });

async function speak(id, scene, lines, ctx, extra = "") {
  const prompt = `${persona(id, ctx.names)}

The other people here:
${cast(ctx.names, id)}

STORY SO FAR: ${ctx.story.join(" ") || "This is the beginning."}

SCENE: ${scene.title}. ${scene.setup}
${extra}
WHAT HAS BEEN SAID IN THIS SCENE (listen closely and respond to it):
${transcript(lines, ctx.names)}

${DRAMA}
Reply with JSON only:
{"say": "<your line>", "to": "<id of who you're talking to, or all>", "delivery": "<how you say it, 2-5 words>", "gesture": "<what your body does, under 12 words>", "thought": "<one private sentence: why>"}`;
  const r = await llmJSON(prompt, { mock: () => ({ say: pick(MOCK[id]), to: pick([...IDS.filter(i => i !== id), "all"]), delivery: "quickly", gesture: "grips the rail", thought: "mock" }) });
  return parseLine(r, id);
}

async function act(id, scene, lines, ctx, c) {
  const prompt = `${persona(id, ctx.names)}

The other people here:
${cast(ctx.names, id)}

STORY SO FAR: ${ctx.story.join(" ")}

SCENE: ${scene.title}. ${scene.setup}
NOW: wind ${c.wind}/10 and rising. When it reaches 10 nothing more can be done tonight.${id === "mom" ? " Your kids are right next to you." : ""}
WHAT NEEDS DOING (nobody has assigned jobs; you decide what you do):
${crisisStatus(c)}

WHAT HAS BEEN SAID AND DONE (listen closely and respond to it):
${transcript(lines, ctx.names)}

${DRAMA}
Choose ONE thing you do now, and say your line while doing it:
- work: put real effort into one problem (target = hatch, motor, signal or asthma)
- talk: only talk (lead, argue, reassure, plan, give someone a job)
Think about what you're best at, what others are already doing, and who you trust, but act like yourself, flaws included.
Reply with JSON only:
{"say": "<your line>", "to": "<id or all>", "delivery": "<2-5 words>", "gesture": "<under 12 words>", "action": "work or talk", "target": "<hatch|motor|signal|asthma or null>", "thought": "<one private sentence: why>"}`;
  const r = await llmJSON(prompt, { mock: () => ({ say: pick(MOCK[id]), to: pick([...IDS.filter(i => i !== id), "all"]), delivery: "through gritted teeth", gesture: "braces against the window",
    action: Math.random() < 0.8 ? "work" : "talk", target: pick(Object.keys(PROBLEMS)), thought: "mock" }) });
  const l = parseLine(r, id);
  l.action = r.action === "work" ? "work" : "talk";
  l.target = PROBLEMS[r.target] ? r.target : null;
  return l;
}

async function showrunnerNote(scene, lines, ctx) {
  const prompt = `You are the showrunner keeping a short film coherent. In two plain sentences, summarize what just happened in "${scene.title}", naming who did and said what. Then one sentence on how each character feels now. Don't invent anything that isn't in the transcript.
TRANSCRIPT:
${transcript(lines, ctx.names)}
Reply with JSON only: {"summary": "<2 sentences>", "feelings": "<1 sentence>"}`;
  const r = await llmJSON(prompt, { mock: () => ({ summary: `In ${scene.title}, things happened.`, feelings: "Everyone is on edge." }) });
  return `${r.summary || ""} ${r.feelings || ""}`.trim();
}

export async function writeScreenplay() {
  const names = {};
  log("Casting: the characters choose their names…");
  await Promise.all(IDS.map(async id => { names[id] = sanitizeName(await llmJSON(namePrompt(id), { mock: () => ({ name: CHAR[id].fallbackNames[0] }) }), id); }));
  log("  " + IDS.map(id => `${names[id]} (${id})`).join(", "));
  const ctx = { names, story: [] };
  const scenes = [];

  for (const scene of SCENES.slice(0, 2)) {
    log(`\nSCENE: ${scene.title}`);
    const lines = [];
    for (let t = 0; t < scene.turns; t++) {
      const id = nextSpeaker(lines, IDS);
      const l = await speak(id, scene, lines, ctx);
      lines.push(l); log(`  ${names[id]}: "${l.say}"`);
    }
    const summary = await showrunnerNote(scene, lines, ctx);
    ctx.story.push(summary);
    scenes.push({ id: scene.id, title: scene.title, location: scene.location, setup: scene.setup, lines, summary });
  }

  const scene = SCENES[2];
  log(`\nSCENE: ${scene.title}`);
  const c = newCrisis();
  const lines = [];
  let sinceTick = 0;
  while (!c.ended && c.decisions < scene.maxDecisions) {
    const id = nextSpeaker(lines, IDS);
    const l = await act(id, scene, lines, ctx, c);
    c.decisions++;
    if (l.action === "work" && l.target) { const res = attempt(c, id, l.target); l.outcome = `${names[id]} works on ${PROBLEMS[l.target].title}: ${res.text}`; l.ok = res.ok; }
    lines.push(l); log(`  ${names[id]}: "${l.say}"${l.outcome ? `  [${l.outcome}]` : ""}`);
    if (c.problems.motor.done) { c.ended = true; break; }
    if (++sinceTick >= 3) {
      sinceTick = 0;
      for (const ev of tick(c)) { lines.push({ world: true, say: ev }); log(`  ~ ${ev}`); }
      if (c.wind >= 10) c.ended = true;
    }
  }
  const ending = crisisEnding(c, names);
  ctx.story.push(await showrunnerNote(scene, lines, ctx) + ` Outcome: ${ending.lines.join(" ")}`);
  scenes.push({ id: scene.id, title: scene.title, location: scene.location, setup: scene.setup, lines, summary: ctx.story.at(-1) });

  const after = SCENES[3];
  const place = ending.title === "Down Together" ? "at the lower cable station on Tafelberg Road, stepping out of the cabin into the night"
    : ending.title === "The Long Night" ? "being helped off the rescue line at the lower station after midnight" : "stepping out of the cabin at dawn, stiff and cold";
  log(`\nSCENE: ${after.title}`);
  const alines = [];
  for (const id of IDS) {
    const l = await speak(id, { ...after, setup: `${after.setup} Now: ${place}. What happened: ${ending.lines.join(" ")}` }, alines, ctx,
      `${id === "mom" ? `Your kids are with you. ${ending.outcome.asthma ? "Your son is breathing easier." : "Paramedics are working on your son."}\n` : ""}This is your last line in the film. Make it honest and specific to what happened tonight.`);
    l.where = place; alines.push(l); log(`  ${names[id]}: "${l.say}"`);
  }
  scenes.push({ id: after.id, title: after.title, location: "lower_station", setup: `${after.setup} ${place}.`, lines: alines, summary: "" });
  return { names, scenes, ending, createdAt: new Date().toISOString() };
}

export function screenplayMarkdown(sp) {
  const N = id => sp.names[id] || id;
  let md = `# The Last Car Down\n\n*Every line and every choice below was made by the characters themselves.*\n\nCast: ${CHARACTERS.map(c => `**${N(c.id)}**, ${c.who}`).join("; ")}.\n`;
  for (const s of sp.scenes) {
    md += `\n## ${s.title.toUpperCase()}\n\n_${s.setup}_\n\n`;
    for (const l of s.lines) {
      if (l.world) { md += `> ${l.say}\n\n`; continue; }
      md += `**${N(l.speaker).toUpperCase()}**${l.to && l.to !== "all" ? ` (to ${N(l.to)})` : ""}${l.delivery ? `, ${l.delivery}` : ""}\n"${l.say}"\n`;
      if (l.outcome) md += `*(${l.outcome})*\n`;
      if (l.thought) md += `<sub>Why: ${l.thought}</sub>\n`;
      md += `\n`;
    }
  }
  md += `\n## THE END: ${sp.ending.title}\n\n${sp.ending.lines.map(l => `- ${l}`).join("\n")}\n`;
  return md;
}
