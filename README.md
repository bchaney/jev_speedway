# Jev Speedway

https://github.com/user-attachments/assets/c7fb4c9b-dccf-41d7-bab4-06c858413c30

A small top-down racing game where **code drives and Jev judges**.

A 60 fps physics loop handles steering, grip, braking, and collisions. Every ~0.8 s each driver's situation is
described in words and sent to [TypeSafe Jev](https://docs.typesafe.ai/) with four questions. Drivers differ only
by a `traits` string in the state, which is enough to produce distinct personalities.

## Quick start

```sh
cp .env.example .env   # OPENROUTER_API_KEY or TYPESAFE_API_KEY (falls back to a mock provider without one)
npm start              # http://localhost:4343
```

No dependencies; Node 20+.

| File | What it does |
| --- | --- |
| `server.mjs` | Serves `public/` and proxies `/api/evaluate` so the API key stays server-side |
| `lib/jev.mjs` | The Jev client, and the mock provider used when no key is set |
| `public/race.js` | The whole game: track spline, physics, the per-driver state builder, and rendering |
| `public/world.mjs` | Jev's world view as data: every phrase the state can say, and the four questions |
| `public/docs.html` | The **World view** page, rendered live from `world.mjs` |

## How it works

- **Units.** Everything physical is in metres, seconds and m/s: the track spline, the car sizes, the grip and braking
  constants, and every distance Jev is told. Speeds are spoken in km/h. The canvas is 4 px to the metre, so a lap is
  roughly 550-650 m and top speed is 135 km/h. Only drawing converts to pixels.
- **Tracks.** The original, a by-eye Circuit of the Americas, or **New track**, where code drafts five random F1-style
  circuits, describes each in words, and Jev picks the one that should make the best race for these drivers.
- **Features.** Each track is classified into named features in circuit vocabulary (kinks, sweepers, medium and tight
  corners, hairpins, chicanes, esses, short/long/back/start-finish straights, numbered T1, T2… from the start line).
  The names label the map, tell each driver what is coming and how hard to brake for it, and describe the drafts Jev
  chooses between.
- **Debugging.** Click a driver card to see its last request and response. The **World view docs** link opens
  `docs.html`, which lights up the case that fired for the selected driver.

## Jev's world view

Every field of the state is an ordered list of cases. The first case whose condition holds supplies the phrase, and
every phrase that grades a quantity also gives the measurement. The game and the docs page read the same table, so the
words Jev sees and the rules behind them cannot drift apart. The tables below are generated from it too
(`npm run readme`; `npm run readme:check` fails if they are stale).

<!-- world:start -->
| Field | About | Cases, in the order they are tried |
| --- | --- | --- |
| `driver.position` | place in the running order | **leading:** `1 of 4` · **anywhere else:** `3 of 4, and places are only gained by passing` |
| `driver.lap` | lap count | **always:** `2 of 3` |
| `driver.boost` | the one-per-lap boost | **not yet used this lap:** `available (one use per lap)` · **already used:** `used this lap` |
| `driver.status` | whether the car is under control | **spinning:** `recovering from a spin` · **otherwise:** `racing` |
| `car.speed` | speed, km/h (top speed is 135) | **under 45 km/h:** `slow, 30 km/h` · **45 to 85 km/h:** `cruising, 70 km/h` · **85 to 120 km/h:** `fast, 105 km/h` · **120 km/h or more:** `flat out, 132 km/h` |
| `car.situation` | the car against what the road needs: the corner it is in, or the next feature and the braking distance to it | **in a corner, more than 2% over its speed:** `in T4 tight corner over its limit: the tyres will not hold this for long (74 km/h against 68 km/h on this line)` · **in a corner, within 10% of its speed:** `in T4 tight corner right at its limit (66 km/h against 68 km/h on this line)` · **in a corner, well under its speed:** `in T4 tight corner with speed in hand (52 km/h against 68 km/h on this line)` · **next feature needs no braking (a straight or a kink):** `nothing ahead needs braking` · **already at or under the speed it needs:** `already at the speed T4 tight corner needs (68 km/h, 41 m away)` · **within 115% of the full-braking distance:** `at the braking point for T4 tight corner: steady brakes now, attack commits past the limit (33 m to go, 31 m needed to slow to 68 km/h)` · **within twice the full-braking distance:** `braking zone for T4 tight corner coming up (55 m to go, 31 m needed to slow to 68 km/h)` · **further away than that:** `T4 tight corner is still some way off (120 m to go, 31 m needed to slow to 68 km/h)` |
| `car.road_position` | where the car sits across the road (−1 is the left edge, +1 the right) | **under -0.7 across the road:** `at the left edge, 5.1 m left of the centre line (the road is 13.5 m wide)` · **-0.7 to -0.25 across the road:** `left of centre, 2.8 m left of the centre line (the road is 13.5 m wide)` · **-0.25 to 0.25 across the road:** `centre of the road, 0.6 m right of the centre line (the road is 13.5 m wide)` · **0.25 to 0.7 across the road:** `right of centre, 2.8 m right of the centre line (the road is 13.5 m wide)` · **0.7 across the road or more:** `at the right edge, 5.1 m right of the centre line (the road is 13.5 m wide)` |
| `car.current` | the last answers, and the corner they apply to | **always:** `steady pace, taking the inside line for T4 tight corner` |
| `car.grip` | speed against the grip limit of the car's own path | **above 95% of the limit:** `at the limit, tyres squealing` · **otherwise:** `comfortable` |
| `car.contact` | car-to-car contact | **contact within the last 2 s:** `just ran into the back of Vera / was hit from behind by Rook / side by side with Pip` · **otherwise:** `none lately` |
| `car.tow` | drafting: close behind a car on the same part of the road at speed | **slingshot burst in progress:** `slingshotting right now` · **in a tow with the charge at least half built:** `in Vera's tow, slingshot ready: calling the pass now releases it` · **in a tow, charge still building:** `in Vera's tow, building a run` · **otherwise:** `clean air` |
| `track_ahead.next` | the nearest feature ahead (a feature counts as ahead until the car is past its midpoint) | **it is a corner:** `T4 tight corner, turning right / T2-T3 chicane, turning left then right` · **it is a straight:** `back straight` |
| `track_ahead.distance` | distance to it, m (a car is 6 m) | **under 15 m:** `right now, 8 m` · **15 to 40 m:** `close, 27 m` · **40 to 80 m:** `medium, 62 m` · **80 m or more:** `far, 140 m` |
| `track_ahead.entry` | the braking it needs, from its speed limit as a fraction of top speed | **under 0.4 of top speed:** `brake very hard, down to walking pace, the limit is 47 km/h` · **0.4 to 0.534 of top speed:** `brake hard, the limit is 68 km/h` · **0.534 to 0.734 of top speed:** `brake, then carry good speed, the limit is 88 km/h` · **0.734 to 0.999 of top speed:** `just a lift, barely any braking, the limit is 122 km/h` · **0.999 of top speed or more:** `flat out, the limit is 135 km/h` |
| `track_ahead.after_that` | the feature after it | **always:** `short straight` |
| `track_ahead.note` | a fixed reminder of how corners are graded | **always:** `corners are graded by how much braking they need, from a kink (flat out) through sweepers and medium and tight corners to a hairpin (walking pace); entering any corner faster than its grip allows causes a spin` |
| `rivals.*` | the nearest car ahead and the nearest behind, within 35 m | **nobody within 35 m:** `nobody nearby` · **someone is:** `{ name, gap, road_position, pace (ahead only), status }` |
| `rivals.*.gap` | gap to the rival, m | **under 7.5 m:** `right on the bumper, 4 m` · **7.5 to 17.5 m:** `close, 12 m` · **17.5 to 35 m:** `a few car lengths, 26 m` |
| `rivals.*.road_position` | where the rival sits across the road (−1 left edge, +1 right), and which side of you | **under -0.7 across the road:** `at the left edge, 5.1 m left of the centre line, 2.4 m to your left` · **-0.7 to -0.25 across the road:** `left of centre, 2.8 m left of the centre line, 2.4 m to your left` · **-0.25 to 0.25 across the road:** `centre of the road, 0.6 m right of the centre line, 2.4 m to your left` · **0.25 to 0.7 across the road:** `right of centre, 2.8 m right of the centre line, 2.4 m to your left` · **0.7 across the road or more:** `at the right edge, 5.1 m right of the centre line, 2.4 m to your left` |
| `rivals.*.side` | the rival's lateral offset from you | **within 0.3 of your line:** `directly in line with you (0.6 m left)` · **to the left:** `2.4 m to your left` · **to the right:** `2.4 m to your right` |
| `rivals.ahead.pace` | how the car ahead is going relative to you | **spinning:** `spinning, a place for the taking` · **the blocking rule is capping your speed to theirs:** `holding you up: you are faster and stuck behind them` · **more than 5% faster than you:** `pulling away (128 km/h to your 112 km/h)` · **more than 5% slower than you:** `slower than you (96 km/h to your 112 km/h)` · **otherwise:** `about the same pace (110 km/h to your 112 km/h)` |
| `rivals.*.status` | whether the rival is under control | **spinning:** `spinning` · **otherwise:** `racing` |
<!-- world:end -->

## The questions

All four are asked on every request. A **Choice** returns one option with a probability for each; a **Noul** returns
the probability that the answer is yes.

<!-- questions:start -->
| Question | Type | Asked | Answers |
| --- | --- | --- | --- |
| `line` | Choice | Which line should `driver` take through the next corner (see `track_ahead`), given `rivals`, `car.road_position` and the driver's `driver.traits`? Two cars in the same place make contact. | `inside`: Tight line, shortest distance, less forgiving if too fast · `middle`: Neutral line · `outside`: Wide line, more forgiving at speed, longer distance |
| `pace` | Choice | How hard should `driver` push into `track_ahead.next`, given `car.situation`, `rivals` and `driver.traits`? The code brakes for corners at the chosen pace. | `attack`: Brake as late as possible and carry speed past the grip limit: faster if it sticks, a real risk of spinning · `steady`: Drive at the limit, brake normally and stay in control · `cautious`: Brake early and protect the position, giving up some time |
| `overtake` | Noul | Should `driver` attempt to pass `rivals.ahead` before `track_ahead.next`? Going for it pulls the car out to the open side of the rival and pushes harder; staying put means following in their wheel tracks. | `true`: A rival is within reach ahead and a pass is on: the driver is being held up or is quicker, the road ahead gives room, and the risk suits the driver's traits. A ready slingshot from `car.tow` makes it far more likely to stick · `false`: No rival within reach, the rival is genuinely quicker, or this driver would rather wait for a better moment. Following costs time when held up; contact costs speed and can spin either car |
| `boost` | Noul | Should `driver` use the boost right now, considering `driver.boost`, `track_ahead` and `rivals`? | `true`: Boost is available and this moment (a straight or a pass) is a good use of it · `false`: Boost is unavailable, or a better moment is coming |
<!-- questions:end -->

A fifth question, `layout`, is asked once when designing a **New track**: a Choice between the five drafts, judged on
real rewards for the risk-takers, a way for the careful drivers to win on consistency, and not being so brutal that
everyone spins.
