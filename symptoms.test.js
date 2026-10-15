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
const { readSymptoms, columnBoundary } = require('./symptoms');

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

it('a bullet marks a remedy on a page where nothing is indented', () => {
  /*
   * From a Siemens oven, page 5. Its whole right column is flush with the boundary and every
   * remedy is prefixed with ▶ instead:
   *
   *     The cookware or       There has been a power cut.
   *     food is not heating   ▶ Check whether the lighting in your room or other appliances are working.
   *     up.
   *                           The appliance is switched off.
   *                           ▶ Switch the appliance on.
   *
   * With nothing indented, the indent rule read all four lines as one cause and glued them into a
   * single label — two causes and two remedies in one sentence, which is a confident piece of
   * nonsense of exactly the kind this parser exists to refuse.
   *
   * The marker is the grammar on that page, the same way indentation is on a Bosch one.
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
  assert.equal(s.causes.length, 2, `the causes were glued together: ${JSON.stringify(s.causes.map((c) => c.label))}`);
  assert.equal(s.causes[0].label, 'There has been a power cut.');
  assert.equal(s.causes[1].label, 'The appliance is switched off.');

  // And the marker itself is not part of the instruction.
  assert.equal(s.causes[1].remedies[0], 'Switch the appliance on.');
  for (const c of s.causes) {
    for (const r of c.remedies) assert.ok(!/^[\u25b6•]/.test(r), `the bullet survived into a remedy: ${r}`);
  }
});

it('a symptom that runs over a line is not split by the full stop in the middle of it', () => {
  /*
   * From a Siemens oven, page 13. This is ONE symptom over three lines:
   *
   *     The appliance is switched on.        The operation indicator is defective.
   *     The operation indicator does not        Call Customer Service Page 15.
   *     light up.
   *
   * The first line ends in a full stop, and the sentence-punctuation rule read that as the symptom
   * being finished — so line two started a new symptom, which came back with no causes at all,
   * while the cause that belonged to it stayed attached to the half above. Both halves were wrong
   * and neither looked it.
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

it('a 2024 manual heads the table "Issue", and the table is read', () => {
  // SHX4AEF5N: a perfectly regular table read as "no column header on this page".
  const text = [
    'Issue                                Cause and troubleshooting',
    'Tea residue or lipstick marks on     Dishwashing temperature is too low.',
    'dishware.                            ▶ Select a program with a higher dishwashing temperature.',
  ].join('\n');
  const r = readSymptoms({ text, page: 29 });
  assert.equal(r.found, 1, r.coverage);
  assert.equal(r.symptoms[0].causes[0].label, 'Dishwashing temperature is too low.');
});

it('empty input is empty, not a crash', () => {
  for (const t of ['', null, undefined]) {
    assert.equal(readSymptoms({ text: t }).found, 0);
  }
});

/*
 * ── Three columns, side by side ─────────────────────────────────────────────
 *
 * Real, from GE's GDT670SYVFS owner's manual (49-4000283 Rev 8), pages 21 and 22, character for
 * character. The header words are centred over their columns, so the columns have to come from
 * the rows; and there is no indent to say where a cause begins.
 */
const GE_PAGE = [
  "                                                                                                                                   TROUBLESHOOTING TIPS",
  "             Problem             Possible Cause                                       What To Do",
  "  Smart Assist light       A potential problem has           Use the SmartHQ App to identify and troubleshoot the",
  "  is red                   been detected with your           potential problem. If you are not connected to WiFi,",
  "                           machine.                          check your display for any codes and call for service.",
  "  Smart Assist light is    There is a notification           Use the SmartHQ App to follow recommended steps.",
  "  yellow                   available in the SmartHQ App.",
  "  Start status indicator   The door was opened or the        Press the Start pad once and close the door within 4",
  "  light flashing           cycle was interrupted.            seconds to start the dishwasher. Press the Start pad a",
  "                                                             second time when the dishwasher is running only if you",
  "                                                             wish to cancel the cycle.",
  "  Dishwasher BEEPS         This is a reminder that your      Press Start and close the door.",
  "  once every minute        dishwasher door has been left",
  "                           open during operation. It will",
  "                           continue beeping until you",
  "                           press Start and close the door.",
  "  Beeping at the end       This is normal. Dishwasher        To turn off the double beep indicator (or re-activate it if",
  "  of the cycle (on         will beep twice at the end of     it was previously turned off), press the Dry Boost pad 5",
  "  some models)             the cycle.                        times within 3 seconds. A triple beep will sound to indicate",
  "                                                             the end-of-cycle beep option has been turned on or off.",
  "  Dishes and flatware      Ultra-Fine Filter or Fine         See the Care and Cleaning section.",
  "  not clean                Filter is clogged",
  "",
  "                           Low inlet water temperature       Make sure inlet water temperature is correct (see the",
  "                                                             USING THE DISHWASHER section). Turn on the hot",
  "                                                             water faucet nearest the dishwasher, let run until the water",
  "                                                             temperature stops rising. Then start the dishwasher and",
  "                                                             turn off the faucet. This ensures the entering water is hot.",
  "                                                             Select Boost if available.",
  "                           Water pressure is                 Turn on a faucet. Is water coming out more slowly than usual?",
  "                           temporarily low                   If so, wait until pressure is normal before using your dishwasher.",
  "                                                             Normal water pressure to the dishwasher should be 20-120 psi.",
  "                           Air gap or disposer clogged       Clean the air gap or flush the disposer.",
  "",
  "                           High drain loop or air gap        Refer to the Installation Instructions for proper drain line",
  "                           not installed                     installation.",
  "                           Improper rack loading             Make sure large dishware does not block the detergent",
  "                                                             dispenser or the wash arms. See the Loading section.",
  "",
  "                           Poor performing detergent         Use high quality detergents such as Cascade® Platinum™",
  "                                                             ActionPacs™ or Bodewell Dishwasher Detergent.",
  "",
].join('\n');
const GE_NEXT = [
  "TROUBLESHOOTING TIPS",
  "                             Problem                Possible Cause                                       What To Do",
  "                       Spots and filming      Extremely hard water              Use high quality rinse agents such as Cascade®",
  "                       on glasses and                                           Platinum™ Power Dry™ Rinse Aid or Finish® Jet-Dry®",
  "                       flatware                                                 Rinse Aid to prevent spots and prevent new film build-up.",
  "                                                                                If water is extremely hard, a softener may be required.",
  "                                              Low inlet water temperature       Make sure water temperature is at least 120°F (49°C).",
  "                                              Overloading or improper           Load dishwasher as shown in the Loading section.",
  "                                              loading of the dishwasher",
  "                                              Old or damp powder                Make sure detergent is fresh. Use high quality detergents",
  "                                              detergent                         such as Cascade® Platinum™ ActionPacs™ or Bodewell",
  "                                                                                Dishwasher Detergent.",
  "                                              Rinse agent dispenser empty       Refill with high quality rinse agents such as Cascade® Platinum™",
  "                                                                                Power Dry™ Rinse Aid or Finish® Jet-Dry® Rinse Aid.",
  "                                              Too little or low performing      Make sure you use the proper amount of highly rated",
].join('\n');

it('a three-column table is read by position: each cause with the remedy printed beside it', () => {
  const r = readSymptoms({ text: GE_PAGE, sourceName: 'GE manual', page: 21 });
  const dirty = r.symptoms.find((s) => s.symptom === 'Dishes and flatware not clean');
  assert.ok(dirty, `not found among: ${r.symptoms.map((s) => s.symptom).join(' | ')}`);
  assert.deepEqual(dirty.causes.map((c) => c.label), [
    'Ultra-Fine Filter or Fine Filter is clogged',
    'Low inlet water temperature',
    'Water pressure is temporarily low',
    'Air gap or disposer clogged',
    'High drain loop or air gap not installed',
    'Improper rack loading',
    'Poor performing detergent',
  ]);
  assert.deepEqual(dirty.causes[0].remedies, ['See the Care and Cleaning section.']);
  assert.equal(dirty.causes[3].remedies[0], 'Clean the air gap or flush the disposer.');
  assert.equal(dirty.causes[0].source.page, 21);
});

it('a problem and a cause that both wrap over several lines come back as one of each', () => {
  const r = readSymptoms({ text: GE_PAGE, sourceName: 'GE manual', page: 21 });
  const red = r.symptoms[0];
  assert.equal(red.symptom, 'Smart Assist light is red');
  assert.equal(red.causes.length, 1);
  assert.equal(red.causes[0].label, 'A potential problem has been detected with your machine.');
  // The remedy cell is prose; one sentence is one step.
  assert.equal(red.causes[0].remedies.length, 2);
  assert.match(red.causes[0].remedies[0], /^Use the SmartHQ App to identify and troubleshoot the potential problem\.$/);
  assert.equal(r.symptoms[1].symptom, 'Smart Assist light is yellow');
});

it('the footer and the running title are not rows', () => {
  const r = readSymptoms({ text: GE_PAGE, sourceName: 'GE manual', page: 21 });
  for (const s of r.symptoms) {
    assert.doesNotMatch(s.symptom, /49-4000283|TROUBLESHOOTING|Rev 8|\d{2}$/, `page furniture was read as a problem: ${s.symptom}`);
    for (const c of s.causes) assert.doesNotMatch(c.label, /49-4000283|TROUBLESHOOTING/);
  }
});

it('the next page sets its columns somewhere else, and is read from its own rows', () => {
  const r = readSymptoms({ text: GE_NEXT, sourceName: 'GE manual', page: 22 });
  assert.ok(r.found >= 1, r.coverage);
  assert.equal(r.symptoms[0].symptom, 'Spots and filming on glasses and flatware');
  assert.equal(r.symptoms[0].causes[0].source.page, 22);
});

it('three-column prose with no table header is still not a table', () => {
  const prose = GE_PAGE.split('\n').filter((l) => !/Problem\s+Possible Cause/.test(l)).join('\n');
  assert.equal(readSymptoms({ text: prose }).found, 0);
});

/*
 * Real, from GE's WJRE5550KWW washer manual, page 8: the dense kind. The first column is headed by
 * its section ("WATER"), remedies are bulleted, causes carry no full stop, and nothing separates
 * one row from the next but the bullet beside it.
 */
const GE_DENSE = [
  "                         WATER                      Possible Causes               What To Do",
  "                         Water level seems low      This is normal                • Water may not cover the top level of the clothes.",
  "                                                                                    This is normal for this high-efficiency washer.",
  "                         Water fills and drains     Drain stand pipe is too low   • The drain stand pipe must be above 30\".",
  "                         at the same time",
  "                         Too many suds              Too much detergent            • Measure your detergent carefully. Use less soap if you have",
  "                                                                                    soft water, a smaller load or a lightly soiled load.",
  "                                                    Type of detergent             • Switch to HE     detergent.",
  "                                                    Soft water                    • Try less detergent.",
  "",
  "",
  "",
  "",
  "Operating Instructions",
  "                         Water leaks                Using too much detergent      • Use less detergent. Use less soap if you have soft water,",
  "                                                    in washer                       a smaller load or a lightly soiled load.",
  "                                                    Type of detergent             • Switch to HE     detergent.",
  "                                                    Fill hoses or drain hose is   • Make sure hose connections are tight at faucets and",
  "                                                    improperly connected            rubber washers are installed. Make sure end of drain hose",
  "                                                                                    is correctly inserted in and secured to drain facility.",
  "                                                    Household drain may           • Check household plumbing. You may need to call",
  "                                                    be clogged                      a plumber.",
  "                                                    Constant water pressure       • Tighten hoses at the faucets and turn the water off after",
  "                                                    to the fill hoses at the        each use.",
  "                                                    water source                  • Check condition of the fill hoses; they should be replaced",
  "                                                                                    every 5 years.",
  "                         Water temperature          Cooler water temperatures     • New laundry detergents have been formulated to work",
  "                         seems incorrect            provide improved energy         with cooler water temperatures without affecting wash",
  "",
  "",
  "",
  "",
  "Troubleshooting Tips",
  "                                                    efficiency                      performance.",
  "                                                    Water supply is turned off    • Turn both hot and cold faucets fully on and make sure",
  "                                                    or improperly connected         hoses are connected to correct faucets.",
  "                                                    Water valve screens are       • Turn off the water source and remove the water connection",
  "                                                    stopped up                      hoses from the upper back of the washer. Use a brush or",
  "                                                                                    toothpick to clean the screens in the machine. Reconnect",
  "                                                                                    the hoses and turn the water back on.",
  "                                                    House water heater is         • Make sure house water heater is delivering water at",
  "                                                    not set properly                120°F–140°F (48°C–60°C).",
  "                         Water pumped out before Lid lifted or cycle was put in   • Reset cycle.",
  "                         cycle is complete       pause for over 24 hours",
  "                         Water won’t drain          Drain hose is kinked or       • Straighten drain hose and make sure washer is not",
].join('\n');

it('a table headed by its section — WATER | Possible Causes | What To Do — is a table', () => {
  const r = readSymptoms({ text: GE_DENSE, sourceName: 'GE manual', page: 8 });
  assert.ok(r.found >= 5, r.coverage);
  assert.equal(r.symptoms[0].symptom, 'Water level seems low');
});

it('causes on consecutive lines with no full stop are separate rows, each with the remedy beside it', () => {
  // The first version read "Type of detergent Soft water" as one cause, with both remedies under
  // it — and the page check passed it, because those words ARE printed one after the other.
  const r = readSymptoms({ text: GE_DENSE, sourceName: 'GE manual', page: 8 });
  const suds = r.symptoms.find((s) => s.symptom === 'Too many suds');
  assert.deepEqual(suds.causes.map((c) => c.label), ['Too much detergent', 'Type of detergent', 'Soft water']);
  assert.deepEqual(suds.causes[2].remedies, ['Try less detergent.']);
  const leaks = r.symptoms.find((s) => s.symptom === 'Water leaks');
  assert.ok(leaks.causes.some((c) => c.label === 'Fill hoses or drain hose is improperly connected'));
  for (const s of r.symptoms) for (const c of s.causes) assert.doesNotMatch(c.remedies.join(' '), /[•▪]/, 'a bullet was kept as part of a step');
});

it('a row whose columns ran together is dropped whole — it is not cut at a space that happens to be there', () => {
  // "Water pumped out before Lid lifted or cycle was put in": nothing straddles the column edge,
  // so the first check missed it and gave "lifted or cycle was put in" to the cause on the row above.
  const r = readSymptoms({ text: GE_DENSE, sourceName: 'GE manual', page: 8 });
  assert.ok(r.collided >= 1, 'the collision was not noticed');
  for (const s of r.symptoms) {
    assert.doesNotMatch(s.symptom, /pumped out before/, 'half of a collided row was kept as a problem');
    for (const c of s.causes) assert.doesNotMatch(c.label, /lifted or cycle|pause for over/, 'a collided row leaked into the cause above it');
  }
  const temp = r.symptoms.find((s) => s.symptom === 'Water temperature seems incorrect');
  assert.equal(temp.causes.at(-1).label, 'House water heater is not set properly');
  // …and the next clean problem is read normally.
  assert.ok(r.symptoms.some((s) => /Water won.t drain/.test(s.symptom)));
});

it('the thumb-tab down the page edge is not part of any row', () => {
  const r = readSymptoms({ text: GE_DENSE, sourceName: 'GE manual', page: 8 });
  const all = JSON.stringify(r.symptoms);
  assert.doesNotMatch(all, /Troubleshooting Tips|Operating Instructions/);
});

/* Real, from GE's DCSR483GAWW dryer manual, page 11. */
const GE_DRYER = [
  "Problem                       Possible Causes                       What To Do",
  "Dryer doesn’t start           Dryer is unplugged                    • Make sure the dryer plug is pushed completely into",
  "                                                                      the outlet.",
  "                              Fuse is blown/circuit breaker         • Check the house fuse/circuit breaker box and replace",
  "                              is tripped                              fuse or reset breaker. NOTE: Most electric dryers use",
  "                                                                      2 fuses/breakers.",
  "",
  "Dryer doesn’t heat            Fuse is blown/circuit breaker is      • Check the house fuse/circuit breaker box and replace",
  "                              tripped, the dryer may tumble           both fuses or reset both breakers. Your dryer may tumble",
  "",
  "",
  "",
  "",
  "                                                                                                                                       Operating Instructions",
  "                              but not heat                            if only one fuse is blown or one breaker tripped.",
  "                              Gas service is off                    • Make sure gas shutoff at dryer and main shutoff are",
  "                                                                      fully open.",
  "",
  "Dryer shakes or               Some shaking/noise is normal.         • Move dryer to an even floor space, or adjust leveling legs",
  "makes noise                   Dryer may be sitting unevenly           as necessary until even.",
].join('\n');

it('two sentences in one cause cell, beside one remedy that runs across both lines, are one row', () => {
  const r = readSymptoms({ text: GE_DRYER, sourceName: 'GE manual', page: 11 });
  const shakes = r.symptoms.find((s) => /shakes/.test(s.symptom));
  assert.ok(shakes, r.symptoms.map((s) => s.symptom).join(' | '));
  assert.equal(shakes.causes.length, 1, 'a remedy still in mid-sentence was split between two causes');
  assert.match(shakes.causes[0].remedies.join(' '), /adjust leveling legs as necessary until even\.$/);
});

it('a capital folded into the cause above, with nothing to say it belongs there, is marked unsure', () => {
  // Is "Old detergent" a second cause, or the end of the first? The page does not say: the line
  // above ends on an ordinary word, and no remedy starts beside it.
  const page = [
    'Problem                 Possible Causes                 What To Do',
    'Spots on glasses        Extremely hard water            Use a rinse agent to remove spots.',
    '                        Old detergent',
  ].join('\n');
  const c = readSymptoms({ text: page }).symptoms[0].causes[0];
  assert.ok(c.unsure, 'an ambiguous join was presented as certain');
  assert.equal(c.suspect, true);
});

it('a name broken across the line is one cause, and is not in doubt', () => {
  // "Ultra-Fine Filter or Fine / Filter is clogged", "the Dry / Boost option": the line above ends
  // on a capitalised word mid-phrase, or on a word that cannot end one.
  for (const [first, second, whole] of [
    ['Ultra-Fine Filter or Fine', 'Filter is clogged', 'Ultra-Fine Filter or Fine Filter is clogged'],
    ['This is normal when the Dry', 'Boost option is used.', 'This is normal when the Dry Boost option is used.'],
    ['The door was opened by', 'Someone during the cycle', 'The door was opened by Someone during the cycle'],
  ]) {
    const page = ['Problem                 Possible Causes                 What To Do',
      `Dishes not clean        ${first.padEnd(32)}See the Care and Cleaning section.`,
      `                        ${second}`].join('\n');
    const c = readSymptoms({ text: page }).symptoms[0].causes[0];
    assert.equal(c.label, whole);
    assert.ok(!c.unsure, `"${first} / ${second}" was put in doubt`);
  }
});

/* Real, from GE's GNE27JSMSS refrigerator manual, page 45: one cause extracts as scrambled capitals. */
const GE_SCRAMBLED = [
  " Problem                                      Possible Causes                             What to Do",
  " Refrigerator does not operate                Refrigerator in defrost cycle.              Wait about 30 minutes for defrost cycle to end.",
  "                                              (LWKHU\u0003RU\u0003ERWK\u0003FRQWUROV\u0003VHW\u0003WR\u00032))\u0011\u0003        Set the controls to a lower temperature setting.",
  "                                              Refrigerator is unplugged.                  Push the plug completely into the outlet.",
  "                                              The fuse is blown/circuit breaker is        Replace fuse or reset the breaker.",
].join('\n');

it('a page whose text layer is font-scrambled in places is refused whole, and says why', () => {
  // Two rows as that page's text layer really gives them: "Either or both controls set to OFF"
  // and "Refrigerator or freezer compartment", each extracted at the wrong codepoints.
  const padded = [GE_SCRAMBLED,
    `${' '.repeat(46)}${'(LWKHURUERWKFRQWUROVVHWWR2))'.padEnd(40)}Set the controls to a lower temperature setting.`,
    ` ${'5HIULJHUDWRURUIUHH]HUFRPSDUWPHQW'.padEnd(45)}${'Temperature control not set cold'.padEnd(40)}See Controls section.`].join('\n');
  const r = readSymptoms({ text: padded, sourceName: 'GE manual', page: 45 });
  assert.equal(r.found, 0);
  assert.ok(r.mangled > 0);
  assert.match(r.coverage, /font-scrambled/);
});

it('one numbered procedure printed beside several causes puts every one of them in doubt', () => {
  // Shaped as GE's GSD4800 prints "Spots and filming": the steps run on past the cause they began beside.
  const page = [
    'Problem                 Possible Causes                 What To Do',
    'Spots and filming       Extremely hard water            • Use a rinse agent to remove spots.',
    'on glasses              Low inlet water temperature     • To remove stubborn spots from glassware:',
    '                        Overloading the dishwasher      1 Remove all metal utensils from the dishwasher.',
    '                        Improper loading                2 Do not add detergent.',
    '                        Old or damp powder detergent    3 Select the longest cycle.',
    'Steam                   This is normal                  • Steam comes through the vent during drying.',
  ].join('\n');
  const r = readSymptoms({ text: page });
  const spots = r.symptoms.find((s) => /Spots/.test(s.symptom));
  assert.ok(spots.causes.length >= 3);
  assert.ok(spots.causes.every((c) => c.unsure), 'a step of a shared procedure was filed under one cause as its remedy');
  // The next problem is its own row and is not in doubt.
  assert.ok(!r.symptoms.find((s) => s.symptom === 'Steam').causes[0].unsure);
});

it('a cause whose words stop mid-phrase is in doubt', () => {
  const page = ['Problem                 Possible Causes                 What To Do',
    'Start status            The door was opened or the      Press the Start button once and close the door.'].join('\n');
  assert.ok(readSymptoms({ text: page }).symptoms[0].causes[0].unsure);
});

// One table row with each column where the header puts it.
const row = (a, b, c) => `${a.padEnd(32)}${b.padEnd(32)}${c}`;

it('a page reference after a symptom is not part of the problem; a code is never mistaken for one', () => {
  const page = [row('Problem', 'Possible Causes', 'What To Do'),
    ['Cloudiness on glassware 14', 'Hard water', 'Use a rinse agent.'],
    ['E 22', 'Filter blocked', 'Clean the filter.'],
  ].map((r) => (Array.isArray(r) ? row(...r) : r)).join('\n');
  const r = readSymptoms({ text: page });
  assert.ok(r.symptoms.some((s) => s.symptom === 'Cloudiness on glassware'), r.symptoms.map((s) => s.symptom).join(' | '));
  assert.ok(r.symptoms.some((s) => s.symptom === 'E 22'), 'a code lost its number');
});

it('rows read wrongly from words that ARE on the page are put in doubt, each with its reason', () => {
  const page = [row('Problem', 'Possible Causes', 'What To Do'),
    ['Spots on dishes', 'Hard water', 'se high quality rinse agents.'],
    ['Noise', 'Drain pump Drain pump', 'This is normal.'],
    ['Runs often', 'Normal operation', 'This is normal.'],
    ['(Modern models run longer.)', 'Larger freezer', 'This is normal.'],
  ].map((r) => (Array.isArray(r) ? row(...r) : r)).join('\n');
  const r = readSymptoms({ text: page });
  const why = (start) => r.symptoms.find((s) => s.symptom.startsWith(start))?.causes[0].unsure;
  assert.match(why('Spots') || '', /mid-sentence/);
  assert.match(why('Noise') || '', /read twice/);
  assert.match(why('(Modern') || '', /aside/);
  assert.equal(why('Runs often'), undefined, 'a clean row was put in doubt');
});

console.log(`\n${passed} passed`);
