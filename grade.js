/* Forgiving marker for typed answers.
 * Ignores case, spaces, brackets, punctuation and accents; tolerates small typos.
 * A question may carry a rubric: { accept: [alt answers], keys: [[idea, synonym…], …], min }.
 * Correct when the reply matches the model answer or any accepted answer, or
 * covers at least `min` key ideas. Without a rubric one is derived from the
 * model answer's bullet points (• ; or newlines), else word overlap is used. */

const fold = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const compact = s => fold(s).replace(/[^\p{L}\p{N}]+/gu, "");
const words = s => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const unbracket = s => String(s || "").replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ");

function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// typo allowance grows with length: exact up to 3 chars, 1 up to 6, then ~1 per 5 chars (max 3)
const allowance = n => n <= 3 ? 0 : n <= 6 ? 1 : Math.min(3, Math.floor(n / 5));
const near = (a, b) => a === b || dist(a, b, allowance(Math.min(a.length, b.length))) <= allowance(Math.min(a.length, b.length));

/* whole-answer match: same text once spacing/case/brackets are ignored, or the
 * (short) answer appears inside the student's reply */
function sameAnswer(student, model) {
  const cs = compact(student);
  for (const variant of [model, unbracket(model)]) {
    const cm = compact(variant);
    if (!cm) continue;
    if (near(cs, cm)) return true;
    if (/^\p{N}+$/u.test(cm)) { if (words(student).includes(cm)) return true; } // "1957" in "tahun 1957", not "12" in "120"
    else if (cm.length >= 2 && cm.length <= 30 && cs.includes(cm)) return true;
  }
  return false;
}

/* does the student mention this idea? `need` = share of its words required */
function mentions(student, idea, need) {
  const ci = compact(idea);
  if (!ci) return false;
  const cs = compact(student);
  if (/^\p{N}+$/u.test(ci)) return words(student).includes(ci);
  if (ci.length >= 4 && cs.includes(ci)) return true;
  const sw = words(student);
  let iw = words(idea);
  const meaningful = iw.filter(w => w.length > 2);
  if (meaningful.length) iw = meaningful;
  const hits = iw.filter(w => sw.some(s => near(s, w))).length;
  return hits >= Math.max(1, Math.ceil(iw.length * need));
}

const NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5 };
function countAsked(questionText) {
  const w = words(questionText);
  for (const x of w) {
    if (NUMS[x]) return NUMS[x];
    if (/^[1-5]$/.test(x)) return +x;
  }
  return 1;
}

function deriveRubric(model, questionText) {
  const parts = String(model || "").split(/\s*(?:•|;|\n)\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { keys: parts.map(p => [p]), min: Math.min(parts.length, countAsked(questionText)), derived: true };
}

function isCorrect(student, q) {
  if (!compact(student)) return false;
  const model = q.answer || "";
  const rub = q.rubric || {};
  if ([model, ...(rub.accept || [])].some(a => a && sameAnswer(student, a))) return true;
  const r = rub.keys && rub.keys.length ? rub : deriveRubric(model, q.text);
  if (r) {
    const need = r.derived ? 0.5 : 1; // AI/teacher keys are short ideas → every word; bullets → half
    const got = r.keys.filter(alts => alts.some(a => mentions(student, a, need))).length;
    if (got >= Math.max(1, Math.min(r.min || 1, r.keys.length))) return true;
    if (!r.derived) return false;
  }
  // fallback: enough of the model answer's meaningful words appear (typo-tolerant)
  const core = unbracket(model);
  return mentions(student, core, words(core).length <= 2 ? 1 : 0.35); // one- or two-word answers need every word
}

/* clean a rubric arriving from the AI, the studio or the host page */
function cleanRubric(r, clean) {
  if (!r || typeof r !== "object") return null;
  const str = s => clean(s, 120);
  const accept = (Array.isArray(r.accept) ? r.accept : []).slice(0, 12).map(str).filter(Boolean);
  const keys = (Array.isArray(r.keys) ? r.keys : []).slice(0, 12)
    .map(k => (Array.isArray(k) ? k : [k]).slice(0, 8).map(str).filter(Boolean)).filter(k => k.length);
  if (!accept.length && !keys.length) return null;
  const min = Math.min(Math.max(1, +r.min | 0 || 1), keys.length || 1);
  return keys.length ? { accept, keys, min } : { accept };
}

module.exports = { isCorrect, cleanRubric, compact };
