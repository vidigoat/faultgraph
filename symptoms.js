/**
 * The table manufacturers actually print now.
 *
 * Every current Bosch US dishwasher manual carries ten to thirteen pages headed
 * `Fault | Cause and troubleshooting`, and not one of them contains a fault code. Measured across
 * ten of them: zero code mentions, against ten in the 2019 European manual for the same kind of
 * machine. The codes moved to repair documentation those models do not publish.
 *
 * So the entry point this project was built on — a code on a panel — matches what Bosch published
 * in 2019 and not what it publishes now. What it publishes now is keyed on a described symptom:
 *
 *   Fault                  Cause and troubleshooting
 *   Excessive formation of Hand soap got in the rinse aid dispenser.
 *   foam occurs.              Immediately add rinse aid to the dispenser.
 *                          Rinse aid has been spilled.
 *                             Remove the rinse aid with a cloth.
 *
 * Which is the same shape. A key, its causes, and the remedy under each cause — and arguably a
 * commoner way to arrive at the problem, because "all the lights are flashing" is what somebody
 * says out loud and `E:22` is not.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * `faultgraph` is keyed on codes at line starts and has a test suite that says so. This needs
 * different key detection and identical cause/remedy handling, and bolting a second mode onto a
 * tested parser to save a file is how a working thing stops working. The output shape is
 * deliberately the same, so both can feed the same hypothesis space.
 *
 * ── How the columns are read ────────────────────────────────────────────────
 *
 * The header line gives the boundary: whatever column `Cause` starts at is where column two
 * begins. Then, within column two, INDENT is the grammar — flush with the boundary is a cause, and
 * indented past it is a remedy belonging to the cause above. That is the whole trick, and it is
 * why `pdftotext -layout` is required: a de-layouted extraction destroys exactly this.
 *
 * Both columns wrap, and both hyphenate across the break (`estab-` / `lished.`), so joining is
 * part of reading rather than a tidy-up afterwards.
 */

/**
 * The headings these tables use. The capture is what fixes the column boundary.
 *
 * "Issue" arrived with Bosch's 2024+ manuals (SHX4AEF5N's "Issue · Cause and troubleshooting"): the
 * table was perfectly regular and read as "no column header on this page" because the word on the
 * left was not one of three. "Malfunction" is the same table in older Siemens and Gaggenau books.
 */
