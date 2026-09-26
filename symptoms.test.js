/**
 * Reading the table manufacturers actually print now.
 *
 *   node manual/symptoms.test.js
 *
 * Every fixture here is lifted from a real current Bosch US dishwasher manual, character for
 * character including the column positions — because the column positions ARE the grammar. Flush
 * with the boundary is a cause; indented past it is a remedy under that cause. Retyping these
 * fixtures "tidily" would delete the only thing being tested.
 *
 * Every assertion exists because the first version got it wrong on this exact page.
 */

const assert = require('node:assert');
const { readSymptoms, columnBoundary } = require('./index');

let passed = 0;
const it = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ', name);
  } catch (e) {
    console.error('  FAIL', name, '\n       ', e.message);
    process.exitCode = 1;
  }
};

/** Real, from SHE2ADF2N page 38. Boundary at column 23. */
const PAGE = [
  'en-us   Troubleshooting',
  'Fault                  Cause and troubleshooting',
  'Excessive formation of Hand soap got in the rinse aid dispenser.',
  'foam occurs.              Immediately add rinse aid to the dispenser.',
  '                          "Adding rinse aid", Page 16',
  '                       Rinse aid has been spilled.',
  '                          Remove the rinse aid with a cloth.',
  '                       Detergent or machine care product used causes ex-',
  '                       cessive foaming.',
  '                          Change the brand of detergent.',
  'Connection to home     WLAN on router is not active.',
  'network is not estab-     Check the wireless network connection of your',
  'lished.                   router.',
  'WLAN display is flash- Connection to home network is not available.',
  'ing.                      Activate the wireless network connection on your',
  '                          router.',
  'Home Connect cannot Home Connect set incorrectly.',
  'be implemented cor-       Please consult the documents supplied for',
  'rectly.                   Home Connect®.',
  'Refill indicator for   No rinse aid.',
  'rinse aid lights up.   1. Add Rinse aid Page 16.',
  '                       2. Set the amount of rinse aid to be dispensed.',
].join('\n');

const read = () => readSymptoms({ text: PAGE, sourceName: 'Bosch manual', page: 38 });
const find = (r, starts) => r.symptoms.find((s) => s.symptom.startsWith(starts));

console.log('symptom-keyed troubleshooting tables');

/* ── the boundary ─────────────────────────────────────────────────────────── */

it('the column boundary comes from the page, not from a constant', () => {
  // It differs between manuals — 23 in one, 25 in another — and a hard-coded column is a parser
  // that works on the manual it was written against.
  const b = columnBoundary(PAGE.split('\n'));
  assert.equal(b.at, 23);
  assert.equal(b.line, 1);
});

it('a page with no column header is not a table', () => {
  /*
   * Guessing the boundary from the text's own whitespace was the first thing tried, and it finds
   * one in ordinary prose too — which produced confident nonsense out of a safety page. A table
   * says it is a table at the top of itself.
   */
  const r = readSymptoms({ text: 'Read these instructions carefully.\n\nContact customer service.' });
  assert.equal(r.found, 0);
  assert.equal(r.boundary, null);
  assert.match(r.coverage, /no column header/);
});

/* ── causes, and the remedies under them ──────────────────────────────────── */

it('indent is the grammar: flush is a cause, indented is its remedy', () => {
  const s = find(read(), 'Excessive formation');
  assert.equal(s.causes.length, 3, 'the three causes under one symptom were not separated');
  assert.equal(s.causes[0].label, 'Hand soap got in the rinse aid dispenser.');
  assert.deepEqual(s.causes[0].remedies, ['Immediately add rinse aid to the dispenser.']);
});

it('a wrapped cause is one cause, not two', () => {
  // "Detergent or machine care product used causes ex-" / "cessive foaming." — both flush with the
  // boundary, and the hyphen is the typesetter's, not the word's.
  const s = find(read(), 'Excessive formation');
  assert.equal(s.causes[2].label, 'Detergent or machine care product used causes excessive foaming.');
});

it('a cross-reference is not a remedy', () => {
  // `"Adding rinse aid", Page 16` tells you where to read, not what to do.
  const s = find(read(), 'Excessive formation');
  for (const c of s.causes) {
    for (const r of c.remedies) assert.ok(!/Page \d+$/.test(r), `a cross-reference was kept as a remedy: ${r}`);
  }
});

