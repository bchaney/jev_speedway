// Jev Speedway: code drives, Jev judges.
import { PRICE_PER_MTOK } from "/lib/jev.mjs";
import { QUESTIONS, speak } from "/world.mjs";
const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const bucket = (v, arr) => { for (const [lim, name] of arr) if (v < lim) return name; return arr[arr.length - 1][1]; };
// Units: the track, the cars and everything Jev is told are in metres, seconds and m/s; only drawing converts to canvas pixels.
// The control points below are canvas layout (pixels), converted once when the track is built.
const M_PER_PX = 0.25, PX_PER_M = 1 / M_PER_PX, px = (m) => m * PX_PER_M; // the 1100 x 720 canvas is 275 m x 180 m; a lap is roughly 550-650 m
const KMH = 3.6; // m/s to km/h, the unit speeds are spoken in (to Jev and on the standings)

// ---------- track: closed Catmull-Rom spline through control points ----------
// Circuit of the Americas, traced by eye from the map (not survey data): the uphill T1 hairpin top-left, the esses across the
// top, the T11 hairpin at the far right, the diagonal back straight, the T12 stadium loop and the T16-18 horseshoe along the bottom.
const COTA_CP = [[200,650],[150,400],[140,180],[170,90],[250,100],[330,160],[410,110],[490,170],[570,120],[650,170],[740,120],[840,150],[930,200],[990,280],[950,340],[850,370],[700,410],[550,450],[420,490],[350,510],[330,570],[400,600],[460,560],[540,540],[660,530],[760,560],[800,630],[740,680],[600,690],[450,690],[300,680]];
const DEFAULT_CP = [[150,360],[200,180],[400,110],[650,120],[850,170],[980,320],[900,470],[760,520],[620,470],[540,360],[430,430],[330,600],[200,600],[130,500]];
const SEG_N = 40;
let pts = []; // {x,y,s,kappa}: metres and 1/m
let L = 0, FEATURES = []; // FEATURES: the lap as named corners and straights, in lap order (classifyTrack)
function buildTrack(CP) {
  pts = [];
  for (let i = 0; i < CP.length; i++) {
    const p0 = CP[(i - 1 + CP.length) % CP.length], p1 = CP[i], p2 = CP[(i + 1) % CP.length], p3 = CP[(i + 2) % CP.length];
    for (let j = 0; j < SEG_N; j++) {
      const t = j / SEG_N, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      pts.push({ x: x * M_PER_PX, y: y * M_PER_PX });
    }
  }
  L = 0;
  for (let i = 0; i < pts.length; i++) { pts[i].s = L; const n = pts[(i + 1) % pts.length]; L += Math.hypot(n.x - pts[i].x, n.y - pts[i].y); }
  for (let i = 0; i < pts.length; i++) { // signed curvature via heading change
    const a = pts[(i - 3 + pts.length) % pts.length], b = pts[i], c = pts[(i + 3) % pts.length];
    const h1 = Math.atan2(b.y - a.y, b.x - a.x), h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    pts[i].kappa = d / (Math.hypot(c.x - a.x, c.y - a.y) || 1);
  }
  classifyTrack();
}
// ---------- track vocabulary ----------
// The lap as a sequence of named features, the way a driver or a circuit designer talks about it. Corners are graded by the speed
// the grip allows through them (kink, fast sweeper, medium corner, tight corner, hairpin), straights by length, and quick left-right
// combinations are grouped into chicanes and esses. Corners are numbered T1, T2… from the start line, as on a real circuit.
const K_IN = 0.016, K_OUT = 0.01; // 1/m (a corner begins tighter than a 62 m radius and ends looser than 100 m): hysteresis, so a wobble in the spline's curvature does not split one corner into two
const isCorner = (f) => f.kind === "corner" || f.kind === "chicane" || f.kind === "esses";
function classifyTrack() {
  const n = pts.length, sAt = (i) => pts[i % n].s + Math.floor(i / n) * L;
  let start = pts.findIndex((p) => Math.abs(p.kappa) < K_OUT); if (start < 0) start = 0; // begin on a straight so no corner is cut in two
  let runs = [], cur = null; // raw runs of one-directional curvature: {sign, i0, i1, peak}
  for (let j = 0; j <= n; j++) {
    const i = start + j, kk = pts[i % n].kappa, a = Math.abs(kk);
    if (cur && (a < K_OUT || (a > K_IN && Math.sign(kk) !== cur.sign) || j === n)) { cur.i1 = i; runs.push(cur); cur = null; }
    if (!cur && a > K_IN && j < n) cur = { sign: Math.sign(kk), i0: i, peak: 0 };
    if (cur) cur.peak = Math.max(cur.peak, a);
  }
  runs = runs.map((r) => ({ ...r, s0: sAt(r.i0), s1: sAt(r.i1) })).filter((r) => r.s1 - r.s0 > 5);
  const merged = []; // same direction with hardly any straight between: one double-apex corner
  for (const r of runs) { const p = merged[merged.length - 1]; if (p && p.sign === r.sign && r.s0 - p.s1 < 7.5) { p.s1 = r.s1; p.peak = Math.max(p.peak, r.peak); p.apexes++; } else merged.push({ ...r, apexes: 1 }); }
  const groups = []; // quick alternating flicks: two make a chicane, three or more make esses
  for (const r of merged) { const g = groups[groups.length - 1], last = g?.[g.length - 1]; if (last && last.sign !== r.sign && r.s0 - last.s1 < 15 && r.s1 - r.s0 < 35 && last.s1 - last.s0 < 35) g.push(r); else groups.push([r]); }
  const grade = (r) => {
    const lim = Math.sqrt(GRIP / r.peak), len = r.s1 - r.s0;
    const g = lim >= V_TOP ? (len < 30 ? "kink" : "gentle bend") : lim >= 27.5 ? "fast sweeper" : lim >= 20 ? "medium corner" : lim >= 15 ? "tight corner" : "hairpin";
    return { limit: Math.min(lim, V_TOP), grade: (r.apexes > 1 ? "double-apex " : len > 55 && lim < V_TOP ? "long " : "") + g };
  };
  const feats = []; let t = 0;
  for (const g of groups.sort((a, b) => (a[0].s0 % L) - (b[0].s0 % L))) {
    const first = t + 1; t += g.length;
    const s0 = g[0].s0 % L, len = g[g.length - 1].s1 - g[0].s0, limit = Math.min(...g.map((r) => grade(r).limit));
    const name = g.length === 1 ? `T${first} ${grade(g[0]).grade}` : `T${first}-T${t} ${limit < 80 ? "tight " : limit >= 110 ? "fast " : ""}${g.length === 2 ? "chicane" : "esses"}`;
    const dir = g.map((r) => (r.sign > 0 ? "right" : "left")).join(" then "); // positive curvature is a right-hander on screen
    feats.push({ kind: g.length === 1 ? "corner" : g.length === 2 ? "chicane" : "esses", name, s0, s1: s0 + len, mid: s0 + len / 2, len, limit, turns: g.length, dir });
  }
  const straights = []; // whatever lies between corners, if it is long enough to be worth a name
  for (let i = 0; i < feats.length; i++) {
    const a = feats[i], b = feats[(i + 1) % feats.length], s0 = a.s1 % L, len = ((b.s0 - a.s1) % L + L) % L;
    if (len >= 22.5) straights.push({ kind: "straight", s0, s1: s0 + len, mid: s0 + len / 2, len, limit: V_TOP });
  }
  if (!feats.length) straights.push({ kind: "straight", s0: 0, s1: L, mid: L / 2, len: L, limit: V_TOP });
  const home = straights.find((f) => ((0 - f.s0) % L + L) % L < f.len) ?? straights.find((f) => f.s0 < 37.5); // the one the start line sits on, or begins just after it
  const back = straights.filter((f) => f !== home).sort((a, b) => b.len - a.len)[0];
  for (const f of straights) f.name = f === home ? "start/finish straight" : f === back && f.len >= 55 ? "back straight" : bucket(f.len, [[55, "short straight"], [112.5, "straight"], [1e9, "long straight"]]);
  FEATURES = [...feats, ...straights].sort((a, b) => a.s0 - b.s0);
}
// Random circuit in the F1 idiom: a loop of "sectors" around the canvas centre, each one a straight, a sweeper, a chicane or a
// hairpin that notches deep toward the middle. Points are placed by angle and radius, so the loop stays star-shaped and never
// crosses itself; trackOk() then rejects layouts where the spline's arms come too close for the road width.
const RX = 480, RY = 300; // canvas px, like the presets' control points
const polar = (a, r) => [550 + Math.cos(a) * RX * r, 370 + Math.sin(a) * RY * r];
function randomCP() {
  const n = 7 + Math.floor(Math.random() * 3), cp = [];
  const kinds = []; // at least one straight and one hairpin, never two hairpins in a row
  for (let i = 0; i < n; i++) kinds.push(["straight", "sweeper", "chicane", "hairpin", "sweeper", "straight"][Math.floor(Math.random() * 6)]);
  if (!kinds.includes("straight")) kinds[0] = "straight";
  if (!kinds.includes("hairpin")) kinds[Math.floor(n / 2)] = "hairpin";
  for (let i = 0; i < n; i++) if (kinds[i] === "hairpin" && kinds[(i + 1) % n] === "hairpin") kinds[(i + 1) % n] = "sweeper";
  const step = Math.PI * 2 / n, ring = 0.86 + Math.random() * 0.1; // one shared ring radius so sectors join tangentially
  for (let i = 0; i < n; i++) {
    const a0 = i * step, a1 = (i + 1) * step, r = ring + (Math.random() - 0.5) * 0.06;
    switch (kinds[i]) {
      case "straight": { const A = polar(a0, r), B = polar(a1, r); for (const t of [0, 0.35, 0.7]) cp.push([lerp(A[0], B[0], t), lerp(A[1], B[1], t)]); break; } // collinear points keep the spline straight
      case "sweeper": cp.push(polar(a0 + step * 0.3, r)); break;
      case "chicane": { const b = a0 + step * 0.15, w = step * 0.25; cp.push(polar(b, r), polar(b + w, r - 0.07), polar(b + 2 * w, r + 0.01)); break; } // flick in, flick out
      case "hairpin": { // deep notch toward the centre, built as a U: two parallel arms and two tip points that set the U's radius
        const tipA = a0 + step * 0.45, tipR = 0.3 + Math.random() * 0.2, T = polar(tipA, tipR), O = polar(tipA, r), rad = 38 + Math.random() * 25;
        const nx = -Math.sin(tipA) * RY, ny = Math.cos(tipA) * RX, nl = Math.hypot(nx, ny); // perpendicular to the notch, in canvas units
        const arm = (side, t) => [lerp(T[0], O[0], t) + nx / nl * rad * side, lerp(T[1], O[1], t) + ny / nl * rad * side];
        const shoulder = (side) => polar(tipA + side * step * 0.38, r); // on the ring, so the turn into and out of the arm is a rounded 90°
        cp.push(shoulder(-1), arm(-1, 0.7), arm(-1, 0.3), arm(-1, 0), arm(1, 0), arm(1, 0.3), arm(1, 0.7), shoulder(1)); break;
      }
    }
  }
  return cp;
}
function trackOk() { // fits the canvas, not absurdly sharp (no radius under 5 m), and no two separate stretches of road overlap
  if (L < 550 || Math.max(...pts.map((p) => Math.abs(p.kappa))) > 0.2) return false;
  const [x0, x1, y0, y1] = [45, 1055, 45, 675].map((v) => v * M_PER_PX); // a margin inside the canvas
  if (pts.some((p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1)) return false;
  const stride = 4;
  for (let i = 0; i < pts.length; i += stride) for (let j = i + stride; j < pts.length; j += stride) {
    const along = Math.min(pts[j].s - pts[i].s, L - (pts[j].s - pts[i].s));
    if (along > WIDTH * 2.5 && Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < WIDTH + 6) return false;
  }
  return true;
}
const snapshotTrack = () => ({ pts, L, FEATURES });
function setTrack(t) { ({ pts, L, FEATURES } = t); }
function randomTrack() {
  for (let tries = 0; tries < 60; tries++) { buildTrack(randomCP()); if (trackOk()) return snapshotTrack(); }
  buildTrack(DEFAULT_CP); return snapshotTrack();
}
function describeTrack(t) { // words only, the way Jev likes its state
  setTrack(t);
  const corners = FEATURES.filter(isCorner), straights = FEATURES.filter((f) => f.kind === "straight");
  const tight = [...corners].sort((a, b) => a.limit - b.limit)[0], long = [...straights].sort((a, b) => b.len - a.len)[0];
  const from0 = (f) => (((0 - f.s0) % L + L) % L < f.len ? 0 : ((f.s0 % L) + L) % L); // lap order, starting at the start line
  return {
    length: bucket(L, [[500, "short lap"], [575, "medium lap"], [1e9, "long lap"]]),
    corners: `${corners.reduce((a, f) => a + f.turns, 0)} corners`,
    lap: [...FEATURES].sort((a, b) => from0(a) - from0(b)).map((f) => f.name).join(", "),
    tightest_corner: tight ? `${tight.name}: ${entryWords(tight)}` : "no real corners",
    longest_straight: long ? `${long.name}, ${bucket(long.len, [[55, "short"], [112.5, "a decent length"], [1e9, "very long"]])}` : "no real straight",
  };
}
const PRESETS = { original: () => buildTrack(DEFAULT_CP), cota: () => buildTrack(COTA_CP) };
let trackDesign = null; // last request/response from asking Jev to pick a layout
async function designTrack() { // code drafts, Jev judges: several random circuits, one Choice question
  const keys = ["A", "B", "C", "D", "E"], drafts = keys.map(randomTrack);
  const state = { drivers: DRIVERS.map((d) => ({ name: d.name, traits: d.traits })), race: `${$("#laps").value} laps`, layouts: Object.fromEntries(drafts.map((t, i) => [keys[i], describeTrack(t)])) };
  const questions = { layout: { type: "choice", instructions: "Which of `layouts` will give `drivers` the most exciting `race`: real rewards for the risk-takers on the boost and the overtakes, a way for the careful drivers to win on consistency, and not so brutal that everyone spins?", criteria: Object.fromEntries(keys.map((k) => [k, `Layout ${k}, described in \`layouts.${k}\``])) } };
  const body = { model: $("#model").value, state, questions };
  let pick = keys[Math.floor(Math.random() * keys.length)], note = "picked at random (Jev unavailable)";
  try {
    const r = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: $("#provider").value, body }) }).then((x) => x.json());
    trackDesign = { request: body, response: r.response };
    const a = r.response?.answers?.layout;
    if (a?.choice) { pick = a.choice; note = `Jev picks it at ${a.probabilities[pick].toFixed(2)} (confidence ${a.confidence.toFixed(2)}) in ${r.latencyMs} ms`; } else note += ` ${JSON.stringify(r.response).slice(0, 100)}`;
  } catch (e) { note += ` ${e.message}`; }
  setTrack(drafts[keys.indexOf(pick)]);
  const d = state.layouts[pick];
  return `Layout ${pick}: ${d.length}, ${d.corners}, tightest ${d.tightest_corner}; lap: ${d.lap}. ${note}`;
}
const WIDTH = 13.5; // road width, m
function at(s) { // spline points are unevenly spaced, so look the index up by accumulated arc length
  s = ((s % L) + L) % L; let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].s <= s) lo = mid; else hi = mid - 1; }
  const p = pts[lo], n = pts[(lo + 1) % pts.length]; const h = Math.atan2(n.y - p.y, n.x - p.x); return { x: p.x, y: p.y, h, kappa: p.kappa };
}
function pos(s, lat) { const p = at(s); return { x: p.x + Math.cos(p.h + Math.PI / 2) * lat * WIDTH * 0.42, y: p.y + Math.sin(p.h + Math.PI / 2) * lat * WIDTH * 0.42, h: p.h }; }
// features (by track distance)
const V_TOP = 37.5, GRIP = 30, ACCEL = 16, BRAKE = 40, CRAWL = 10, DRAFT_RANGE = 22.5, STEER_RATE = 2; // m/s, m/s² and m; top speed is 135 km/h. CRAWL: slower than any corner needs, and as slow as braking or coasting will take a car. GRIP (lateral, about 3 g) sized so a hairpin limits to ~19 m/s and the sweepers to 25-37
// Lateral offset changes the real path: the inside of a corner is shorter but tighter, the outside longer but more forgiving.
// Positive kappa is a right-hand turn on screen; positive lat is the right-hand side of the road.
function pathAt(s, lat) { const k = at(s).kappa; const denom = clamp(1 - k * lat * WIDTH * 0.42, 0.6, 1.4); return { kappa: k / denom, progress: 1 / denom }; }
function nextCorner(sm) { // the nearest corner ahead (or the one the car is in), which is what a line is chosen for
  let best = null, bd = Infinity;
  for (const f of FEATURES) { if (!isCorner(f)) continue; const into = ((sm - f.s0) % L + L) % L, d = into < f.len ? 0 : ((f.s0 - sm) % L + L) % L; if (d < bd) { bd = d; best = f; } }
  return best;
}
function nextTurn(sm) { const f = nextCorner(sm); return f && f.dir.startsWith("left") ? -1 : 1; } // +1 right-hander, -1 left-hander
function speedNeed(c, sm) { // what sets the speed right now: the corner the car is still in, otherwise the next feature
  const here = featureAt(sm), f = here && isCorner(here) ? here : nextFeature(sm);
  return { f, here: f === here, dist: f === here ? 0 : f.dist, limit: pathLimit(f, c.lat) };
}
function pathLimit(f, lat) { // slowest point of a feature along the car's actual path, which the inside of the road makes tighter
  let m = Infinity; for (let i = 0; i <= 8; i++) m = Math.min(m, cornerLimit(f.s0 + f.len * i / 8, lat)); return Math.min(V_TOP, m);
}
function cornerLimit(s, lat = 0) { return Math.sqrt(GRIP / Math.max(Math.abs(pathAt(s, lat).kappa), 1e-4)); } // physical grip limit, uncapped
function vmax(s, lat = 0) { return Math.min(V_TOP, cornerLimit(s, lat)); }
buildTrack(DEFAULT_CP);
function nextFeature(s) { // nearest upcoming feature; a feature still counts as upcoming until the car is past its midpoint
  let bestD = Infinity, best = -1;
  FEATURES.forEach((f, i) => {
    const into = ((s - f.s0) % L + L) % L, d = into < f.len / 2 ? 0 : ((f.s0 - s) % L + L) % L;
    if (d < bestD) { bestD = d; best = i; }
  });
  const f = FEATURES[best], ahead = (g) => ((g.s0 - f.mid) % L + L) % L; // the track feature that begins soonest after this one's midpoint
  const after = FEATURES.reduce((a, g) => (ahead(g) < ahead(a) ? g : a));
  return { ...f, dist: bestD, then: after.name, entry: entryWords(f) };
}
function featureAt(s) { return FEATURES.find((f) => ((s - f.s0) % L + L) % L < f.len); } // the feature the car is in right now, if any

