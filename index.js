/**
 * faultgraph — read the fault table out of an equipment service manual.
 *
 * Every manufacturer ships a page that says "if the machine shows E24, check these three things, in
 * this order". It is the most useful page in the manual and the least machine-readable: a table in a
 * PDF, a sticker inside a door, a scan somebody photographed. This turns that page into something a
 * program can reason with — causes with priors, checks with costs, and a citation on every one.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It does not guess. There is no model here and no inference: every cause traces to a line that was
 * printed on the page, and a page with no fault table on it recovers nothing and says so. That is
 * the whole design constraint, and it exists because the output is meant to be *acted on* — somebody
 * opening a machine, or spending money on a part — and a plausible-sounding invented remedy is worse
 * than no answer at all.
 *
 * ── Why the ordering is information ─────────────────────────────────────────
 *
 * Manuals list remedies cheapest-and-likeliest first. That ordering is expertise, written down by
 * the people who built the machine, and it is thrown away by every tool that treats a manual as
 * prose. Here it becomes the prior.
 *
 * ── The part worth stealing ─────────────────────────────────────────────────
 *
 * A remedy often carries its own condition:
 *
 *     "Replace the drain pump IF IT DOES NOT TURN"
 *
 * That subordinate clause is not part of the repair. It is the *observation that justifies* the
 * repair, and as a question it is enormously cheaper: "does it turn?" is answered by looking, and
 * "replace the pump — did that fix it?" is answered by buying a pump. `faultgraph` lifts those
 * conditions out and offers them as checks, which is the difference between a diagnostic tool and a
 * list of things to try.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     const { parse } = require('faultgraph');
 *     const graph = parse({ text: manualPageText, sourceName: 'Bosch service manual' });
 *
 *     graph.codes.E24.meaning   // 'Water cannot leave the machine'
 *     graph.codes.E24.causes    // [{ label, likelihood, effort, mains, evidence, source }, …]
 *     graph.codes.E24.checks    // observations first, then remedies
 *     graph.coverage            // '3 fault codes recovered'  — honest about what it found
 *
 * Extracted from a repair-assistant project and generalised: nothing here is specific to household
 * appliances, and the code schemes of four manufacturers are handled because they disagree with each
 * other in ways one regex cannot cover.
 *
 * MIT. Zero dependencies. Node 18+.
 */

const CODE_PATTERNS = [
  /^\s*([A-Z]{1,2}[:\-\s]?\d{1,3}[A-Z]?)\s*[-–—:.\t]?\s+(.{6,200})$/, // E24, E:15, F21, E09A
  /^\s*(\d{1,2}[A-Z]{1,2})\s*[-–—:.\t]?\s+(.{6,200})$/,               // 4C, 5E, 21E
  /^\s*([A-Z]{2,3})\s*(?:[-–—:]\s*|\s{2,})(.{6,200})$/,               // OE, UE, dE, FE
];

/*
 * "Fault code E24 is lit." — the code in a sentence, not in a column.
 *
 * Found in a real Bosch dishwasher manual, and it is the phrasing that survives when a
 * three-column table is read aloud by a vision model: the table's first column becomes a sentence
 * and the code lands in the middle of it. Every pattern above wants the code at the START of the
 * line, so this format recovered nothing at all until it was handled.
 *
 * The line carries no meaning — "is lit" is not a description of the fault — so a code matched this
 * way takes its meaning from the first line beneath it that is not itself a remedy.
 */