const HEADER = /^(\s*)(?:Fault|Problem|Symptom|Issue|Malfunction)\s{2,}(Cause and troubleshooting|Cause and remedy|Cause\b.*)$/im;

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
// The step's own marker is not part of the instruction — a numbered "1." or a bulleted "▶".
const stripStep = (s) => s.replace(/^(?:\d+\.|[▶►▸‣•·–—])\s*/, '').trim();

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
  // Three columns side by side — Problem | Possible Cause | What To Do — is a different table from
  // the two-column one below, read by position rather than by indent. See readThreeColumns.
  const three = threeColumnHeader(lines);
  const boundary = three ? { at: three.cause, line: three.line } : columnBoundary(lines);

  if (!boundary) {
    /*
     * No header, no boundary, no parse. Guessing the column from the text's own whitespace was the
     * first thing tried and it finds a boundary in ordinary prose too — which produced confident
     * nonsense out of a safety page. A table says it is a table at the top of itself.
     */
    return { found: 0, symptoms: [], boundary: null, coverage: 'no column header on this page, so no table to read' };
  }

  let { at } = boundary;
  const read3 = three ? readThreeColumns(lines, page) : null;
  const symptoms = read3 ? read3.symptoms : [];
  let current = null;   // the symptom being built
  let cause = null;     // the cause being built, inside it
  let lastKind = null;  // 'cause' | 'remedy' — what the previous right-column line was
  let leftWasBlank = true;
  let collided = read3 ? read3.collided : 0;   // rows whose two columns run together and cannot be split
  let skipping = false; // inside a symptom whose first row collided, so none of it can be trusted
  let prose = 0;      // consecutive full-width lines: the page has moved past the table
  let lastLeft = null;  // the previous line's left column, for deciding where a skipped symptom ends

  /*
   * Which page we are on, as the table crosses page breaks.
   *
   * `joinAdjacent` puts a form feed at each seam — `pdftotext`'s own page separator — so counting
   * them is counting pages. Without this every row in a run carried the number of the page the run
   * STARTED on: a table running 37 to 48 cited all two hundred of its causes to page 37, and an
   * owner following one of them would open the manual to the wrong page and find nothing. A
   * citation that does not survive being checked is worse than no citation, because it was
   * believed.
   */
  let pageNow = page;

  // The two-column reader. A three-column table has already been read, so this loop does not run.
  for (let i = read3 ? lines.length : boundary.line + 1; i < lines.length; i++) {
    let raw = lines[i];

    if (raw.includes('\f')) {
      if (typeof pageNow === 'number') pageNow += raw.split('\f').length - 1;
      raw = raw.replace(/\f/g, '');
    }

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
      if (process.env.SYMPTOMS_DEBUG) console.error(`collided @${cols.cause}/${cols.action}: ${raw.slice(0, 120)}`);
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
      /*
       * Unless the right column says otherwise.
       *
       * Sentence punctuation alone split a symptom in half on a Siemens oven:
       *
       *     The appliance is switched on.        The operation indicator is defective.
       *     The operation indicator does not        Call Customer Service Page 15.
       *     light up.
       *
       * That is ONE symptom over three lines, and the first line ends in a full stop — so the
       * second line started a new symptom, which then had no causes at all, and the cause that
       * belonged to it stayed with the half above.
       *
       * A new symptom always begins a new cause; that is what a row in this table is. So a line
       * whose right column is a REMEDY — indented, sitting under the cause above it — cannot be
       * the start of one, whatever punctuation the left column happens to end on.
       */
      /*
       * Two columns of indent, not one. A single space is the jitter you get when a row's right
       * column happens to start a character late — the remedies in these manuals are indented
       * three. And only when there is a symptom open to continue: with nothing open, an indented
       * right column is the first row of a table whose layout starts indented, and it has to
       * start one.
       */
      const underARemedy = Boolean(current) && indent >= 2 && right;
      const finished = current && /[.!?:]$/.test(current.symptom) && !underARemedy;
      if ((leftWasBlank && !underARemedy) || finished) {
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
     * Some manuals mark the remedy instead of indenting it.
     *
     * A Siemens oven sets its whole right column flush and prefixes every remedy with ▶:
     *
     *     The cookware or       There has been a power cut.
     *     food is not heating   ▶ Check whether the lighting in your room or other appliances are working.
     *     up.
     *                           The appliance is switched off.
     *                           ▶ Switch the appliance on.
     *
     * With nothing indented, the indent rule saw four causes' worth of text as one cause and glued
     * the whole block into a single label — two causes and two remedies in one sentence. The
     * marker is the grammar on that page exactly as indentation is on a Bosch one, and it is the
     * same kind of signal as the numbered step already handled below.
     */
    const bulleted = /^[▶►▸‣•·–—]\s/.test(right);

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

    if (indent === 0 && !numbered && !bulleted) {
      /*
       * Flush with the boundary. A new cause — unless the previous right-column line was also a
       * cause, in which case this is the rest of it wrapping. "Detergent or machine care product
       * used causes ex-" / "cessive foaming." is one cause, not two.
       */
      if (lastKind === 'cause' && cause) {
        cause.label = joinWrapped(cause.label, right);
      } else {
        cause = { label: right, remedies: [], line: i, page: pageNow };
        current.causes.push(cause);
      }
      lastKind = 'cause';
    } else {
      const step = stripStep(right);
      if (!step) continue;
      if (!cause) {
        // A remedy with no cause above it. The manual gave a step and no reason; keep it under an
        // unnamed cause rather than dropping a real instruction on the floor.
        cause = { label: null, remedies: [], line: i, page: pageNow };
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
  // A "symptom" that is only a step number ("2.", "3)") is a numbered procedure that sits in the
  // left column of a later page, not a row of the table. Re-reading a Bosch refrigerator manual
  // produced three of them, each with a real instruction filed under it as its cause.
  const usable = symptoms.filter((s) => s.causes.length && !/^\d{1,2}[.)]?$/.test(s.symptom));

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

  /*
   * Rows the font destroyed.
   *
   * Some manuals embed a face whose glyphs extract at the wrong codepoints, for some runs of text
   * and not others: a GE refrigerator's "Either or both controls set to OFF" comes out of the text
   * layer as `(LWKHURUERWKFRQWUROVVHWWR2))`, on a page that is otherwise perfectly readable. The
   * page check cannot catch it — the scrambled string really is what the text layer says — so it
   * would be admitted as a cause, and read out.
   *
   * Scrambled runs have no spaces and no lower case, so they show up as very long capital tokens,
   * or as capitals with a bracket or backslash in the middle of them. Nothing is decoded or guessed.
   */
  const pageWords = String(text || '').split(/\s+/);
  const scrambledPage = pageWords.filter((w) => w.length >= 16 && !/[a-z]/.test(w) && /[A-Z]{6,}/.test(w) && !/^[-–—_.=*]+$/.test(w)).length >= 2
    || pageWords.some((w) => /[A-Z]{3,}[\]\[\\][A-Z]{2,}/.test(w));
  /*
   * And when a page has them, none of it is kept.
   *
   * Dropping only the rows that fail was tried first. What was left read "Refrigerator does not
   * operate Vibration or rattling" as one problem: with half the rows unreadable, the surviving
   * ones lose the lines that separated them. A page whose text layer cannot be trusted in places
   * cannot be trusted for its structure either, so it is refused whole and says why — it wants
   * reading from the rendered page, not from this text.
   */
  let mangled = 0;
  if (scrambledPage) {
    mangled = usable.reduce((n, sy) => n + sy.causes.length, 0);
    usable.length = 0;
  }

  /*
   * A page reference printed after a symptom — GE's tables say "Cloudiness on glassware 14",
   * pointing at the page that explains it. Read out, that is a stray number. It is only stripped
   * after a lower-case word or a closing bracket: "E 22" is a code, and a code is never touched.
   */
  const pageRef = (t) => String(t).replace(/(?<=[a-z’')])\s+\d{1,3}$/, '');

  /*
   * Rows whose words are all on the page but which were still read wrongly, so the page check —
   * which asks only whether a sentence is printed there — passes them. Each one is marked unsure
   * with its reason, and an unsure row is refused by name before it reaches the library:
   *
   *   a remedy that opens in lower case lost its start to the column beside it
   *     ("se high quality rinse agents", "ter after agitation stops");
   *   a "symptom" that opens with a bracket is an aside from the row above
   *     ("(Modern refrigerators … require more operating time.)"), not a problem anyone has;
   *   a cause whose label is one phrase twice ("Water drain pump Water drain pump") is two
   *     columns' worth of the same line, and the remedy beside it is cut.
   */
  const doubled = (t) => {
    const w = String(t || '').trim().split(/\s+/);
    const h = w.length / 2;
    return w.length >= 4 && Number.isInteger(h) && w.slice(0, h).join(' ') === w.slice(h).join(' ');
  };
  const doubtOf = (s, c) =>
    (c.unsure && 'this may be two rows read as one') ||
    (/^[a-z]/.test(String(c.remedies?.[0]?.text || '').trim()) && 'its remedy begins mid-sentence') ||
    (/^\(/.test(String(s.symptom).trim()) && 'this is an aside from the row above, not a symptom') ||
    (doubled(c.label) && 'its cause is one line read twice') ||
    undefined;

  const out = usable.map((s) => ({
    // A stable handle for the row, so a reviewer can accept or reject this symptom by name. The
    // symptom text itself is a sentence and makes a poor key.
    id: slug(pageRef(s.symptom)),
    symptom: pageRef(s.symptom),
    suspect: looksTruncated(s.symptom) || undefined,
    causes: s.causes.map((c, k) => ({
      id: `${slug(pageRef(s.symptom))}-${k}`,
      label: c.label,
      // Begins mid-sentence, so the start of it was lost to a column collision. Not repairable
      // here; flagged so a reviewer's eye goes to it.
      suspect: looksTruncated(c.label) || Boolean(doubtOf(s, c)) || undefined,
      // Why the reader doubts this row, when it does. scripts/verify-against-pages.js refuses it.
      unsure: doubtOf(s, c),
      // The manual's ordering is the prior: the first cause listed is the commonest.
      likelihood: Number((1 / (k + 1.6)).toFixed(3)),
      // A manual lists remedies, never prices. Null, not zero — zero would mean free.
      cost: null,
      remedies: c.remedies.map((r) => r.text),
      /*
       * The page THIS cause was printed on, recorded when it was read rather than taken from the
       * run afterwards. A run spanning pages 37 to 48 has causes on twelve different pages, and
       * both a first-page and a last-page answer are wrong for almost all of them.
       */
      evidence: `${sourceName}${c.page ? `, page ${c.page}` : ''}: "${c.label || c.remedies[0]?.text || ''}"`,
      source: { line: c.line, manual: sourceName, page: c.page ?? null },
    })),
  }));

  return {
    found: out.length,
    symptoms: out,
    boundary: at,
    dropped,
    // How many rows the columns ran together on. A caller that can render the page and pay a model
    // to look at it uses this to decide whether that is worth doing — see mcp/tools/read_symptoms.js.
    collided,
    mangled,
    coverage: out.length
      ? `${out.length} symptom${out.length === 1 ? '' : 's'} recovered` +
        (collided ? `, ${collided} row${collided === 1 ? '' : 's'} skipped where the two columns run together` : '') +
        (dropped - collided > 0 ? `, ${dropped - collided} had no readable cause` : '') +
        (mangled ? `, ${mangled} row${mangled === 1 ? '' : 's'} dropped where the text layer is font-scrambled` : '')
      : mangled
        ? `this page's text layer is font-scrambled in places (${mangled} rows), so none of it is taken from the text`
        : 'a column header, but nothing readable beneath it',
  };
}

/*
 * ── Three columns, side by side ─────────────────────────────────────────────
 *
 * GE, and most North American manuals, print the table as
 *
 *        Problem             Possible Cause                 What To Do
 *   Dishes and flatware   Ultra-Fine Filter or Fine    See the Care and Cleaning section.
 *   not clean             Filter is clogged
 *
 *                         Low inlet water temperature  Make sure inlet water temperature is
 *                                                      correct. Turn on the hot water faucet…
 *
 * which is the same information as the two-column kind — a key, its causes, a remedy for each —
 * laid out by POSITION instead of by indent: the remedy sits beside its cause, not under it.
 *
 * Two things the two-column reader could take from the header, this one cannot:
 *
 *   where the columns are   the header words are CENTRED over their columns, so "Possible Cause"
 *                           begins six characters to the right of the causes beneath it. The
 *                           columns are found from the rows: within each page, the commonest
 *                           place a run of text starts, looked for between one header word and
 *                           the next.
 *   where a cause begins    there is no indent to say. A line starts a new cause when the cause
 *                           column begins with a capital AND the entry before it had finished —
 *                           a blank line, a cause column that had gone quiet while the remedy
 *                           ran on, or a sentence that ended. A line that starts a new cause with
 *                           words in the first column as well starts a new problem.
 *
 * Every page re-states the header and may set the columns somewhere else, so both are re-read per
 * page; a page with no header ends the table.
 */
/*
 * The first column is headed "Problem" — or, in GE's laundry manuals, by the section the rows
 * belong to: `WATER   Possible Causes   What To Do`, then `OPERATION`, `PERFORMANCE`, `SOUNDS`. Any
 * short heading is accepted there, but only when the other two columns say "Possible Causes" and
 * what to do about them in so many words; a bare "Cause" needs "Problem" beside it.
 */
const HEADER3 = /^\s*(Problem|Symptom|Issue|Fault|[A-Z][A-Za-z&\/ -]{2,28}?(?=\s{2,}(?:Possible|Probable)\s))\s{2,}((?:Possible\s+|Probable\s+)?(?:Causes?|Reasons?))\s{2,}(What To Do|Solutions?|Remed(?:y|ies)|Corrective Action|Action|Fix)\s*$/i;

function threeColumnHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\f/g, '');
    const m = HEADER3.exec(raw);
    if (!m) continue;
    const problem = raw.indexOf(m[1]);
    const cause = raw.indexOf(m[2], problem + m[1].length);
    const action = raw.indexOf(m[3], cause + m[2].length);
    if (cause > problem && action > cause) return { line: i, problem, cause, action };
  }
  return null;
}

/** Where each run of text on a line starts — runs are separated by two spaces or more. */
function chunkStarts(raw) {
  const out = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(raw))) out.push(m.index);
  return out;
}

/**
 * Where a column starts: the LEFTMOST place text commonly begins, not the commonest.
 *
 * A remedy cell that lists its steps with bullets wraps two characters in from the bullet, and
 * there are more wrapped lines than bulleted ones. The commonest start is then the wrap indent —
 * two characters right of the column's real edge — and every bulleted line reads as a collision.
 * The column's edge is the leftmost start that is not a one-off.
 */
const columnStart = (xs) => {
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) || 0) + 1);
  if (!n.size) return null;
  const top = Math.max(...n.values());
  return Math.min(...[...n].filter(([, c]) => c >= Math.max(2, top * 0.3) || c === top).map(([x]) => x));
};

