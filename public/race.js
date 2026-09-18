// Jev Speedway: code drives, Jev judges.
import { PRICE_PER_MTOK } from "/lib/jev.mjs";
const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- track: closed Catmull-Rom spline through control points ----------
const CP = [[150,360],[200,180],[400,110],[650,120],[850,170],[980,320],[900,470],[760,520],[620,470],[540,360],[430,430],[330,600],[200,600],[130,500]];
const SEG_N = 40;
const pts = []; // {x,y,s,kappa}
for (let i = 0; i < CP.length; i++) {
  const p0 = CP[(i - 1 + CP.length) % CP.length], p1 = CP[i], p2 = CP[(i + 1) % CP.length], p3 = CP[(i + 2) % CP.length];
  for (let j = 0; j < SEG_N; j++) {
    const t = j / SEG_N, t2 = t * t, t3 = t2 * t;
    const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
    const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    pts.push({ x, y });
  }
}
let L = 0;
for (let i = 0; i < pts.length; i++) { pts[i].s = L; const n = pts[(i + 1) % pts.length]; L += Math.hypot(n.x - pts[i].x, n.y - pts[i].y); }
for (let i = 0; i < pts.length; i++) { // signed curvature via heading change
  const a = pts[(i - 3 + pts.length) % pts.length], b = pts[i], c = pts[(i + 3) % pts.length];
  const h1 = Math.atan2(b.y - a.y, b.x - a.x), h2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  pts[i].kappa = d / (Math.hypot(c.x - a.x, c.y - a.y) || 1);
}
const WIDTH = 46;
function at(s) { s = ((s % L) + L) % L; let i = Math.floor(s / L * pts.length); i = clamp(i, 0, pts.length - 1); const p = pts[i], n = pts[(i + 1) % pts.length]; const h = Math.atan2(n.y - p.y, n.x - p.x); return { x: p.x, y: p.y, h, kappa: p.kappa }; }
function pos(s, lat) { const p = at(s); return { x: p.x + Math.cos(p.h + Math.PI / 2) * lat * WIDTH * 0.42, y: p.y + Math.sin(p.h + Math.PI / 2) * lat * WIDTH * 0.42, h: p.h }; }
// features (by track distance)
const V_TOP = 150, GRIP = 3200, ACCEL = 65, BRAKE = 160;
function cornerLimit(s) { return Math.sqrt(GRIP / Math.max(Math.abs(at(s).kappa), 1e-4)); } // physical grip limit, uncapped
function vmax(s) { return Math.min(V_TOP, cornerLimit(s)); }
const BOOST_PAD = { s0: L * 0.06, s1: L * 0.11 };
const SHORTCUT = { entry: L * 0.60, exit: L * 0.71, minSpeed: 100, airTime: 0.9 }; // a jump over the S-bend; too slow = crash
const HAIRPIN = (() => { let best = 0, bs = 0; for (const p of pts) if (Math.abs(p.kappa) > best) { best = Math.abs(p.kappa); bs = p.s; } return bs; })();
function nextFeature(s) { // nearest upcoming semantic feature
  const list = [
    { name: "hairpin", s: HAIRPIN, then: "a straight" },
    { name: "booster pad", s: BOOST_PAD.s0, then: "a fast sweeping section" },
    { name: "shortcut jump entry", s: SHORTCUT.entry, then: "an S-bend (or the jump)" },
  ];
  let bestD = Infinity, best = null;
  for (const f of list) { const d = ((f.s - s) % L + L) % L; if (d < bestD) { bestD = d; best = f; } }
  return { ...best, dist: bestD };
}

// ---------- drivers ----------
const DRIVERS = [
  { name: "Blaze", color: "#f97316", traits: "reckless, loves jumps and boosts, hates being behind" },
  { name: "Vera", color: "#22c55e", traits: "calm and calculating, brakes early, only passes when it is safe" },
  { name: "Rook", color: "#3b82f6", traits: "aggressive defender, blocks rivals, takes risks only when losing" },
  { name: "Pip", color: "#e879f9", traits: "nervous rookie, avoids contact, cautious into corners, brave on straights" },
];
const cars = [];
let race = { running: false, laps: 3, t: 0, finished: [], reqs: 0, tokens: 0, cost: 0, latency: [] };
const bucket = (v, arr) => { for (const [lim, name] of arr) if (v < lim) return name; return arr[arr.length - 1][1]; };

