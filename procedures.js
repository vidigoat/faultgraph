/**
 * Following the manual's own cross-references.
 *
 * A troubleshooting table points rather than explains. "Water is left in the appliance at the end
 * of the program" → "Clean the Filters, Page 35." Read aloud, that is an instruction to go and find
 * a page, to somebody on a kitchen floor who is using this precisely because they cannot. And an
 * agent handed only that line filled the gap on a live run — "turn the dishwasher off and open it
 * up, take out the filters and wash them thoroughly" — which is plausible and is not what page 35
 * says. Page 35 has seven numbered steps and a warning about the sump.
 *
 * So the pointer is followed. In the library this was written for, 111 remedies across 18 of 19
 * reviewed machines end in "Page N".
 *
 * ── How a page is read ─────────────────────────────────────────────────────
 *
 * These manuals are set in two columns, and `pdftotext -layout` keeps them side by side; read
 * line by line, a procedure's steps interleave with whatever sits in the other column. So each page
 * is split at its gutter — the character column that is blank on nearly every line — and read left
 * column, then right, then the next page the same way, because procedures run over.
 *
 * Then: find the heading the remedy names ("Clean the Filters" is printed as "Cleaning filters"),
 * and take the numbered steps that follow it IN SEQUENCE — 1, 2, 3 — across the column and page
 * break. A number out of sequence, or the next numbered heading, ends it. Lines after a finished
 * sentence are the manual's notes under that step ("Ensure that foreign objects do not fall into
 * the sump") and are kept as notes, because they are the part people skip and should not.
 *
 * Nothing is rephrased. A step is the manual's sentence with its line breaks and hyphenation
 * undone, and `check` re-finds every one in the page text before anything is kept.
 */

/** The same crude stem the library matches symptoms with: "Cleaning filters" meets "Clean the Filters". */
const stem = (w) => {
  let out = w.toLowerCase();
  if (out.length > 5 && out.endsWith('ing')) out = out.slice(0, -3);
  else if (out.length > 4 && out.endsWith('ed')) out = out.slice(0, -2);
  else if (out.length > 4 && out.endsWith('es')) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss')) out = out.slice(0, -1);
  if (out.length > 3 && out.at(-1) === out.at(-2) && !'aeiou'.includes(out.at(-1))) out = out.slice(0, -1);
  if (out.length > 3 && out.endsWith('e')) out = out.slice(0, -1);
  return out;
};
const NOISE = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'on', 'in', 'your', 'you', 'it']);
const words = (s) => (String(s).toLowerCase().match(/[a-z]{2,}/g) || []).filter((w) => !NOISE.has(w)).map(stem);

