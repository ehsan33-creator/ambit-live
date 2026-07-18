/* Ambit Live — teacher (host) client */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const socket = io();

let questions = [];
let session = null;   // {code, title, count}
let curQ = null;      // host copy of current question
let tickIv = null;

function toast(msg) {
  $$(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function phase(p) {
  ["setup", "lobby", "run", "report"].forEach(x => $("#ph-" + x).hidden = x !== p);
  window.scrollTo(0, 0);
}

/* ---------- setup ---------- */
$$("#timerChips .chip").forEach(c => c.addEventListener("click", () => {
  $$("#timerChips .chip").forEach(x => x.removeAttribute("aria-pressed"));
  c.setAttribute("aria-pressed", "true");
}));
$$(".switch").forEach(s => s.addEventListener("click", () =>
  s.setAttribute("aria-pressed", s.getAttribute("aria-pressed") !== "true")));

function reparse() {
  questions = parseQuestions($("#qtext").value);
  const mcq = questions.filter(q => q.opts).length;
  const typed = questions.length - mcq;
  $("#parseStatus").textContent = questions.length
    ? `✓ ${questions.length} questions detected (${mcq} multiple choice, ${typed} typed answer)`
    : "No questions detected yet — number them and include “Jawapan:” / “Answer:” lines";
  $("#createBtn").disabled = !questions.length;
  if (questions.length && !$("#title").value) {
    const first = $("#qtext").value.trim().split("\n")[0].trim();
    if (first && !/^\d/.test(first)) $("#title").value = first.slice(0, 120);
  }
}
$("#qtext").addEventListener("input", reparse);
$("#loadSample").addEventListener("click", () => { $("#qtext").value = SAMPLE_TEXT; reparse(); });

$("#createBtn").addEventListener("click", () => {
  const settings = {
    timer: +($("#timerChips .chip[aria-pressed='true']")?.dataset.t || 20),
    shuffle: $("#swShuffle").getAttribute("aria-pressed") === "true",
    feedback: $("#swFeedback").getAttribute("aria-pressed") === "true",
  };
  socket.emit("host:create", { title: $("#title").value.trim(), questions, settings }, res => {
    if (res.error) return toast(res.error);
    session = res;
    const link = location.origin + "/join/" + res.code;
    $("#codeBig").textContent = res.code.slice(0, 3) + " " + res.code.slice(3);
    $("#lobbyTitle").textContent = `${res.title} · ${res.count} questions`;
    $("#joinLink").value = link;
    const msg = `📚 ${res.title}\nJoin our live quiz now — no sign-up needed!\nTap: ${link}\nor enter code ${res.code} at ${location.origin}/join`;
    $("#waShare").href = "https://wa.me/?text=" + encodeURIComponent(msg);
    phase("lobby");
  });
});
$("#copyLink").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#joinLink").value);
  toast("Join link copied — paste it in your class group");
});
$("#cancelBtn").addEventListener("click", () => location.reload());

/* ---------- lobby ---------- */
socket.on("lobby", ({ players }) => {
  $("#joiners").innerHTML = players.length
    ? players.map(p => `<span class="joiner ${p.connected ? "" : "off"}"><span class="dot"></span>${esc(p.nick)}</span>`).join("")
    : `<span class="muted">Waiting for students…</span>`;
  const on = players.filter(p => p.connected).length;
  $("#startBtn").disabled = on < 1;
  $("#startBtn").textContent = on < 1 ? "Start quiz →" : `Start quiz with ${on} student${on === 1 ? "" : "s"} →`;
});
$("#startBtn").addEventListener("click", () => socket.emit("host:start"));

/* ---------- run ---------- */
socket.on("question", q => {
  curQ = q;
  phase("run");
  $("#qNum").textContent = `Q${q.i + 1} / ${q.total}`;
  $("#qText").textContent = q.text;
  $("#answeredN").textContent = "0 answered";
  $("#strugglePill").hidden = true;
  $("#nextBtn").textContent = "Skip timer ⏩";
  if (q.opts) {
    $("#bars").hidden = false; $("#typedWrap").hidden = true;
    drawBars(q.opts.map(() => 0), null);
  } else {
    $("#bars").hidden = true; $("#typedWrap").hidden = false;
    $("#typedList").innerHTML = "";
    $("#typedNote").textContent = `Typed answer — model: “${q.answer}”. Answers are auto-marked by keyword match.`;
  }
  startTick(q.endsAt);
});
function startTick(endsAt) {
  clearInterval(tickIv);
  const step = () => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    $("#timer").textContent = left;
    $("#timer").classList.toggle("low", left <= 5);
    if (left <= 0) clearInterval(tickIv);
  };
  step();
  tickIv = setInterval(step, 250);
}
function drawBars(counts, correct) {
  const max = Math.max(1, ...counts);
  $("#bars").innerHTML = curQ.opts.map((o, i) => `
    <div class="ans-bar ${correct === i ? "correct" : ""}">
      <span class="lbl2">${correct === i ? "✓ " : ""}${esc(o)}</span>
      <div class="track"><div class="fill" style="width:${counts[i] / max * 100}%"></div></div>
      <span class="n">${counts[i]}</span>
    </div>`).join("");
}
socket.on("progress", ({ answered, of, counts }) => {
  $("#answeredN").textContent = `${answered} of ${of} answered`;
  if (counts && curQ && curQ.opts) drawBars(counts, null);
});
socket.on("revealHost", r => {
  clearInterval(tickIv);
  $("#timer").textContent = "0";
  if (curQ.opts && r.counts) drawBars(r.counts, r.correct);
  if (r.typed) $("#typedList").innerHTML = r.typed.map(t => `<span>${esc(t)}</span>`).join("");
  $("#accPill").hidden = false;
  $("#accPill").textContent = `This question: ${r.acc}% correct`;
  if (r.acc < 50 && r.answered > 0) {
    $("#strugglePill").hidden = false;
    $("#strugglePill").textContent = `⚠ ${100 - r.acc}% missed — worth revisiting`;
  }
  $("#lead").innerHTML = r.leaderboard.map((p, i) =>
    `<div class="lead-row"><span class="rank">${i + 1}</span><b>${esc(p.nick)}</b><span class="sc">${p.score}</span></div>`).join("");
  $("#nextBtn").textContent = r.last ? "Finish → report" : "Next question →";
});
$("#nextBtn").addEventListener("click", () => socket.emit("host:next"));
$("#endBtn").addEventListener("click", () => { if (confirm("End the session for everyone?")) socket.emit("host:end"); });