function resetCars() {
  cars.length = 0;
  DRIVERS.forEach((d, i) => cars.push({
    ...d, i, s: -30 - i * 28, lat: i % 2 ? 0.6 : -0.6, v: 0, lap: 0, spin: 0, air: 0, boostAvail: true, boostT: 0, done: false, finishT: null,
    dec: { line: "middle", pace: "steady", overtake: false, boost: false, shortcut: false, conf: {}, probs: {} }, thinking: false, nextThink: i * 0.2, lastReq: null, lastRes: null, shortcutTaken: false,
  }));
}

// ---------- physics (code owns the car) ----------
function step(dt) {
  race.t += dt;
  const order = ranking();
  for (const c of cars) {
    if (c.done) { c.v = lerp(c.v, 60, dt); c.s += c.v * dt; continue; }
    if (c.spin > 0) { c.spin -= dt; c.v = lerp(c.v, 0, dt * 2); c.s += c.v * dt; continue; }
    if (c.air > 0) { c.air -= dt; c.s += c.v * dt * 1.6; if (c.air <= 0) { c.lat = -0.4; } continue; }
    const sm = ((c.s % L) + L) % L;
    // target lane from decision, hesitation if low confidence
    const laneT = { inside: -0.85, middle: 0, outside: 0.85 }[c.dec.line] ?? 0;
    c.lat = lerp(c.lat, laneT, dt * 3);
    // pace: how close to the limit into the next corner
    const paceF = { attack: 1.12, steady: 1.0, cautious: 0.86 }[c.dec.pace] ?? 1;
    const look = 40 + c.v * 0.55;
    let target = V_TOP;
    for (let d = 0; d < look; d += 10) target = Math.min(target, vmax(sm + d) * paceF + (d / look) * 40);
    if (c.dec.overtake) target *= 1.06;
    if (sm > BOOST_PAD.s0 && sm < BOOST_PAD.s1) target = V_TOP * 1.2, c.v = Math.max(c.v, c.v + 55 * dt);
    if (c.dec.boost && c.boostAvail) { c.boostAvail = false; c.boostT = 1.4; log(`${c.name} hits the boost`); }
    if (c.boostT > 0) { c.boostT -= dt; target = V_TOP * 1.25; }
    // blocking: car directly ahead in same lane caps speed
    for (const o of cars) if (o !== c && !o.done) { const gap = ((o.s - c.s) % L + L) % L; if (gap > 0 && gap < 26 && Math.abs(o.lat - c.lat) < 0.7) target = Math.min(target, o.v * (c.dec.overtake ? 1.0 : 0.95)); }
    // accelerate / brake
    if (c.v < target) c.v = Math.min(target, c.v + ACCEL * dt * (c.boostT > 0 ? 2 : 1)); else c.v = Math.max(target, c.v - BRAKE * dt);
    // grip check: too fast for the corner => spin
    const limit = cornerLimit(sm) * (1 + 0.12 * (c.lat > 0.3 ? 0.5 : 0)); // outside line is a little more forgiving; straights never spin
    if (c.v > limit * 1.08) { c.spin = 1.2; c.v *= 0.35; log(`${c.name} spins out in the ${nextFeature(sm).dist < 60 ? nextFeature(sm).name : "corner"}!`); }
    // shortcut jump
    if (c.dec.shortcut && !c.shortcutTaken && sm > SHORTCUT.entry - 6 && sm < SHORTCUT.entry + 6) {
      c.shortcutTaken = true;
      if (c.v >= SHORTCUT.minSpeed) { c.air = SHORTCUT.airTime; c.lat = -1.4; log(`${c.name} takes the jump at ${Math.round(c.v)} and clears it!`); }
      else { c.spin = 2.0; c.v = 0; log(`${c.name} tried the jump too slowly and crashed`); }
    }
    if (sm > SHORTCUT.exit + 20 && sm < SHORTCUT.exit + 60) c.shortcutTaken = false;
    const before = Math.floor(c.s / L);
    c.s += c.v * dt;
    if (Math.floor(c.s / L) > before && c.s > 0) { c.lap++; c.boostAvail = true; if (c.lap >= race.laps) { c.done = true; c.finishT = race.t; race.finished.push(c.name); log(`🏁 ${c.name} finishes P${race.finished.length}`); } else log(`${c.name} completes lap ${c.lap}`); }
    // think
    c.nextThink -= dt;
    if (c.nextThink <= 0 && !c.thinking) { c.nextThink = Number($("#tick").value) / 1000; think(c, order); }
  }
  if (cars.every((c) => c.done) && race.running) { race.running = false; log("Race over."); }
}
function ranking() { return [...cars].sort((a, b) => (a.finishT ?? Infinity) - (b.finishT ?? Infinity) || (b.lap * L + b.s) - (a.lap * L + a.s)); }

