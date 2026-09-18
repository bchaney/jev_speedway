// Jev's world view: the vocabulary of the driver's state and the questions asked about it. Shared by the game (race.js) and the docs page.
// ---------- Jev's world view ----------
// Everything a driver's state can say, and the condition that says it. Each field is an ordered list of cases; the first whose
// test passes supplies the phrase. buildState reads phrases from here and the World view panel renders the same table with the
// case that fired for the selected driver lit up, so the words Jev sees and the rules behind them cannot drift apart.
// Pure: everything a case looks at comes in on x, so this module can be rendered as documentation without the game running.
// A case is { when: condition in words, test(x, v), say: phrase or (x, v) => phrase, sample: what a computed phrase looks like }.
// x is the context: c (car), f (next feature), n (what sets the speed: the corner it is in, or the next feature and its distance), need
// (full-braking distance to that speed), p (position), o and g (a rival and its gap), corner (next corner), gripLimit, vtop, cars, race.
export const always = () => true;
export const ladder = (unit, steps) => steps.map(([lim, say], i) => ({ when: i === 0 ? `under ${lim} ${unit}` : lim >= 1e9 ? `${steps[i - 1][0]} ${unit} or more` : `${steps[i - 1][0]} to ${lim} ${unit}`, test: (x, v) => v < lim, say })); // a bucket, with its conditions spelled out
const ROAD = ladder("across the road", [[-0.7, "at the left edge"], [-0.25, "left of centre"], [0.25, "centre of the road"], [0.7, "right of centre"], [1e9, "at the right edge"]]);
export const WORLD = {
  "driver.position": { about: "place in the running order", value: (x) => x.p, cases: [
    { when: "leading", test: (x, v) => v === 1, say: (x, v) => `${v} of ${x.cars.length}`, sample: "1 of 4" },
    { when: "anywhere else", test: always, say: (x, v) => `${v} of ${x.cars.length}, and places are only gained by passing`, sample: "3 of 4, and places are only gained by passing" }] },
  "driver.lap": { about: "lap count", cases: [{ when: "always", test: always, say: (x) => `${x.c.lap + 1} of ${x.race.laps}`, sample: "2 of 3" }] },
  "driver.boost": { about: "the one-per-lap boost", cases: [
    { when: "not yet used this lap", test: (x) => x.c.boostAvail, say: "available (one use per lap)" },
    { when: "already used", test: always, say: "used this lap" }] },
  "driver.status": { about: "whether the car is under control", cases: [
    { when: "spinning", test: (x) => x.c.spin > 0, say: "recovering from a spin" },
    { when: "otherwise", test: always, say: "racing" }] },
  "car.speed": { about: "speed, km/h (top speed is 135)", value: (x) => x.c.v * 3.6, cases: ladder("km/h", [[45, "slow"], [85, "cruising"], [120, "fast"], [1e9, "flat out"]]) },
  "car.situation": { about: "the car against what the road needs: the corner it is in, or the next feature and the braking distance to it", value: (x) => x.c.v, cases: [
    { when: "in a corner, more than 2% over its speed", test: (x, v) => x.n.here && v > x.n.limit * 1.02, say: (x) => `in ${x.n.f.name} over its limit: the tyres will not hold this for long`, sample: "in T4 tight corner over its limit: the tyres will not hold this for long" },
    { when: "in a corner, within 10% of its speed", test: (x, v) => x.n.here && v > x.n.limit * 0.9, say: (x) => `in ${x.n.f.name} right at its limit`, sample: "in T4 tight corner right at its limit" },
    { when: "in a corner, well under its speed", test: (x) => x.n.here, say: (x) => `in ${x.n.f.name} with speed in hand`, sample: "in T4 tight corner with speed in hand" },
    { when: "next feature needs no braking (a straight or a kink)", test: (x) => x.n.limit >= x.vtop, say: "nothing ahead needs braking" },
    { when: "already at or under the speed it needs", test: (x, v) => v <= x.n.limit, say: (x) => `already at the speed ${x.n.f.name} needs`, sample: "already at the speed T4 tight corner needs" },
    { when: "within 115% of the full-braking distance", test: (x) => x.n.dist <= x.need * 1.15, say: (x) => `at the braking point for ${x.n.f.name}: steady brakes now, attack commits past the limit`, sample: "at the braking point for T4 tight corner: steady brakes now, attack commits past the limit" },
    { when: "within twice the full-braking distance", test: (x) => x.n.dist <= x.need * 2, say: (x) => `braking zone for ${x.n.f.name} coming up`, sample: "braking zone for T4 tight corner coming up" },
    { when: "further away than that", test: always, say: (x) => `${x.n.f.name} is still some way off`, sample: "T4 tight corner is still some way off" }] },
  "car.road_position": { about: "where the car sits across the road (−1 is the left edge, +1 the right)", value: (x) => x.c.lat, cases: ROAD },
  "car.current": { about: "the last answers, and the corner they apply to", cases: [{ when: "always", test: always, say: (x) => `${x.c.dec.pace} pace, taking the ${x.c.dec.line} line for ${x.corner?.name ?? "the next corner"}`, sample: "steady pace, taking the inside line for T4 tight corner" }] },
  "car.grip": { about: "speed against the grip limit of the car's own path", cases: [
    { when: "above 95% of the limit", test: (x) => x.c.v > x.gripLimit * 0.95, say: "at the limit, tyres squealing" },
    { when: "otherwise", test: always, say: "comfortable" }] },
  "car.contact": { about: "car-to-car contact", cases: [
    { when: "contact within the last 2 s", test: (x) => x.c.contact && x.race.t - x.c.contact.t < 2, say: (x) => `just ${x.c.contact.kind} ${x.c.contact.with}`, sample: "just ran into the back of Vera / was hit from behind by Rook / side by side with Pip" },
    { when: "otherwise", test: always, say: "none lately" }] },
  "car.tow": { about: "drafting: close behind a car on the same part of the road at speed", cases: [
    { when: "slingshot burst in progress", test: (x) => x.c.slingT > 0, say: "slingshotting right now" },
    { when: "in a tow with the charge at least half built", test: (x) => x.c.towing && x.c.tow >= 0.5, say: (x) => `in ${x.c.towing.name}'s tow, slingshot ready: calling the pass now releases it`, sample: "in Vera's tow, slingshot ready: calling the pass now releases it" },
    { when: "in a tow, charge still building", test: (x) => x.c.towing, say: (x) => `in ${x.c.towing.name}'s tow, building a run`, sample: "in Vera's tow, building a run" },
    { when: "otherwise", test: always, say: "clean air" }] },
  "track_ahead.next": { about: "the nearest feature ahead (a feature counts as ahead until the car is past its midpoint)", cases: [
    { when: "it is a corner", test: (x) => !!x.f.dir, say: (x) => `${x.f.name}, turning ${x.f.dir}`, sample: "T4 tight corner, turning right / T2-T3 chicane, turning left then right" },
    { when: "it is a straight", test: always, say: (x) => x.f.name, sample: "back straight" }] },
  "track_ahead.distance": { about: "distance to it, m (a car is 6 m)", value: (x) => x.f.dist, cases: ladder("m", [[15, "right now"], [40, "close"], [80, "medium"], [1e9, "far"]]) },
  "track_ahead.entry": { about: "the braking it needs, from its speed limit as a fraction of top speed", value: (x) => x.f.limit / x.vtop, cases: ladder("of top speed", [[0.4, "brake very hard, down to walking pace"], [0.534, "brake hard"], [0.734, "brake, then carry good speed"], [0.999, "just a lift, barely any braking"], [1e9, "flat out"]]) },
  "track_ahead.after_that": { about: "the feature after it", cases: [{ when: "always", test: always, say: (x) => x.f.then, sample: "short straight" }] },
  "track_ahead.note": { about: "a fixed reminder of how corners are graded", cases: [{ when: "always", test: always, say: "corners are graded by how much braking they need, from a kink (flat out) through sweepers and medium and tight corners to a hairpin (walking pace); entering any corner faster than its grip allows causes a spin" }] },
  "rivals.*": { about: "the nearest car ahead and the nearest behind, within 35 m", cases: [
    { when: "nobody within 35 m", test: (x) => !x.o, say: "nobody nearby" },
    { when: "someone is", test: always, say: "{ name, gap, road_position, pace (ahead only), status }" }] },
  "rivals.*.gap": { about: "gap to the rival, m", value: (x) => x.g, cases: ladder("m", [[7.5, "right on the bumper"], [17.5, "close"], [35, "a few car lengths"]]) },
  "rivals.*.road_position": { about: "where the rival sits across the road (−1 left edge, +1 right), and which side of you", value: (x) => x.o.lat, cases: ROAD.map((k) => ({ ...k, say: (x, v) => `${k.say}, ${speak("rivals.*.side", x, `rivals.${x.which}.side`)}`, sample: `${k.say}, to your left` })) },
  "rivals.*.side": { about: "the rival's lateral offset from you", value: (x) => x.o.lat - x.c.lat, cases: [
    { when: "within 0.3 of your line", test: (x, v) => Math.abs(v) < 0.3, say: "directly in line with you" },
    { when: "to the left", test: (x, v) => v < 0, say: "to your left" },
    { when: "to the right", test: always, say: "to your right" }] },
  "rivals.ahead.pace": { about: "how the car ahead is going relative to you", cases: [
    { when: "spinning", test: (x) => x.o.spin > 0, say: "spinning, a place for the taking" },
    { when: "the blocking rule is capping your speed to theirs", test: (x) => x.c.heldBy === x.o, say: "holding you up: you are faster and stuck behind them" },
    { when: "more than 5% faster than you", test: (x) => x.o.v > x.c.v * 1.05, say: "pulling away" },
    { when: "more than 5% slower than you", test: (x) => x.o.v < x.c.v * 0.95, say: "slower than you" },
    { when: "otherwise", test: always, say: "about the same pace" }] },
  "rivals.*.status": { about: "whether the rival is under control", cases: [
    { when: "spinning", test: (x) => x.o.spin > 0, say: "spinning" },
    { when: "otherwise", test: always, say: "racing" }] },
};
export function speak(key, x, traceKey = key) { // the first case that fits supplies the phrase, and the trace remembers which one
  const field = WORLD[key], v = field.value ? field.value(x) : undefined;
  for (let i = 0; i < field.cases.length; i++) { const k = field.cases[i]; if (k.test(x, v)) { if (x.trace) x.trace[traceKey] = i; return typeof k.say === "function" ? k.say(x, v) : k.say; } }
}

