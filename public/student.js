/* Ambit Live — student client */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const socket = io();

let me = null;          // {nick, title}
let cur = null;         // current question payload
let score = 0;
let tickIv = null;

function show(id) {
  ["sp-join", "sp-wait", "sp-q", "sp-end"].forEach(x => $("#" + x).hidden = x !== id);
  window.scrollTo(0, 0);
}
function esc(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }

/* prefill code from /join/CODE path */
const pathCode = (location.pathname.match(/\/join\/([A-Za-z0-9]{4,8})/) || [])[1];
if (pathCode) $("#code").value = pathCode.toUpperCase();
const saved = JSON.parse(sessionStorage.getItem("ambit-live") || "null");
if (saved && saved.nick) $("#nick").value = saved.nick;
if (saved && saved.code && !$("#code").value) $("#code").value = saved.code;

function join() {
  const code = $("#code").value.trim().toUpperCase();
  const nick = $("#nick").value.trim();
  $("#joinErr").textContent = "";
  if (code.length < 4) { $("#joinErr").textContent = "Enter the session code from your teacher."; return; }
  if (!nick) { $("#joinErr").textContent = "Pick a nickname so your teacher knows it's you."; return; }
  socket.emit("player:join", { code, nick }, res => {
    if (res.error) { $("#joinErr").textContent = res.error; return; }
    me = res;
    sessionStorage.setItem("ambit-live", JSON.stringify({ code, nick: res.nick }));
    $("#waitNick").textContent = res.nick;
    $("#waitTitle").textContent = res.title;
    if (res.question) renderQuestion(res.question, res.alreadyAnswered);
    else show("sp-wait");
  });
}
$("#joinBtn").addEventListener("click", join);
$("#nick").addEventListener("keydown", e => { if (e.key === "Enter") join(); });

socket.on("question", q => renderQuestion(q, false));
function renderQuestion(q, alreadyAnswered) {
  cur = q;
  show("sp-q");
  $("#sqNum").textContent = `Q${q.i + 1} / ${q.total}`;
  $("#sScore").textContent = `${score} pts`;
  $("#sqText").textContent = q.text;
  $("#sFeed").innerHTML = alreadyAnswered ? "Answer locked in ✓" : "";
  if (q.opts) {
    $("#sTypedWrap").hidden = true;
    $("#sOpts").innerHTML = q.opts.map((o, i) => `<button class="opt-btn" data-oi="${i}">${esc(o)}</button>`).join("");
    $$(".opt-btn").forEach(b => b.addEventListener("click", () => {
      $$(".opt-btn").forEach(x => x.disabled = true);
      b.classList.add("sel");
      socket.emit("player:answer", { oi: +b.dataset.oi }, () => { $("#sFeed").textContent = "Answer locked in ✓"; });
    }));
    if (alreadyAnswered) $$(".opt-btn").forEach(x => x.disabled = true);
  } else {
    $("#sOpts").innerHTML = "";
    $("#sTypedWrap").hidden = false;
    $("#sTyped").value = ""; $("#sTyped").disabled = alreadyAnswered;
    $("#sSubmit").disabled = alreadyAnswered;
    const submit = () => {
      const text = $("#sTyped").value.trim();
      if (!text) return;
      socket.emit("player:answer", { text }, res => {
        if (res && res.locked) {
          $("#sTyped").disabled = true; $("#sSubmit").disabled = true;
          $("#sFeed").textContent = "Answer locked in ✓";
        }
      });
    };
    $("#sSubmit").onclick = submit;
    $("#sTyped").onkeydown = e => { if (e.key === "Enter") submit(); };
    if (!alreadyAnswered) setTimeout(() => $("#sTyped").focus(), 100);
  }
  startTick(q.endsAt);
}
function startTick(endsAt) {
  clearInterval(tickIv);
  const step = () => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    $("#sTimer").textContent = left;
    $("#sTimer").classList.toggle("low", left <= 5);
    if (left <= 0) clearInterval(tickIv);
  };
  step();
  tickIv = setInterval(step, 250);
}

socket.on("reveal", r => {
  clearInterval(tickIv);
  score = r.score;
  $("#sScore").textContent = `${score} pts`;
  if (cur && cur.opts) {
    $$(".opt-btn").forEach(b => {
      b.disabled = true;
      const i = +b.dataset.oi;
      if (i === r.correct) b.classList.add("right");
      else if (b.classList.contains("sel")) b.classList.add("wrong");
    });
  } else {
    $("#sTyped").disabled = true; $("#sSubmit").disabled = true;
  }
  let html = !r.answered
    ? `<span style="color:var(--warn)">⏱ Time's up — no answer</span>`
    : r.right
      ? `<span style="color:var(--good)">Correct! 🎉</span>`
      : `<span style="color:var(--crit)">Not quite</span>`;
  if (!r.right) html += `<div class="expl"><b>Answer:</b> ${esc(r.answerText)}${r.expl ? `<br>${esc(r.expl)}` : ""}</div>`;
  else if (r.expl) html += `<div class="expl">${esc(r.expl)}</div>`;
  $("#sFeed").innerHTML = html;
});

socket.on("ended", rep => {
  if (rep.players) return; // host-shaped payload safety
  clearInterval(tickIv);
  show("sp-end");
  $("#endScore").textContent = rep.score;
  $("#endRank").textContent = `#${rep.rank} of ${rep.of} · ${rep.correct}/${rep.total} correct · ${rep.nick}`;
  $("#endReview").innerHTML = rep.review.map(r => `
    <div class="review-item"><span>${r.right ? "✅" : "❌"}</span>
      <span>${esc(r.text)}${r.given != null ? `<small>Your answer: ${esc(r.given)}</small>` : `<small>No answer</small>`}</span>
    </div>`).join("");
  sessionStorage.removeItem("ambit-live");
});

/* auto-rejoin on reconnect (e.g. phone screen locked) */
socket.io.on("reconnect", () => {
  const s = JSON.parse(sessionStorage.getItem("ambit-live") || "null");
  if (s && me) socket.emit("player:join", { code: s.code, nick: s.nick }, res => {
    if (res.ok && res.question) renderQuestion(res.question, res.alreadyAnswered);
  });
});
