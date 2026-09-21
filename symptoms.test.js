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

console.log(`\n${passed} passed`);
