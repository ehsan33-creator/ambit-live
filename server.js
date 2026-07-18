/* Ambit Live — real-time classroom quiz server
 * Sessions are in-memory (single instance). For multi-instance scale, move
 * session state to Redis and use the socket.io Redis adapter.
 */
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, "public")));
app.get("/join/:code?", (_req, res) => res.sendFile(path.join(__dirname, "public", "join.html")));
app.get("/studio", (_req, res) => res.sendFile(path.join(__dirname, "public", "studio.html")));
app.get("/healthz", (_req, res) => res.json({ ok: true, sessions: sessions.size }));

const PORT = process.env.PORT || 3000;
const sessions = new Map(); // code -> session

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
  while (sessions.has(code));
  return code;
}
const clean = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);

/* Fuzzy match for typed answers: correct when the student's words cover
 * enough of the model answer's meaningful words. */
const normWords = s => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9À-ɏ\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
function fuzzyCorrect(student, model) {
  const sw = new Set(normWords(student));
  const mw = normWords(model);
  if (!mw.length || !sw.size) return false;
  const hits = mw.filter(w => sw.has(w)).length;
  return hits / mw.length >= 0.35;
}

const connectedCount = s => [...s.players.values()].filter(p => p.connected).length;
const hostRoom = s => s.code + ":host";
function publicQuestion(s) {
  const q = s.questions[s.qi];
  return { i: s.qi, total: s.questions.length, type: q.type, text: q.text,
           opts: q.opts || null, timer: s.settings.timer, endsAt: s.cur.endsAt };
}
function hostLobby(s) {
  return { players: [...s.players.values()].map(p => ({ nick: p.nick, score: p.score, connected: p.connected })) };
}
function leaderboard(s) {
  return [...s.players.values()].sort((a, b) => b.score - a.score).slice(0, 8)
    .map(p => ({ nick: p.nick, score: p.score }));
}
function answerCounts(s) {
  const q = s.questions[s.qi];
  if (!q.opts) return null;
  const counts = q.opts.map(() => 0);
  for (const a of s.cur.answers.values()) if (a.oi != null && counts[a.oi] != null) counts[a.oi]++;
  return counts;
}

function startQuestion(s, i) {
  clearTimeout(s.cur && s.cur.timeout);
  s.qi = i;
  s.phase = "question";
  s.cur = { answers: new Map(), t0: Date.now(), endsAt: Date.now() + s.settings.timer * 1000 };
  s.cur.timeout = setTimeout(() => reveal(s), s.settings.timer * 1000 + 700);
  io.to(s.code).emit("question", publicQuestion(s));
  const q = s.questions[s.qi];
  io.to(hostRoom(s)).emit("question", { ...publicQuestion(s), correct: q.correct, answer: q.answer, expl: q.expl });
}

function reveal(s) {
  if (s.phase !== "question") return;
  clearTimeout(s.cur.timeout);
  s.phase = "reveal";
  const q = s.questions[s.qi];
  let nRight = 0;
  for (const [sid, p] of s.players) {
    const a = s.cur.answers.get(sid);
    let right = false;
    if (a) {
      right = q.opts ? a.oi === q.correct : fuzzyCorrect(a.text, q.answer);
      if (right) {
        nRight++;
        p.correct++;
        const speed = Math.max(0, s.settings.timer * 1000 - a.ms) / (s.settings.timer * 1000);
        p.score += 100 + Math.round(speed * 100);
      }
    }
    p.answers[s.qi] = { given: a ? (q.opts ? q.opts[a.oi] : a.text) : null, right };
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit("reveal", {
      answered: !!a, right,
      correct: q.opts ? q.correct : null,
      answerText: q.opts ? q.opts[q.correct] : q.answer,
      expl: s.settings.feedback ? (q.expl || "") : "",
      score: p.score,
    });
  }
  const answered = s.cur.answers.size;
  const acc = answered ? Math.round(nRight / answered * 100) : 0;
  s.qstats[s.qi] = { text: q.text, acc, answered };
  io.to(hostRoom(s)).emit("revealHost", {
    counts: answerCounts(s), acc, answered,
    correct: q.correct, answerText: q.opts ? q.opts[q.correct] : q.answer,
    leaderboard: leaderboard(s),
    last: s.qi + 1 >= s.questions.length,
    typed: !q.opts ? [...s.cur.answers.values()].slice(0, 40).map(a => a.text) : null,
  });
}