/* ── the three bugs this page found ───────────────────────────────────────── */

it('two symptoms on consecutive lines stay two symptoms', () => {
  /*
   * `...is not estab-` / `lished.` then `WLAN display is flash-` sit on adjacent lines with no
   * blank between them. A blank-line rule merged them into one symptom reading "Connection to home
   * network is not established. WLAN display is flashing."
   *
   * Sentence-ending punctuation is the signal, and it is the typesetter's own.
   */
  const r = read();
  const a = find(r, 'Connection to home network');
  const b = find(r, 'WLAN display');
  assert.ok(a, 'the first symptom went missing');
  assert.ok(b, 'the second symptom was swallowed by the first');
  assert.equal(a.symptom, 'Connection to home network is not established.');
  assert.equal(b.symptom, 'WLAN display is flashing.');
});

it('a split one word inside the right column is handed back', () => {
  /*
   * Real, both rows, from SGV78C53UC pages 48-49. The split lands on a space that LOOKS like the
   * column gap and is not, giving the symptom "Home Connect cannot There" and the cause "is a
   * technical error."
   *
   * The signal is precise: a cause beginning with a lowercase word. Manuals do not start a sentence
   * in lower case, so when the left column's last word is capitalised and the right begins lower,
   * the word belongs to the right. That is a repair, not a guess — and note the difference from the
   * collided rows below, where nothing in the text says where the break belongs and the row is
   * refused instead.
   */
  // Column two at 25, which is where this manual sets it — and which is what makes the split land
  // on the space before "is" rather than inside a word. A tidier fixture does not reproduce it.
  const page = [
    'Fault' + ' '.repeat(20) + 'Cause and troubleshooting',
    'Home Connect cannot There is a technical error.',
    'be implemented cor-' + ' '.repeat(9) + 'Please consult the documents supplied.',
    'rectly.',
  ].join('\n');

  const [s] = readSymptoms({ text: page, sourceName: 'Bosch manual' }).symptoms;
  assert.equal(s.symptom, 'Home Connect cannot be implemented correctly.');
  assert.equal(s.causes[0].label, 'There is a technical error.');
});

it('a row whose columns have collided is refused, not guessed at', () => {
  /*
   * This assertion replaced one that claimed the row was recoverable, because it is not, and the
   * first version only appeared to recover it.
   *
   * `Home Connect cannot Home Connect set incorrectly.` is one line of a two-column table whose
   * columns have collided: the left column ran long and the typesetter squeezed the gap to a single
   * space. Slicing at the boundary gave "Home Connect cannot Hom" / "e Connect set incorrectly.";
   * backing off to the nearest space gave "Home Connect cannot Home" / "Connect set incorrectly.",
   * which is wrong in a way that looks right, and is exactly the kind of confident nonsense this
   * project exists to refuse. Nothing in the text layer says where the break belongs.
   *
   * So the row is dropped and counted. A reviewer can reject a row they can see; they cannot repair
   * the words inside one.
   */
  const r = read();
  assert.equal(find(r, 'Home Connect'), undefined, 'a collided row was emitted anyway');
  for (const s of r.symptoms) {
    assert.ok(!/Hom$|^e Connect/.test(s.symptom), `a mangled symptom survived: ${s.symptom}`);
  }
  assert.ok(r.dropped >= 1, 'the dropped row was not counted');
  assert.match(r.coverage, /columns run together/);
});

it('a numbered step is a remedy wherever it is printed', () => {
  /*
   * `1. Add Rinse aid` sits flush with the boundary in these manuals rather than indented, so the
   * indent rule read it as a cause and glued the repair steps into one label: "No rinse aid. 1. Add
   * Rinse aid Page 16. 2. Set the amount of rinse aid to be dispensed."
   */
  const s = find(read(), 'Refill indicator');
  assert.equal(s.causes.length, 1, 'numbered steps were read as causes');
  assert.equal(s.causes[0].label, 'No rinse aid.');
  assert.equal(s.causes[0].remedies.length, 2);
  assert.ok(!/^\d\./.test(s.causes[0].remedies[0]), 'the step number was kept as content');
});

/* ── a table that runs across a page break ───────────────────────────────── */

