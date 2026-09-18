// Jev Speedway: code drives, Jev judges.
import { PRICE_PER_MTOK } from "/lib/jev.mjs";
const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- track: closed Catmull-Rom spline through control points ----------
// Circuit of the Americas, traced by eye from the map (not survey data): the uphill T1 hairpin top-left, the esses across the
// top, the T11 hairpin at the far right, the diagonal back straight, the T12 stadium loop and the T16-18 horseshoe along the bottom.
const COTA_CP = [[200,650],[150,400],[140,180],[170,90],[250,100],[330,160],[410,110],[490,170],[570,120],[650,170],[740,120],[840,150],[930,200],[990,280],[950,340],[850,370],[700,410],[550,450],[420,490],[350,510],[330,570],[400,600],[460,560],[540,540],[660,530],[760,560],[800,630],[740,680],[600,690],[450,690],[300,680]];
const DEFAULT_CP = [[150,360],[200,180],[400,110],[650,120],[850,170],[980,320],[900,470],[760,520],[620,470],[540,360],[430,430],[330,600],[200,600],[130,500]];
const SEG_N = 40;
let pts = []; // {x,y,s,kappa}
let L = 0, HAIRPIN = 0, BOOST_PAD = null;
function buildTrack(CP, fixed) {
  pts = [];
  for (let i = 0; i < CP.length; i++) {
    const p0 = CP[(i - 1 + CP.length) % CP.length], p1 = CP[i], p2 = CP[(i + 1) % CP.length], p3 = CP[(i + 2) % CP.length];
    for (let j = 0; j < SEG_N; j++) {
      const t = j / SEG_N, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      pts.push({ x, y });
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
  // features: the hairpin is the tightest point; the pad goes on the straightest stretch
  let best = 0; HAIRPIN = 0; for (const p of pts) if (Math.abs(p.kappa) > best) { best = Math.abs(p.kappa); HAIRPIN = p.s; }
  const gap = (a, b) => Math.min(((a - b) % L + L) % L, ((b - a) % L + L) % L);
  const window = (len, score, avoid) => { // best start s for a window of length len, by score, keeping clear of avoid points
    let bestS = 0, bestV = -Infinity;
    for (let s0 = 0; s0 < L; s0 += L / 200) { if (avoid.some((a) => gap(s0 + len / 2, a) < len / 2 + L * 0.06)) continue; const v = score(s0, s0 + len); if (v > bestV) { bestV = v; bestS = s0; } }
    return bestS;
  };
  const maxK = (a, b) => { let m = 0; for (let x = a; x <= b; x += 4) m = Math.max(m, Math.abs(at(x).kappa)); return m; };
  const padS = fixed ? fixed.pad * L : window(L * 0.05, (a, b) => -maxK(a, b), [HAIRPIN]);
  BOOST_PAD = { s0: padS, s1: padS + L * 0.05 };
}
// Random circuit in the F1 idiom: a loop of "sectors" around the canvas centre, each one a straight, a sweeper, a chicane or a
// hairpin that notches deep toward the middle. Points are placed by angle and radius, so the loop stays star-shaped and never
// crosses itself; trackOk() then rejects layouts where the spline's arms come too close for the road width.
const RX = 480, RY = 300;
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
function trackOk() { // fits the canvas, not absurdly sharp, and no two separate stretches of road overlap
  if (L < 2200 || Math.max(...pts.map((p) => Math.abs(p.kappa))) > 0.05) return false;
  if (pts.some((p) => p.x < 45 || p.x > 1055 || p.y < 45 || p.y > 675)) return false;
  const stride = 4;
  for (let i = 0; i < pts.length; i += stride) for (let j = i + stride; j < pts.length; j += stride) {
    const along = Math.min(pts[j].s - pts[i].s, L - (pts[j].s - pts[i].s));
    if (along > WIDTH * 2.5 && Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < WIDTH + 24) return false;
  }
  return true;
}
const snapshotTrack = () => ({ pts, L, HAIRPIN, BOOST_PAD });
function setTrack(t) { ({ pts, L, HAIRPIN, BOOST_PAD } = t); }
function randomTrack() {
  for (let tries = 0; tries < 60; tries++) { buildTrack(randomCP()); if (trackOk()) return snapshotTrack(); }
  buildTrack(DEFAULT_CP, { pad: 0.06 }); return snapshotTrack();
}
function describeTrack(t) { // words only, the way Jev likes its state
  setTrack(t);
  let corners = 0, inCorner = false, straight = 0, longest = 0, maxK = 0;
  for (const p of pts) {
    const k = Math.abs(p.kappa); maxK = Math.max(maxK, k);
    const c = k > 0.006; if (c && !inCorner) corners++; inCorner = c;
    if (k < 0.003) { straight += L / pts.length; longest = Math.max(longest, straight); } else straight = 0;
  }
  return {
    length: bucket(L, [[2000, "short lap"], [2300, "medium lap"], [1e9, "long lap"]]),
    corners: `${corners} corners`,
    tightest_corner: bucket(1 / maxK, [[35, "a very tight hairpin, well under walking pace"], [55, "a tight hairpin"], [90, "a firm corner"], [1e9, "only open sweepers"]]),
    longest_straight: bucket(longest, [[200, "no real straight"], [350, "a short straight"], [550, "a long straight"], [1e9, "a very long straight"]]),
    booster_pad: `on ${bucket(1 / Math.max(1e-4, ...Array.from({ length: 10 }, (_, i) => Math.abs(at(BOOST_PAD.s0 + i * (BOOST_PAD.s1 - BOOST_PAD.s0) / 9).kappa))), [[120, "a curve"], [1e9, "a straight"]])}, with ${nextFeature(BOOST_PAD.s1).name} ${bucket(nextFeature(BOOST_PAD.s1).dist, [[160, "close after it"], [400, "a little way after it"], [1e9, "far after it"]])}`,
  };
}
const PRESETS = { original: () => buildTrack(DEFAULT_CP, { pad: 0.06 }), cota: () => buildTrack(COTA_CP) };
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
  return `Layout ${pick}: ${d.length}, ${d.corners}, ${d.tightest_corner}, ${d.longest_straight}; pad ${d.booster_pad}. ${note}`;
}
const WIDTH = 46;
function at(s) { // spline points are unevenly spaced, so look the index up by accumulated arc length
  s = ((s % L) + L) % L; let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].s <= s) lo = mid; else hi = mid - 1; }
  const p = pts[lo], n = pts[(lo + 1) % pts.length]; const h = Math.atan2(n.y - p.y, n.x - p.x); return { x: p.x, y: p.y, h, kappa: p.kappa };
}
function pos(s, lat) { const p = at(s); return { x: p.x + Math.cos(p.h + Math.PI / 2) * lat * WIDTH * 0.42, y: p.y + Math.sin(p.h + Math.PI / 2) * lat * WIDTH * 0.42, h: p.h }; }
// features (by track distance)
const V_TOP = 150, GRIP = 120, ACCEL = 65, BRAKE = 160; // GRIP sized so the hairpin limits to ~75 px/s and the sweepers to ~100-150
// Lateral offset changes the real path: the inside of a corner is shorter but tighter, the outside longer but more forgiving.
// Positive kappa is a right-hand turn on screen; positive lat is the right-hand side of the road.
function pathAt(s, lat) { const k = at(s).kappa; const denom = clamp(1 - k * lat * WIDTH * 0.42, 0.6, 1.4); return { kappa: k / denom, progress: 1 / denom }; }
function cornerLimit(s, lat = 0) { return Math.sqrt(GRIP / Math.max(Math.abs(pathAt(s, lat).kappa), 1e-4)); } // physical grip limit, uncapped
function vmax(s, lat = 0) { return Math.min(V_TOP, cornerLimit(s, lat)); }
function turnAhead(s, look) { // sign of the next significant corner (+1 right, -1 left, 0 none in range)
  let best = 0; for (let d = 0; d <= look; d += 10) { const k = at(s + d).kappa; if (Math.abs(k) > Math.abs(best)) best = k; }
  return Math.abs(best) > 0.004 ? Math.sign(best) : 0;
}
buildTrack(DEFAULT_CP, { pad: 0.06 }); // the hand-made track keeps its hand-placed pad
function nextFeature(s) { // nearest upcoming semantic feature
  const list = [
    { name: "hairpin", s: HAIRPIN, then: "the run to the next feature" },
    { name: "booster pad", s: BOOST_PAD.s0, then: "a fast sweeping section" },
  ];
  let bestD = Infinity, best = null;
  for (const f of list) { const d = ((f.s - s) % L + L) % L; if (d < bestD) { bestD = d; best = f; } }
  return { ...best, dist: bestD };
}

