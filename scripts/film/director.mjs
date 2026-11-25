// The director turns the agents' screenplay into a shot list. It frames the story; it never changes it:
// dialogue is taken word for word from the screenplay, and every outcome-changing action gets a shot.
import { CHARACTERS, CHAR } from "../../public/world.js";
import { llmJSON, log } from "./env.mjs";

export const LOCATIONS = {
  aerial_peninsula: "an aerial drone view sweeping north along the Cape Peninsula from the rocky tip of Cape Point and the Cape of Good Hope, past the Twelve Apostles mountain range and the Atlantic coastline of Camps Bay, towards the unmistakable flat-topped Table Mountain rising over Cape Town and Table Bay",
  cable_car_exterior: "a round Swiss-made Rotair cable car cabin with wraparound panoramic windows, hanging from twin steel cables as it climbs the sheer grey-and-ochre sandstone cliff of Table Mountain's front face; far below, the lower station on Tafelberg Road, Kloof Nek, Lion's Head, Signal Hill and the Cape Town city bowl curving down to Table Bay",
  cable_car_interior: "inside a round Rotair cable car cabin whose floor slowly rotates, wraparound windows showing the sheer sandstone cliff of Table Mountain on one side and Cape Town's city bowl, Lion's Head, Signal Hill, Robben Island in Table Bay and the Atlantic on the other",
  upper_station: "the stone upper cable station on the western edge of Table Mountain's flat sandstone summit, fynbos and boulders around it, the round cable car waiting at the platform, the white 'tablecloth' cloud pouring over the mountain's edge, Lion's Head and the Atlantic below",
  stalled_car_night: "inside the round cable car stalled halfway down Table Mountain's sheer cliff, its lights dead, swaying on its cables in a gale, rain-streaked panoramic windows, the glittering lights of the Cape Town city bowl and Table Bay hundreds of metres below",
  car_roof: "on top of the stalled round cable car in a howling gale, the steel cables and grip carriage overhead, an open roof hatch and the motor housing, the sandstone cliff face beside it, Cape Town's lights spread out far below",
  car_exterior_night: "the round cable car hanging motionless halfway up the cliff of Table Mountain in a gale, a single torch flickering in its windows, cloud streaming past, the city lights of Cape Town below",
  lower_station: "the lower cable station on Tafelberg Road at the foot of Table Mountain, floodlights, a rescue vehicle and paramedics with flashing blue lights, the round cable car arriving out of the darkness above",
  dawn_wire: "the round cable car hanging on its cables against Table Mountain's cliff at dawn, the wind finally dropped, soft pink light over Cape Town, Lion's Head and Table Bay",
};
export const LIGHT = ["warm late-afternoon sunlight", "golden-hour sunset light, long shadows", "stormy dusk, wind rising, cloud thickening", "night gale, torchlight and city glow", "cold soft dawn light"];

export const LOOK = {
  scholar: "a 28-year-old African-American woman with a polished, scholarly look, cardigan over smart casual travel clothes, small backpack",
  lucky: "a 68-year-old Cape Verdean man with grey stubble, deep smile lines, a faded colourful shirt and an old straw hat",
  mechanic: "a 38-year-old muscular Latino man in a fitted T-shirt, utility pants and work boots",
  mom: "a 35-year-old athletic Irish-American woman in a windbreaker, with her two children (a 10-year-old and a 7-year-old) at her side",
};

export const LOOK_SHORT = {
  scholar: "a 28-year-old African-American woman in a cardigan",
  lucky: "a 68-year-old Cape Verdean man in a straw hat",
  mechanic: "a 38-year-old muscular Latino man",
  mom: "a 35-year-old Irish-American mother in a windbreaker",
};

const words = s => String(s).trim().split(/\s+/).filter(Boolean).length;

function compact(sp) {
  const N = id => sp.names[id] || id;
  return sp.scenes.map(s => `SCENE ${s.id} "${s.title}" (${s.location}):\n` + s.lines.map((l, i) =>
    l.world ? `  [${i}] EVENT: ${l.say}` : `  [${i}] ${N(l.speaker)} (${l.speaker})${l.to && l.to !== "all" ? ` to ${N(l.to)}` : ""}, ${l.delivery || "plainly"}: "${l.say}"${l.action && l.action !== "talk" ? `  ACTION: ${l.outcome}` : ""}${l.where ? `  WHERE: ${l.where}` : ""}`
  ).join("\n")).join("\n\n") + `\n\nENDING: ${sp.ending.title}. ${sp.ending.lines.join(" ")}`;
}