/*
 * Real, from SHE41CM2N, whose troubleshooting table runs pages 38 to 39. Joining the two pages —
 * which is necessary, or a symptom is split from its causes at the seam — drops page 38's number
 * and page 39's column header right into the middle of the rows.
 */
const ACROSS_PAGES = [
  'Fault                  Cause and troubleshooting',
  'Appliance does not     The door is not closed.',
  'start.                    Close the door.',
  '38',
  // Page 39 sets the SAME table four columns further right. The typesetter laid each page out on
  // its own, and nothing says the two agree.
  'Fault                      Cause and troubleshooting',
  'Appliance door cannot      The lock is engaged.',
  'be closed.                    Release the lock.',
].join('\n');

it('a page number stranded mid-table is not a symptom', () => {
  /*
   * It was. The parser produced a symptom called "38", with a cause scavenged from the real row
   * beside it, sitting in the list between two genuine ones.
   */
  const r = readSymptoms({ text: ACROSS_PAGES, sourceName: 'Bosch manual' });
  assert.ok(!r.symptoms.some((s) => /^\d+$/.test(s.symptom)), 'a page number was read as a symptom');
});

it('the header repeating on the next page is not a symptom either', () => {
  // Same seam, same cause: the table introduces itself again and the parser believed it.
  const r = readSymptoms({ text: ACROSS_PAGES, sourceName: 'Bosch manual' });
  assert.ok(!r.symptoms.some((s) => /^Fault$/i.test(s.symptom)), 'the column header was read as a symptom');
});

it('and the real rows on both sides of the break survive', () => {
  // The point of joining pages in the first place.
  const r = readSymptoms({ text: ACROSS_PAGES, sourceName: 'Bosch manual' });
  const names = r.symptoms.map((s) => s.symptom);
  assert.deepEqual(names, ['Appliance does not start.', 'Appliance door cannot be closed.']);
});

it('one symptom printed twice across a page break is one symptom', () => {
  /*
   * A row that runs past the bottom of a page has its symptom repeated in the left column at the
   * top of the next one — the manual being helpful — and after the header reset it arrived as a
   * second symptom with the same words and the leftovers of the first one's causes. On one machine
   * that produced two entries called "All LEDs light up or flash.", the second with no cause at all.
   */
  const page = [
    'Fault                  Cause and troubleshooting',
    'All LEDs light up or   A software update is installing.',
    'flash.                    Wait until it finishes.',
    '48',
    'Fault                  Cause and troubleshooting',
    'All LEDs light up or   Electronics have detected a fault.',
    'flash.                    Press the main switch for 4 seconds.',
  ].join('\n');

  const r = readSymptoms({ text: page, sourceName: 'Bosch manual' });
  assert.equal(r.symptoms.length, 1, 'the same symptom came back twice');
  assert.equal(r.symptoms[0].causes.length, 2, 'the causes from the two halves were not joined');
});

it('a procedure split by the seam is one cause, not a cause with no reason', () => {
  /*
   * A procedure that runs past the bottom of a page carries on at the top of the next one with its
   * steps and without its cause — the cause was printed once, back on the first page. Joined
   * naively that became a second cause with no label, sitting under the symptom as though the
   * manual had listed a reason and left it blank. One on every machine with a multi-page table.
   */
  const page = [
    'Fault                  Cause and troubleshooting',
    'All LEDs light up or   Electronics have detected a fault.',
    'flash.                 1. Press the main switch for 4 seconds.',
    '48',
    'Fault                  Cause and troubleshooting',
    'All LEDs light up or      2. If the problem occurs again:',
    'flash.                       Contact customer service.',
  ].join('\n');

  const r = readSymptoms({ text: page, sourceName: 'Bosch manual' });
  assert.equal(r.symptoms.length, 1);
  assert.equal(r.symptoms[0].causes.length, 1, 'the continuation became a cause of its own');
  assert.equal(r.symptoms[0].causes[0].label, 'Electronics have detected a fault.');
  assert.ok(r.symptoms[0].causes[0].remedies.length >= 2, 'the steps after the seam were lost');
});

