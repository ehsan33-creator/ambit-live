const { io } = require("socket.io-client");
const URL = "http://localhost:3000";
const questions = [
  { text: "Tahun merdeka?", opts: ["1955", "1957"], correct: 1, expl: "31 Ogos 1957." },
  { text: "Maksud kedaulatan?", answer: "kekuasaan tertinggi negara", expl: "Nota bab 1." },
];
const h = io(URL);
let hostCards = null, studentReview = null;
function maybeDone() {
  if (!hostCards || !studentReview) return;
  const okHost = hostCards.length === 2 && hostCards[0].back === "1957" && hostCards[1].back === "kekuasaan tertinggi negara";
  const okStu = studentReview.every(r => "answer" in r && "expl" in r);
  console.log("host cards:", JSON.stringify(hostCards));
  console.log("student review has answers/expl:", okStu);
  console.log(okHost && okStu ? "=== CARDS TEST PASSED ===" : "=== CARDS TEST FAILED ===");
  process.exit(okHost && okStu ? 0 : 1);
}
h.on("connect", () => h.emit("host:create", { title: "Cards test", questions, settings: { timer: 10 } }, res => {
  const p = io(URL);
  p.on("connect", () => p.emit("player:join", { code: res.code, nick: "Bot" }, () => h.emit("host:start")));
  p.on("question", () => setTimeout(() => p.emit("player:answer", { oi: 1 }), 100));
  p.on("ended", rep => { if (!rep.players) { studentReview = rep.review; maybeDone(); } });
  h.on("revealHost", () => setTimeout(() => h.emit("host:next"), 200));
  h.on("ended", rep => { hostCards = rep.cards; maybeDone(); });
}));
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 30000);