/* ---------- report ---------- */
let lastReport = null;
socket.on("ended", rep => {
  if (!rep.players) return; // student-shaped payload safety
  lastReport = rep;
  clearInterval(tickIv);
  phase("report");
  $("#repTitle").textContent = rep.title;
  $("#repSub").textContent = `${rep.players.length} students · ${rep.questions.length} questions · code ${rep.code}`;
  const top = rep.players[0];
  $("#repStats").innerHTML = `
    <div class="card stat"><div class="n">${rep.avgAcc}%</div><div class="s">class accuracy</div></div>
    <div class="card stat"><div class="n">${rep.players.length}</div><div class="s">participants</div></div>
    <div class="card stat"><div class="n" style="font-size:19px">${top ? esc(top.nick) : "—"}</div><div class="s">top scorer · ${top ? top.score : 0} pts</div></div>
    <div class="card stat"><div class="n">${rep.questions.filter(q => q.acc < 50).length}</div><div class="s">questions below 50%</div></div>`;
  $("#repQ").innerHTML = rep.questions.map((q, i) => `<tr>
    <td>Q${String(i + 1).padStart(2, "0")}</td><td style="max-width:340px">${esc(q.text)}</td>
    <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${q.acc}%;background:${q.acc >= 70 ? "var(--good)" : q.acc >= 50 ? "var(--warn)" : "var(--crit)"}"></div></div><b style="font-size:12.5px">${q.acc}%</b></div></td>
    <td>${q.answered}</td></tr>`).join("");
  $("#repS").innerHTML = rep.players.map((p, i) => `<tr>
    <td>${i + 1}</td><td style="font-weight:600">${esc(p.nick)}</td><td>${p.score}</td><td>${p.correct}/${rep.questions.length}</td></tr>`).join("");
});
$("#csvBtn").addEventListener("click", () => {
  if (!lastReport) return;
  const q = lastReport.questions;
  const head = ["Rank", "Student", "Score", "Correct", ...q.map((_, i) => `Q${i + 1}`)];
  const rows = lastReport.players.map((p, i) =>
    [i + 1, p.nick, p.score, p.correct, ...q.map((_, qi) => p.answers[qi] ? (p.answers[qi].right ? "correct" : `wrong (${p.answers[qi].given ?? "-"})`) : "no answer")]);
  const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = (lastReport.title || "ambit-live-report").replace(/[^\w\- ]+/g, "").slice(0, 60) + ".csv";
  a.click();
  toast("CSV downloaded");
});
$("#againBtn").addEventListener("click", () => location.reload());

socket.on("disconnect", () => toast("Connection lost — reconnecting…"));
socket.io.on("reconnect", () => { if (session) toast("Reconnected — note: an interrupted session may need a restart"); });

function esc(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
reparse();

/* ---------- one-click import from the Ambit studio app (#q= payload) ---------- */
function questionsToText(qs) {
  return qs.map((q, i) => {
    let block = `${i + 1}. ${q.text}`;
    if (q.opts && q.opts.length >= 2) {
      block += "\n" + q.opts.map((o, j) => `${"ABCDEF"[j]}) ${o}`).join("\n");
      block += `\nJawapan: ${"ABCDEF"[q.correct || 0]}${q.expl ? ` ${q.expl}` : ""}`;
    } else {
      block += `\nJawapan: ${q.answer || ""}`;
    }
    return block;
  }).join("\n\n");
}
(function importFromHash() {
  const m = location.hash.match(/^#q=(.+)$/);
  if (!m) return;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
    const data = JSON.parse(json);
    if (Array.isArray(data.questions) && data.questions.length) {
      if (data.title) $("#title").value = String(data.title).slice(0, 120);
      $("#qtext").value = questionsToText(data.questions.slice(0, 100));
      reparse();
      toast(`Imported ${questions.length} questions from Ambit — review and press Start session`);
    }
    history.replaceState(null, "", location.pathname);
  } catch (e) {
    toast("Couldn't read the imported questions — paste them manually instead");
  }
})();