const CODE_IN_SENTENCE =
  /^\s*(?:fault|error|alarm)\s+code\s+["'\u201C\u2018]?([A-Z]{0,2}[:\-\s]?\d{1,3}[A-Z]?|[A-Z]{2,3})["'\u201D\u2019]?\s+(?:is\s+)?(?:lit|shown|displayed|flashing|appears)/i;

/* Words that would otherwise read as a letter-only fault code at the start of a line. */
const NOT_A_CODE = new Set(['THE', 'AND', 'FOR', 'ARE', 'NOT', 'YOU', 'USE', 'SEE', 'ALL', 'ANY', 'CAN', 'ITS', 'OFF', 'ON', 'IF', 'IN', 'TO', 'OF', 'OR', 'AT', 'IS', 'IT', 'BE', 'DO', 'NO', 'WARNING', 'NOTE']);

/**
 * Phrases that are not a description of a fault.
 *
 * "E:07 is lit." parses cleanly — code, then six-plus characters of text — and hands back the
 * meaning "is lit.", which tells a reader nothing and looks like a bug in the interface. The page
 * simply does not state a meaning for these codes; the causes carry all of it. An empty meaning is
 * the honest answer and the caller can decide how to show a code with no description.
 */
const NOT_A_MEANING = /^(?:is\s+)?(?:lit|shown|displayed|flashing|on|appears|illuminated)\.?$/i;

function matchCodeLine(line) {
  const sentence = CODE_IN_SENTENCE.exec(line);
  if (sentence && !NOT_A_CODE.has(sentence[1].toUpperCase().replace(/[:\-\s]/g, ''))) {
    // No meaning on this line. `parse` fills it from the first non-remedy line beneath.
    return [line, sentence[1], ''];
  }

  for (const pattern of CODE_PATTERNS) {
    const m = line.match(pattern);
    if (!m) continue;
    if (NOT_A_CODE.has(m[1].toUpperCase().replace(/[:\-\s]/g, ''))) continue;
    return m;
  }
  return null;
}

/** Kept for callers that only need to ask "does this line start a fault entry?" */
const CODE_LINE = { test: (line) => matchCodeLine(line) !== null };

/** Words that mark a line as describing a remedy rather than a symptom. */
const REMEDY_HINTS = /\b(check|clean|clear|replace|inspect|remove|tighten|straighten|reset|ensure|lock|install|unscrew|descale|refill|arrange)\b/i;

/**
 * Rough cost of asking a person to do the thing described. Drives information gain.
 *
 * "Replace the drain pump" is the important case. A manual lists it as a remedy, but as a
 * *diagnostic step* it means buy a part, fit it, and see — which is exactly the expensive guessing
 * this whole project exists to prevent. It is the most costly thing we can ask for, so it must
 * never be reached for early: every free look and every cheap check has to be exhausted first.
 */
function effortOf(text) {
  if (/\b(replace|renew|fit a new|install a new|swap out)\b/i.test(text)) return 'heavy';
  if (/\b(pull (the )?(machine|appliance|unit|equipment) out|behind the|move the|disconnect the (mains|water|supply|battery)|remove the (back|panel|base|cover|housing))\b/i.test(text)) return 'heavy';
  if (/\b(unscrew|open the (base|panel)|take off|dismantle)\b/i.test(text)) return 'awkward';
  if (/\b(listen|look|check the display|is there|do you (hear|see))\b/i.test(text)) return 'free';
  return 'easy';
}

/**
 * Is this cause behind something that can hurt you?
 *
 * Stored on every cause as `mains`, and the name is deliberate: mains voltage is the case that
 * motivated it, but the list has since grown to cover the other things a manual will cheerfully
 * instruct you to touch — a charged capacitor, a pressurised line, a gas fitting.
 *
 * `faultgraph` does not stop anybody doing anything; it has no authority and no hands. What it does
 * is mark the cause, so that a caller which *does* decide things — whether to speak a repair aloud,
 * whether to sell a part — has the flag available and cannot say it did not know. A tool that reads
 * a manual and reads out "replace the heating element" in the same tone as "clean the filter" is
 * the failure mode this exists to make awkward.
 */
function isMains(text) {
  return /\b(mains|voltage|wiring harness|control board|earth|live|neutral|terminal block|capacitor|busbar|high[- ]voltage|refrigerant|gas (line|valve|supply)|pressuri[sz]ed|heating element|element)\b/i.test(text);
}

function normaliseCode(raw) {
  return raw.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * A manual lists remedies; the interface has to show causes. "Replace the drain pump if it does not
 * run" is an instruction, and putting it in a list headed "possible causes" reads as nonsense.
 * These turn the instruction back into the thing that is wrong with the machine.
 */
const CAUSE_PHRASINGS = [
  [/^replace\s+(?:the\s+)?(.+?)(?:\s+if\b.*)?$/i, (m) => `${m[1]} has failed`],
  [/^(?:clean|clear)\s+(?:the\s+)?(.+?)(?:\s+(?:of|from)\b.*)?$/i, (m) => `${m[1]} is blocked`],
  [/^straighten\s+(?:the\s+)?(.+)$/i, (m) => `${m[1]} is kinked`],
  [/^tighten\s+(?:the\s+)?(.+)$/i, (m) => `${m[1]} is loose`],
  [/^(?:check|inspect)\s+(?:the\s+)?(.+?)\s+for\s+(.+)$/i, (m) => `${m[1]} — ${m[2]}`],
  [/^(?:check|inspect|ensure)\s+(?:the\s+)?(.+)$/i, (m) => `${m[1]}`],
];

/** Sentence case, trailing full stop removed — the shape every other label here has. */
function tidy(text) {
  const t = String(text).trim().replace(/[.;]$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function remedyToCause(remedy) {
  const text = remedy.replace(/\.$/, '').trim();
  for (const [pattern, phrase] of CAUSE_PHRASINGS) {
    const m = text.match(pattern);
    if (m) {
      const out = phrase(m).trim();
      return out.charAt(0).toUpperCase() + out.slice(1);
    }
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Manuals write a fault table two ways, and so do people transcribing one.
 *
 *   E24  The machine cannot drain        the code and its meaning on one line
 *   E24
 *   The machine cannot drain             the code alone, meaning underneath
 *
 * The second is common in printed tables, where the code sits in its own narrow column, and it is
 * what a vision model produces when it transcribes such a table honestly. Rejoining them here means
 * the rest of the parser only ever sees one shape — and, more to the point, means a perfectly good
 * transcription is not thrown away over a line break.
 */
function joinOrphanCodes(lines) {
  const out = [];
  // Joining two lines into one shifts every line number after it. A citation is only worth
  // anything if it points at the line the reader can look at, so the original index of each
  // surviving line is carried alongside rather than recomputed later.
  const origin = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bare = /^\s*([A-Za-z]{0,3}[:\-]?\d{0,3}[A-Za-z]?)\s*$/.exec(line);
    const next = lines[i + 1];

    // A line holding only a plausible code, with something substantial under it.
    if (bare && bare[1].length >= 2 && /[A-Za-z0-9]/.test(bare[1]) && next && next.trim().length > 5
        && !NOT_A_CODE.has(bare[1].trim().toUpperCase())) {
      out.push(`${bare[1].trim()}   ${next.trim()}`);
      origin.push(i);
      i++; // the meaning has been consumed
      continue;
    }
    out.push(line);
    origin.push(i);
  }

  // Metadata, not content: non-enumerable so that `joinOrphanCodes(x)` still deep-equals the plain
  // array of lines it produced. A line-number table riding along as a visible element would make
  // every caller that iterates or compares the result subtly wrong.
  Object.defineProperty(out, 'origin', { value: origin });
  return out;
}

/**
 * How to describe what came back, including the two different ways it can be empty.
 */
function coverageOf(found, orphanCodes) {
  if (found > 0) return `${found} fault code${found === 1 ? '' : 's'} recovered`;
  if (orphanCodes > 0) {
    return `${orphanCodes} fault code${orphanCodes === 1 ? '' : 's'} seen, none with remedies beneath them — ` +
      'this looks like the right page in a layout I cannot read (remedies in a column to the right?)';
  }
  return 'nothing usable found';
}

/**
 * Read a fault table out of manual text.
 *
 * @param {object}  arg
 * @param {string}  arg.text          the page, as text. Newlines matter; columns may be split.
 * @param {string} [arg.equipment]    what this manual is for. Carried through, never interpreted.
 * @param {string} [arg.sourceName]   cited in every piece of evidence. Name the document.
 * @returns {{equipment, source, method, codes, found, coverage}}
 *
 * Deterministic: same text in, same graph out. Returns only what it actually found — a page with no
 * fault table on it yields `{}` and says `nothing usable found`, which is a correct answer and the
 * one a guessing parser would never give.
 */
function parse({ model, equipment = model, text, sourceName = 'manual' }) {
  const lines = joinOrphanCodes(String(text).split(/\r?\n/));
  /** Output line index → the line number a reader would count to on the original page. */
  const onPage = (idx) => (lines.origin ? lines.origin[idx] : idx) + 1;
  const codes = {};
  let found = 0;
  // Codes that looked like codes but had no remedies beneath them. Counted separately, because
  // "this page has no fault table on it" and "this page has one and I could not read its layout"
  // are different problems with different fixes, and they were sharing a sentence.
  let orphanCodes = 0;

  lines.forEach((line, i) => {
    const m = matchCodeLine(line);
    if (!m) return;

    const code = normaliseCode(m[1]);
    const raw = m[2].trim();
    // "is lit" is not a fault description. Better an empty meaning than a meaningless one.
    const description = NOT_A_MEANING.test(raw) ? '' : raw;

    /*
     * Remedy lines directly beneath a code line usually belong to it — and so do the lines between
     * them.
     *
     * A three-column table (Fault | Reason | Remedial action) flattens into alternating lines when
     * it is transcribed:
     *
     *     Fault code E24 is lit.
     *     Waste-water hose kinked or blocked.              ← the manufacturer's REASON
     *     Install hose without kinks, remove any residue.  ← the remedial ACTION
     *
     * Only the action lines carry a remedy verb, so an earlier version kept those and discarded the
     * reasons — then derived a cause back out of the remedy. That works, and it is strictly worse
     * than reading the reason the manufacturer printed: "Waste-water hose kinked or blocked" is
     * their sentence; "Hose has failed" is our guess at their sentence.
     *
     * Each remedy also carries its own line number: a citation that points at the code line instead
     * of the remedy is not a citation, it is a gesture at roughly the right part of the page.
     */
    const following = [];
    const atLine = [];
    /** The manufacturer's own words for the cause, where the page gave them. Sparse by design. */
    const statedCause = [];
    let pendingReason = null;

    // Twelve lines, not five: a real table runs several reason/action pairs under one code, and a
    // window sized for a short fixture truncated every genuine manual at the third cause.
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const text = lines[j].trim();
      if (!text || CODE_LINE.test(lines[j])) break;

      /*
       * An explicitly labelled row beats any inference.
       *
       * A transcription that says `REASON:` and `REMEDY:` has already told us which cell is which,
       * and guessing from verbs when the answer is written down would be perverse. "Water
       * protection system activated" carries no remedy verb and "Turn off water supply" does, so
       * the inference happens to work here — but "Check the door seal" as a REASON would fool it,
       * and a labelled line never can.
       */
      const labelled = /^(REASON|CAUSE|REMEDY|ACTION|REMEDIAL ACTION)\s*:\s*(.+)$/i.exec(text);
      if (labelled) {
        const kind = labelled[1].toUpperCase();
        const body = labelled[2].trim();
        if (kind === 'REASON' || kind === 'CAUSE') {
          pendingReason = body;
        } else {
          following.push(body);
          atLine.push(onPage(j));
          statedCause.push(pendingReason);
          pendingReason = null;
        }
        continue;
      }

      if (REMEDY_HINTS.test(text)) {
        following.push(text);
        atLine.push(onPage(j));
        statedCause.push(pendingReason);
        pendingReason = null;
      } else {
        pendingReason = text;
      }
    }

    const causes = following.map((remedy, k) => ({
      id: `${code.toLowerCase()}-${k}`,
      // The manufacturer's stated reason when the page gave one; our derivation when it did not.
      label: statedCause[k] ? tidy(statedCause[k]) : remedyToCause(remedy),
      // The manual's ordering is the prior: the first remedy listed is the most common.
      likelihood: Number((1 / (k + 1.6)).toFixed(3)),
      // Null, not 0. A service manual lists remedies, never prices — so what this costs is
      // UNKNOWN, and 0 would mean "free". Written as 0 it told an owner that replacing a drain
      // pump costs nothing to fix, which is both wrong and exactly the kind of confident wrong
      // answer the gate exists to prevent.
      cost: null,
      mains: isMains(remedy),
      ownerFixable: !isMains(remedy),
      evidence: `${sourceName}: "${remedy}"`,
      // The manual's own wording, kept verbatim. This is what the guide reads aloud, because a
      // remedy line IS the repair step — paraphrasing it would be inventing a procedure.
      remedy,
      source: { line: atLine[k], codeLine: onPage(i), manual: sourceName },
    }));

    if (causes.length === 0) { orphanCodes++; return; }
    found++;

    // A remedy check tests exactly one cause, so a table of them is irreducibly linear: a "no"
    // removes one possibility and nothing else, and no clever question-chooser can beat working
    // down the list. An OBSERVATION is consistent with several causes at once, which is what makes
    // choosing a question worth anything at all. Deriving observations is what lifts a parsed
    // manual out of that linear floor.
    const remedyTests = causes.map((c, k) => ({
      id: `${c.id}-check`,
      question: following[k].endsWith('?') ? following[k] : `${following[k]} — did that fix it?`,
      effort: effortOf(following[k]),
      kind: 'remedy',
      outcomes: [
        { value: 'yes', say: 'yes, that was it', consistentWith: [c.id] },
        { value: 'no', say: 'no, still faulty', consistentWith: causes.filter((x) => x.id !== c.id).map((x) => x.id) },
      ],
    }));

    codes[code] = {
      meaning: description,
      causes,
      // Observations first: they cost the same to ask and rule out more.
      tests: [...observationsFrom(causes, following), ...remedyTests],
    };
  });

  return {
    equipment,
    /** @deprecated the machine's model number; `equipment` says what it is without ambiguity. */
    model: equipment,
    source: sourceName,
    method: 'parsed',
    codes,
    found,
    // Meant to be shown, not logged. Two codes recovered from a 90-page manual is a thin graph, and
    // a caller that does not say so implies it read the whole book.
    coverage: coverageOf(found, orphanCodes),
    /*
     * Codes that matched but carried no remedies. This is the difference between the two ways a
     * parse comes back empty, and they need different things from the person holding the manual:
     *
     *   0 codes, 0 orphans   wrong page. Find the fault-table page.
     *   0 codes, 5 orphans   RIGHT page — and the remedies are not underneath the codes. Almost
     *                        always a two-column layout, where the remedy sits to the right.
     *
     * Reporting the second as "nothing usable found" sends somebody hunting for a page they are
     * already looking at.
     */
    orphanCodes,
  };
}

/*
 * ── Where a vision model belongs, and where it does not ──────────────────────
 *
 * Most manual pages exist as paper or as a photograph, so something has to turn pixels into
 * characters, and a vision model is very good at that. It is deliberately not in this library.
 *
 * The ordering is the point. A model transcribes the page; `parse()` turns characters into causes.
 * The model therefore never produces a cause — it produces text, and every cause is derived from
 * text by code you can read. An invented remedy cannot arrive wearing a citation to a line that
 * does not exist, because the line number is counted here, from the string it was given.
 *
 * Reverse those two and the guarantee is gone. Keep it, and `faultgraph` stays deterministic: same
 * text in, same graph out, testable without a network.
 */

/**
 * Merge a parsed graph under data you already trust.
 *
 * Verified entries always win. A parser is a good way to cover a machine nobody has written up yet
 * and a bad way to overwrite a machine somebody has: the whole value of hand-checked service data
 * is that a person stood behind it, and silently replacing it with regex output throws that away.
 */
function merge(existing = {}, graph) {
  const codes = { ...graph.codes };
  Object.entries(existing).forEach(([code, entry]) => {
    codes[code] = entry; // verified data always beats generated data
  });
  return codes;
}

/**
 * The conditions a manual already contains.
 *
 *   "Replace the drain pump IF IT DOES NOT TURN"
 *   "Replace the inlet valve IF IT DOES NOT OPEN"
 *   "Check the machine is level ON ALL FOUR FEET"
 *
 * That subordinate clause is not part of the repair. It is the *observation that justifies* the
 * repair, and it is a far better question than the repair itself — "does the pump turn?" can be
 * answered by looking, costs nothing, and its answer says something about every other cause too.
 *
 * Asking "replace the drain pump — did that fix it?" makes somebody buy a pump to find out.
 *
 * A manual that contains no conditions yields no observations, and the remedy checks still work.
 * Nothing is invented: every question here is a clause that was printed on the page.
 */
/**
 * Third person singular, for a phrase read aloud.
 *
 * Only the first word is a verb — "turn on the tap" conjugates to "turns on the tap" — and only the
 * bare infinitive needs it. Anything already inflected, or not obviously a verb, is left alone:
 * a clumsy sentence is better than a wrong one, and this is spoken to somebody.
 */
function conjugate(phrase) {
  const [head, ...rest] = String(phrase).trim().split(/\s+/);
  if (!head) return phrase;
  const tail = rest.length ? ` ${rest.join(' ')}` : '';
  // Already third-person, past, or a participle: leave it.
  if (/(s|ed|ing)$/i.test(head)) return phrase;
  if (/(s|sh|ch|x|z|o)$/i.test(head)) return `${head}es${tail}`;
  if (/[^aeiou]y$/i.test(head)) return `${head.slice(0, -1)}ies${tail}`;
  return `${head}s${tail}`;
}

const CONDITION = /\b(?:if|when|where|unless)\s+(?:it\s+|the\s+\w+\s+|they\s+)?(does not|doesn't|is not|isn't|will not|won't|fails to|cannot|can't|has|is|are)\s+([a-z][a-z\s]{2,40}?)\s*$/i;

function observationsFrom(causes, remedies) {
  const out = [];

  remedies.forEach((remedy, k) => {
    const m = CONDITION.exec(remedy.trim().replace(/[.;]$/, ''));
    if (!m) return;

    const negated = /not|n't|fails|cannot/i.test(m[1]);
    const thing = m[2].trim().replace(/\s+/g, ' ');
    const cause = causes[k];
    if (!cause) return;

    // "does not turn" → "Does it turn?" — the affirmative, because that is how a person checks.
    const question = `Does it ${thing}?`;

    // The question takes the bare infinitive ("Does it turn?") and the answer does not ("yes, it
    // turns"). This is read aloud by a voice assistant, so "yes, it turn" is not a detail.
    const affirmative = conjugate(thing);

    // The manual's own implication, followed rather than guessed at. "Replace the pump if it does
    // not turn" is the manufacturer asserting that a pump which does not turn IS the fault; taking
    // them at their word is citing the manual, and every cause here already cites it.
    //
    // The information is the same as the remedy check it was derived from. What differs is the
    // PRICE of asking: "does the pump turn?" is answered by looking, and "replace the pump — did
    // that fix it?" is answered by buying a pump. `next()` weighs bits against effort, so the
    // cheaper question wins on its own merits and needs no special case here.
    const holds = negated
      ? { value: 'no', say: `no, it does not ${thing}` }
      : { value: 'yes', say: `yes, it ${affirmative}` };
    const fails = negated
      ? { value: 'yes', say: `yes, it ${affirmative}` }
      : { value: 'no', say: `no, it does not ${thing}` };

    out.push({
      id: `${cause.id}-observe`,
      question,
      // Looking is easy. Replacing is heavy. That gap is the entire point of deriving this.
      effort: 'easy',
      kind: 'observation',
      derivedFrom: remedy,
      outcomes: [
        { ...holds, consistentWith: [cause.id] },
        { ...fails, consistentWith: causes.filter((c) => c.id !== cause.id).map((c) => c.id) },
      ],
    });
  });

  return out;
}


/* ════════════════════════════════════════════════════════════════════════════
 *  The diagnosable half.
 *
 *  A parsed fault table is a list. What makes it a graph is that answering one question changes
 *  which of the others are worth asking, and the four functions below are the whole of that:
 *
 *      spaceFor()   the causes for one code, as a probability distribution
 *      next()       the one question worth asking now
 *      prune()      fold an answer back in
 *      entropy()    how much is still unknown, in bits
 *
 *  They are pure. No I/O, no clock, no model. A caller supplies the answers — from a person, a
 *  sensor, a test rig — and gets the next question back.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Shannon entropy of the space, in bits: how much is still unknown.
 * One certain cause is 0 bits. Four equally likely causes is 2 bits.
 */
function entropy(space) {
  const total = space.reduce((n, c) => n + c.prior, 0);
  if (total <= 0) return 0;
  return -space.reduce((h, c) => {
    const p = c.prior / total;
    return p > 0 ? h + p * Math.log2(p) : h;
  }, 0);
}

/** Priors always sum to 1, whatever the source data did. */
function normalise(space) {
  const total = space.reduce((n, c) => n + c.prior, 0);
  if (total <= 0) return space.map((c) => ({ ...c, prior: 1 / space.length }));
  return space.map((c) => ({ ...c, prior: c.prior / total }));
}

/**
 * The hypothesis space for one code: its causes, as a distribution summing to 1.
 *
 * The prior comes from the manual's own ordering, which is the quiet claim this library makes —
 * that the sequence the manufacturer printed encodes which fault they see most, and is better
 * information than a uniform guess.
 */
function spaceFor(graph, code) {
  const entry = graph.codes[normaliseCode(String(code))];
  if (!entry) {
    return { known: false, reason: `${code} is not in ${graph.source}.`, space: [], tests: [] };
  }
  return {
    known: true,
    meaning: entry.meaning,
    space: normalise(entry.causes.map((c) => ({ ...c, prior: c.likelihood }))),
    tests: entry.tests,
    bits: entropy(normalise(entry.causes.map((c) => ({ ...c, prior: c.likelihood })))),
  };
}

/** Effort as a divisor. A free check is never penalised; a heavy one has to earn its place. */
const EFFORT = { free: 0, easy: 1, awkward: 4, heavy: 12 };

/** Expected entropy after a test, averaged over its outcomes, weighted by how likely each is. */
function expectedEntropyAfter(space, test) {
  const total = space.reduce((n, c) => n + c.prior, 0) || 1;
  return test.outcomes.reduce((acc, outcome) => {
    const keep = new Set(outcome.consistentWith);
    const survivors = space.filter((c) => keep.has(c.id));
    if (survivors.length === 0) return acc; // an impossible outcome contributes nothing
    const pOutcome = survivors.reduce((n, c) => n + c.prior, 0) / total;
    return acc + pOutcome * entropy(normalise(survivors));
  }, 0);
}

/** Bits gained, discounted by what it costs to find out. Eliminating nothing scores zero. */
function score(space, test) {
  const bits = Math.max(0, entropy(space) - expectedEntropyAfter(space, test));
  const effort = EFFORT[test.effort] ?? EFFORT.easy;
  return { bits, effort, value: bits / (1 + effort) };
}

/**
 * What to ask next.
 *
 * Returns `{ test: null }` in two cases, and a caller must tell them apart: `done` means one cause
 * is left, `stuck` means nothing remaining would tell us anything. Both are real answers. Stuck is
 * the more important one — it is the moment a diagnostic tool is supposed to stop rather than
 * recommend the most expensive part and hope.
 */
function next({ space, tests, performed = [] }) {
  if (space.length <= 1) return { test: null, reason: 'one cause left', done: true, stuck: false };

  const already = new Set(performed);
  const available = tests.filter((t) => !already.has(t.id));
  if (available.length === 0) {
    return { test: null, reason: 'no tests left to run', done: false, stuck: true };
  }

  const ranked = available
    .map((test) => ({ test, ...score(space, test) }))
    .sort((a, b) => b.value - a.value || a.effort - b.effort);

  const best = ranked[0];
  if (best.bits <= 0.001) {
    return { test: null, reason: 'nothing left that would tell us anything', done: false, stuck: true };
  }

  /*
   * There was a second pass here: take the cheapest test whose bits are within 85% of the best, on
   * the grounds that being marginally more informative does not justify asking somebody to pull a
   * machine out from under a counter.
   *
   * It never once fired, and it cannot. Ranking already divides bits by (1 + effort), so for a
   * higher-effort test to rank first it must carry proportionally more information — and `easy` to
   * `free` is a factor of two, well past the 15% the filter allowed. Solve it and the two
   * conditions contradict each other at every pair of effort levels the scale defines.
   *
   * So the preference for cheap checks lives entirely in the ranking, where it belongs; the second
   * pass was a comforting no-op that also carried a second `why` string no user could ever have
   * been shown. A test asserting that string is what proved it dead. Both are gone.
   */
  return {
    test: best.test,
    bits: Number(best.bits.toFixed(3)),
    effort: best.test.effort,
    done: false,
    stuck: false,
    // If it cannot say why it is asking, it should not ask.
    why: 'Rules out the most for the least effort.',
  };
}

/**
 * Fold an answer back in.
 *
 * Eliminated causes are returned rather than dropped, because "these three are now ruled out" is
 * the sentence that makes a person believe the next question. And an outcome that rules out
 * *everything* is reported as a contradiction, not as certainty about nothing: it means the machine
 * is doing something the manual does not describe, which is worth saying out loud.
 */
function prune({ space, outcome }) {
  const keep = new Set(outcome.consistentWith);
  const survivors = space.filter((c) => keep.has(c.id));
  const eliminated = space.filter((c) => !keep.has(c.id));

  if (survivors.length === 0) {
    return {
      space,
      eliminated: [],
      contradiction: true,
      reason: 'That result rules out every cause the manual lists for this code. Something else is going on.',
    };
  }

  const nextSpace = normalise(survivors);
  return { space: nextSpace, eliminated, contradiction: false, bits: entropy(nextSpace) };
}

module.exports = {
  parse, merge, spaceFor, next, prune, entropy, normalise, score, expectedEntropyAfter, EFFORT,
  // The pieces, exported because a manual you have never seen may need one of them adjusted.
  matchCodeLine, joinOrphanCodes, observationsFrom, conjugate,
  effortOf, isMains, remedyToCause, normaliseCode, CONDITION, CODE_LINE, CODE_PATTERNS, NOT_A_CODE,
};