// ---------- drivers ----------
const DRIVERS = [
  { name: "Blaze", color: "#f97316", traits: "reckless, loves the boost, hates being behind", grid: 4 }, // starts last, so "hates being behind" bites from lap one
  { name: "Vera", color: "#22c55e", traits: "calm and calculating, brakes early, only passes when it is safe" },
  { name: "Rook", color: "#3b82f6", traits: "aggressive defender, blocks rivals, takes risks only when losing" },
  { name: "Pip", color: "#e879f9", traits: "nervous rookie, avoids contact, cautious into corners, brave on straights" },
];
const cars = [];
const newRace = (running) => ({ running, laps: Number($("#laps").value) || 3, t: 0, finished: [], reqs: 0, tokens: 0, cost: 0, latency: [] });
let race = newRace(false);

function gridOrder() { // drivers with a grid number take that slot; the rest fill the remaining slots in list order
  const slots = new Array(DRIVERS.length).fill(null);
  for (const d of DRIVERS) if (d.grid) slots[d.grid - 1] = d;
  let k = 0; for (const d of DRIVERS) if (!d.grid) { while (slots[k]) k++; slots[k] = d; }
  return slots;
}
function resetCars() {
  cars.length = 0; const grid = gridOrder();
  DRIVERS.forEach((d, i) => cars.push({
    ...d, i, s: -7.5 - grid.indexOf(d) * 7, lat: grid.indexOf(d) % 2 ? 0.6 : -0.6, v: 0, lap: 0, spin: 0, boostAvail: true, boostT: 0, tow: 0, towing: null, slingT: 0, done: false, finishT: null,
    dec: { line: "middle", pace: "steady", overtake: false, boost: false, conf: {}, probs: {} }, steer: 0, thinking: false, nextThink: i * 0.2, lastReq: null, lastRes: null, contact: null,
  }));
  buildCards();
}