// ---------- drivers ----------
const DRIVERS = [
  { name: "Blaze", color: "#f97316", traits: "reckless, loves the boost, hates being behind" },
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
    ...d, i, s: -30 - i * 28, lat: i % 2 ? 0.6 : -0.6, v: 0, lap: 0, spin: 0, boostAvail: true, boostT: 0, turn: 1, done: false, finishT: null,
    dec: { line: "middle", pace: "steady", overtake: false, boost: false, conf: {}, probs: {} }, thinking: false, nextThink: i * 0.2, lastReq: null, lastRes: null,
  }));
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
    if (c.done) { c.v = lerp(c.v, 60, dt); advance(c, c.v * dt); continue; }
    if (c.spin > 0) { c.spin -= dt; c.v = lerp(c.v, 0, dt * 2); advance(c, c.v * dt); continue; }
    const sm = ((c.s % L) + L) % L;
    const look = 40 + c.v * 0.55;
    c.turn = turnAhead(sm, look + 60) || c.turn;
    // target lane from decision, relative to the upcoming corner; hesitation if low confidence
    const laneT = { inside: 0.85 * c.turn, middle: 0, outside: -0.85 * c.turn }[c.dec.line] ?? 0;
    c.lat = lerp(c.lat, laneT, dt * 3);
    // pace: how close to the limit into the next corner
    const paceF = { attack: 1.12, steady: 1.0, cautious: 0.86 }[c.dec.pace] ?? 1;
    const onPad = sm > BOOST_PAD.s0 && sm < BOOST_PAD.s1;
    const ceil = onPad ? V_TOP * 1.2 : V_TOP; // the pad raises the ceiling but still respects the corners, so it never punishes a careful driver
    let target = ceil;
    for (let d = 0; d < look; d += 5) { const v = Math.min(ceil, cornerLimit(sm + d, c.lat)) * paceF; target = Math.min(target, Math.sqrt(v * v + 2 * BRAKE * d)); } // fastest speed now that can still brake to v by d
    if (c.dec.overtake) target *= 1.06;
    if (onPad) c.v = Math.max(c.v, Math.min(target, c.v + 55 * dt));
    if (c.dec.boost && c.boostAvail) { c.boostAvail = false; c.dec.boost = false; c.boostT = 1.4; log(`${c.name} hits the boost`); } // consume the decision so a new lap needs a fresh call
    if (c.boostT > 0) { c.boostT -= dt; target = V_TOP * 1.25; } // the driver's own boost ignores the corner cap: boosting into a corner is the risk Jev is asked about
    // blocking: car directly ahead in same lane caps speed
    for (const o of cars) if (o !== c && !o.done) { const gap = ((o.s - c.s) % L + L) % L; if (gap > 0 && gap < 26 && Math.abs(o.lat - c.lat) < 0.7) target = Math.min(target, o.v * (c.dec.overtake ? 1.0 : 0.95)); }
    // accelerate / brake
    if (c.v < target) c.v = Math.min(target, c.v + ACCEL * dt * (c.boostT > 0 ? 2 : 1)); else c.v = Math.max(target, c.v - BRAKE * dt);
    // grip check: over the limit of the actual path is a risk that grows with the overshoot, not a certainty; straights never spin
    const over = c.v / (cornerLimit(sm, c.lat) * 1.05) - 1; // 5% tolerance so a steady car at the limit is safe; attack (12% over) is not
    if (over > 0 && Math.random() < over * dt * 8) { c.spin = 1.2; c.v *= 0.35; log(`${c.name} spins out in the ${nextFeature(sm).dist < 60 ? nextFeature(sm).name : "corner"}!`); }
    advance(c, c.v * dt * pathAt(sm, c.lat).progress); // inside line covers centreline distance faster
    // think
    c.nextThink -= dt;
    if (c.nextThink <= 0 && !c.thinking) { c.nextThink = Number($("#tick").value) / 1000; think(c, order); }
  }
  if (cars.every((c) => c.done) && race.running) { race.running = false; log("Race over."); }
}
function ranking() { return [...cars].sort((a, b) => (a.finishT ?? Infinity) - (b.finishT ?? Infinity) || b.s - a.s); } // s already accumulates across laps