/** Page furniture a table crosses: its own running title, a publication number, a page number. */
// A footer carries the publication number wherever the page number sits beside it ("22   49-4000283 Rev 8").
const FURNITURE3 = /troubleshooting tips|before you call for service|\b\d{2}-\d{5,}\S*\s+rev\b|^\s*(?:page\s+)?\d{1,4}\s*$/i;
// The thumb-tab down the edge of the page ("Operating Instructions", "Troubleshooting Tips"), which
// the text layer hands back as a line of its own — or as a fragment of one — in whichever column it
// happens to sit over. It is never part of a row.
const MARGIN_TAB = /^(?:(?:operating|safety|installation|care and cleaning)(?: instructions)?|consumer support|customer service|trouble(?:shooting)?(?: tips)?|shooting tips|tips|instructions|support)$/i;
const ENDS = (t) => /[.?!:)”"]$/.test(String(t || '').trim());
const CAPITAL = (t) => /^["“(]?[A-Z0-9]/.test(String(t || '').trim());

/**
 * Does this line plainly run on into the next — so a capital at the start of the next is not a new row?
 *
 * Two ways a line shows it is unfinished. It ends on a word that cannot end a phrase ("when the",
 * "caused by", "or"). Or it ends on a capitalised word that is not the line's first: a name broken
 * across the line — "the Dry / Boost option", "Ultra-Fine Filter or Fine / Filter is clogged".
 * "Type of detergent" does neither, which is why "Soft water" beneath it stays in doubt.
 */
const UNFINISHED = /\b(?:the|a|an|of|or|and|to|for|with|in|on|at|by|from|is|are|was|be|been|not|when|if|your|their|this|that|than|then|into|has|have|may|can|will|should|must|new|each|per|no|too)$/i;
function plainlyContinues(prevLine) {
  const t = String(prevLine || '').trim();
  if (/[,;–—-]$/.test(t) || UNFINISHED.test(t)) return true;
  const words = t.split(/\s+/);
  return words.length > 1 && /^["“(]?[A-Z]/.test(words[words.length - 1]);
}

function readThreeColumns(lines, firstPage) {
  const symptoms = [];
  let collided = 0;
  let pageNow = firstPage;
  let cols = null;          // { cause, action } for the page being read, from its own rows
  let current = null;
  let cause = null;
  let prev = { blank: true, c: '', r: '' };
  let started = false;
  let skipping = false;     // inside a row whose columns collided — see `squeezed`

  // A page's rows run from its header to the next form feed.
  const columnsFor = (h, from) => {
    const rows = [];
    // …or to the next header: a page can carry several tables (WATER, then OPERATION), each set
    // at its own columns.
    for (let j = from; j < lines.length && !lines[j].includes('\f'); j++) {
      if (HEADER3.test(lines[j])) break;
      if (lines[j].trim() && !FURNITURE3.test(lines[j]) && !MARGIN_TAB.test(lines[j].trim())) rows.push(lines[j]);
    }
    const starts = rows.flatMap(chunkStarts);
    const c2 = columnStart(starts.filter((x) => x > h.problem && x <= h.cause + 2));
    const c3 = columnStart(starts.filter((x) => x > h.cause + 2 && x <= h.action + 2));
    return { cause: c2 ?? h.cause, action: c3 ?? h.action };
  };

  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    if (raw.includes('\f')) {
      if (typeof pageNow === 'number') pageNow += raw.split('\f').length - 1;
      raw = raw.replace(/\f/g, '');
      // A new page has to say it is still the table, near its top. One that does not is the manual
      // having moved on — a warranty, an index — and reading it by column would invent rows.
      if (started) {
        let again = false;
        for (let j = i, seen = 0; j < lines.length && seen < 14; j++) {
          if (j > i && lines[j].includes('\f')) break;
          if (!lines[j].trim()) continue;
          seen++;
          if (HEADER3.test(lines[j].replace(/\f/g, ''))) { again = true; break; }
        }
        if (!again) break;
      }
      cols = null;
      prev = { blank: true, c: '', r: '' };
    }

    const h = HEADER3.exec(raw);
    if (h) {
      const problem = raw.indexOf(h[1]);
      const causeAt = raw.indexOf(h[2], problem + h[1].length);
      const action = raw.indexOf(h[3], causeAt + h[2].length);
      cols = columnsFor({ problem, cause: causeAt, action }, i + 1);
      started = true;
      prev = { blank: true, c: '', r: '' };
      continue;
    }
    if (!cols) continue;
    if (!raw.trim()) { prev = { ...prev, blank: true }; continue; }
    if (FURNITURE3.test(raw)) continue;
    if (MARGIN_TAB.test(raw.trim())) continue;
    // …or it shares a line with a real row, far out to the right: cut it off the end.
    raw = raw.replace(/\s{6,}(?:Operating Instructions|Safety Instructions|Installation Instructions|Troubleshooting Tips|Consumer Support|Trouble|Tips)\s*$/i, '');

    // A word that straddles a column edge means two columns ran together on this line. Cutting it
    // would put half a word in each; the line is skipped and counted instead.
    const straddles = (at) => at < raw.length && raw[at] !== ' ' && raw[at - 1] !== ' ' && raw[at - 1] !== undefined;
    /*
     * …and the collision that does NOT straddle, which is the dangerous one.
     *
     *     Water pumped out before Lid lifted or cycle was put in   • Reset cycle.
     *
     * The first column ran long, the typesetter closed the gap to one space, and the edge happens
     * to fall on the space after "Lid". Nothing straddles; the cut gives the problem "Water pumped
     * out before Lid" and hands "lifted or cycle was put in" to the cause on the row ABOVE. A real
     * column gap is two spaces or more, so text on both sides of an edge with exactly one space
     * between them is a collision too.
     */
    const squeezed = (at) => {
      const left = raw.slice(0, at);
      const right = raw.slice(at);
      if (!left.trim() || !right.trim()) return false;
      const gap = (left.length - left.trimEnd().length) + (right.length - right.trimStart().length);
      return gap < 2;
    };
    if (straddles(cols.cause) || straddles(cols.action) || squeezed(cols.cause) || squeezed(cols.action)) {
      // The row this line belongs to cannot be trusted, and neither can whatever wraps beneath it.
      // Everything is dropped until a clean line starts the next problem.
      if (process.env.SYMPTOMS_DEBUG) console.error(`collided @${cols.cause}/${cols.action}: ${raw.slice(0, 120)}`);
      collided++;
      skipping = true;
      cause = null;
      prev = { blank: false, c: 'x', r: 'x' };
      continue;
    }

    const l = raw.slice(0, cols.cause).trim();
    const c = raw.slice(cols.cause, cols.action).trim();
    const r = raw.slice(cols.action).trim();

    // A table row's cells are top-aligned, so a new cause begins on the line where a new remedy
    // does. A bullet says so outright; otherwise it is a capital after the last remedy finished.
    const bullet = /^[•▪■●]/.test(r);
    const newRemedy = Boolean(r) && (bullet || (CAPITAL(r) && (!prev.r || ENDS(prev.r))));
    // …and a remedy still in mid-sentence means the row has NOT ended, whatever the cause column
    // does: "Some shaking/noise is normal." / "Dryer may be sitting unevenly" beside one remedy
    // that runs across both lines is a single cell with two sentences in it, not two causes.
    const midRemedy = Boolean(r) && !bullet && Boolean(prev.r) && !ENDS(prev.r) && !prev.blank;
    const startsCause = Boolean(c) && CAPITAL(c) && !midRemedy && (prev.blank || !prev.c || ENDS(prev.c) || newRemedy);

    if (skipping) {
      if (!(startsCause && l && CAPITAL(l))) { prev = { blank: false, c, r }; continue; }
      skipping = false;
    }

    if (startsCause) {
      if (l && (CAPITAL(l) || !current)) {
        current = { symptom: l, causes: [], line: i };
        symptoms.push(current);
      } else if (l && current) {
        current.symptom = joinWrapped(current.symptom, l);
      }
      if (current) {
        cause = { label: c, remedies: r ? [{ text: r, line: i }] : [], line: i, page: pageNow };
        current.causes.push(cause);
      }
    } else {
      if (l && current) current.symptom = joinWrapped(current.symptom, l);
      else if (l && !current) { current = { symptom: l, causes: [], line: i }; symptoms.push(current); }
      if (c && cause) {
        /*
         * A capital, folded into the cause above it, with nothing to say whether that was right.
         *
         * "Ultra-Fine Filter or Fine / Filter is clogged" is one cause wrapping onto a second line.
         * "Type of detergent / Soft water" is two causes on consecutive lines. On the page they
         * look the same when the second one has no remedy starting beside it — and joined they
         * would both pass a check that only asks whether the words are printed there. So the row
         * is kept, marked, and refused at admission (scripts/verify-against-pages.js) rather than
         * believed.
         */
        if (CAPITAL(c) && prev.c && !ENDS(prev.c) && !plainlyContinues(prev.c)) cause.unsure = true;
        cause.label = joinWrapped(cause.label, c);
      }
      if (r && cause) {
        const last = cause.remedies[cause.remedies.length - 1];
        if (last) last.text = joinWrapped(last.text, r);
        else cause.remedies.push({ text: r, line: i });
      }
    }
    prev = { blank: false, c, r };
  }

  // The remedy cell is prose. One sentence is one step, the way the two-column kind lists them —
  // so the guide can read a step and wait, rather than a paragraph in one breath.
  for (const s of symptoms) for (const k of s.causes) {
    if (k.label) k.label = k.label.trim();
    // A cell that lists its steps with bullets is cut at the bullets first; the bullet is scaffolding.
    k.remedies = k.remedies.flatMap((x) => x.text.split(/\s*[•▪■●]\s+/).flatMap((b) => b.split(/(?<=[.?!])\s+(?=[A-Z"“(])/))
      .map((t) => ({ text: t.replace(/^[•▪■●]\s*/, '').trim(), line: x.line })).filter((x2) => x2.text));
  }
  /*
   * One remedy cell, printed beside several causes.
   *
   * Older GE tables list five causes of "Spots and filming" down the middle column and ONE cell
   * beside them all: a sentence, then "To remove stubborn spots…: 1 Remove all metal utensils.
   * 2 Do not add detergent. 3 Select the longest cycle." Read row by row, step 1 lands on the
   * second cause and steps 2 and 3 on the third — "Overloading the dishwasher → Do not add
   * detergent" — which is a pairing the manual never made. A remedy that opens at step two or
   * later is the tell: the procedure began beside a different cause. Every cause of that problem
   * is then in doubt, because there is no saying which of them the cell belongs to.
   *
   * And a cause whose words stop on "or the" lost its ending to a collision below it.
   */
  for (const s of symptoms) {
    const shared = s.causes.some((k) => /^(?:[2-9]|1\d)[.)]?\s+\S/.test(k.remedies[0]?.text || ''));
    for (const k of s.causes) {
      if (shared) k.unsure = true;
      if (k.label && UNFINISHED.test(k.label)) k.unsure = true;
    }
  }
  return { symptoms, collided };
}

/**
 * The cause column of a page, as one string — what a quotation is checked against.
 *
 * Flattening a whole page interleaves its columns, so a wrapped cause comes back with the other
 * columns' words spliced into it. scripts/verify-against-pages.js needs the same column the reader
 * took: everything right of the boundary for a two-column table, the middle column for three.
 */
function causeColumn(pageText) {
  const lines = String(pageText || '').split(/\r?\n/);
  const three = threeColumnHeader(lines);
  if (three) {
    const rows = lines.slice(three.line + 1).filter((x) => x.trim() && !HEADER3.test(x) && !FURNITURE3.test(x));
    const starts = rows.flatMap(chunkStarts);
    const c2 = columnStart(starts.filter((x) => x > three.problem && x <= three.cause + 2)) ?? three.cause;
    const c3 = columnStart(starts.filter((x) => x > three.cause + 2 && x <= three.action + 2)) ?? three.action;
    return lines.map((x) => x.slice(c2, c3)).join(' ');
  }
  const boundary = columnBoundary(lines);
  return boundary ? lines.map((x) => x.slice(boundary.at)).join(' ') : '';
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

module.exports = { readSymptoms, columnBoundary, causeColumn, threeColumnHeader, HEADER, HEADER3 };
