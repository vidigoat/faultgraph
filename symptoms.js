/*
 * ── Symptom-keyed troubleshooting tables ───────────────────────────────────
 *
 * Not every manual prints fault codes. Measured across ten CURRENT Bosch US dishwasher manuals
 * fetched from the manufacturer's own site: zero fault codes between them, and ten to thirteen
 * pages each of `Fault | Cause and troubleshooting` keyed on a described symptom. A 2019 European
 * manual for the same kind of machine has ten code mentions. A 482-page self-repair-hints document
 * for a fridge-freezer has none either — it is a disassembly guide.
 *
 * So for a lot of equipment the symptom table is not a fallback, it is the only door. It has the
 * same shape as a fault table — a key, its causes, and the remedies under each — and the key is a
 * sentence instead of a code.
 *
 * `readSymptoms` is deliberately separate from `parse`. That one is keyed on codes at line starts
 * and has a test suite saying so; a second mode inside it would be how a working thing stops
 * working. The output shape matches, so both feed the same hypothesis space.
 */

/** The two headings these tables use. The capture is what fixes the column boundary. */
const HEADER = /^(\s*)(?:Fault|Problem|Symptom)\s{2,}(Cause and troubleshooting|Cause and remedy|Cause\b.*)$/im;

/** `21.1 Disposal of your old appliance` — the manual has moved on to another section. */
const SECTION_HEADING = /^\s*\d{1,2}\.\d{1,2}\s+[A-Z]/;

/*
 * A run of spaces inside a symptom is a column gap that survived the split. No symptom a manual
 * prints contains three spaces, so collapsing is a repair rather than a tidy-up.
 */
const tidy = (t) => String(t).replace(/\s{3,}\S*\s*$/, '').replace(/\s{2,}/g, ' ').trim();

/** A page number stranded mid-table by a page break. No manual prints a symptom that is only digits. */
const PAGE_NUMBER = /^\s*\d{1,4}\s*$/;

/** A cross-reference, not a remedy. `"Adding rinse aid", Page 16` tells you where to read, not what to do. */
const CROSS_REFERENCE = /^["“].*["”],?\s*(?:Page|page)\s+\d+/;

/** A numbered step is still a step. The number is scaffolding, not content. */
const stripStep = (s) => s.replace(/^\d+\.\s*/, '').trim();

/** Join a wrapped line to the one before it, healing the hyphen the typesetter added. */
function joinWrapped(a, b) {
  if (!a) return b;
  if (/[‐-]$/.test(a)) return a.replace(/[‐-]$/, '') + b;
  return `${a} ${b}`;
}

/**
 * Where column two begins, from the page's own header line.
 *
 * Taken from the page rather than guessed, because the boundary differs between manuals — 23 in one
 * of these, 25 in another — and a hard-coded column is a parser that works on the manual it was
 * written against.
 *
 * @returns {{at: number, line: number}|null}
 */
function columnBoundary(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i]);
    if (!m) continue;
    const at = lines[i].indexOf(m[2]);
    if (at > 4) return { at, line: i };
  }
  return null;
}

/*
 * Deriving the column from the rows instead was tried, and is worse.
 *
 * The idea was that the header word and the rows might be set at different columns. They are not —
 * in these manuals the causes begin exactly where `Cause and troubleshooting` begins. What differs
 * is the REMEDIES, which are indented three further, and there are more of them than there are
 * causes. So a modal column across all rows elects the remedy indent, puts the split three columns
 * too far right, and fragments every symptom on the page: "Excessive formation of foam occurs."
 * came out as "Excessive formation of Rinse foam occurs."
 *
 * The header is the right source. It is also why the indent rule works at all.
 */

/**
 * Read one page of a symptom-keyed troubleshooting table.
 *
 * @param {object} opts
 * @param {string} opts.text        the page, from `pdftotext -layout`
 * @param {string} opts.sourceName  what to cite — every remedy carries where it came from
 * @param {number} [opts.page]      page number, for the citation
 * @returns {{found: number, symptoms: object[], coverage: string, boundary: number|null}}
 */
