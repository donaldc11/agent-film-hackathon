// Shared helpers: .env loading, LLM calls (OpenAI or Gemini), Runware calls, files.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
export const MOCK = process.argv.includes("--mock");   // offline test mode: no API calls
export const log = (...a) => console.log(...a);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- LLM (JSON in, JSON out) ----------
const parseJSON = text => JSON.parse(String(text).replace(/```json|```/g, "").trim());
export async function llmJSON(prompt, { mock } = {}) {
  if (MOCK) return mock ? mock() : {};
  const brain = (process.env.BRAIN || (process.env.OPENAI_API_KEY ? "openai" : "gemini")).toLowerCase();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (brain === "openai") {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: process.env.OPENAI_MODEL, temperature: 1.0,
            response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
        });
        if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return parseJSON((await r.json()).choices[0].message.content);
      } else {
        const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 1.0, responseMimeType: "application/json" } }),
        });
        if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const d = await r.json();
        return parseJSON(d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}");
      }
    } catch (e) {
      if (attempt === 3) throw e;
      log(`  (brain retry ${attempt}: ${e.message.slice(0, 120)})`);
      await sleep(1500 * attempt);
    }
  }
}

// ---------- Runware ----------
export async function runware(tasks) {
  const r = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RUNWARE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(tasks),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.errors?.length) throw new Error(`Runware ${r.status}: ${JSON.stringify(body.errors || body).slice(0, 400)}`);
  return body.data || [];
}
export const uuid = () => crypto.randomUUID();

export async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
export const dataURI = file => `data:image/${path.extname(file).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(file).toString("base64")}`;
export const readJSON = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
export const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
