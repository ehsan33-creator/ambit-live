/* Ambit Live — question parser (shared with the Ambit prototype).
 * Accepts:
 *  1) Numbered Q&A text:  "1. Question…\nJawapan: …"  (or "Answer:")
 *     - A)–D) option lines become multiple choice; the answer letter marks correct.
 *     - Otherwise the answer text becomes a typed-answer question (fuzzy-marked).
 *  2) JSON array: [{text, opts?, correct?, answer?, expl?}, …]
 */
function parseQuestions(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  if (text[0] === "[") {
    try {
      const arr = JSON.parse(text);
      return Array.isArray(arr) ? arr.filter(q => q && q.text && (q.opts || q.answer)) : [];
    } catch (e) { /* fall through to text parsing */ }
  }
  const qs = [];
  const blocks = text.split(/\n(?=\s*\d{1,3}\s*[.)]\s*\S)/);
  for (const b of blocks) {
    const m = b.match(/^\s*\d{1,3}\s*[.)]\s*([\s\S]*)$/);
    if (!m) continue;
    const parts = m[1].split(/\n\s*(?:jawapan|answer|ans)\s*[:：]?\s*/i);
    const qpart = parts[0].trim();
    const ans = (parts.slice(1).join(" ") || "").trim();
    if (!qpart) continue;
    const optLines = [...qpart.matchAll(/^\s*([A-D])[.)]\s*(.+)$/gm)];
    if (optLines.length >= 2) {
      const qtext = qpart.slice(0, optLines[0].index).trim().replace(/\s*\n+\s*/g, " ");
      const opts = optLines.map(o => o[2].trim());
      const letter = (ans.match(/^[A-D]\b/i) || ["A"])[0].toUpperCase();
      qs.push({ text: qtext, opts, correct: Math.max("ABCD".indexOf(letter), 0),
                expl: ans.replace(/^[A-D][.)]?\s*/i, "") });
    } else if (ans) {
      qs.push({ text: qpart.replace(/\s*\n+\s*/g, " "),
                answer: ans.replace(/\n\s*[-•]\s*/g, " • ").replace(/\s*\n+\s*/g, " "),
                expl: "" });
    }
  }
  return qs;
}

const SAMPLE_TEXT = `Sejarah Tingkatan 5 Bab 1: Kedaulatan Negara

1. Apakah maksud kedaulatan?
Jawapan: Kekuasaan tertinggi sesebuah negara untuk mentadbir dan menggubal undang-undang tanpa campur tangan kuasa asing.

2. Negara kita mencapai kemerdekaan pada tahun berapa?
A) 1955
B) 1957
C) 1963
D) 1969
Jawapan: B

3. Nyatakan dua ciri negara berdaulat.
Jawapan: Mempunyai pemerintah sendiri • Mempunyai perlembagaan • Bebas daripada penjajahan • Diiktiraf oleh negara lain

4. Apakah tindakan pelajar untuk mempertahankan kedaulatan negara?
Jawapan: Menghormati undang-undang • Menjaga perpaduan • Mengamalkan nilai patriotisme • Tidak menyebarkan berita palsu

5. Perlembagaan Persekutuan ialah undang-undang tertinggi negara.
A) Betul
B) Salah
Jawapan: A`;
