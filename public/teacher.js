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
  ["setup", "lobby", "run", "paced", "report"].forEach(x => $("#ph-" + x).hidden = x !== p);
  window.scrollTo(0, 0);
}

/* ---------- setup ---------- */
$$("#timerChips .chip").forEach(c => c.addEventListener("click", () => {
  $$("#timerChips .chip").forEach(x => x.removeAttribute("aria-pressed"));
  c.setAttribute("aria-pressed", "true");
}));
$$("#modeChips .chip").forEach(c => c.addEventListener("click", () => {
  $$("#modeChips .chip").forEach(x => x.removeAttribute("aria-pressed"));
  c.setAttribute("aria-pressed", "true");
  $("#modeNote").textContent = c.dataset.m === "paced"
    ? "Students move to the next question on their own as soon as they answer."
    : "You control the pace — everyone answers each question together.";
}));
function setChip(groupId, attr, value) {
  const target = $$("#" + groupId + " .chip").find(c => c.dataset[attr] == value);
  if (target) target.click();
}
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
    mode: $("#modeChips .chip[aria-pressed='true']")?.dataset.m || "instructor",
  };
  socket.emit("host:create", { title: $("#title").value.trim(), questions, settings }, res => {
    if (res.error) return toast(res.error);
    session = res;
    saveCurrentToLib(true); // anything you host is kept in your library
    try { localStorage.setItem("ambitLiveHost", JSON.stringify({ code: res.code, hostKey: res.hostKey })); } catch (e) {}
    setLobbyHeader(res.code, res.title, res.count);
    phase("lobby");
  });
});
function setLobbyHeader(code, title, count) {
  const link = location.origin + "/join/" + code;
  $("#codeBig").textContent = code.slice(0, 3) + " " + code.slice(3);
  $("#lobbyTitle").textContent = `${title} · ${count} questions`;
  $("#joinLink").value = link;
  const msg = `📚 ${title}\nJoin our live quiz now — no sign-up needed!\nTap: ${link}\nor enter code ${code} at ${location.origin}/join`;
  $("#waShare").href = "https://wa.me/?text=" + encodeURIComponent(msg);
}
function clearHostSession() { try { localStorage.removeItem("ambitLiveHost"); } catch (e) {} }
$("#copyLink").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#joinLink").value);
  toast("Join link copied — paste it in your class group");
});
$("#cancelBtn").addEventListener("click", () => { clearHostSession(); location.reload(); });

/* ---------- lobby ---------- */
function onLobby({ players }) {
  $("#joiners").innerHTML = players.length
    ? players.map(p => `<span class="joiner ${p.connected ? "" : "off"}"><span class="dot"></span>${esc(p.nick)}</span>`).join("")
    : `<span class="muted">Waiting for students…</span>`;
  const on = players.filter(p => p.connected).length;
  $("#startBtn").disabled = on < 1;
  $("#startBtn").textContent = on < 1 ? "Start quiz →" : `Start quiz with ${on} student${on === 1 ? "" : "s"} →`;
}
socket.on("lobby", onLobby);
$("#startBtn").addEventListener("click", () => socket.emit("host:start"));

/* ---------- run ---------- */
function onQuestion(q) {
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
}
socket.on("question", onQuestion);
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
function onProgress({ answered, of, counts }) {
  $("#answeredN").textContent = `${answered} of ${of} answered`;
  if (counts && curQ && curQ.opts) drawBars(counts, null);
}
socket.on("progress", onProgress);
function onRevealHost(r) {
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
}
socket.on("revealHost", onRevealHost);
$("#nextBtn").addEventListener("click", () => socket.emit("host:next"));
$("#endBtn").addEventListener("click", () => { if (confirm("End the session for everyone?")) socket.emit("host:end"); });

/* ---------- participant-paced dashboard ---------- */
let pacedTotal = 0;
function renderPaced(players) {
  $("#pacedRows").innerHTML = players.map(p => {
    const prog = p.done ? pacedTotal : p.answered;
    const pct = pacedTotal ? Math.round(prog / pacedTotal * 100) : 0;
    return `<tr>
      <td style="font-weight:600">${esc(p.nick)}${p.connected ? "" : " <span class='muted'>(offline)</span>"}${p.done ? " ✅" : ""}</td>
      <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><b style="font-size:12px">${prog}/${pacedTotal}</b></div></td>
      <td>${p.correct}</td><td>${p.score}</td></tr>`;
  }).join("");
  const top = [...players].sort((a, b) => b.score - a.score).slice(0, 8);
  $("#pacedLead").innerHTML = top.map((p, i) =>
    `<div class="lead-row"><span class="rank">${i + 1}</span><b>${esc(p.nick)}</b><span class="sc">${p.score}</span></div>`).join("");
}
socket.on("pacedStart", d => { pacedTotal = d.total; phase("paced"); renderPaced(d.players); });
socket.on("pacedProgress", d => renderPaced(d.players));
$("#pacedEnd").addEventListener("click", () => { if (confirm("End the session and generate the report?")) socket.emit("host:end"); });