// ---------- physics (code owns the car) ----------
function advance(c, ds) { // move along the track; laps are counted here so spins across the line still count
  const before = Math.floor(c.s / L);
  c.s += ds;
  if (before >= 0 && Math.floor(c.s / L) > before) { // before >= 0: the grid sits behind the line, the first crossing is not a lap
    c.lap++; c.boostAvail = true;
    if (c.lap >= race.laps && !c.done) { c.done = true; c.finishT = race.t; race.finished.push(c.name); log(`🏁 ${c.name} finishes P${race.finished.length}`); }
    else if (!c.done) log(`${c.name} completes lap ${c.lap}`);
  }
}
function step(dt) {
  race.t += dt;
  const order = ranking();
  for (const c of cars) {
    c.braking = false;
    if (c.done) { c.v = lerp(c.v, 15, dt); advance(c, c.v * dt); continue; }
    if (c.spin > 0) { c.spin -= dt; c.v = lerp(c.v, 0, dt * 2); advance(c, c.v * dt); continue; }
    const sm = ((c.s % L) + L) % L;
    const look = 10 + c.v * 0.55; // m, a little beyond the braking distance from top speed
    // drafting: tucked in close behind a car on the same part of the road at speed, the air is easier, so the ceiling rises and a charge builds.
    // Pulling out of the tow (or Jev calling the pass) releases it as a slingshot: a short burst and a move to the other side of the car ahead.
    let tow = null, towF = 0;
    for (const o of cars) if (o !== c && !o.done) { const gap = ((o.s - c.s) % L + L) % L; if (gap > 0 && gap < DRAFT_RANGE && Math.abs(o.lat - c.lat) < 0.5 && c.v > 20) { const f = 1 - gap / DRAFT_RANGE; if (f > towF) { towF = f; tow = o; } } }
    const armed = c.tow >= 0.5;
    if (tow) c.tow = Math.min(1, c.tow + dt / 1.5); else c.tow = Math.max(0, c.tow - dt);
    if (armed && c.slingT <= 0 && ((c.towing && !tow) || (tow && c.dec.overtake))) { c.slingT = 0.9 * c.tow; c.slingFrom = tow ?? c.towing; c.tow = 0; log(`${c.name} slingshots out of ${c.slingFrom.name}'s tow`); }
    c.towing = tow;
    if (c.slingT > 0) c.slingT -= dt;
    // Jev picks the line and the pace; the code does the driving. Line: inside, middle or outside of the next corner, steered to at
    // up to STEER_RATE. Pace: how close to the grip limit the code drives, braking for corners in time (attack brakes late and
    // carries speed past the limit, which is faster if it sticks and a spin if it does not).
    const turn = nextTurn(sm); // +1 the next corner is a right-hander, -1 a left-hander
    // an overtake call pulls the car out to the open side of the rival directly ahead; a slingshot does the same with a burst
    let blocker = null, bg = Infinity; for (const o of cars) if (o !== c && !o.done) { let gap = ((o.s - c.s) % L + L) % L; if (gap > L / 2) gap -= L; if (gap > -CAR_LEN && gap < 20 && gap < bg) { blocker = o; bg = gap; } } // ahead or alongside: the move is held until the car is clear past
    const passing = (c.slingT > 0 && c.slingFrom && !c.slingFrom.done && ((c.slingFrom.s - c.s) % L + L) % L < 15) ? c.slingFrom : (c.dec.overtake && blocker);
    const latT = passing ? -Math.sign(passing.lat || -c.lat || 1) * 0.85 : ({ inside: 0.85 * turn, middle: 0, outside: -0.85 * turn }[c.dec.line] ?? 0);
    c.steer = clamp((latT - c.lat) * 3, -1, 1); // wheel angle the code applies to get there, shown on the instruments
    c.lat = clamp(c.lat + c.steer * STEER_RATE * dt, -1, 1);
    const paceF = { attack: 1.15, steady: 0.95, cautious: 0.84 }[c.dec.pace] ?? 0.95; // steady sits just inside the grip tolerance, attack well past it
    const mult = c.slingT > 0 ? 1.18 : 1 + 0.1 * towF; // the tow and the slingshot raise the ceiling
    let target = V_TOP * mult;
    for (let d = 0; d < look; d += 1.25) { const v = Math.min(V_TOP * mult, cornerLimit(sm + d, c.lat)) * paceF; target = Math.min(target, Math.sqrt(v * v + 2 * BRAKE * d)); } // fastest speed now that can still brake to v by d
    target = Math.max(CRAWL, target);
    if (c.dec.overtake) target *= 1.06;
    if (c.dec.boost && c.boostAvail) { c.boostAvail = false; c.dec.boost = false; c.boostT = 1.4; log(`${c.name} hits the boost`); } // consume the decision so a new lap needs a fresh call
    if (c.boostT > 0) { c.boostT -= dt; target = V_TOP * 1.25; } // the driver's own boost ignores the corner cap: boosting into a corner is the risk Jev is asked about
    // blocking: a car directly ahead on the same part of the road caps speed
    c.heldBy = null; for (const o of cars) if (o !== c && !o.done) { const gap = ((o.s - c.s) % L + L) % L; if (gap > 0 && gap < 7 && Math.abs(o.lat - c.lat) < 0.5 && o.v * 1.0 < target) { c.heldBy = o; target = Math.min(target, o.v * (c.dec.overtake ? 1.0 : 0.95)); } }
    // accelerate / brake
    const accel = ACCEL * (c.boostT > 0 ? 2 : c.slingT > 0 ? 1.6 : 1 + 0.5 * towF);
    c.braking = c.v > target + 0.25; c.throttle = c.braking ? 0 : 1; // holding the cap still counts as on the throttle
    if (c.v < target) c.v = Math.min(target, c.v + accel * dt); else c.v = Math.max(target, c.v - BRAKE * dt);
    // grip check: over the limit of the actual path is a risk that grows with the overshoot, not a certainty; straights never spin
    const over = c.v / (cornerLimit(sm, c.lat) * 1.05) - 1; // 5% tolerance so a steady car at the limit is safe; attack (12% over) is not
    if (over > 0 && Math.random() < over * dt * 8) { c.spin = 1.2; c.v *= 0.35; { const f = featureAt(sm) ?? nextFeature(sm); log(`${c.name} spins out ${f.kind === "straight" ? "on" : "in"} ${f.name}!`); } }
    advance(c, c.v * dt * pathAt(sm, c.lat).progress); // inside line covers centreline distance faster
    // think
    c.nextThink -= dt;
    if (c.nextThink <= 0 && !c.thinking) { c.nextThink = Number($("#tick").value) / 1000; think(c, order); }
  }
  collide();
  if (cars.every((c) => c.done) && race.running) { race.running = false; log("Race over."); }
}
// ---------- contact ----------
// Cars are 6 m long and 3.25 m wide for contact (drawn a touch smaller). Two racing cars on the same bit of road are pushed apart: nose to tail along the track,
// with the faster car handing speed to the one it hits; alongside, sideways off their lines. A hard hit can spin the car that took it.
const CAR_LEN = 6, CAR_W = 3.25, LAT_M = WIDTH * 0.42; // LAT_M: metres of road per unit of lat
const lastBump = new Map(); // pair -> race time, so one scrape does not fill the log
function collide() {
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j]; if (a.done || b.done) continue;
    let g = ((b.s - a.s) % L + L) % L; if (g > L / 2) g -= L; // signed gap, positive when b is ahead
    const dl = (b.lat - a.lat) * LAT_M;
    if (Math.abs(g) >= CAR_LEN || Math.abs(dl) >= CAR_W) continue;
    const [back, front] = g > 0 ? [a, b] : [b, a], gap = Math.abs(g);
    let hard, kind, victim;
    if (gap > CAR_W) { // nose to tail: separate along the track and trade speed
      const push = (CAR_LEN - gap) / 2; back.s -= push; front.s += push;
      const dv = Math.max(0, back.v - front.v); front.v += dv * 0.6; back.v -= dv * 0.6;
      hard = dv; kind = "rear-ended"; victim = front;
    } else { // alongside: shove apart sideways, the faster car holds its line better
      const dir = Math.sign(dl) || (Math.random() < 0.5 ? 1 : -1), push = (CAR_W - Math.abs(dl)) / LAT_M;
      const wa = b.v / (a.v + b.v + 1e-6); a.lat = clamp(a.lat - dir * push * wa, -1, 1); b.lat = clamp(b.lat + dir * push * (1 - wa), -1, 1);
      hard = 2 + Math.abs(a.v - b.v) * 0.5; kind = "side by side with"; victim = a.v < b.v ? a : b;
    }
    const other = (c) => (c === a ? b : a);
    for (const c of [a, b]) c.contact = { with: other(c).name, t: race.t, kind: c === back ? (kind === "rear-ended" ? "ran into the back of" : kind) : (kind === "rear-ended" ? "was hit from behind by" : kind) };
    const key = `${a.name}|${b.name}`;
    if (hard > 3 && (lastBump.get(key) ?? -9) < race.t - 1.5) {
      lastBump.set(key, race.t);
      log(`${back.name} ${kind === "rear-ended" ? "runs into the back of" : "rubs wheels with"} ${front.name}`);
      const p = clamp((hard - 7.5) / 20, 0, 0.6); // hard is a closing speed in m/s: a firm hit is a scare, a hard one can spin the car that took it
      if (victim.spin <= 0 && Math.random() < p) { victim.spin = 1.2; victim.v *= 0.35; log(`💥 ${victim.name} is spun round by the contact!`); }
    }
  }
}
function ranking() { return [...cars].sort((a, b) => (a.finishT ?? Infinity) - (b.finishT ?? Infinity) || b.s - a.s); } // s already accumulates across laps

