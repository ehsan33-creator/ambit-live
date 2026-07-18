/* E2E test for participant-paced mode: each bot answers and advances on its own. */
const { io } = require("socket.io-client");
const URL = process.argv[2] || "http://localhost:3000";

const questions = [
  { text: "Q1: 1957?", opts: ["Ya", "Tidak"], correct: 0, expl: "" },
  { text: "Q2: maksud kedaulatan?", answer: "kekuasaan tertinggi negara", expl: "" },
  { text: "Q3: perlembagaan tertinggi?", opts: ["Betul", "Salah"], correct: 0, expl: "" },
];
const NICKS = ["Fast", "Medium", "Slow"];
const SPEED = { Fast: 300, Medium: 900, Slow: 1600 };

const host = io(URL);
let started = false, finishedBots = 0;

host.on("connect", () => {
  host.emit("host:create", { title: "Paced E2E", questions, settings: { timer: 10, mode: "paced", feedback: true, shuffle: false } }, res => {
    if (res.error) { console.error("CREATE FAILED", res.error); process.exit(1); }
    console.log("SESSION", res.code, "(paced)");
    NICKS.forEach(nick => spawnBot(res.code, nick));
  });
});
host.on("lobby", ({ players }) => {
  if (players.length >= 3 && !started) { started = true; console.log(">>> start (paced)"); host.emit("host:start"); }
});
host.on("pacedStart", d => console.log("HOST pacedStart total:", d.total));
host.on("pacedProgress", d => console.log("HOST progress:", d.players.map(p => `${p.nick}:${p.done ? "DONE" : p.answered}/${questions.length} s=${p.score}`).join("  ")));
host.on("ended", rep => {
  console.log("\n=== REPORT ===");
  console.log("avgAcc:", rep.avgAcc + "%", "| players:", rep.players.map(p => `${p.nick}=${p.score}(${p.correct})`).join(" "));
  rep.questions.forEach((q, i) => console.log(` Q${i + 1}: ${q.acc}% of ${q.answered}`));
  const ok = rep.players.length === 3 && rep.questions.length === 3;
  console.log(ok ? "=== PACED E2E PASSED ===" : "=== PACED E2E FAILED ===");
  process.exit(ok ? 0 : 1);
});

function spawnBot(code, nick) {
  const s = io(URL);
  s.on("connect", () => s.emit("player:join", { code, nick }, res => {
    if (res.error) console.error(nick, "join err", res.error);
    else if (res.question) answer(s, nick, res.question);
  }));
  s.on("question", q => answer(s, nick, q));
  s.on("reveal", r => {
    console.log(` ${nick}: ${r.right ? "✓" : "✗"} score=${r.score}${r.last ? " (last)" : ""}`);
    if (r.paced) setTimeout(() => s.emit("player:next"), SPEED[nick] / 2);
  });
  s.on("pacedFinished", d => { console.log(` ${nick}: FINISHED ${d.correct}/${d.total} score=${d.score}`); finishedBots++; });
  s.on("ended", rep => { if (!rep.players) console.log(` ${nick}: final rank ${rep.rank}/${rep.of}`); s.close(); });
}
function answer(s, nick, q) {
  setTimeout(() => {
    if (q.opts) s.emit("player:answer", { oi: nick === "Slow" ? 1 : 0 });
    else s.emit("player:answer", { text: nick === "Slow" ? "tak tahu" : "kekuasaan tertinggi sesebuah negara" });
  }, SPEED[nick]);
}
setTimeout(() => { console.error("PACED E2E TIMEOUT"); process.exit(1); }, 60000);
