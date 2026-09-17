/**
 * The README is a claim. This checks it.
 *
 *   node docs.test.js
 *
 * A README that drifts from the code is the most common lie a library tells, and it is told by
 * accident: a number was true when it was typed. Every figure quoted in README.md is re-derived
 * here from the library itself, so drifting breaks the build rather than misleading a reader.
 *
 * Named `docs.test.js` rather than the obvious `readme.test.js` because npm force-includes any file
 * matching README* in the published tarball, whatever `files` says — so the obvious name shipped a
 * test file to everyone who installed the library.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fg = require('./index.js');

const README = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');

let passed = 0;
const it = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok   ', name);
  } catch (e) {
    console.error('  FAIL ', name, '\n         ', e.message);
    process.exitCode = 1;
  }
};

console.log('readme');

it('the check count it quotes is the check count the suite reports', () => {
  const claimed = /npm test\s+#\s*(\d+) checks/.exec(README);
  assert.ok(claimed, 'the README no longer states how many checks there are');

  const output = execFileSync(process.execPath, [path.join(__dirname, 'test.js')], { encoding: 'utf8' });
  const actual = /^(\d+) passed/m.exec(output);
  assert.ok(actual, 'the suite no longer reports a count');
  assert.equal(claimed[1], actual[1], `README says ${claimed[1]} checks, the suite ran ${actual[1]}`);
});

it('the install command it gives is one that works today', () => {
  // The first code block in a README is the highest-traffic line in a project, and the obvious
  // `npm install faultgraph` 404s until somebody publishes. Promising an install that fails is
  // worse than promising nothing.
  const install = /```bash\n(npm install [^\n]+)\n```/.exec(README);
  assert.ok(install, 'the README no longer shows how to install it');
  assert.ok(!/^npm install faultgraph$/.test(install[1]),
    'the README says `npm install faultgraph`, which 404s — publish it first, then change this test');
  assert.match(install[1], /github:|file:|@/, `unrecognised install route: ${install[1]}`);
});

it('every function it documents is actually exported', () => {
  for (const name of ['parse', 'spaceFor', 'next', 'prune', 'entropy', 'merge']) {
    assert.ok(README.includes(`${name}(`), `${name} is exported but undocumented`);
    assert.equal(typeof fg[name], 'function', `README documents ${name}, which is not exported`);
  }
});

it('the effort scale it prints is the effort scale in the code', () => {
  const quoted = /EFFORT = \{ free: (\d+), easy: (\d+), awkward: (\d+), heavy: (\d+) \}/.exec(README);
  assert.ok(quoted, 'the README no longer prints the effort scale');
  assert.deepEqual(
    [fg.EFFORT.free, fg.EFFORT.easy, fg.EFFORT.awkward, fg.EFFORT.heavy].map(String),
    quoted.slice(1, 5),
    'the effort numbers in the README have drifted from the code'
  );
});

it('the example cause it shows is the cause the library produces', () => {
  // The README prints one cause object in full. It is quoted from a real run of examples/diagnose.js
  // and must stay that way, because a reader will believe the field values are real.
  const page = fs.readFileSync(path.join(__dirname, 'examples', 'diagnose.js'), 'utf8');
  const PAGE = /const PAGE = `([\s\S]*?)`;/.exec(page)[1];
  const graph = fg.parse({ text: PAGE, equipment: 'Bosch SMS46', sourceName: 'Bosch service manual' });
  const cause = graph.codes.E24.causes[2];

  assert.equal(cause.id, 'e24-2');
  for (const claim of [
    `id: '${cause.id}'`,
    `label: '${cause.label}'`,
    `likelihood: ${cause.likelihood}`,
    'cost: null',
    `line: ${cause.source.line}, codeLine: ${cause.source.codeLine}`,
  ]) {
    assert.ok(README.includes(claim), `the README does not show "${claim}", which is what the library returns`);
  }
});

it('the run it prints is the run the example produces', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, 'examples', 'diagnose.js')], {
    encoding: 'utf8',
  }).replace(/\x1b\[[0-9;]*m/g, '');

  // Not a full-text match: the README strips the arrow marker and re-indents. The load-bearing
  // lines are the ones a reader would quote back.
  for (const line of [
    '2 fault codes recovered from Bosch service manual',
    'E24 — Water cannot leave the machine',
    '1.50 bits unknown',
    'Does it turn?',
    'derived from: "Replace the drain pump if it does not turn."',
    'Drain hose is kinked',
    'cost: unknown — a manual lists remedies, not prices',
    'Asked 2 questions. The manual lists 3.',
  ]) {
    assert.ok(output.includes(line), `the example no longer prints "${line}"`);
    assert.ok(README.includes(line), `the README no longer shows "${line}"`);
  }
});

it('it does not promise anything the library refuses to do', () => {
  // Each of these is a limitation the README states. If one stops being true, saying so is a lie in
  // the other direction — so they are checked too.
  assert.strictEqual(fg.parse({ text: 'E24  Water cannot leave\nCheck the filter.' }).codes.E24.causes[0].cost, null,
    'README: "cost is always null from a parse"');
  assert.equal(fg.parse({ text: 'Before first use, remove all packaging.' }).coverage, 'nothing usable found',
    'README: "a page with no fault table on it recovers nothing and says so"');
  assert.ok(!Object.keys(fg).some((k) => /pdf|image|ocr|fetch/i.test(k)),
    'README: "it does not read PDFs or images"');
});

console.log(`\n${passed} passed`);
