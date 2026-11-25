// server.js — serves the app, keeps the Gemini key off the client, and writes
// every decision and ending to data/*.jsonl for the Bruin pipeline.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });

// Minimal .env loader (no dependencies)
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const BRAIN = OPENAI_KEY ? "openai" : "gemini";
const KEY = OPENAI_KEY || GEMINI_KEY;
const MODEL = OPENAI_KEY ? OPENAI_MODEL : GEMINI_MODEL;
const PORT = Number(process.env.PORT || 3000);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg" };

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((ok, bad) => {
  let s = ""; req.on("data", c => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch (e) { bad(e); } });
});

async function askOpenAI(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Reply with JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, responseMimeType: "application/json" },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

const append = (file, rows) =>
  fs.appendFileSync(path.join(DATA, file), rows.map(r => JSON.stringify(r)).join("\n") + "\n");

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/status") return send(res, 200, { llm: Boolean(KEY), model: MODEL, brain: BRAIN });

    if (req.method === "POST" && req.url === "/api/brain") {
      if (!KEY) return send(res, 503, { error: "No OPENAI_API_KEY or GEMINI_API_KEY set" });
      const { prompt } = await readBody(req);
      try { return send(res, 200, await (BRAIN === "openai" ? askOpenAI(prompt) : askGemini(prompt))); }
      catch (e) { console.warn(e.message); return send(res, 502, { error: e.message }); }
    }

    if (req.method === "POST" && req.url === "/api/log") {
      const { decisions = [], run } = await readBody(req);
      if (decisions.length) append("decisions.jsonl", decisions);
      if (run) append("runs.jsonl", [run]);
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && req.url.startsWith("/assets/")) {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/assets\/?/, "");
      const assetsRoot = path.join(ROOT, "assets");
      const file = path.normalize(path.join(assetsRoot, rel));
      if (!file.startsWith(assetsRoot + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found", "text/plain");
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
    }

    if (req.method === "GET" && (req.url.startsWith("/portraits/") || req.url.startsWith("/scenes/"))) {
      const folder = req.url.startsWith("/scenes/") ? "scenes" : "portraits";
      const name = path.basename(decodeURIComponent(req.url.split("?")[0]));
      const file = path.join(ROOT, "assets", folder, name);
      if (!name.endsWith(".png") || !fs.existsSync(file)) return send(res, 404, "Not found", "text/plain");
      return send(res, 200, fs.readFileSync(file), "image/png");
    }

    // static files
    const p = path.normalize(path.join(PUBLIC, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0])));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, "Not found", "text/plain");
    send(res, 200, fs.readFileSync(p), TYPES[path.extname(p)] || "application/octet-stream");
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`🎬 The Last Car Down: http://localhost:${PORT}  (brain: ${KEY ? `${BRAIN} ${MODEL}` : "offline"})`));