/** "Clean the Filters, Page 35." → { title: 'Clean the Filters', page: 35 } */
function reference(remedy) {
  const m = /^(.*?)[\s,.;:→"“”-]*\bPage\s+(\d{1,3})\s*\.?\s*$/i.exec(String(remedy || '').trim());
  if (!m) return null;
  const title = m[1].replace(/["“”→]/g, ' ').replace(/\s+/g, ' ').trim();
  return title ? { title, page: Number(m[2]) } : null;
}

/**
 * Split a `-layout` page into its columns, in reading order.
 *
 * Per BAND, not per page: a page can open with a full-width table and end in two columns (the
 * SGE53C55UC's page 48 does exactly that, and the drain-pump procedure is in the second half), so
 * one gutter for the whole page finds none. The page is cut into bands at blank lines, each band's
 * gutter is found — the widest run of character positions in the middle half that is a space on at
 * least 92% of the band's lines long enough to reach it — and neighbouring bands that share a gutter
 * are merged back into one region, so a column that runs the height of the page is still read top
 * to bottom before the next one.
 */
function gutterOf(lines) {
  const long = lines.filter((l) => l.trim());
  const width = Math.max(0, ...long.map((l) => l.length));
  if (width < 40 || long.length < 3) return null;
  const blankAt = (x) => {
    const reach = long.filter((l) => l.length > x);
    if (reach.length < Math.max(2, long.length * 0.3)) return false;
    return reach.filter((l) => l[x] === ' ').length / reach.length >= 0.92;
  };
  let best = null;
  let run = null;
  for (let x = Math.floor(width * 0.25); x < Math.floor(width * 0.75); x++) {
    if (blankAt(x)) {
      run = run ? { from: run.from, to: x } : { from: x, to: x };
      if (!best || run.to - run.from > best.to - best.from) best = { ...run };
    } else {
      run = null;
    }
  }
  return best && best.to - best.from >= 1 ? best : null;
}

function columns(text) {
  const lines = String(text).split('\n');
  const bands = [];
  let band = [];
  for (const l of lines) {
    if (!l.trim()) { if (band.length) bands.push(band); band = []; } else band.push(l);
  }
  if (band.length) bands.push(band);

  /*
   * Where the right column's text starts — per band, then bands that agree are merged.
   *
   * Looking for a blank gutter gave a slightly different answer per band, and bands that did not
   * quite agree were read as separate regions — left, right, left, right — which put the other
   * column's "1. Unscrew the upper spray arm" in the middle of the filter procedure and ended it at
   * step 4 of 7. The right column's LEFT EDGE is steadier: its lines start at the same character
   * after a run of spaces. But per band, not per page: page 48 opens with a full-width table whose
   * second column starts at 26, and a page-wide vote cut the procedure below it at 26 as well.
   */
  const width = Math.max(0, ...lines.map((l) => l.length));
  const edgeOf = (b) => {
    const starts = new Map();
    for (const l of b) {
      const re = /\s{3,}(\S)/g;
      let m;
      while ((m = re.exec(l))) {
        const x = m.index + m[0].length - 1;
        if (x >= width * 0.25 && x <= width * 0.75) starts.set(x, (starts.get(x) || 0) + 1);
      }
    }
    /*
     * The LEFTMOST well-supported start, not the commonest. A column's continuation lines are
     * indented past its edge ("5. Pry the pump cover off using a" / "   spoon and grip it…"), and on
     * page 48 the indented start outnumbered the edge — which cut "5." off its own step.
     */
    const most = Math.max(0, ...starts.values());
    const edge = [...starts].filter(([, n]) => n >= Math.max(2, most * 0.5)).map(([x]) => x).sort((a, c) => a - c)
      .find((x) => fitsEdge(b, x));
    return edge ?? null;
  };
  function crosses(l, R) { return l.length > R && l[R - 1] !== ' ' && l[R] !== ' '; }
  function fitsEdge(b, R) { return R != null && b.filter((l) => crosses(l, R)).length <= b.length * 0.08; }

  const regions = [];
  for (const b of bands) {
    const last = regions.at(-1);
    const own = edgeOf(b);
    // Same edge as the region above (within a couple of characters), or no edge of its own and
    // nothing crossing the one above: it continues that region.
    if (last && last.R != null && fitsEdge(b, last.R) && (own == null || Math.abs(own - last.R) <= 2)) {
      last.lines.push('', ...b);
      continue;
    }
    const R = own != null && fitsEdge(b, own) ? own : null;
    if (last && last.R == null && R == null) { last.lines.push('', ...b); continue; }
    regions.push({ R, lines: [...b] });
  }

  const out = [];
  for (const r of regions) {
    if (r.R == null) { out.push(r.lines); continue; }
    out.push(r.lines.map((l) => l.slice(0, r.R).replace(/\s+$/, '')));
    out.push(r.lines.map((l) => l.slice(r.R).replace(/\s+$/, '')));
  }
  return out;
}

/** The running header — "en-us   Cleaning and maintenance" — which is not part of any step. */
function header(text) {
  const first = String(text).split('\n').find((l) => l.trim()) || '';
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  return new Set([norm(first), ...first.split(/\s{2,}/).map(norm)].filter(Boolean));
}

/** The printed page number, off the page's own footer — which is not always its index in the PDF. */
function printedNumber(text) {
  const nums = String(text).split('\n').map((l) => l.trim()).filter((l) => /^\d{1,3}$/.test(l));
  return nums.length ? Number(nums.at(-1)) : null;
}

/** Page N as printed. Falls back to the Nth page of the file when no footer says otherwise. */
function pageIndex(pages, n) {
  const i = pages.findIndex((p) => printedNumber(p) === n);
  if (i > -1) return i;
  return n - 1 < pages.length ? n - 1 : -1;
}

const STEP = /^\s*(\d{1,2})\.(?:\s+|(?=[A-Z]))(\S.*)$/; // "10.Insert" is printed without the space
const SECTION = /^\s*\d{1,2}(?:\.\d{1,2})?\s+[A-Z]/; // "16.6 Cleaning the spray arms", "18 Transportation…"

/** Undo line breaks and the hyphenation across them, and drop the gap an icon left behind. */
function join(parts) {
  let out = '';
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (/[a-z]-$/.test(out) && /^[a-z]/.test(p)) out = out.slice(0, -1) + p;
    else out = out ? `${out} ${p}` : p;
  }
  return out.replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/**
 * The procedure a remedy points at.
 *
 * @param {string[]} pages   every page's `-layout` text, in file order
 * @param {{title: string, page: number}} ref
 * @returns {{found: true, heading, page, pages: number[], steps: {n, text, notes: string[]}[]} | {found: false, reason}}
 */
function findProcedure(pages, ref) {
  const at = pageIndex(pages, ref.page);
  if (at < 0) return { found: false, reason: `the manual has no page ${ref.page}` };

  // Reading order across the referenced page and the one after it.
  const stream = [];
  for (const i of [at, at + 1]) {
    if (i >= pages.length) break;
    const skip = header(pages[i]);
    for (const col of columns(pages[i])) {
      for (const line of col) {
        if (skip.has(line.replace(/\s+/g, ' ').trim())) continue;
        stream.push({ line, page: printedNumber(pages[i]) ?? i + 1 });
      }
    }
  }

  const want = words(ref.title);
  if (!want.length) return { found: false, reason: 'the reference names nothing to look for' };

  // The heading: a short line, not a step, with every word the remedy names — and it must be on
  // the page the remedy cited, not on the next one.
  // Matched per segment: where the columns were not told apart, a heading shares its line with the
  // other column's text, and only the segment that matches is the heading.
  const startPage = stream[0]?.page;
  let start = -1;
  let heading = null;
  for (let k = 0; k < stream.length && start < 0; k++) {
    const { line, page } = stream[k];
    if (page !== startPage) continue;
    for (const seg of line.trim().split(/\s{3,}/)) {
      const t = seg.trim();
      if (!t || STEP.test(t) || t.split(/\s+/).length > 8) continue;
      const have = new Set(words(t.replace(/^\d{1,2}\.\d{1,2}\s+/, '')));
      if (want.every((w) => have.has(w))) { start = k; heading = t; break; }
    }
  }
  if (start < 0) return { found: false, reason: `no heading for "${ref.title}" on page ${ref.page}` };

  const steps = [];
  let current = null;
  let expect = 1;
  let skipping = false; // inside something that is not this procedure: the other column's text
  for (let k = start + 1; k < stream.length; k++) {
    const t = stream[k].line.trim();
    const prevBlank = !stream[k - 1].line.trim();
    // A short unpunctuated line after a gap is the next heading — "Combining the warming drawer
    // with another appliance" — and ends the procedure, or its text arrives as the last step's notes.
    if (steps.length && prevBlank && /^[A-Z]/.test(t) && !/[.!?:,;-]$/.test(t) && t.split(/\s+/).length <= 8 && !STEP.test(t)) {
      if (!skipping) break;
    }
    const m = STEP.exec(t);
    if (m) {
      if (Number(m[1]) === expect) {
        current = { n: expect, parts: [m[2]], notes: [], page: stream[k].page };
        steps.push(current);
        expect++;
        skipping = false;
        continue;
      }
      // A 1. after we have begun is another procedure starting; anything else out of sequence is
      // the neighbouring column's list. Either way, not ours.
      if (Number(m[1]) === 1 && steps.length) break;
      skipping = true;
      continue;
    }
    if (SECTION.test(t)) {
      if (steps.length && stream[k].page === steps.at(-1).page && !skipping) break;
      skipping = true;
      continue;
    }
    if (!current || skipping || !t) continue;
    if (/^\d{1,3}$/.test(t)) continue;                           // a page footer
    if (/^(Tip|Note|Notes?):/i.test(t)) { skipping = true; continue; }
    const body = join(current.parts);
    // After a finished sentence, a new capitalised line is the manual's note under this step.
    if (/[.!?]$/.test(body) && /^[A-Z]/.test(t) && !current.noteOpen) {
      current.notes.push([t]);
      current.noteOpen = true;
    } else if (current.noteOpen) {
      current.notes[current.notes.length - 1].push(t);
      if (/[.!?]$/.test(t)) current.noteOpen = false;
    } else {
      current.parts.push(t);
    }
  }

  if (!steps.length) return { found: false, reason: `"${ref.title}" is on page ${ref.page} but no numbered steps follow it` };
  // The steps have to start on the page the manual pointed at. "Aligning the appliance" on page 16
  // was followed by prose and a figure, and the numbered steps taken were the next page's — for
  // connecting a power adapter. Every word of them was on the page; none of them was the answer.
  if (steps[0].page !== startPage) {
    return { found: false, reason: `the numbered steps after "${ref.title}" begin on the next page, under what may be another heading` };
  }

  return {
    found: true,
    heading: heading.replace(/^\d{1,2}\.\d{1,2}\s+/, ''),
    page: ref.page,
    pages: [...new Set(steps.map((s) => s.page))],
    steps: steps.map((s) => ({
      n: s.n,
      text: join(s.parts),
      notes: s.notes.map((x) => join(x)),
      page: s.page,
    })),
  };
}

/*
 * `check` needs a SECOND reading of the same pages, made independently of the -layout text this
 * module parses — poppler's default reading order (`pdftotext -f N -l N+1 file -`) is the one this
 * was built against. The library runs no binaries and fetches nothing; the caller supplies it.
 */

const flat = (s) => String(s).replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/[\s\u00ad]+/g, '').toLowerCase();

/** Whether a sentence is in the text: whole, or — split by a column or a figure — in order, in short runs. */
function present(text, sentence) {
  const t = flat(text);
  if (t.includes(flat(sentence))) return true;
  const ws = String(sentence).split(/\s+/);
  let from = 0;
  for (let i = 0; i < ws.length; i += 3) {
    const run = flat(ws.slice(i, i + 3).join(' ')).replace(/-$/, '');
    const at = t.indexOf(run, from);
    // Runs must follow each other closely, or "in order somewhere on the page" proves nothing.
    if (at < 0 || (i > 0 && at - from > 160)) return false;
    from = at + run.length;
  }
  return true;
}

/**
 * Hold a procedure to the independent reading.
 *
 * Every STEP must be re-found or the whole procedure is dropped — a procedure with a wrong step in
 * it is worse than the page reference it replaces, because it will be followed. A NOTE that cannot
 * be re-found is dropped on its own: they are the manual's asides, and one garbled by a figure
 * should not cost the steps around it.
 */
function check(procedure, text) {
  if (!procedure.found) return procedure;
  const no = (reason) => ({ found: false, reason, checked: false });
  if (typeof text !== 'string') return no('no independent reading of the page to check it against');

  const bad = procedure.steps.find((s) => !present(text, s.text));
  if (bad) return no(`step ${bad.n} could not be re-found on the page word for word`);

  /*
   * Words on the page are not the same as words in THIS procedure. Reviewing the first run by eye
   * found two procedures whose every step was genuinely printed — under a different heading, on
   * the next page ("Switch on ice cube production" came back as the defrosting steps). So, in the
   * independent reading: step 1 has to follow its heading closely, and the manual's numbering must
   * not carry on past the last step kept, or the procedure is incomplete — one came back with 1 of
   * its 7 steps, the second swallowed as a note.
   */
  const t = flat(text);
  const head = t.indexOf(flat(procedure.heading));
  const lead = (s) => flat(s.split(/\s+/).slice(0, 4).join(' '));
  const first = head < 0 ? -1 : t.indexOf(lead(procedure.steps[0].text), head);
  if (head < 0 || first < 0 || first - head > 700) return no('step … does not follow its heading in the manual\'s own reading order');

  // Anywhere in the heading's region, not just straight after the last step: poppler's reading can
  // place a missed step elsewhere on the page. A neighbouring list can trip this too; that refuses
  // a good procedure, which is the direction to be wrong in.
  const last = procedure.steps.at(-1);
  const region = t.slice(head, head + 2500);
  const more = [1, 2, 3].some((k) => new RegExp(`(^|[^0-9])${last.n + k}\\.[a-z]`).test(region));
  if (more) return no(`the manual's list carries on past step …, so what was read is incomplete`);

  // Notes: the manual's asides, each re-found; not a chapter heading or a bare page pointer.
  const isNote = (n) => n.length <= 240 && present(text, n) && !/\b\d{1,2}(?:\.\d{1,2})? [A-Z][a-z]/.test(n) && !/^[→\s"“]*[^.]*,?\s*Page \d+\.?$/.test(n);
  const steps = procedure.steps.map((s) => {
    // "Connect the appliance to the electricity supply. Page 11" — the pointer is kept, apart.
    const m = /^(.*?[.!?])\s*(?:→\s*)?(?:"[^"]*",?\s*)?Page (\d+)\.?$/.exec(s.text);
    return {
      ...s,
      text: m ? m[1] : s.text,
      ...(m ? { see: Number(m[2]) } : {}),
      notes: s.notes.filter(isNote),
    };
  });
  return { ...procedure, steps, checked: true };
}

module.exports = { reference, columns, header, findProcedure, check, present, printedNumber, pageIndex, words };