export async function directShots(sp) {
  const prompt = `You are the director of a 2-minute animated short film ("stylized realistic animated feature film" look). Turn this screenplay, written entirely by the characters, into a shot list. You frame the story; you never change it.

CAST (use these ids): ${CHARACTERS.map(c => `${c.id} = ${sp.names[c.id]}, ${LOOK[c.id]}`).join("; ")}.

SCREENPLAY:
${compact(sp)}

RULES
- 14 to 20 shots. Each shot is 5 to 10 seconds. Total runtime 110 to 170 seconds.
- Shot 1: location aerial_peninsula, no dialogue, the title "THE LAST CAR DOWN" fades in elegantly over the view. 8 to 10 seconds.
- Shot 2: location cable_car_exterior, the cable car climbing the cliff. No dialogue.
- Then follow the screenplay in order. Dialogue must be copied WORD FOR WORD from the screenplay (you may drop whole lines, or cut words from the end of a long line, never add or rephrase).
- At most 2 lines per shot, and at most 3 words of dialogue per second of shot (an 8-second shot holds at most 24 words).
- Every ACTION marked DONE, every stroke of luck, the moment the car stalls, the boy's asthma attack and the violent gusts must appear in some shot. Work on the hatch or motor happens on location car_roof; the rest of the stall happens in stalled_car_night, with car_exterior_night for wide shots of the car hanging on the cliff.
- Mix shot types like a real film: wide establishing, medium two-shots for exchanges, close-ups for emotional lines, reaction shots.
- The last shot resolves the ending visually (lower_station for a night arrival or rescue, dawn_wire for the dawn ending).
- location must be one of: ${Object.keys(LOCATIONS).join(", ")}. light is an index 0 to 4 (0 = late afternoon, 4 = night) that only moves forward through the film.
- in_frame lists the character ids visible (max 3; the mom's kids come with her automatically).

Reply with JSON only:
{"shots": [{"location": "...", "light": 0, "duration": 8, "camera": "<shot type and movement>", "in_frame": ["id"], "action": "<what happens visibly, present tense, one or two sentences>", "dialogue": [{"speaker": "id", "delivery": "<2-5 words>", "line": "<exact words>"}], "audio": "<ambient and effects, plus music only if it truly helps>"}]}`;
  let shots;
  try {
    const r = await llmJSON(prompt, { mock: () => ({}) });
    shots = Array.isArray(r.shots) ? r.shots : null;
  } catch (e) { log(`  director fell back to rule-based shots (${e.message.slice(0, 100)})`); }
  if (!shots || shots.length < 6) shots = ruleBasedShots(sp);
  return withFinale(validate(shots, sp), sp);
}

// Every film ends the same way structurally, whatever the director planned: how they got down,
// the characters' closing lines, and an end card. The content of all three comes from the story itself.
const RESOLUTION = {
  "Down Together": { location: "cable_car_exterior", light: 3, camera: "slow wide shot following the cabin down the cliff",
    action: "The backup motor coughs to life. Lights flicker on inside the round cabin and it begins to creep down the dark cliff towards the glittering lights of Cape Town and the lower station on Tafelberg Road.",
    audio: "a motor sputtering then catching, cables humming back to life, wind easing, a warm hopeful string theme rising" },
  "The Long Night": { location: "car_exterior_night", light: 3, camera: "wide shot, slow push in",
    action: "Headlamps of a mountain rescue team edge out along the cable towards the stranded cabin in the gale, torch beams answering from inside the car.",
    audio: "howling wind, the clink of rescue gear on steel cable, distant shouts, a tense low string note resolving" },
  "Dawn on the Wire": { location: "dawn_wire", light: 4, camera: "slow wide shot as the light grows",
    action: "The wind has dropped. Soft dawn light spreads over Cape Town and Table Bay as the cable shudders and the cabin is slowly winched down the cliff.",
    audio: "near silence after the storm, birdsong far below, the slow groan of the winch, a gentle piano theme" },
};
export function finaleShots(sp) {
  const title = sp.ending.title;
  const res = RESOLUTION[title] || RESOLUTION["Dawn on the Wire"];
  const endLoc = title === "Dawn on the Wire" ? "dawn_wire" : "lower_station";
  const after = sp.scenes.find(s => s.id === "aftermath")?.lines.filter(l => !l.world) || [];
  const out = [{ location: res.location, light: res.light, duration: 8, camera: res.camera, in_frame: [], action: res.action, dialogue: [], audio: res.audio }];
  const closing = after.slice(0, 4);
  for (let i = 0; i < closing.length; i += 2) {
    const pair = closing.slice(i, i + 2);
    const spoken = pair.reduce((a, l) => a + words(l.say), 0);
    out.push({ location: endLoc, light: res.light, duration: Math.min(10, Math.max(7, Math.ceil(spoken / 3))), camera: i === 0 ? "medium group shot" : "close two-shot",
      in_frame: [...new Set(pair.map(l => l.speaker))],
      action: `The group, exhausted, ${title === "Dawn on the Wire" ? "steps out of the cabin into the dawn light" : "stands together at the lower station"}. ${pair.map(l => l.gesture ? `${sp.names[l.speaker]} ${l.gesture.replace(/\.$/, "")}.` : "").join(" ")}`,
      dialogue: pair.map(l => ({ speaker: l.speaker, delivery: l.delivery || "quietly", line: l.say })),
      audio: "quiet wind, distant city, the film's theme returning softly" });
  }
  out.push({ location: title === "Dawn on the Wire" ? "dawn_wire" : "cable_car_exterior", light: res.light, duration: 7, camera: "slow wide pull back from Table Mountain",
    in_frame: [], action: "The camera pulls back from Table Mountain and Cape Town.", dialogue: [],
    titleText: title.toUpperCase(), subtitleText: "Written by its characters", audio: "the theme swells to a warm final chord" });
  return out;
}
function withFinale(shots, sp) {
  // drop anything the director put after the crisis, then add the guaranteed ending
  let cut = shots.length;
  for (let i = shots.length - 1; i >= 2; i--) if (["lower_station", "dawn_wire"].includes(shots[i].location)) cut = i; else break;
  const out = [...shots.slice(0, Math.min(cut, 18)), ...finaleShots(sp)];
  return out.map((s, i) => ({ ...s, n: i + 1 }));
}