const entryWords = (f) => speak("track_ahead.entry", { f, vtop: V_TOP });
const NEAR = 35; // m: how far away a rival still counts as nearby (world.mjs says the same number in words)
const wheelWords = (s) => (Math.abs(s) < 0.1 ? "centred" : `${Math.round(s * 90)}° ${s < 0 ? "left" : "right"}`);

function buildState(c, order) {
  const sm = ((c.s % L) + L) % L, p = order.indexOf(c) + 1, f = nextFeature(sm), n = speedNeed(c, sm);
  const need = Math.max(0, (c.v * c.v - n.limit * n.limit) / (2 * BRAKE)); // road needed to slow to what the road needs, at full braking
  const x = { c, sm, p, f, n, need, corner: nextCorner(sm), gripLimit: cornerLimit(sm, c.lat), vtop: V_TOP, cars, race, trace: {} };
  const gapTo = (o) => o ? (((o.s - c.s) % L + L) % L) : null;
  let ahead = null, behind = null;
  for (const o of cars) if (o !== c && !o.done) { const g = gapTo(o); const gBehind = ((c.s - o.s) % L + L) % L; if (g < NEAR && (!ahead || g < gapTo(ahead))) ahead = o; if (gBehind < NEAR && (!behind || gBehind < ((c.s - behind.s) % L + L) % L)) behind = o; }
  const rival = (o, g, which) => { // phrases for one rival, traced under rivals.ahead.* or rivals.behind.*
    const r = { ...x, o, g, which }, t = (k) => `rivals.${which}.${k.split(".").pop()}`;
    if (!o) return speak("rivals.*", r, t("rivals.*.self"));
    speak("rivals.*", r, t("rivals.*.self"));
    return { name: o.name, gap: speak("rivals.*.gap", r, t("gap")), road_position: speak("rivals.*.road_position", r, t("road_position")), ...(which === "ahead" ? { pace: speak("rivals.ahead.pace", r) } : {}), status: speak("rivals.*.status", r, t("status")) };
  };
  const state = {
    driver: { name: c.name, traits: c.traits, position: speak("driver.position", x), lap: speak("driver.lap", x), boost: speak("driver.boost", x), status: speak("driver.status", x) },
    car: { speed: speak("car.speed", x), situation: speak("car.situation", x), road_position: speak("car.road_position", x), current: speak("car.current", x), grip: speak("car.grip", x), contact: speak("car.contact", x), tow: speak("car.tow", x) },
    track_ahead: { next: speak("track_ahead.next", x), distance: speak("track_ahead.distance", x), entry: speak("track_ahead.entry", x), after_that: speak("track_ahead.after_that", x), note: speak("track_ahead.note", x) },
    rivals: { ahead: rival(ahead, ahead ? gapTo(ahead) : 0, "ahead"), behind: rival(behind, behind ? ((c.s - behind.s) % L + L) % L : 0, "behind") },
  };
  c.lastTrace = x.trace; // which case fired for each field, for the World view panel
  return state;
}
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
      if (a.line.confidence >= 0.35) d.line = a.line.choice; // low confidence: hesitate, keep the line
      d.pace = a.pace.confidence >= 0.35 ? a.pace.choice : "steady";
      d.overtake = a.overtake.noul > 0.5; d.boost = a.boost.noul > 0.7;
      d.conf = { line: a.line.confidence, pace: a.pace.confidence }; d.probs = { line: a.line.probabilities, pace: a.pace.probabilities, overtake: a.overtake.noul, boost: a.boost.noul };
    } else log(`${c.name}: request failed (${r.status}) ${JSON.stringify(r.response).slice(0, 120)}`);
  } catch (e) { log(`${c.name}: ${e.message}`); }
  c.thinking = false;
  renderSide();
  if (selected === c) renderDebug();
}

