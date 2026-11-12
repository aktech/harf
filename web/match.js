// Matching for the command palette: a query
// matches a title from its start, at a word start, inside a word, word by
// word, or by word initials, ranked in that order. Case and accents are
// ignored. Each match carries the [start, end) ranges of the title it covers.

const isWordChar = (c) => /[\p{L}\p{N}]/u.test(c);

// fold lowers case and drops accents, keeping for each folded character its
// index in the original and noting where words start.
function fold(original) {
  let text = '';
  const at = [];
  const starts = [];
  let prev = '';
  for (let i = 0; i < original.length; i++) {
    const c = original[i];
    const f = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    // A word starts after a separator, or at a capital after a lower case letter.
    if (isWordChar(c) && (!isWordChar(prev) || (prev !== prev.toUpperCase() && c !== c.toLowerCase()))) starts.push(text.length);
    text += f;
    for (let k = 0; k < f.length; k++) at.push(i);
    prev = c;
  }
  return { text, at, starts };
}

const PREFIX = 1000, WORD = 800, SUBSTRING = 600, WORDS = 500, INITIALS = 400;
const span = (f, from, length) => [f.at[from], f.at[from + length - 1] + 1];

// words: every query word starts a word of the text, in order.
function words(f, q) {
  const ranges = [];
  let w = 0;
  for (const part of q.split(' ')) {
    while (w < f.starts.length && !f.text.startsWith(part, f.starts[w])) w++;
    if (w === f.starts.length) return null;
    ranges.push(span(f, f.starts[w], part.length));
    w++;
  }
  return ranges;
}

// initials: the query is made of word beginnings, in order ("nc", "newch").
function initials(f, q, from = 0, w = 0) {
  if (from === q.length) return [];
  for (let i = w; i < f.starts.length; i++) {
    const s = f.starts[i];
    let n = 0;
    while (from + n < q.length && f.text[s + n] === q[from + n]) n++;
    for (let take = n; take > 0; take--) {
      const rest = initials(f, q, from + take, i + 1);
      if (rest) return [span(f, s, take), ...rest];
    }
  }
  return null;
}

// match ranks text against query: null when it does not match.
export function match(text, query) {
  const q = fold(String(query).trim().replace(/\s+/g, ' ')).text;
  if (!q) return null;
  const f = fold(String(text));
  const tie = (pos) => -pos - f.text.length / 100; // earlier and shorter wins
  if (f.text.startsWith(q)) return { score: PREFIX + tie(0), ranges: [span(f, 0, q.length)] };
  const word = f.starts.find((s) => f.text.startsWith(q, s));
  if (word !== undefined) return { score: WORD + tie(word), ranges: [span(f, word, q.length)] };
  const sub = f.text.indexOf(q);
  if (sub >= 0) return { score: SUBSTRING + tie(sub), ranges: [span(f, sub, q.length)] };
  if (q.includes(' ')) {
    const r = words(f, q);
    return r ? { score: WORDS + tie(r[0][0]), ranges: r } : null;
  }
  const r = initials(f, q);
  return r && r.length > 1 ? { score: INITIALS + tie(r[0][0]), ranges: r } : null;
}

// matchItem is the better of a title match and, at half the rank and
// without marks, a match on one of the item's keywords.
function matchItem(item, query) {
  let best = match(item.label, query);
  for (const k of item.keywords || []) {
    const m = match(k, query);
    if (m && (!best || m.score / 2 > best.score)) best = { score: m.score / 2, ranges: [] };
  }
  return best;
}

// rank keeps the rows that match query, best first, each with its marked
// ranges, and orders the sections by their best row. Empty sections go.
export function rank(sections, query) {
  if (!String(query).trim()) return [];
  return sections
    .map((s) => {
      const rows = s.items.flatMap((item) => {
        const m = matchItem(item, query);
        return m ? [{ item: { ...item, ranges: m.ranges }, score: m.score }] : [];
      });
      rows.sort((a, b) => b.score - a.score);
      return { section: { ...s, items: rows.map((r) => r.item) }, best: rows.length ? rows[0].score : 0 };
    })
    .filter((x) => x.section.items.length)
    .sort((a, b) => b.best - a.best)
    .map((x) => x.section);
}