function validate(shots, sp) {
  const allLines = sp.scenes.flatMap(s => s.lines.filter(l => !l.world).map(l => l.say.trim()));
  let light = 0;
  return shots.slice(0, 22).map((s, i) => {
    const location = LOCATIONS[s.location] ? s.location : i === 0 ? "aerial_peninsula" : "stalled_car_night";
    light = Math.max(light, Math.min(4, Math.max(0, Number(s.light) || 0)));
    const inFrame = (Array.isArray(s.in_frame) ? s.in_frame : []).filter(id => CHAR[id]).slice(0, 3);
    let dialogue = (Array.isArray(s.dialogue) ? s.dialogue : []).filter(d => CHAR[d.speaker] && d.line)
      // keep only words that really came from the screenplay
      .filter(d => allLines.some(l => l.toLowerCase().startsWith(String(d.line).trim().toLowerCase().replace(/[.…]+$/, "").slice(0, 25))))
      .slice(0, 2);
    let duration = Math.round(Math.min(10, Math.max(5, Number(s.duration) || 8)));
    const spoken = dialogue.reduce((a, d) => a + words(d.line), 0);
    if (spoken > duration * 3) duration = Math.min(10, Math.ceil(spoken / 3));
    for (const d of dialogue) if (!inFrame.includes(d.speaker) && inFrame.length < 3) inFrame.push(d.speaker);
    return { n: i + 1, location, light, duration, camera: String(s.camera || "medium shot"), in_frame: inFrame,
      action: String(s.action || ""), dialogue: dialogue.map(d => ({ speaker: d.speaker, delivery: String(d.delivery || "naturally"), line: String(d.line).trim() })),
      audio: String(s.audio || "wind gusting across the mountain") };
  });
}

// Used when the LLM director is unavailable: every dialogue line pair becomes a shot.
function ruleBasedShots(sp) {
  const shots = [
    { location: "aerial_peninsula", light: 0, duration: 9, camera: "slow aerial drone push north", in_frame: [], action: "The camera sweeps up the Cape Peninsula towards Table Mountain as the title \"THE LAST CAR DOWN\" fades in elegantly in clean white serif type and holds.", dialogue: [], audio: "wind over the ocean, a warm sustained string chord" },
    { location: "cable_car_exterior", light: 0, duration: 6, camera: "wide shot tracking the cabin", in_frame: [], action: "The round cable car climbs the sheer sandstone cliff, Cape Town far below.", dialogue: [], audio: "the hum of the cables, gusting wind" },
  ];
  const endLoc = sp.ending.title === "Dawn on the Wire" ? "dawn_wire" : "lower_station";
  const light = { ride_up: 0, summit: 1, stall: 3, aftermath: sp.ending.title === "Dawn on the Wire" ? 4 : 3 };
  for (const s of sp.scenes) {
    if (s.id === "stall") shots.push({ location: "car_exterior_night", light: 2, duration: 6, camera: "wide shot of the car on the cliff", in_frame: [], action: "With a bang and a lurch the cable car stops dead halfway down the cliff and its lights go out.", dialogue: [], audio: "a metallic bang, groaning cables, roaring wind" });
    const talk = s.lines.filter(l => !l.world);
    for (let i = 0; i < talk.length; i += 2) {
      const pair = talk.slice(i, i + 2);
      const roof = pair.some(l => l.action === "work" && ["hatch", "motor"].includes(l.target));
      const loc = s.id === "ride_up" ? "cable_car_interior" : s.id === "summit" ? "upper_station" : s.id === "stall" ? (roof ? "car_roof" : "stalled_car_night") : endLoc;
      shots.push({ location: loc, light: light[s.id], duration: 8, camera: pair.length > 1 ? "medium two-shot" : "close-up",
        in_frame: [...new Set(pair.map(l => l.speaker))],
        action: pair.map(l => (l.outcome ? l.outcome + "." : l.gesture ? `${sp.names[l.speaker]} ${l.gesture.replace(/\.$/, "")}.` : "")).filter(Boolean).join(" "),
        dialogue: pair.map(l => ({ speaker: l.speaker, delivery: l.delivery || "naturally", line: l.say })), audio: s.id === "stall" ? "howling wind, creaking cables, rain on glass" : "wind, distant cable hum" });
    }
  }
  return shots.slice(0, 20);
}
