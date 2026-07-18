/* Test: teacher refresh mid-session → host:resume reclaims the session. */
const { io } = require("socket.io-client");
const URL = process.argv[2] || "http://localhost:3000";
const questions = [
  { text: "Q1", opts: ["a", "b"], correct: 0, expl: "" },
  { text: "Q2", opts: ["a", "b"], correct: 1, expl: "" },
];

const h1 = io(URL);
h1.on("connect", () => {
  h1.emit("host:create", { title: "Resume test", questions, settings: { timer: 10 } }, res => {
    if (res.error || !res.hostKey) { console.error("create failed / no hostKey"); process.exit(1); }
    const { code, hostKey } = res;
    console.log("created", code, "hostKey ok");
    const p = io(URL);
    p.on("connect", () => p.emit("player:join", { code, nick: "Bot" }, () => {
      console.log("bot joined; teacher 'refreshes' now");
      h1.disconnect();
      setTimeout(() => {
        const h2 = io(URL);
        h2.on("connect", () => h2.emit("host:resume", { code, hostKey }, snap => {
          if (snap.error) { console.error("resume failed:", snap.error); process.exit(1); }
          console.log("resumed in phase:", snap.phase, "| players:", snap.lobby.players.map(x => x.nick).join(","));
          h2.emit("host:start");
        }));
        h2.on("question", q => {
          console.log("host receives question after resume:", q.text);
          // second refresh mid-question
          h2.disconnect();
          const h3 = io(URL);
          h3.on("connect", () => h3.emit("host:resume", { code, hostKey }, snap2 => {
            if (snap2.error || snap2.phase !== "question" || !snap2.question) { console.error("mid-question resume failed"); process.exit(1); }
            console.log("mid-question resume ok — phase:", snap2.phase, "q:", snap2.question.text, "progress:", JSON.stringify(snap2.progress));
            console.log("=== RESUME TEST PASSED ===");
            process.exit(0);
          }));
        });
      }, 400);
    }));
    p.on("question", () => setTimeout(() => p.emit("player:answer", { oi: 0 }), 150));
  });
});
setTimeout(() => { console.error("RESUME TEST TIMEOUT"); process.exit(1); }, 20000);