it('but a symptom that genuinely appears twice is not flattened', () => {
  // Merged only when ADJACENT. A manual listing the same symptom in two places is telling you
  // something, and this must not delete it.
  const page = [
    'Fault                  Cause and troubleshooting',
    'Door will not close.   The lock is engaged.',
    '                          Release it.',
    'Water remains.         The filter is blocked.',
    '                          Clean it.',
    'Door will not close.   A rack is in the way.',
    '                          Move the rack.',
  ].join('\n');

  const r = readSymptoms({ text: page, sourceName: 'Bosch manual' });
  assert.equal(r.symptoms.length, 3, 'two non-adjacent mentions of one symptom were merged');
});

it('the columns are re-anchored where the header repeats', () => {
  /*
   * The worst of the three, because it was silent. Page 38 sets its table at one column and page 39
   * sets the same table four further right — each page laid out on its own — and carrying the first
   * boundary across the seam put every cause on the second page to the right of where the parser
   * looked. The indent rule then read them as REMEDIES, and five symptoms came back with no cause
   * at all, their cause text swallowed into the step list. Nothing about the output looked broken.
   */
  const r = readSymptoms({ text: ACROSS_PAGES, sourceName: 'Bosch manual' });
  const after = r.symptoms.find((s) => s.symptom.startsWith('Appliance door'));
  assert.ok(after, 'the row after the break went missing');
  assert.equal(after.causes[0].label, 'The lock is engaged.', 'the cause after the break was lost');
  assert.deepEqual(after.causes[0].remedies, ['Release the lock.']);
});

/* ── explanation is not a cause ───────────────────────────────────────────── */

/*
 * Real, from SHE43DM2N page 40. A cause with an ordered procedure under it prints sentences flush
 * with the boundary BETWEEN its numbered steps — what happens next, how long it takes — and the
 * indent rule read every one of them as a new cause.
 */
const PROCEDURE = [
  'Fault                  Cause and troubleshooting',
  'All LEDs light up or   A software update is possibly installing.',
  'flash.                 1. Wait until the software update has been installed.',
  '                       This process can take approx. 30 minutes.',
  '                       2. If the appliance is not ready to use after 30 minutes,',
  '                          perform a reset.',
  '                          Press the main switch button for approx. 4 seconds.',
  '                          Your appliance is resetting.',
  '                       Electronics have detected a fault.',
  '                       1. Press the main switch button for approx. 4 seconds.',
  '                       The appliance is reset and restarted.',
  '                       2. If the problem occurs again:',
  '                          Contact customer service.',
].join('\n');

it('a line between two numbered steps is explanation, not a new cause', () => {
  /*
   * The manual lists TWO causes here. This produced four — the extra pair being "This process can
   * take approx. 30 minutes." and "The appliance is reset and restarted." An owner told either of
   * those is a cause of their fault is worse off than one told nothing.
   *
   * Across twelve real manuals this removed 18 false causes and changed no symptom.
   */
  const [s] = readSymptoms({ text: PROCEDURE, sourceName: 'Bosch manual' }).symptoms;
  assert.equal(s.causes.length, 2, 'explanatory lines were promoted to causes');
  assert.deepEqual(
    s.causes.map((c) => c.label),
    ['A software update is possibly installing.', 'Electronics have detected a fault.']
  );
});

it('a flush line followed by an INDENTED one is the next cause, not explanation', () => {
  /*
   * The other half, and the rule that stopped explanations becoming causes started swallowing
   * causes into remedies without it — one silent error traded for another.
   *
   * Both lines look identical on their own. The layout decides it one line ahead: an explanation
   * sits between two steps of one procedure, so what follows it is flush; a cause is followed by
   * its own remedies, so what follows it is indented.
   */
  const page = [
    'Fault                      Cause and troubleshooting',
    'Water is left in the ap-   Filter system or area under the filters is blocked.',
    'pliance at the end of      1. Clean the Filters.',
    'the program.               2. Clean the Drain pump.',
    '                           Program has not yet ended.',
    '                              Wait until the program ends.',
  ].join('\n');

  const [s] = readSymptoms({ text: page, sourceName: 'Bosch manual' }).symptoms;
  assert.equal(s.causes.length, 2, 'the second cause was swallowed into the first cause\'s steps');
  assert.equal(s.causes[1].label, 'Program has not yet ended.');
  assert.deepEqual(s.causes[1].remedies, ['Wait until the program ends.']);
});

