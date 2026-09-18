# Jev Speedway

https://github.com/user-attachments/assets/d039d120-4c1f-4fac-94f3-151bbad27152

A small top-down racing game where **code drives and Jev judges**. A 60 fps physics loop handles steering, grip,
braking, and collisions. Every ~0.8 s each driver's situation is described in words and sent to
[TypeSafe Jev](https://docs.typesafe.ai/) with four questions: line and pace (Choice), overtake and boost (Noul). Drivers differ only by a `traits` string in the state, which is enough to produce distinct
personalities.

```sh
cp .env.example .env   # OPENROUTER_API_KEY or TYPESAFE_API_KEY (falls back to a mock provider without one)
npm start              # http://localhost:4343
```

No dependencies; Node 20+. `server.mjs` serves `public/` and proxies `/api/evaluate` so the key stays server-side.
`public/race.js` is the whole game: track spline, physics, the per-driver state builder, the Jev questions, and rendering.
Everything physical is in metres, seconds and m/s: the track spline, the car sizes, the grip and braking constants, and every
distance Jev is told (speeds are spoken in km/h). The canvas is 4 px to the metre, so a lap is roughly 550-650 m and top speed is 135 km/h;
only drawing converts to pixels.
Tracks: the original, a by-eye Circuit of the Americas, or **New track**, where code drafts five random F1-style circuits,
describes each in words, and Jev picks the one that should make the best race for these drivers.
Each track is classified into named features in circuit vocabulary (kinks, sweepers, medium and tight corners, hairpins,
chicanes, esses, short/long/back/start-finish straights, numbered T1, T2… from the start line); the names label the map, tell
each driver what is coming and how hard to brake for it, and describe the drafts Jev chooses between.
Click a driver card to see its last request and response.