/* ---- participant-paced mode: every student advances independently ---- */
function pacedQuestionPayload(s, p) {
  const q = s.questions[p.qi];
  return { i: p.qi, total: s.questions.length, type: q.type, text: q.text, opts: q.opts || null,
           timer: s.settings.timer, endsAt: Date.now() + s.settings.timer * 1000, paced: true };
}
function sendPacedQ(s, sid, p) {
  p.qT0 = Date.now();
  const sock = io.sockets.sockets.get(sid);
  if (sock) sock.emit("question", pacedQuestionPayload(s, p));
}
function pacedSummary(s) {
  return [...s.players.values()].map(p => ({
    nick: p.nick, connected: p.connected, done: !!p.done,
    answered: p.answers.filter(a => a !== undefined).length,
    correct: p.correct, score: p.score,
  }));
}
function startPaced(s) {
  s.phase = "paced";
  s.pacedStats = s.questions.map(() => ({ answered: 0, right: 0 }));
  io.to(hostRoom(s)).emit("pacedStart", { total: s.questions.length, players: pacedSummary(s) });
  for (const [sid, p] of s.players) { p.qi = 0; p.done = false; sendPacedQ(s, sid, p); }
}
function pacedAnswer(s, socket, p, data, cb) {
  if (p.done || p.qi == null || p.qi >= s.questions.length) return;
  if (p.answers[p.qi] !== undefined) { if (cb) cb({ locked: true }); return; }
  const q = s.questions[p.qi];
  const ms = Date.now() - (p.qT0 || Date.now());
  let right = false, given = null, answered = false;
  if (!(data && data.timedOut)) {
    if (q.opts) {
      const oi = (data || {}).oi | 0;
      if (oi < 0 || oi >= q.opts.length) return;
      given = q.opts[oi]; right = oi === q.correct; answered = true;
    } else {
      const text = clean((data || {}).text, 300);
      if (!text) { if (cb) cb({ error: "Type an answer first." }); return; }
      given = text; right = fuzzyCorrect(text, q.answer); answered = true;
    }
  }
  p.answers[p.qi] = { given, right };
  if (right) {
    p.correct++;
    const speed = Math.max(0, s.settings.timer * 1000 - ms) / (s.settings.timer * 1000);
    p.score += 100 + Math.round(speed * 100);
  }
  const st = s.pacedStats[p.qi];
  if (answered) { st.answered++; if (right) st.right++; }
  if (cb) cb({ locked: true });
  socket.emit("reveal", {
    answered, right,
    correct: q.opts ? q.correct : null,
    answerText: q.opts ? q.opts[q.correct] : q.answer,
    expl: s.settings.feedback ? (q.expl || "") : "",
    score: p.score, paced: true, last: p.qi + 1 >= s.questions.length,
  });
  io.to(hostRoom(s)).emit("pacedProgress", { players: pacedSummary(s) });
}

function endSession(s) {
  clearTimeout(s.cur && s.cur.timeout);
  if (s.phase === "ended") return;
  if (s.pacedStats) s.pacedStats.forEach((st, i) => {
    s.qstats[i] = { text: s.questions[i].text, acc: st.answered ? Math.round(st.right / st.answered * 100) : 0, answered: st.answered };
  });
  s.phase = "ended";
  const stats = s.qstats.filter(Boolean);
  const players = [...s.players.values()].sort((a, b) => b.score - a.score);
  io.to(hostRoom(s)).emit("ended", {
    title: s.title, code: s.code,
    avgAcc: stats.length ? Math.round(stats.reduce((a, x) => a + x.acc, 0) / stats.length) : 0,
    questions: stats,
    players: players.map(p => ({ nick: p.nick, score: p.score, correct: p.correct,
      answers: p.answers.map(a => a ? { given: a.given, right: a.right } : null) })),
  });
  players.forEach((p, idx) => {
    for (const [sid, pl] of s.players) {
      if (pl !== p) continue;
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.emit("ended", {
        nick: p.nick, score: p.score, rank: idx + 1, of: players.length,
        correct: p.correct, total: stats.length,
        review: stats.map((qs, i) => ({ text: qs.text, given: p.answers[i] ? p.answers[i].given : null, right: !!(p.answers[i] && p.answers[i].right) })),
      });
    }
  });
  setTimeout(() => sessions.delete(s.code), 60 * 60 * 1000);
}