// ---------- Jev: the driver's judgment ----------
function buildState(c, order) {
  const sm = ((c.s % L) + L) % L, p = order.indexOf(c) + 1, f = nextFeature(sm);
  const gapTo = (o) => o ? (((o.s - c.s) % L + L) % L) : null;
  let ahead = null, behind = null;
  for (const o of cars) if (o !== c && !o.done) { const g = gapTo(o); const gBehind = ((c.s - o.s) % L + L) % L; if (g < 140 && (!ahead || g < gapTo(ahead))) ahead = o; if (gBehind < 140 && (!behind || gBehind < ((c.s - behind.s) % L + L) % L)) behind = o; }
  const laneName = (lat) => lat < -0.3 ? "inside" : lat > 0.3 ? "outside" : "middle";
  const desc = (o, g) => o ? { name: o.name, gap: bucket(g, [[30, "right on the bumper"], [70, "close"], [140, "a few car lengths"]]), lane: laneName(o.lat), status: o.spin > 0 ? "spinning" : "racing" } : "nobody nearby";
  return {
    driver: { name: c.name, traits: c.traits, position: `${p} of ${cars.length}`, lap: `${c.lap + 1} of ${race.laps}`, boost: c.boostAvail ? "available (one use per lap)" : "used this lap", status: c.spin > 0 ? "recovering from a spin" : "racing" },
    car: { speed: bucket(c.v, [[50, "slow"], [95, "cruising"], [135, "fast"], [1e9, "flat out"]]), lane: laneName(c.lat), grip: c.v > vmax(sm) * 0.95 ? "at the limit, tyres squealing" : "comfortable" },
    track_ahead: { next: f.name, distance: bucket(f.dist, [[60, "right now"], [160, "close"], [320, "medium"], [1e9, "far"]]), after_that: f.then, hairpin_note: "the hairpin is the tightest corner; entering it fast without braking causes a spin" },
    rivals: { ahead: desc(ahead, ahead ? gapTo(ahead) : 0), behind: desc(behind, behind ? ((c.s - behind.s) % L + L) % L : 0) },
    shortcut: { available: f.name === "shortcut jump entry" && f.dist < 200, description: "a jump that skips the S-bend and gains about two seconds; it only works when the car is fast or flat out; a slow attempt crashes and loses about three seconds" },
  };
}
const QUESTIONS = {
  line: { type: "choice", instructions: "Which lane should `driver` take through `track_ahead.next`, given `rivals` and the driver's `driver.traits`?", criteria: { inside: "Tight line, shortest distance, less forgiving if too fast", middle: "Neutral line", outside: "Wide line, more forgiving at speed, longer distance" } },
  pace: { type: "choice", instructions: "How hard should `driver` push into `track_ahead.next`?", criteria: { attack: "Brake as late as possible, carry maximum speed, accept a real risk of spinning", steady: "Brake normally and stay in control", cautious: "Brake early and protect the position, giving up some time" } },
  overtake: { type: "noul", instructions: "Should `driver` attempt to pass `rivals.ahead` before `track_ahead.next`?", criteria: { true: "There is a rival close ahead and passing now fits the driver's traits and the situation", false: "No rival close ahead, or passing now is unwise for this driver" } },
  boost: { type: "noul", instructions: "Should `driver` use the boost right now, considering `driver.boost`, `track_ahead` and `rivals`?", criteria: { true: "Boost is available and this moment (a straight, a pass, a jump run-up) is a good use of it", false: "Boost is unavailable, or a better moment is coming" } },
  shortcut: { type: "noul", instructions: "Should `driver` take the `shortcut` jump, given `shortcut.available`, `car.speed` and `driver.traits`?", criteria: { true: "The shortcut is available and the driver is fast enough and willing to risk it", false: "Not available, too slow, or too risky for this driver" } },
};
async function think(c, order) {
  c.thinking = true;
  const state = buildState(c, order);
  const body = { model: $("#model").value, state, questions: QUESTIONS };
  c.lastReq = body;
  const t0 = performance.now();
  try {
    const r = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: $("#provider").value, body }) }).then((x) => x.json());
    c.lastRes = r.response;
    const a = r.response?.answers;
    if (a) {
      race.reqs++; race.tokens += r.response.usage?.input_tokens ?? 0; race.cost += r.response.usage?.cost ?? (r.response.usage?.input_tokens ?? 0) * PRICE_PER_MTOK / 1e6; race.latency.push(r.latencyMs);
      const d = c.dec;
      if (a.line.confidence >= 0.35) d.line = a.line.choice; // low confidence: hesitate, keep the lane
      d.pace = a.pace.confidence >= 0.35 ? a.pace.choice : "steady";
      d.overtake = a.overtake.noul > 0.6; d.boost = a.boost.noul > 0.7; d.shortcut = a.shortcut.noul > 0.6 && state.shortcut.available;
      d.conf = { line: a.line.confidence, pace: a.pace.confidence }; d.probs = { line: a.line.probabilities, pace: a.pace.probabilities, overtake: a.overtake.noul, boost: a.boost.noul, shortcut: a.shortcut.noul };
    } else log(`${c.name}: request failed (${r.status}) ${JSON.stringify(r.response).slice(0, 120)}`);
  } catch (e) { log(`${c.name}: ${e.message}`); }
  c.thinking = false;
  renderSide();
  if (selected === c) $("#raw").textContent = JSON.stringify({ request: c.lastReq, response: c.lastRes }, null, 2);
}