it('after an ordinary remedy, a flush line IS the next cause', () => {
  /*
   * The rule only fires after a NUMBERED step, which is what marks a cause as having an ordered
   * procedure. Widening it would merge every cause on every dishwasher page into the one above.
   */
  const [s] = readSymptoms({ text: PAGE, sourceName: 'Bosch manual' }).symptoms;
  assert.equal(s.causes.length, 3, 'unnumbered remedies started swallowing the causes after them');
});

/* ── where the table ends ─────────────────────────────────────────────────── */

it('the page moving on to another section ends the table', () => {
  /*
   * Nothing told it to stop. On a Bosch washer the fault table finishes part-way down the page and
   * the disposal section, a safety warning and the installation notes follow — and every one came
   * back as a symptom: "21.1 Disposal of your old appliance...", "WARNING Children can lock
   * themselves in the appliance". Seven of that machine's eight symptoms were not symptoms.
   */
  const page = [
    'Fault                  Cause and troubleshooting',
    'Door will not close.   The lock is engaged.',
    '                          Release it.',
    '21.1 Disposal of your old appliance',
    'Environmentally compatible disposal allows valuable raw materials to be recycled.',
  ].join('\n');

  const r = readSymptoms({ text: page, sourceName: 'Bosch manual' });
  assert.equal(r.symptoms.length, 1);
  assert.equal(r.symptoms[0].symptom, 'Door will not close.');
});

it('two full-width lines in a row end it too', () => {
  const page = [
    'Fault                  Cause and troubleshooting',
    'Door will not close.   The lock is engaged.',
    '                          Release it.',
    'Children can lock themselves in the appliance, thereby putting their lives at risk.',
    'The appliance must not be set up behind a lockable door or a sliding door of any kind.',
  ].join('\n');

  assert.equal(readSymptoms({ text: page, sourceName: 'x' }).symptoms.length, 1);
});

it('but ONE gapless line does not, because a collided row has no gap either', () => {
  // Requiring two consecutive lines is what keeps this from eating the rows the parser is meant to
  // notice and refuse.
  const page = [
    'Fault' + ' '.repeat(20) + 'Cause and troubleshooting',
    'Home Connect cannot There is a technical error.',
    'be implemented cor-' + ' '.repeat(9) + 'Please consult the documents supplied.',
    'rectly.',
    'Door will not close.' + ' '.repeat(6) + 'The lock is engaged.',
    ' '.repeat(28) + 'Release it.',
  ].join('\n');

  const names = readSymptoms({ text: page, sourceName: 'x' }).symptoms.map((s) => s.symptom);
  assert.ok(names.includes('Door will not close.'), 'the table was cut short at a collided row');
});

/* ── honesty ──────────────────────────────────────────────────────────────── */

it('every cause cites where it came from', () => {
  // Same rule as the fault-code path: a claim about somebody's machine carries the page it is on,
  // so the owner can go and check rather than taking it on trust.
  for (const s of read().symptoms) {
    for (const c of s.causes) {
      assert.match(c.evidence, /Bosch manual, page 38/);
      assert.equal(c.source.page, 38);
    }
  }
});

it('cost is null, never zero', () => {
  // A manual lists remedies and never prices. Written as 0 it once told an owner that replacing a
  // drain pump costs nothing.
  for (const s of read().symptoms) {
    for (const c of s.causes) assert.equal(c.cost, null);
  }
});

it('the manual ordering is the prior, and it decreases', () => {
  const s = find(read(), 'Excessive formation');
  assert.ok(s.causes[0].likelihood > s.causes[1].likelihood);
  assert.ok(s.causes[1].likelihood > s.causes[2].likelihood);
});

it('a row whose causes could not be read is dropped and counted', () => {
  // Reported rather than silently discarded, so the coverage line is about what was recovered
  // rather than what was noticed.
  const r = readSymptoms({
    // Short enough to sit entirely inside column one, which is what "nothing beside it" means.
    text: 'Fault                  Cause and troubleshooting\nNothing beside it.',
    sourceName: 'x',
  });
  assert.equal(r.found, 0);
  assert.equal(r.dropped, 1);
  assert.match(r.coverage, /nothing readable/);
});

