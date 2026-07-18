/* Simulated students for testing: node test/bots.js <CODE> [n] [url] */
const { io } = require("socket.io-client");

const code = process.argv[2];
const N = +(process.argv[3] || 4);
const URL = process.argv[4] || "http://localhost:3000";
if (!code) { console.error("Usage: node test/bots.js <CODE> [n] [url]"); process.exit(1); }

const NAMES = ["Aina", "Hafiz", "MeiLing", "Arjun", "Siti", "Darren", "Priya", "Farid"];

for (let i = 0; i < N; i++) {
  const nick = NAMES[i % NAMES.length] + (i >= NAMES.length ? i : "");
  const s = io(URL);
  s.on("connect", () => {
    s.emit("player:join", { code, nick }, res => {
      if (res.error) { console.error(nick, "join failed:", res.error); return; }
      console.log(nick, "joined", res.title, "phase:", res.phase);
      if (res.question) answer(res.question);
    });
  });
  s.on("question", q => answer(q));
  s.on("reveal", r => console.log(nick, r.right ? "✓ right" : "✗ wrong", "score:", r.score));
  s.on("ended", rep => { console.log(nick, "FINAL rank", rep.rank, "score", rep.score); s.close(); });

  function answer(q) {
    const delay = 500 + Math.random() * Math.min(4000, q.timer * 500);
    setTimeout(() => {
      if (q.opts) {
        // 70% chance to guess "correctly" as option 1 is often right in the sample… just random
        const oi = Math.floor(Math.random() * q.opts.length);
        s.emit("player:answer", { oi }, res => console.log(nick, "answered opt", oi, res));
      } else {
        const texts = ["kekuasaan tertinggi negara mentadbir undang-undang", "tidak pasti", "menjaga perpaduan dan menghormati undang-undang"];
        const text = texts[Math.floor(Math.random() * texts.length)];
        s.emit("player:answer", { text }, res => console.log(nick, "typed:", text.slice(0, 20), res));
      }
    }, delay);
  }
}