// ---------- render ----------
const cv = $("#c"), ctx = cv.getContext("2d");
function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  // track ribbon
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "#1c2233"; ctx.lineWidth = WIDTH + 10; tracePath(); ctx.stroke();
  ctx.strokeStyle = "#2a3247"; ctx.lineWidth = WIDTH; tracePath(); ctx.stroke();
  ctx.setLineDash([10, 14]); ctx.strokeStyle = "#3d4763"; ctx.lineWidth = 2; tracePath(); ctx.stroke(); ctx.setLineDash([]);
  // booster
  ctx.strokeStyle = "#facc15"; ctx.lineWidth = WIDTH - 8; ctx.globalAlpha = 0.35; ctx.beginPath(); for (let s = BOOST_PAD.s0; s <= BOOST_PAD.s1; s += 6) { const p = at(s); s === BOOST_PAD.s0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); } ctx.stroke(); ctx.globalAlpha = 1;
  // shortcut chord
  const a = pos(SHORTCUT.entry, -1.4), b = pos(SHORTCUT.exit, -0.4);
  ctx.setLineDash([6, 8]); ctx.strokeStyle = "#f97316"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2 + 30, (a.y + b.y) / 2 - 70, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  label("JUMP", (a.x + b.x) / 2 + 20, (a.y + b.y) / 2 - 40, "#f97316"); label("BOOST", at((BOOST_PAD.s0 + BOOST_PAD.s1) / 2).x, at((BOOST_PAD.s0 + BOOST_PAD.s1) / 2).y - 36, "#facc15"); label("HAIRPIN", at(HAIRPIN).x, at(HAIRPIN).y + 40, "#8a93a6");
  // start line
  const s0 = at(0); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(s0.x + Math.cos(s0.h + Math.PI / 2) * WIDTH / 2, s0.y + Math.sin(s0.h + Math.PI / 2) * WIDTH / 2); ctx.lineTo(s0.x - Math.cos(s0.h + Math.PI / 2) * WIDTH / 2, s0.y - Math.sin(s0.h + Math.PI / 2) * WIDTH / 2); ctx.stroke();
  // cars
  for (const c of cars) {
    let p; if (c.air > 0) { const t = 1 - c.air / SHORTCUT.airTime; const q = { x: lerp(a.x, b.x, t) + Math.sin(t * Math.PI) * 30, y: lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * 70 }; p = { ...q, h: Math.atan2(b.y - a.y, b.x - a.x) }; } else p = pos(c.s, c.lat);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.h); if (c.spin > 0) ctx.rotate(c.spin * 9);
    const sc = c.air > 0 ? 1.4 : 1; ctx.scale(sc, sc);
    if (c.boostT > 0) { ctx.fillStyle = "rgba(250,204,21,.8)"; ctx.fillRect(-22, -4, 10, 8); }
    ctx.fillStyle = c.color; ctx.fillRect(-11, -6, 22, 12); ctx.fillStyle = "#111"; ctx.fillRect(-3, -5, 8, 10);
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(c.name, p.x + 14, p.y - 10);
  }
}
function tracePath() { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
function label(t, x, y, col) { ctx.fillStyle = col; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(t, x, y); ctx.textAlign = "left"; }

let selected = null;
function renderSide() {
  const order = ranking();
  $("#standings").innerHTML = order.map((c, i) => `<div><span style="color:${c.color}">P${i + 1} ${c.name}</span><span>${c.done ? `finished ${c.finishT.toFixed(1)}s` : `lap ${Math.min(c.lap + 1, race.laps)} · ${Math.round(c.v)}`}</span></div>`).join("");
  const avgLat = race.latency.length ? Math.round(race.latency.reduce((a, b) => a + b, 0) / race.latency.length) : 0;
  $("#stats").textContent = `${race.reqs} Jev requests · ${race.tokens.toLocaleString()} input tokens · $${race.cost.toFixed(5)} · avg ${avgLat} ms`;
  $("#racestate").textContent = race.running ? `${race.t.toFixed(1)}s` : "";
  $("#drivers").innerHTML = cars.map((c) => {
    const d = c.dec, pr = d.probs, bar = (v) => `<span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span>`;
    const choiceRows = (k, obj) => obj ? Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([o, p]) => `<div class="dec ${o === d[k] ? "" : "dim"}"><span class="k">${k === "line" ? "line" : "pace"}: ${o}</span>${bar(p)}<span class="v">${p.toFixed(2)}</span></div>`).join("") : "";
    const noulRow = (k, v, on) => v == null ? "" : `<div class="dec ${on ? "" : "dim"}"><span class="k">${k}${on ? " ✓" : ""}</span>${bar(v)}<span class="v">${v.toFixed(2)}</span></div>`;
    return `<div class="card" data-i="${c.i}" style="--c:${c.color};cursor:pointer;${selected === c ? "outline:1px solid #fff" : ""}"><h3>${c.name} <span class="stats">${c.thinking ? "thinking…" : ""} conf line ${(d.conf.line ?? 0).toFixed(2)} · pace ${(d.conf.pace ?? 0).toFixed(2)}</span></h3><div class="traits">${c.traits}</div>
      ${choiceRows("line", pr.line)}${choiceRows("pace", pr.pace)}${noulRow("overtake", pr.overtake, d.overtake)}${noulRow("boost", pr.boost, d.boost)}${noulRow("shortcut", pr.shortcut, d.shortcut)}</div>`;
  }).join("");
  document.querySelectorAll("#drivers .card").forEach((el) => el.addEventListener("click", () => { selected = cars[Number(el.dataset.i)]; $("#raw").textContent = JSON.stringify({ request: selected.lastReq, response: selected.lastRes }, null, 2); renderSide(); }));
}
const logs = [];
function log(m) { logs.unshift(`<div><b>${race.t.toFixed(1)}s</b> ${m}</div>`); if (logs.length > 60) logs.pop(); $("#log").innerHTML = logs.join(""); }

// ---------- loop & init ----------
let last = 0, paused = false;
function frame(t) { const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; if (race.running && !paused) step(dt); draw(); requestAnimationFrame(frame); }
async function init() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  const live = Object.entries(cfg.providers).find(([k, p]) => k !== "mock" && p.hasKey);
  const ps = $("#provider"); ps.innerHTML = Object.entries(cfg.providers).map(([k, p]) => `<option value="${k}" ${p.hasKey ? "" : "disabled"}>${p.label}</option>`).join(""); ps.value = live ? live[0] : "mock";
  const ms = $("#model"); const fill = () => { ms.innerHTML = cfg.providers[ps.value].models.map((m) => `<option>${m}</option>`).join(""); }; fill(); ps.addEventListener("change", fill);
  $("#start").addEventListener("click", () => { race = { running: true, laps: Number($("#laps").value), t: 0, finished: [], reqs: 0, tokens: 0, cost: 0, latency: [] }; logs.length = 0; resetCars(); paused = false; log("Lights out!"); renderSide(); });
  $("#pause").addEventListener("click", () => { paused = !paused; $("#pause").textContent = paused ? "Resume" : "Pause"; });
  resetCars(); renderSide(); requestAnimationFrame(frame);
}
init();
