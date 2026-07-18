# Ambit Live 🎓📡

Real-time classroom quiz sessions. Teachers paste questions and host; students
join from **any phone, tablet or laptop** with a 6-character code or a one-tap
link — no accounts, no app install.

## Run locally

```bash
npm install
npm start          # → http://localhost:3000
```

- **Teacher:** open `http://localhost:3000`, paste questions (or “Load sample”),
  press **Start session**.
- **Students on the same Wi-Fi:** share `http://<your-mac-ip>:3000/join/<CODE>`
  (find your IP with `ipconfig getifaddr en0`).

## Test with simulated students

```bash
npm start                       # terminal 1
node test/host.js               # terminal 2 — full automated session
node test/bots.js <CODE> 8      # or: 8 bots join YOUR live session
```

## Question format

Numbered questions with `Jawapan:` / `Answer:` lines. `A)`–`D)` lines become
multiple choice (the answer letter marks the correct option); otherwise the
answer text becomes a **typed answer**, auto-marked by keyword match.

```
1. Negara kita merdeka pada tahun berapa?
A) 1955
B) 1957
C) 1963
D) 1969
Jawapan: B

2. Apakah maksud kedaulatan?
Jawapan: Kekuasaan tertinggi sesebuah negara untuk mentadbir…
```

A JSON array of `{text, opts, correct, answer, expl}` is also accepted.

## Deploy (so students can join from anywhere)

The app is a single Node server with WebSockets — deploy to any Node host:

**Render (free tier, easiest):**
1. Push this folder to a GitHub repo.
2. render.com → New → Web Service → connect the repo.
3. Build command `npm install`, start command `node server.js`. Done —
   you get `https://your-app.onrender.com`, and join links work in WhatsApp.

**Railway:** `npm i -g @railway/cli && railway login && railway init && railway up`

**Fly.io:** `fly launch` (accepts the defaults; Node is auto-detected).

> Note: Vercel/Netlify serverless functions do **not** support the persistent
> WebSocket connections this app needs — use Render/Railway/Fly instead.

## Architecture notes

- `server.js` — Express + Socket.IO; sessions held in memory, auto-deleted
  1 hour after ending. Single-instance by design; for multi-instance scale,
  move session state to Redis and add the Socket.IO Redis adapter.
- Scoring: 100 points per correct answer + up to 100 speed bonus.
- Reconnects: students who drop (locked phone screen) auto-rejoin and keep
  their score; a same-nickname rejoin resumes the seat.
- Typed answers are marked by normalized keyword overlap (≥35% of the model
  answer's words) — review the streamed answers on the teacher dashboard.