function readSymptoms({ text, sourceName = 'service manual', page = null } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const boundary = columnBoundary(lines);

  if (!boundary) {
    /*
     * No header, no boundary, no parse. Guessing the column from the text's own whitespace was the
     * first thing tried and it finds a boundary in ordinary prose too — which produced confident
     * nonsense out of a safety page. A table says it is a table at the top of itself.
     */
    return { found: 0, symptoms: [], boundary: null, coverage: 'no column header on this page, so no table to read' };
  }

  let { at } = boundary;
  const symptoms = [];
  let current = null;   // the symptom being built
  let cause = null;     // the cause being built, inside it
  let lastKind = null;  // 'cause' | 'remedy' — what the previous right-column line was
  let leftWasBlank = true;
  let collided = 0;   // rows whose two columns run together and cannot be split
  let skipping = false; // inside a symptom whose first row collided, so none of it can be trusted
  let prose = 0;      // consecutive full-width lines: the page has moved past the table
  let lastLeft = null;  // the previous line's left column, for deciding where a skipped symptom ends

  for (let i = boundary.line + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) { leftWasBlank = true; continue; }

    /*
     * Page furniture, in the middle of a table that runs across a page break.
     *
     * Joining pages 38 and 39 puts page 38's number and page 39's column header right in the
     * middle of the rows, and the parser read both as symptoms: one called "38" and one called
     * "Fault", each with a cause underneath it scavenged from the real row next to it.
     *
     * A bare number is a page number — no manual prints a symptom that is only digits — and a
     * repeat of the header line is the table introducing itself again on the next page.
     */
    /*
     * Where the table ENDS.
     *
     * Nothing told it to stop. On a Bosch washer the fault table finishes part-way down the page
     * and the disposal section, a safety warning and the installation notes follow — and every one
     * of them came back as a symptom: "21.1 Disposal of your old appliance...", "WARNING Children
     * can lock themselves in the appliance". Seven of that machine's eight symptoms were not
     * symptoms.
     *
     * A table row always has a column gap, because column one is padded out to the boundary. Prose
     * does not. So a long line with no gap in it is the page having moved on — long, because a
     * COLLIDED row has no gap either and those are worth keeping and are never this long.
     */
    if (SECTION_HEADING.test(raw)) break;
    // Two in a row, not one. A COLLIDED table row also has no gap in it, and those are worth
    // keeping — one long gapless line proves nothing, two consecutive ones are prose.
    prose = !/\s{2,}\S/.test(raw.trim()) && raw.trim().length > at + 40 ? prose + 1 : 0;
    if (prose >= 2) break;

    if (PAGE_NUMBER.test(raw) || HEADER.test(raw)) {
      /*
       * A repeated header is also where the columns MOVE.
       *
       * Page 38 sets its table at column 23 and page 39 sets the same table at 27, because the
       * typesetter laid each page out on its own. Carrying the first page's boundary across the
       * seam put every cause on the second page three columns to the right of where the parser
       * expected it — so the indent rule read them as remedies and five symptoms came back with no
       * cause at all, their cause text swallowed into the step list.
       *
       * So the boundary is re-anchored here rather than fixed once for the whole run.
       */
      const again = HEADER.exec(raw);
      if (again) {
        const moved = raw.indexOf(again[2]);
        if (moved > 4) at = moved;
      }
      leftWasBlank = true;
      current = null;
      cause = null;
      lastKind = null;
      continue;
    }

    /*
     * The boundary is a guide, not a guillotine — and sometimes there is no boundary at all.
     *
     * `Home Connect cannot Home Connect set incorrectly.` is one line of a two-column table whose
     * columns have COLLIDED: the left column ran long, the typesetter squeezed the gap to a single
     * space, and the only thing separating "Home Connect cannot" from "Home Connect set
     * incorrectly." is that space. Slicing at the boundary gave "Home Connect cannot Hom" and
     * "e Connect set incorrectly."; backing off one word gave "...cannot Home" and "Connect set
     * incorrectly.", which is wrong in a way that looks right.
     *
     * There is no signal in the text layer that recovers it. So the row is dropped and counted,
     * because a mangled symptom on screen is worse than an absent one — a reviewer can reject a
     * row they can see, and cannot repair the words in it.
     */
    let cut = splitAt(raw, at);

    /*
     * A split that landed one word inside the right column.
     *
     * `Home Connect cannot There is a technical error.` splits at a space that LOOKS like the
     * column gap and is not, giving the symptom "Home Connect cannot There" and the cause "is a
     * technical error." Same shape on another row: "Wash cycle starts up You" / "did not wait
     * until the cycle ended."
     *
     * The signal is precise: a cause that begins with a lowercase word. Manuals do not start a
     * sentence in lower case. So when the left column's last word is capitalised and the right
     * begins lower, the word is handed back — and the guard is strict enough that a wrapped
     * continuation, which is the other thing that begins lower, never reaches here as a cause.
     */
    if (cut !== null) {
      const l = raw.slice(0, cut).trimEnd();
      const r = raw.slice(cut).trimStart();
      const lastWord = l.split(/\s+/).pop() || '';
      if (/^[a-z]/.test(r) && /^[A-Z]/.test(lastWord) && l.split(/\s+/).length > 1) {
        const back = l.lastIndexOf(lastWord);
        if (back > 0) cut = back;
      }
    }

    /*
     * A collided row takes its whole symptom with it.
     *
     * The line that cannot be split is the one that STARTS a symptom — the left column ran long
     * precisely because it was the first line of a long description. Dropping only that line left
     * its continuations behind as orphans, and the page came out listing symptoms called "foam
     * occurs.", "ing." and "be implemented correctly."
     *
     * So skip forward until a symptom plainly begins again — see the `skipping` block below for
     * what "plainly" turned out to have to mean.
     */
    if (cut === null) {
      collided++;
      skipping = true;
      current = null;
      cause = null;
      lastKind = null;
      leftWasBlank = false;
      // Judged against the collided line itself, not against nothing: its left portion is a
      // symptom mid-sentence, so the line after it is a continuation rather than a fresh start.
      lastLeft = raw.slice(0, at).trim();
      continue;
    }

    if (skipping) {
      /*
       * A skipped symptom ends where the next one begins, and the signal is the same one that
       * starts a symptom anywhere else: a left column with something in it, following a left
       * column that was blank or had finished its sentence.
       *
       * The blank-line half alone was not enough — in a dense table every row has something in its
       * left column, so the skip never cleared and it swallowed the rest of the page.
       */
      const thisLeft = raw.slice(0, at).trim();
      const ended = !lastLeft || /[.!?:]$/.test(lastLeft);
      lastLeft = thisLeft;
      if (thisLeft && ended) skipping = false;
      else continue;
    }
    const left = raw.slice(0, cut).trim();
    const rightRaw = raw.slice(cut);
    const right = rightRaw.trim();
    // Indent measured from the boundary: flush is a cause, past it is a remedy under that cause.
    const indent = Math.max(0, (rightRaw.length - rightRaw.trimStart().length) - (at - cut));

    /* ── column one: the symptom ──────────────────────────────────────────── */

    if (left) {
      /*
       * A new symptom starts when the one before it is FINISHED, not merely when the left column
       * was blank. Two symptoms can sit on consecutive lines — `...is not estab-` / `lished.` then
       * `WLAN display is flash-` — and a blank-line rule merged them into
       * "Connection to home network is not established. WLAN display is flashing."
       *
       * Sentence-ending punctuation is the signal, and it is the typesetter's own: a wrapped line
       * ends mid-phrase or on a hyphen, a finished one ends on a full stop.
       */
      const finished = current && /[.!?:]$/.test(current.symptom);
      if (leftWasBlank || finished) {
        current = { symptom: left, causes: [], line: i };
        symptoms.push(current);
        cause = null;
        lastKind = null;
      } else if (current) {
        current.symptom = joinWrapped(current.symptom, left);
      } else {
        current = { symptom: left, causes: [], line: i };
        symptoms.push(current);
      }
      leftWasBlank = false;
    } else {
      leftWasBlank = true;
    }

    /* ── column two: causes, and the remedies under them ──────────────────── */

    if (!right || !current) continue;
    if (CROSS_REFERENCE.test(right)) continue;

    /*
     * A numbered step is a remedy wherever it sits.
     *
     * `1. Add Rinse aid` is printed flush with the boundary in these manuals, not indented, so the
     * indent rule read it as a cause and glued three repair steps into one cause label: "No rinse
     * aid. 1. Add Rinse aid Page 16. 2. Set the amount of rinse aid to be dispensed."
     */
    const numbered = /^\d+\.\s/.test(right);

    /*
     * A line flush with the boundary, sitting between two NUMBERED steps of the same cause, is
     * explanation — not a new cause.
     *
     *   Electronics have detected a fault.          <- cause
     *   1. Press the main switch for 4 seconds.     <- step
     *   The appliance is reset and restarted.       <- what happens next, printed flush
     *   2. If the problem occurs again:             <- step
     *
     * The indent rule read those middle lines as causes, so "All LEDs light up or flash" came out
     * with four causes where the manual has two — and the extra pair were "This process can take
     * approx. 30 minutes." and "The appliance is reset and restarted." An owner told either of
     * those is a CAUSE of their fault is worse off than one told nothing.
     *
     * Only after a numbered step, because that is what marks a cause as having an ordered procedure
     * underneath it. After an ordinary unnumbered remedy, a flush line is the next cause — which is
     * how the foam rows on every dishwasher page read.
     *
     * It is a heuristic and it leans on layout: the NEXT cause is reachable because a procedure's
     * later lines are indented continuations, which put `lastKind` back to `remedy` before the
     * cause arrives. Compress a fixture by dropping those continuation lines and this rule will
     * swallow the cause after them. Nothing in the text distinguishes "This process can take approx.
     * 30 minutes." from "Electronics have detected a fault." except where they sit, so a fixture
     * for this has to be the real page rather than a tidy version of it.
     */
    /*
     * Which flush line after a numbered step is explanation, and which is the next cause.
     *
     * Both look identical on their own line. The layout decides it, one line ahead:
     *
     *   1. Wait until the software update has been installed.
     *   This process can take approx. 30 minutes.      <- explanation
     *   2. If the appliance is not ready to use...      <- the sequence continues, FLUSH
     *
     *   2. Clean the Drain pump.
     *   Program has not yet ended.                      <- a new cause
     *      Wait until the program ends...               <- its remedy, INDENTED
     *
     * An explanation sits between two steps of one procedure, so the line after it is flush. A
     * cause is followed by its own remedies, so the line after it is indented. Without this, the
     * rule that stopped explanations becoming causes started swallowing causes into remedies —
     * trading one silent error for another.
     */
    const lookahead = (() => {
      for (let j = i + 1; j < lines.length; j++) {
        const nxt = lines[j];
        if (!nxt.trim()) continue;
        const cut2 = splitAt(nxt, at);
        if (cut2 === null) return null;
        const r = nxt.slice(cut2);
        if (!r.trim()) return null;
        return Math.max(0, (r.length - r.trimStart().length) - (at - cut2));
      }
      return null;
    })();

    const midProcedure =
      lastKind === 'step' && indent === 0 && !numbered && lookahead === 0;
    if (midProcedure) {
      const last = cause && cause.remedies[cause.remedies.length - 1];
      if (last) last.text = joinWrapped(last.text, right);
      continue;
    }

    if (indent === 0 && !numbered) {
      /*
       * Flush with the boundary. A new cause — unless the previous right-column line was also a
       * cause, in which case this is the rest of it wrapping. "Detergent or machine care product
       * used causes ex-" / "cessive foaming." is one cause, not two.
       */
      if (lastKind === 'cause' && cause) {
        cause.label = joinWrapped(cause.label, right);
      } else {
        cause = { label: right, remedies: [], line: i };
        current.causes.push(cause);
      }
      lastKind = 'cause';
    } else {
      const step = stripStep(right);
      if (!step) continue;
      if (!cause) {
        // A remedy with no cause above it. The manual gave a step and no reason; keep it under an
        // unnamed cause rather than dropping a real instruction on the floor.
        cause = { label: null, remedies: [], line: i };
        current.causes.push(cause);
      }
      // Remedies wrap too, and a wrapped remedy is not a second remedy.
      const last = cause.remedies[cause.remedies.length - 1];
      if (lastKind === 'remedy' && last && !/[.:!?]$/.test(last.text)) {
        last.text = joinWrapped(last.text, step);
      } else {
        cause.remedies.push({ text: step, line: i });
      }
      lastKind = numbered ? 'step' : 'remedy';
    }
  }

  /*
   * A symptom with no causes is a row we saw the left of and could not read the right of. Dropped,
   * and counted, so the coverage line is about what was recovered rather than what was noticed.
   */
  /*
   * One symptom, printed twice because the table crossed a page.
   *
   * A row that runs past the bottom of a page has its symptom repeated in the left column at the
   * top of the next one — that is the manual being helpful — and after the header reset it arrived
   * here as a second symptom with the same words and the leftovers of the first one's causes. On
   * one machine that produced two entries called "All LEDs light up or flash.", the second with no
   * cause at all.
   *
   * Merged only when they are ADJACENT and identical. A manual that genuinely lists the same
   * symptom twice in different places is telling you something, and this must not flatten that.
   */
  /*
   * Compared AFTER tidying, which is where this quietly stopped working.
   *
   * The merge ran on the raw joined text and the tidy ran later, so two halves of one symptom that
   * differed only by a stray column-gap fragment never matched — and "All LEDs light up or flash."
   * came back twice on five machines, the second with a cause carrying no label at all.
   */
  for (const s of symptoms) s.symptom = tidy(s.symptom);

  /*
   * Dropped first, THEN merged — and getting that order wrong left the bug half-fixed.
   *
   * A row the parser could see the left of and not the right of sits between the two halves of a
   * split symptom. Merging before dropping it means the halves are not adjacent and never match;
   * dropping first puts them next to each other, which is where they were on the page.
   */
  const dropped = symptoms.filter((s) => !s.causes.length).length + collided;
  const usable = symptoms.filter((s) => s.causes.length);

  for (let k = usable.length - 1; k > 0; k--) {
    if (usable[k].symptom !== usable[k - 1].symptom) continue;

    const before = usable[k - 1].causes;
    const after = [...usable[k].causes];

    /*
     * The seam falls inside a cause, not between two of them.
     *
     * A procedure that runs past the bottom of a page carries on at the top of the next one with
     * its steps and without its cause — the cause was printed once, back on the first page. Joined
     * naively that became a second cause with no label at all, sitting under the symptom as though
     * the manual had listed a reason and left it blank.
     *
     * It is the same cause. Its steps belong to the last one of the half above.
     */
    if (after.length && !after[0].label && before.length) {
      before[before.length - 1].remedies.push(...(after[0].remedies || []));
      after.shift();
    }

    before.push(...after);
    usable.splice(k, 1);
  }

  /*
   * A run of spaces inside a symptom is a column gap that survived the split — the boundary landed
   * just after a space, so the cut was allowed, and part of column two came along. "UP appears on
   * the        A display." is one symptom's worth of left column with a stray "A" from the next.
   * Collapsing is a repair, not a tidy-up: no symptom a manual prints contains three spaces.
   */

  /*
   * A row the parser could not read cleanly, saying so.
   *
   * Four rows across twelve real manuals still come out truncated — a cause beginning mid-sentence
   * because the columns collided part-way down its symptom, which nothing in the text layer can
   * recover. They cannot be fixed here. They CAN be pointed at.
   *
   * That is the whole difference between this and guessing: a flagged row sits in front of a
   * reviewer looking like a question, and an unflagged one sits in a library looking like a fact.
   */
  const looksTruncated = (t) => Boolean(t) && /^[a-z]/.test(String(t).trim());

  const out = usable.map((s) => ({
    // A stable handle for the row, so a reviewer can accept or reject this symptom by name. The
    // symptom text itself is a sentence and makes a poor key.
    id: slug(s.symptom),
    symptom: s.symptom,
    suspect: looksTruncated(s.symptom) || undefined,
    causes: s.causes.map((c, k) => ({
      id: `${slug(s.symptom)}-${k}`,
      label: c.label,
      // Begins mid-sentence, so the start of it was lost to a column collision. Not repairable
      // here; flagged so a reviewer's eye goes to it.
      suspect: looksTruncated(c.label) || undefined,
      // The manual's ordering is the prior: the first cause listed is the commonest.
      likelihood: Number((1 / (k + 1.6)).toFixed(3)),
      // A manual lists remedies, never prices. Null, not zero — zero would mean free.
      cost: null,
      remedies: c.remedies.map((r) => r.text),
      evidence: `${sourceName}${page ? `, page ${page}` : ''}: "${c.label || c.remedies[0]?.text || ''}"`,
      source: { line: c.line, manual: sourceName, page },
    })),
  }));

  return {
    found: out.length,
    symptoms: out,
    boundary: at,
    dropped,
    coverage: out.length
      ? `${out.length} symptom${out.length === 1 ? '' : 's'} recovered` +
        (collided ? `, ${collided} row${collided === 1 ? '' : 's'} skipped where the two columns run together` : '') +
        (dropped - collided > 0 ? `, ${dropped - collided} had no readable cause` : '')
      : 'a column header, but nothing readable beneath it',
  };
}

/**
 * Where to cut a line into its two columns, or `null` when it cannot be done.
 *
 * Clean when the boundary lands on a space, or just after one: a left column that exactly fills its
 * width leaves a single space before column two, and that is normal rather than a problem.
 *
 * `null` when the boundary lands INSIDE a word, which means the columns have collided — the left
 * column ran long, the typesetter squeezed the gap to a single space, and column two now begins
 * somewhere to the left of where the header says it does. `Home Connect cannot Home Connect set
 * incorrectly.` is one line of a two-column table and nothing in the text layer says whether the
 * break is before the second "Home" or after it.
 *
 * Backing off to the nearest space was tried and is worse than refusing: it produced the symptom
 * "Home Connect cannot Home" and the cause "Connect set incorrectly.", which is wrong in a way that
 * looks right. Some recoverable rows are dropped by this rule. That is the correct trade — a
 * reviewer can reject a row they can see and cannot repair the words inside one.
 */
function splitAt(raw, at) {
  if (at >= raw.length) return at;
  if (raw[at] === ' ' || raw[at - 1] === ' ') return at;
  return null;
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'symptom';


module.exports = { readSymptoms, columnBoundary, HEADER };