// ---------- render ----------
const cv = $("#c"), ctx = cv.getContext("2d");
function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  // track ribbon
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "#1c2233"; ctx.lineWidth = px(WIDTH) + 10; tracePath(); ctx.stroke();
  ctx.strokeStyle = "#2a3247"; ctx.lineWidth = px(WIDTH); tracePath(); ctx.stroke();
  for (const f of FEATURES) { // name every feature, pushed off the road: to the outside of a corner, away from the middle for a straight
    const p = at(f.mid), X = px(p.x), Y = px(p.y), nx = Math.cos(p.h + Math.PI / 2), ny = Math.sin(p.h + Math.PI / 2);
    const out = Math.sign(nx * (X - cv.width / 2) + ny * (Y - cv.height / 2)) || 1, side = isCorner(f) ? -Math.sign(p.kappa) || 1 : out, off = px(WIDTH) / 2 + 14;
    const dx = nx * side, align = dx > 0.4 ? "left" : dx < -0.4 ? "right" : "center"; // anchor the text on the side away from the road
    label(f.name, X + dx * off, Y + ny * side * off + 4, isCorner(f) ? "#8a93a6" : "#5d6780", align);
  }
  if (race.running || race.finished.length) { ctx.fillStyle = "#e8eaf0"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "left"; ctx.fillText(race.running ? `LAP ${currentLap()} / ${race.laps}` : "FINISH", 18, 34); }
  // start line
  const s0 = at(0), hw = px(WIDTH) / 2; ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px(s0.x) + Math.cos(s0.h + Math.PI / 2) * hw, px(s0.y) + Math.sin(s0.h + Math.PI / 2) * hw); ctx.lineTo(px(s0.x) - Math.cos(s0.h + Math.PI / 2) * hw, px(s0.y) - Math.sin(s0.h + Math.PI / 2) * hw); ctx.stroke();
  // cars
  for (const c of cars) {
    const p = pos(c.s, c.lat), X = px(p.x), Y = px(p.y);
    ctx.save(); ctx.translate(X, Y); ctx.rotate(p.h); if (c.spin > 0) ctx.rotate(c.spin * 9);
    if (c.boostT > 0) { ctx.fillStyle = "rgba(250,204,21,.8)"; ctx.fillRect(-22, -4, 10, 8); }
    if (c.slingT > 0) { ctx.fillStyle = "rgba(56,189,248,.8)"; ctx.fillRect(-34, -3, 22, 6); } else if (c.towing) { ctx.fillStyle = `rgba(56,189,248,${(0.25 + 0.5 * c.tow).toFixed(2)})`; ctx.fillRect(-20, -2, 8, 4); }
    if (c.contact && race.t - c.contact.t < 0.3) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.globalAlpha = 1 - (race.t - c.contact.t) / 0.3; ctx.strokeRect(-14, -9, 28, 18); ctx.globalAlpha = 1; } // flash on contact
    ctx.fillStyle = c.color; ctx.fillRect(-11, -6, 22, 12); ctx.fillStyle = "#111"; ctx.fillRect(-3, -5, 8, 10);
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(c.name, X + 14, Y - 10);
  }
}
function tracePath() { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(px(p.x), px(p.y)) : ctx.moveTo(px(p.x), px(p.y))); ctx.closePath(); }
function label(t, x, y, col, align = "center") { // kept inside the canvas
  ctx.fillStyle = col; ctx.font = "bold 11px sans-serif"; ctx.textAlign = align;
  const w = ctx.measureText(t).width, left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  ctx.fillText(t, x + clamp(left, 4, cv.width - w - 4) - left, clamp(y, 12, cv.height - 4)); ctx.textAlign = "left";
}