/* ---------- device library (localStorage) ---------- */
const LIB_KEY = "ambitLiveLibrary";
const loadLibrary = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || "[]"); } catch (e) { return []; } };
const storeLibrary = l => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l.slice(0, 30))); } catch (e) {} };
function renderLib() {
  const lib = loadLibrary();
  $("#libBox").hidden = !lib.length;
  $("#libList").innerHTML = lib.map((s, i) => `<div class="row" style="border:1px solid var(--line-soft);border-radius:12px;padding:9px 12px;justify-content:space-between">
    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis"><b>${esc(s.title)}</b><span class="muted"> · ${s.questions.length} questions · ${new Date(s.ts).toLocaleDateString()}</span></span>
    <span class="row" style="flex-wrap:nowrap"><button class="chip" data-libload="${i}">Load</button><button class="chip" data-libdel="${i}" aria-label="Delete ${esc(s.title)}">🗑</button></span></div>`).join("");
  $$("[data-libload]").forEach(b => b.onclick = () => {
    const s = loadLibrary()[+b.dataset.libload]; if (!s) return;
    $("#title").value = s.title;
    $("#qtext").value = questionsToText(s.questions);
    reparse(); window.scrollTo(0, 0);
    toast("Loaded from library — press Start session to host it");
  });
  $$("[data-libdel]").forEach(b => b.onclick = () => {
    const l = loadLibrary(); l.splice(+b.dataset.libdel, 1); storeLibrary(l); renderLib();
  });
}
function saveCurrentToLib(silent) {
  if (!questions.length) { if (!silent) toast("No questions detected yet — nothing to save"); return; }
  const title = $("#title").value.trim() || "Untitled set";
  const lib = loadLibrary().filter(x => x.title !== title);
  lib.unshift({ title, ts: Date.now(), questions });
  storeLibrary(lib); renderLib();
  if (!silent) toast("Saved — find it under My library whenever you come back");
}
$("#saveLibBtn").addEventListener("click", () => saveCurrentToLib(false));

/* ---------- report ---------- */
let lastReport = null;
socket.on("ended", rep => {
  if (!rep.players) return; // student-shaped payload safety
  lastReport = rep;
  clearInterval(tickIv);
  clearHostSession();
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

function esc(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
reparse();
renderLib();

/* ---------- resume a running session after refresh/reconnect ---------- */
function tryResume() {
  let saved; try { saved = JSON.parse(localStorage.getItem("ambitLiveHost") || "null"); } catch (e) {}
  if (!saved || !saved.code) return;
  socket.emit("host:resume", saved, snap => {
    if (snap.error) { clearHostSession(); return; }
    session = { code: snap.code, title: snap.title, count: snap.count };
    setLobbyHeader(snap.code, snap.title, snap.count);
    if (snap.phase === "lobby") {
      phase("lobby");
      if (snap.lobby) onLobby(snap.lobby);
    } else if (snap.paced) {
      pacedTotal = snap.paced.total;
      phase("paced");
      renderPaced(snap.paced.players);
    } else if (snap.question) {
      onQuestion(snap.question);
      if (snap.progress) onProgress(snap.progress);
      if (snap.reveal) onRevealHost(snap.reveal);
    }
    toast(`Session ${snap.code} restored — carry on`);
  });
}
if (socket.connected) tryResume();
socket.on("connect", tryResume);

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
  const m = location.hash.match(/^#q=(.+)$/) || location.search.match(/[?&]q=([^&]+)/);
  if (!m) return;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
    const data = JSON.parse(json);
    if (Array.isArray(data.questions) && data.questions.length) {
      if (data.title) $("#title").value = String(data.title).slice(0, 120);
      $("#qtext").value = questionsToText(data.questions.slice(0, 100));
      reparse();
      if (data.settings) {
        if (data.settings.mode) setChip("modeChips", "m", data.settings.mode === "paced" ? "paced" : "instructor");
        if (data.settings.timer) setChip("timerChips", "t", data.settings.timer);
      }
      saveCurrentToLib(true); // imported sets land in the library automatically
      toast(`Imported ${questions.length} questions from Ambit — saved to My library`);
    }
    history.replaceState(null, "", location.pathname);
  } catch (e) {
    toast("Couldn't read the imported questions — paste them manually instead");
  }
})();
