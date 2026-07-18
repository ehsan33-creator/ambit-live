/* End-to-end protocol test: simulates a teacher hosting a full session.
 * Usage: node test/host.js  — creates session, prints code, starts when
 * 3+ players join, advances through all questions, prints the report. */
const { io } = require("socket.io-client");
const { execFile } = require("child_process");
const path = require("path");

const URL = process.argv[2] || "http://localhost:3000";
const questions = [
  { text: "Negara kita merdeka pada tahun berapa?", opts: ["1955", "1957", "1963", "1969"], correct: 1, expl: "31 Ogos 1957." },
  { text: "Perlembagaan Persekutuan ialah undang-undang tertinggi negara.", opts: ["Betul", "Salah"], correct: 0, expl: "" },
  { text: "Apakah maksud kedaulatan?", answer: "kekuasaan tertinggi sesebuah negara untuk mentadbir dan menggubal undang-undang", expl: "" },
];

const s = io(URL);
let started = false;

s.on("connect", () => {
  s.emit("host:create", {
    title: "E2E Test — Kedaulatan Negara",
    questions,
    settings: { timer: 10, feedback: true, shuffle: false },
  }, res => {
    if (res.error) { console.error("CREATE FAILED:", res.error); process.exit(1); }
    console.log("SESSION CREATED:", res.code, "-", res.count, "questions");
    // spawn 4 bot students against this code
    const bots = execFile("node", [path.join(__dirname, "bots.js"), res.code, "4", URL]);
    bots.stdout.on("data", d => process.stdout.write("  [bot] " + d));
    bots.stderr.on("data", d => process.stderr.write("  [bot!] " + d));
  });
});
s.on("lobby", ({ players }) => {
  const on = players.filter(p => p.connected).length;
  console.log("LOBBY:", players.map(p => p.nick).join(", "), `(${on} connected)`);
  if (on >= 4 && !started) { started = true; console.log(">>> starting quiz"); s.emit("host:start"); }
});
s.on("question", q => console.log(`QUESTION ${q.i + 1}/${q.total}:`, q.text, q.opts ? "[MCQ]" : "[typed]"));
s.on("progress", p => console.log("  progress:", p.answered, "of", p.of, p.counts ? JSON.stringify(p.counts) : ""));
s.on("revealHost", r => {
  console.log("  REVEAL — acc:", r.acc + "%", "answered:", r.answered,
    r.counts ? "counts:" + JSON.stringify(r.counts) : "", r.typed ? "typed:" + JSON.stringify(r.typed) : "");
  console.log("  leaderboard:", r.leaderboard.map(p => `${p.nick}:${p.score}`).join(" "));
  setTimeout(() => s.emit("host:next"), 800);
});
s.on("ended", rep => {
  console.log("\n=== REPORT ===");
  console.log("avg accuracy:", rep.avgAcc + "%");
  rep.questions.forEach((q, i) => console.log(` Q${i + 1}: ${q.acc}% (${q.answered} answered)`));
  rep.players.forEach((p, i) => console.log(` #${i + 1} ${p.nick} — ${p.score} pts, ${p.correct} correct`));
  console.log("=== E2E TEST PASSED ===");
  process.exit(0);
});
setTimeout(() => { console.error("E2E TIMEOUT"); process.exit(1); }, 90000);