// ---------- Jev: the driver's judgment ----------
function buildState(c, order) {
  const sm = ((c.s % L) + L) % L, p = order.indexOf(c) + 1, f = nextFeature(sm);
  const gapTo = (o) => o ? (((o.s - c.s) % L + L) % L) : null;
  let ahead = null, behind = null;
  for (const o of cars) if (o !== c && !o.done) { const g = gapTo(o); const gBehind = ((c.s - o.s) % L + L) % L; if (g < 140 && (!ahead || g < gapTo(ahead))) ahead = o; if (gBehind < 140 && (!behind || gBehind < ((c.s - behind.s) % L + L) % L)) behind = o; }
  const laneName = (lat) => { const r = lat * c.turn; return r > 0.3 ? "inside" : r < -0.3 ? "outside" : "middle"; }; // relative to the next corner
  const desc = (o, g) => o ? { name: o.name, gap: bucket(g, [[30, "right on the bumper"], [70, "close"], [140, "a few car lengths"]]), lane: laneName(o.lat), status: o.spin > 0 ? "spinning" : "racing" } : "nobody nearby";
  return {
    driver: { name: c.name, traits: c.traits, position: `${p} of ${cars.length}`, lap: `${c.lap + 1} of ${race.laps}`, boost: c.boostAvail ? "available (one use per lap)" : "used this lap", status: c.spin > 0 ? "recovering from a spin" : "racing" },
    car: { speed: bucket(c.v, [[50, "slow"], [95, "cruising"], [135, "fast"], [1e9, "flat out"]]), lane: laneName(c.lat), grip: c.v > cornerLimit(sm, c.lat) * 0.95 ? "at the limit, tyres squealing" : "comfortable" },
    track_ahead: { next: f.name, distance: bucket(f.dist, [[60, "right now"], [160, "close"], [320, "medium"], [1e9, "far"]]), after_that: f.then, hairpin_note: "the hairpin is the tightest corner; entering it fast without braking causes a spin" },
    rivals: { ahead: desc(ahead, ahead ? gapTo(ahead) : 0), behind: desc(behind, behind ? ((c.s - behind.s) % L + L) % L : 0) },
  };
}
const QUESTIONS = {
  line: { type: "choice", instructions: "Which lane should `driver` take through `track_ahead.next`, given `rivals` and the driver's `driver.traits`?", criteria: { inside: "Tight line, shortest distance, less forgiving if too fast", middle: "Neutral line", outside: "Wide line, more forgiving at speed, longer distance" } },
  pace: { type: "choice", instructions: "How hard should `driver` push into `track_ahead.next`?", criteria: { attack: "Brake as late as possible, carry maximum speed, accept a real risk of spinning", steady: "Brake normally and stay in control", cautious: "Brake early and protect the position, giving up some time" } },
  overtake: { type: "noul", instructions: "Should `driver` attempt to pass `rivals.ahead` before `track_ahead.next`?", criteria: { true: "There is a rival close ahead and passing now fits the driver's traits and the situation", false: "No rival close ahead, or passing now is unwise for this driver" } },
  boost: { type: "noul", instructions: "Should `driver` use the boost right now, considering `driver.boost`, `track_ahead` and `rivals`?", criteria: { true: "Boost is available and this moment (a straight or a pass) is a good use of it", false: "Boost is unavailable, or a better moment is coming" } },
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
      d.overtake = a.overtake.noul > 0.6; d.boost = a.boost.noul > 0.7;
      d.conf = { line: a.line.confidence, pace: a.pace.confidence }; d.probs = { line: a.line.probabilities, pace: a.pace.probabilities, overtake: a.overtake.noul, boost: a.boost.noul };
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
  label("BOOST", at((BOOST_PAD.s0 + BOOST_PAD.s1) / 2).x, at((BOOST_PAD.s0 + BOOST_PAD.s1) / 2).y - 36, "#facc15"); label("HAIRPIN", at(HAIRPIN).x, at(HAIRPIN).y + 40, "#8a93a6");
  // start line
  const s0 = at(0); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(s0.x + Math.cos(s0.h + Math.PI / 2) * WIDTH / 2, s0.y + Math.sin(s0.h + Math.PI / 2) * WIDTH / 2); ctx.lineTo(s0.x - Math.cos(s0.h + Math.PI / 2) * WIDTH / 2, s0.y - Math.sin(s0.h + Math.PI / 2) * WIDTH / 2); ctx.stroke();
  // cars
  for (const c of cars) {
    const p = pos(c.s, c.lat);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.h); if (c.spin > 0) ctx.rotate(c.spin * 9);
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
      ${choiceRows("line", pr.line)}${choiceRows("pace", pr.pace)}${noulRow("overtake", pr.overtake, d.overtake)}${noulRow("boost", pr.boost, d.boost)}</div>`;
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
  $("#randomize").addEventListener("click", async () => {
    const btn = $("#randomize"); btn.disabled = true; btn.textContent = "Drafting…";
    race.running = false; logs.length = 0; log("Drafting five circuits and asking Jev to pick one…"); renderSide();
    const summary = await designTrack();
    resetCars(); log(summary); renderSide(); $("#raw").textContent = JSON.stringify(trackDesign, null, 2);
    btn.disabled = false; btn.textContent = "New track";
  });
  $("#pause").addEventListener("click", () => { paused = !paused; $("#pause").textContent = paused ? "Resume" : "Pause"; });
  const want = new URLSearchParams(location.search).get("track");
  if (want === "random") setTrack(randomTrack()); else if (PRESETS[want]) { PRESETS[want](); $("#preset").value = want; }
  $("#preset").addEventListener("change", () => { PRESETS[$("#preset").value](); race.running = false; logs.length = 0; resetCars(); log($("#preset").selectedOptions[0].textContent); renderSide(); });
  resetCars(); renderSide(); requestAnimationFrame(frame);
}
init();