let selected = null, debugView = null; // debugView: a car, "track", or null
function selectDriver(c) { selected = c; debugView = c; $("#dbg").value = String(c.i); updateCards(); renderDebug(); }
function renderDebug() { // the exact request body a driver last sent and what came back; live while the race runs
  const view = debugView === "track" ? trackDesign : debugView?.lastReq ? { request: debugView.lastReq, response: debugView.lastRes } : null;
  const at = (el, v) => { const txt = v == null ? "– nothing sent yet –" : JSON.stringify(v, null, 2); if (el.textContent !== txt) el.textContent = txt; };
  at($("#raw"), view?.request); at($("#rawres"), view?.response);
  $("#dbgmeta").textContent = debugView && debugView !== "track" ? `${debugView.thinking ? "request in flight · " : ""}${debugView.lastReq ? `${JSON.stringify(debugView.lastReq).length} chars` : ""}` : "";
}
const currentLap = () => Math.min(race.laps, Math.max(1, ...cars.map((c) => c.lap + 1))); // the leader's lap
function renderSide() { // standings and stats; the driver cards are built once and updated in place, so nothing flickers
  const order = ranking();
  $("#standings").innerHTML = order.map((c, i) => `<div><span style="color:${c.color}">P${i + 1} ${c.name}</span><span>${c.done ? `finished ${c.finishT.toFixed(1)}s` : `lap ${Math.min(c.lap + 1, race.laps)} · ${Math.round(c.v * KMH)} km/h`}</span></div>`).join("");
  const avgLat = race.latency.length ? Math.round(race.latency.reduce((a, b) => a + b, 0) / race.latency.length) : 0;
  $("#stats").textContent = `${race.reqs} Jev requests · ${race.tokens.toLocaleString()} input tokens · $${race.cost.toFixed(5)} · avg ${avgLat} ms`;
  $("#racestate").textContent = race.running ? `Lap ${currentLap()} / ${race.laps} · ${race.t.toFixed(1)}s` : race.finished.length ? `Finished · ${race.t.toFixed(1)}s` : "";
  if (document.querySelectorAll("#drivers .card").length !== cars.length) buildCards();
  updateCards();
}
const PACE_STEPS = ["attack", "steady", "cautious"], LINE_STEPS = ["inside", "middle", "outside"];
function buildCards() {
  const row = (id, label) => `<div class="dec dim" id="${id}"><span class="k">${label}</span><span class="bar"><i style="width:0"></i></span><span class="v">–</span></div>`;
  $("#drivers").innerHTML = cars.map((c) => `<div class="card" data-i="${c.i}" style="--c:${c.color};cursor:pointer"><h3>${c.name} <span class="stats" id="hdr${c.i}"></span></h3><div class="traits">${c.traits}</div>
      <div class="inst"><span class="gauge" title="throttle"><i id="thr${c.i}"></i></span><span class="lamp" id="brk${c.i}">BRAKE</span><svg class="wheel" viewBox="0 0 40 40"><g id="whl${c.i}"><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="4"/><path d="M20 20 L20 34 M20 20 L7 13 M20 20 L33 13" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="4" r="2.5" fill="#f97316" stroke="none"/></g></svg><span class="deg" id="deg${c.i}"></span></div>
      ${PACE_STEPS.map((s, i) => row(`p${c.i}_${i}`, `pace: ${s}`)).join("")}${LINE_STEPS.map((s, i) => row(`w${c.i}_${i}`, `line: ${s}`)).join("")}${row(`o${c.i}`, "overtake")}${row(`b${c.i}`, "boost")}</div>`).join("");
  document.querySelectorAll("#drivers .card").forEach((el) => el.addEventListener("click", () => { selectDriver(cars[Number(el.dataset.i)]); }));
  $("#dbg").innerHTML = `<option value="">– pick a driver –</option>${cars.map((c) => `<option value="${c.i}">${c.name}</option>`).join("")}<option value="track">Track design</option>`;
}
function updateCards() {
  const setRow = (id, p, bright, label) => { const el = $(`#${id}`); if (!el || p == null) return; el.classList.toggle("dim", !bright); el.querySelector(".bar i").style.width = `${(p * 100).toFixed(0)}%`; el.querySelector(".v").textContent = p.toFixed(2); if (label) el.querySelector(".k").textContent = label; };
  for (const c of cars) {
    const d = c.dec, pr = d.probs, el = document.querySelector(`#drivers .card[data-i="${c.i}"]`), hdr = $(`#hdr${c.i}`); if (!el || !hdr) continue;
    el.style.outline = selected === c ? "1px solid #fff" : "";
    hdr.textContent = `${c.thinking ? "thinking… " : ""}conf pace ${(d.conf.pace ?? 0).toFixed(2)} · line ${(d.conf.line ?? 0).toFixed(2)}`;
    const scale = (obj, steps, prefix, chosen) => { if (!obj) return; steps.forEach((s, i) => setRow(`${prefix}${c.i}_${i}`, obj[s] ?? 0, s === chosen)); };
    scale(pr.pace, PACE_STEPS, "p", d.pace); scale(pr.line, LINE_STEPS, "w", d.line);
    setRow(`o${c.i}`, pr.overtake, d.overtake, `overtake${d.overtake ? " ✓" : ""}`); setRow(`b${c.i}`, pr.boost, d.boost, `boost${d.boost ? " ✓" : ""}`);
  }
}
const logs = [];
function log(m) { logs.unshift(`<div><b>${race.t.toFixed(1)}s</b> ${m}</div>`); if (logs.length > 60) logs.pop(); $("#log").innerHTML = logs.join(""); }

