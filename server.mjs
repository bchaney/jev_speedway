// Zero-dependency dev server: serves the GUI and proxies evaluation requests
// so API keys stay on the server side and the browser avoids CORS.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS, mockAnswers } from "./lib/jev.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

// Minimal .env loader (no dependency). Real env wins over the file.
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]] && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT || 4343);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function availableProviders() {
  const out = {};
  for (const [k, p] of Object.entries(PROVIDERS)) {
    out[k] = { label: p.label, models: p.models, url: p.url, hasKey: k === "mock" ? true : Boolean(process.env[p.envKey]) };
  }
  return out;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function evaluate({ provider, body }) {
  const t0 = performance.now();
  if (provider === "mock") {
    await new Promise((r) => setTimeout(r, 120));
    return { status: 200, latencyMs: Math.round(performance.now() - t0), response: mockAnswers(body) };
  }
  const p = PROVIDERS[provider];
  if (!p) return { status: 400, latencyMs: 0, response: { error: `Unknown provider ${provider}` } };
  const key = process.env[p.envKey];
  if (!key) return { status: 401, latencyMs: 0, response: { error: `${p.envKey} is not set. Add it to .env or the environment, or use the mock provider.` } };
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "jev-test";
  }
  const r = await fetch(p.url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let response;
  try { response = JSON.parse(text); } catch { response = { error: text.slice(0, 2000) }; }
  return { status: r.status, latencyMs: Math.round(performance.now() - t0), response };
}

async function serveStatic(res, urlPath) {
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const rel = urlPath.startsWith("/lib/") ? urlPath : "/public" + urlPath;
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, "forbidden", "text/plain");
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return send(res, 200, { providers: availableProviders() });
    }
    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const payload = await readJson(req);
      const result = await evaluate(payload);
      return send(res, 200, result);
    }
    if (req.method === "GET") return serveStatic(res, url.pathname);
    send(res, 405, "method not allowed", "text/plain");
  } catch (e) {
    send(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => {
  const p = availableProviders();
  const live = Object.entries(p).filter(([k, v]) => k !== "mock" && v.hasKey).map(([k]) => k);
  console.log(`jev_speedway running at http://localhost:${PORT}`);
  console.log(live.length ? `Live providers: ${live.join(", ")}` : "No API key found; mock provider only. See .env.example.");
});