// ---------- the questions ----------
export const QUESTIONS = {
  line: { type: "choice", instructions: "Which line should `driver` take through the next corner (see `track_ahead`), given `rivals`, `car.road_position` and the driver's `driver.traits`? Two cars in the same place make contact.", criteria: { inside: "Tight line, shortest distance, less forgiving if too fast", middle: "Neutral line", outside: "Wide line, more forgiving at speed, longer distance" } },
  pace: { type: "choice", instructions: "How hard should `driver` push into `track_ahead.next`, given `car.situation`, `rivals` and `driver.traits`? The code brakes for corners at the chosen pace.", criteria: { attack: "Brake as late as possible and carry speed past the grip limit: faster if it sticks, a real risk of spinning", steady: "Drive at the limit, brake normally and stay in control", cautious: "Brake early and protect the position, giving up some time" } },
  overtake: { type: "noul", instructions: "Should `driver` attempt to pass `rivals.ahead` before `track_ahead.next`? Going for it pulls the car out to the open side of the rival and pushes harder; staying put means following in their wheel tracks.", criteria: { true: "A rival is within reach ahead and a pass is on: the driver is being held up or is quicker, the road ahead gives room, and the risk suits the driver's traits. A ready slingshot from `car.tow` makes it far more likely to stick", false: "No rival within reach, the rival is genuinely quicker, or this driver would rather wait for a better moment. Following costs time when held up; contact costs speed and can spin either car" } },
  boost: { type: "noul", instructions: "Should `driver` use the boost right now, considering `driver.boost`, `track_ahead` and `rivals`?", criteria: { true: "Boost is available and this moment (a straight or a pass) is a good use of it", false: "Boost is unavailable, or a better moment is coming" } },
};