it('empty input is empty, not a crash', () => {
  for (const t of ['', null, undefined]) {
    assert.equal(readSymptoms({ text: t }).found, 0);
  }
});

it('a symptom that runs over a line is not split by the full stop in the middle of it', () => {
  /*
   * From a Siemens oven, page 13. ONE symptom over three lines:
   *
   *     The appliance is switched on.        The operation indicator is defective.
   *     The operation indicator does not        Call Customer Service Page 15.
   *     light up.
   *
   * The first line ends in a full stop, and sentence punctuation is what tells a finished symptom
   * from a wrapped one — so line two started a NEW symptom, which came back with no causes at all,
   * while the cause that belonged to it stayed attached to the half above.
   *
   * A new symptom always begins a new cause. A line whose right column is a remedy, indented under
   * the cause above, cannot be the start of one.
   */
  const page = [
    'Fault' + ' '.repeat(30) + 'Cause and troubleshooting',
    'The appliance is switched on.' + ' '.repeat(6) + 'The operation indicator is defective.',
    'The operation indicator does not' + ' '.repeat(6) + 'Call Customer Service Page 15.',
    'light up.',
    '',
    'The front panel is not aligned.' + ' '.repeat(4) + 'The front panel was not aligned during installation.',
  ].join('\n');

  const out = readSymptoms({ text: page, sourceName: 'x' });
  const names = out.symptoms.map((s) => s.symptom);

  assert.equal(names.length, 2, `split into ${names.length}: ${names.join(' / ')}`);
  assert.match(names[0], /switched on\. The operation indicator does not light up\./);
  assert.equal(out.symptoms[0].causes.length, 1, 'the cause was orphaned from its symptom');
  assert.equal(names[1], 'The front panel is not aligned.');
});

it('a bullet marks a remedy on a page where nothing is indented', () => {
  /*
   * From a Siemens oven, page 5. Its whole right column is flush with the boundary and every
   * remedy is prefixed with ▶ instead:
   *
   *     The cookware or       There has been a power cut.
   *     food is not heating   ▶ Check whether the lighting in your room is working.
   *     up.
   *                           The appliance is switched off.
   *                           ▶ Switch the appliance on.
   *
   * With nothing indented, the indent rule read all four lines as one cause and glued them into a
   * single label — two causes and two remedies in one sentence, which is a confident piece of
   * nonsense of exactly the kind this parser exists to refuse. The marker is the grammar on that
   * page, the same way indentation is on a Bosch one.
   */
  const page = [
    'Fault' + ' '.repeat(17) + 'Cause and troubleshooting',
    'The cookware or' + ' '.repeat(7) + 'There has been a power cut.',
    'food is not heating' + ' '.repeat(3) + '\u25b6 Check whether the lighting in your room is working.',
    'up.',
    ' '.repeat(22) + 'The appliance is switched off.',
    ' '.repeat(22) + '\u25b6 Switch the appliance on.',
  ].join('\n');

  const [s] = readSymptoms({ text: page, sourceName: 'x' }).symptoms;
  assert.equal(s.symptom, 'The cookware or food is not heating up.');
  assert.equal(s.causes.length, 2, `the causes were glued: ${JSON.stringify(s.causes.map((c) => c.label))}`);
  assert.equal(s.causes[0].label, 'There has been a power cut.');
  assert.equal(s.causes[1].label, 'The appliance is switched off.');

  // And the marker itself is not part of the instruction.
  assert.equal(s.causes[1].remedies[0], 'Switch the appliance on.');
  for (const c of s.causes) {
    for (const r of c.remedies) assert.ok(!/^[\u25b6•]/.test(r), `the bullet survived into a remedy: ${r}`);
  }
});

it('a 2024 manual heads the table "Issue", and the table is read', () => {
  const text = [
    'Issue                                Cause and troubleshooting',
    'Tea residue or lipstick marks on     Dishwashing temperature is too low.',
    'dishware.                            ▶ Select a program with a higher dishwashing temperature.',
  ].join('\n');
  const r = readSymptoms({ text, page: 29 });
  assert.equal(r.found, 1, r.coverage);
  assert.equal(r.symptoms[0].causes[0].label, 'Dishwashing temperature is too low.');
});

console.log(`\n${passed} passed`);
