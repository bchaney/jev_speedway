# Jev Speedway

A small top-down racing game where **code drives and Jev judges**. A 60 fps physics loop handles steering, grip,
braking, and collisions. Every ~0.8 s each driver's situation is described in words and sent to
[TypeSafe Jev](https://docs.typesafe.ai/) with five questions: line and pace (Choice), overtake, boost, and
shortcut (Noul). Drivers differ only by a `traits` string in the state, which is enough to produce distinct
personalities.

```sh
cp .env.example .env   # OPENROUTER_API_KEY or TYPESAFE_API_KEY (falls back to a mock provider without one)
npm start              # http://localhost:4343
```

No dependencies; Node 20+. `server.mjs` serves `public/` and proxies `/api/evaluate` so the key stays server-side.
`public/race.js` is the whole game: track spline, physics, the per-driver state builder, the Jev questions, and rendering.
Click a driver card to see its last request and response.