// ---------- loop & init ----------
let last = 0, paused = false;
function frame(t) { const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; if (race.running && !paused) step(dt); draw(); syncPlay(); instruments(); requestAnimationFrame(frame); }
function instruments() { // throttle gauge, brake lamp, wheel angle and the lap counter, live
  if (race.running) $("#racestate").textContent = `Lap ${currentLap()} / ${race.laps} · ${race.t.toFixed(1)}s`;
  for (const c of cars) {
    const thr = $(`#thr${c.i}`); if (!thr) continue;
    thr.style.width = `${Math.round((c.throttle ?? 0) * 100)}%`; // what the code is doing: on the throttle, or on the brakes
    $(`#brk${c.i}`).classList.toggle("on", !!c.braking);
    $(`#whl${c.i}`).setAttribute("transform", `rotate(${(c.steer * 90).toFixed(1)} 20 20)`);
    $(`#deg${c.i}`).textContent = `${wheelWords(c.steer)} · ${c.dec.pace}`;
  }
}
function syncPlay() { // one button: play starts or resumes, pause pauses; it reads the race so ending, resetting or changing track all update it
  const playing = race.running && !paused, title = playing ? "Pause" : race.running ? "Resume" : "Start race";
  const b = $("#play"); if (b.title !== title) { b.textContent = playing ? "❚❚" : "▶"; b.title = title; b.setAttribute("aria-label", title); }
}
function resetRace() { race = newRace(false); paused = false; logs.length = 0; resetCars(); renderSide(); $("#log").innerHTML = ""; }
async function init() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  const live = Object.entries(cfg.providers).find(([k, p]) => k !== "mock" && p.hasKey);
  const ps = $("#provider"); ps.innerHTML = Object.entries(cfg.providers).map(([k, p]) => `<option value="${k}" ${p.hasKey ? "" : "disabled"}>${p.label}</option>`).join(""); ps.value = live ? live[0] : "mock";
  const ms = $("#model"); const fill = () => { ms.innerHTML = cfg.providers[ps.value].models.map((m) => `<option>${m}</option>`).join(""); }; fill(); ps.addEventListener("change", fill);
  $("#play").addEventListener("click", () => {
    if (race.running) { paused = !paused; return; }
    race = newRace(true); logs.length = 0; resetCars(); paused = false; log("Lights out!"); renderSide();
  });
  $("#reset").addEventListener("click", resetRace);
  $("#dbg").addEventListener("change", () => { const v = $("#dbg").value; debugView = v === "track" ? "track" : v === "" ? null : cars[Number(v)]; if (debugView && debugView !== "track") { selected = debugView; updateCards(); } renderDebug(); });
  $("#randomize").addEventListener("click", async () => {
    const btn = $("#randomize"); btn.disabled = true; btn.textContent = "Drafting…";
    race.running = false; logs.length = 0; log("Drafting five circuits and asking Jev to pick one…"); renderSide();
    const summary = await designTrack();
    resetCars(); log(summary); renderSide(); debugView = "track"; $("#dbg").value = "track"; renderDebug();
    btn.disabled = false; btn.textContent = "New track";
  });
  const want = new URLSearchParams(location.search).get("track");
  if (want === "random") setTrack(randomTrack()); else if (PRESETS[want]) { PRESETS[want](); $("#preset").value = want; }
  $("#preset").addEventListener("change", () => { PRESETS[$("#preset").value](); race.running = false; logs.length = 0; resetCars(); log($("#preset").selectedOptions[0].textContent); renderSide(); });
  resetCars(); renderSide(); requestAnimationFrame(frame);
}
init();