io.on("connection", socket => {
  /* ---- teacher ---- */
  socket.on("host:create", (data, cb) => {
    if (typeof cb !== "function") return;
    try {
      const questions = (Array.isArray(data.questions) ? data.questions : []).slice(0, 100).map(q => {
        const opts = Array.isArray(q.opts) && q.opts.length >= 2 ? q.opts.slice(0, 6).map(o => clean(o, 200)).filter(Boolean) : null;
        return {
          type: opts ? (opts.length === 2 ? "tf" : "mcq") : "typed",
          text: clean(q.text, 500),
          opts,
          correct: opts ? Math.min(Math.max(0, q.correct | 0), opts.length - 1) : null,
          answer: q.answer ? clean(q.answer, 600) : null,
          expl: clean(q.expl, 600),
        };
      }).filter(q => q.text && (q.opts || q.answer));
      if (!questions.length) return cb({ error: "No usable questions — each needs options or an answer." });
      const settings = {
        timer: [10, 20, 30, 45, 60, 90, 120].includes(+(data.settings || {}).timer) ? +data.settings.timer : 20,
        feedback: (data.settings || {}).feedback !== false,
        shuffle: !!(data.settings || {}).shuffle,
        mode: (data.settings || {}).mode === "paced" ? "paced" : "instructor",
      };
      if (settings.shuffle) questions.sort(() => Math.random() - 0.5);
      const code = makeCode();
      const s = { code, hostId: socket.id, title: clean(data.title, 120) || "Live quiz",
                  settings, questions, players: new Map(), qi: -1, phase: "lobby", qstats: [], cur: {} };
      sessions.set(code, s);
      socket.data = { role: "host", code };
      socket.join(hostRoom(s));
      cb({ code, title: s.title, count: questions.length });
    } catch (e) {
      cb({ error: "Could not create the session — check the question format." });
    }
  });

  socket.on("host:start", () => {
    const s = sessions.get((socket.data || {}).code);
    if (!(s && s.hostId === socket.id && s.phase === "lobby" && s.players.size > 0)) return;
    if (s.settings.mode === "paced") startPaced(s); else startQuestion(s, 0);
  });
  socket.on("host:next", () => {
    const s = sessions.get((socket.data || {}).code);
    if (!s || s.hostId !== socket.id) return;
    if (s.phase === "question") return reveal(s); // allow forcing reveal early
    if (s.phase !== "reveal") return;
    if (s.qi + 1 >= s.questions.length) endSession(s);
    else startQuestion(s, s.qi + 1);
  });
  socket.on("host:end", () => {
    const s = sessions.get((socket.data || {}).code);
    if (s && s.hostId === socket.id && s.phase !== "ended") {
      if (s.phase === "question") reveal(s);
      endSession(s);
    }
  });

  /* ---- student ---- */
  socket.on("player:join", (data, cb) => {
    if (typeof cb !== "function") return;
    const code = String((data || {}).code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const s = sessions.get(code);
    if (!s || s.phase === "ended") return cb({ error: "Session not found — check the code with your teacher." });
    let nick = clean((data || {}).nick, 24) || "Student";
    // Reconnect support: a disconnected player with the same nickname is resumed.
    let takeover = null;
    for (const [sid, p] of s.players) {
      if (p.nick.toLowerCase() === nick.toLowerCase()) { takeover = p.connected ? "clash" : [sid, p]; break; }
    }
    let player;
    if (Array.isArray(takeover)) {
      player = takeover[1];
      player.connected = true;
      s.players.delete(takeover[0]);
      s.players.set(socket.id, player);
    } else {
      if (takeover === "clash") {
        const base = nick; let i = 2;
        while ([...s.players.values()].some(p => p.nick.toLowerCase() === nick.toLowerCase())) nick = `${base} ${i++}`;
      }
      if (s.players.size >= 300) return cb({ error: "This session is full." });
      player = { nick, score: 0, correct: 0, answers: [], connected: true };
      s.players.set(socket.id, player);
    }
    socket.data = { role: "player", code };
    socket.join(code);
    io.to(hostRoom(s)).emit("lobby", hostLobby(s));
    if (s.phase === "paced" && player.qi == null) { player.qi = 0; player.done = false; player.qT0 = Date.now(); }
    if (s.phase === "paced") io.to(hostRoom(s)).emit("pacedProgress", { players: pacedSummary(s) });
    cb({ ok: true, nick: player.nick, title: s.title, phase: s.phase,
         question: s.phase === "question" ? publicQuestion(s)
                 : (s.phase === "paced" && !player.done && player.qi < s.questions.length ? pacedQuestionPayload(s, player) : null),
         alreadyAnswered: s.phase === "question" ? s.cur.answers.has(socket.id)
                        : (s.phase === "paced" ? player.answers[player.qi] !== undefined : false) });
  });

  socket.on("player:answer", (data, cb) => {
    const s = sessions.get((socket.data || {}).code);
    if (!s || !s.players.has(socket.id)) { if (cb) cb({ error: "Not accepting answers right now." }); return; }
    if (s.phase === "paced") return pacedAnswer(s, socket, s.players.get(socket.id), data, cb);
    if (s.phase !== "question") { if (cb) cb({ error: "Not accepting answers right now." }); return; }
    if (s.cur.answers.has(socket.id)) { if (cb) cb({ locked: true }); return; }
    const q = s.questions[s.qi];
    const ms = Date.now() - s.cur.t0;
    if (q.opts) {
      const oi = (data || {}).oi | 0;
      if (oi < 0 || oi >= q.opts.length) return;
      s.cur.answers.set(socket.id, { oi, ms });
    } else {
      const text = clean((data || {}).text, 300);
      if (!text) { if (cb) cb({ error: "Type an answer first." }); return; }
      s.cur.answers.set(socket.id, { text, ms });
    }
    if (cb) cb({ locked: true });
    io.to(hostRoom(s)).emit("progress", { answered: s.cur.answers.size, of: connectedCount(s), counts: answerCounts(s) });
    if (s.cur.answers.size >= connectedCount(s)) reveal(s);
  });

  socket.on("player:next", () => {
    const s = sessions.get((socket.data || {}).code);
    if (!s || s.phase !== "paced" || !s.players.has(socket.id)) return;
    const p = s.players.get(socket.id);
    if (p.done || p.answers[p.qi] === undefined) return; // must answer (or time out) first
    p.qi++;
    if (p.qi >= s.questions.length) {
      p.done = true;
      socket.emit("pacedFinished", { score: p.score, correct: p.correct, total: s.questions.length });
      io.to(hostRoom(s)).emit("pacedProgress", { players: pacedSummary(s) });
      if ([...s.players.values()].every(x => x.done || !x.connected)) endSession(s);
    } else {
      sendPacedQ(s, socket.id, p);
      io.to(hostRoom(s)).emit("pacedProgress", { players: pacedSummary(s) });
    }
  });

  socket.on("disconnect", () => {
    const { role, code } = socket.data || {};
    const s = sessions.get(code);
    if (!s) return;
    if (role === "player" && s.players.has(socket.id)) {
      s.players.get(socket.id).connected = false;
      io.to(hostRoom(s)).emit("lobby", hostLobby(s));
    }
    if (role === "host" && s.hostId === socket.id && s.phase === "lobby") {
      // Host left before starting: close the room after a grace period.
      setTimeout(() => { if (sessions.get(code) && sessions.get(code).phase === "lobby") sessions.delete(code); }, 10 * 60 * 1000);
    }
  });
});

server.listen(PORT, () => console.log(`Ambit Live running on http://localhost:${PORT}`));
