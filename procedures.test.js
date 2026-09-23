/**
 * Following a manual's "Page N" to the procedure printed there — and refusing when it cannot be sure.
 *
 *   node manual/procedures.test.js
 *
 * The pages here are synthetic, laid out the way `pdftotext -layout` lays out a two-column manual,
 * in words written for this test rather than copied from one. Each refusal case is one that
 * actually happened on the first run over the real library and was caught by reading the output.
 */

const assert = require('node:assert');
const P = require('./procedures');

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

/** Two columns, side by side, the way -layout prints them. */
const page = (left, right, { header = 'en-us   Care and upkeep', footer } = {}) => {
  const rows = Math.max(left.length, right.length);
  const out = [header, ''];
  for (let i = 0; i < rows; i++) out.push(`${(left[i] || '').padEnd(44)}${right[i] || ''}`.replace(/\s+$/, ''));
  out.push('', '', String(footer));
  return out.join('\n');
};

const LEFT_30 = [
  'Other things this page is about. The',
  'left column carries its own list:',
  '1. Wipe the seal with a damp cloth.',
  '2. Dry it.',
  '3. Close the door.',
  '',
  'Wiping the seal',
  'A dirty seal leaks.',
];
const RIGHT_30 = [
  'Emptying the tray',
  'A full tray stops the machine.',
  '1. Slide the tray out towards',
  '   you.',
  '     Hold it level so nothing spills.',
  '2. Tip the water into a sink and',
  '   rinse the tray under the tap.',
  '3. Push the tray back in until it',
  '   clicks.',
];
const PAGES = [page(LEFT_30, RIGHT_30, { footer: 30 }), page(['Nothing to see here.'], ['Or here.'], { footer: 31 })];

/** Poppler's own reading order, for the check: left column, then right. */
const reading = (pages) => pages.map((p) => P.columns(p).map((c) => c.join('\n')).join('\n')).join('\n');

it('a remedy that points is recognised, with its page', () => {
  assert.deepEqual(P.reference('Clean the Filters, Page 35.'), { title: 'Clean the Filters', page: 35 });
  assert.deepEqual(P.reference('"Loading dishware", Page 25'), { title: 'Loading dishware', page: 25 });
  assert.equal(P.reference('Wait until the program ends.'), null);
});

it('a two-column page is read one column at a time, not across', () => {
  const cols = P.columns(PAGES[0]);
  const right = cols.find((c) => c.some((l) => /Emptying the tray/.test(l)));
  assert.ok(right, 'the right column was not separated');
  assert.ok(!right.some((l) => /Wipe the seal/.test(l)), 'the left column bled into the right');
});

it('the procedure under the named heading is taken in sequence, joined, with its notes', () => {
  const r = P.findProcedure(PAGES, P.reference('Empty the tray, Page 30.'));
  assert.equal(r.found, true, r.reason);
  assert.equal(r.heading, 'Emptying the tray');
  assert.deepEqual(r.steps.map((s) => s.n), [1, 2, 3]);
  assert.equal(r.steps[0].text, 'Slide the tray out towards you.');
  assert.deepEqual(r.steps[0].notes, ['Hold it level so nothing spills.']);
  assert.equal(r.steps[1].text, 'Tip the water into a sink and rinse the tray under the tap.');
  // The other column's list — its own 1, 2, 3 — never gets in.
  assert.ok(!r.steps.some((s) => /seal|Dry it|door/.test(s.text)));
});

it('it passes the check when every step is in the independent reading', () => {
  const r = P.check(P.findProcedure(PAGES, P.reference('Empty the tray, Page 30.')), reading(PAGES));
  assert.equal(r.found, true, r.reason);
  assert.equal(r.checked, true);
});

it('a step the independent reading does not contain drops the WHOLE procedure', () => {
  const r = P.findProcedure(PAGES, P.reference('Empty the tray, Page 30.'));
  const tampered = reading(PAGES).replace('rinse the tray under the tap', 'rinse it');
  const c = P.check(r, tampered);
  assert.equal(c.found, false);
  assert.match(c.reason, /step 2 could not be re-found/);
});

it('with no independent reading at all, nothing is kept', () => {
  const c = P.check(P.findProcedure(PAGES, P.reference('Empty the tray, Page 30.')), null);
  assert.equal(c.found, false);
});

it('numbered steps that begin on the NEXT page, under another heading, are refused', () => {
  // "Aligning the appliance" had prose under it and the next page's power-adapter steps were taken.
  const pages = [
    page(['Levelling the machine', 'Use the feet to level it; see the', 'figure.'], ['A picture of a spirit level.'], { footer: 16 }),
    page(['Connecting the adapter', '1. Plug the adapter into the wall.', '2. Plug the machine into the', '   adapter.'], [''], { footer: 17 }),
  ];
  const r = P.findProcedure(pages, P.reference('Level the machine, Page 16.'));
  assert.equal(r.found, false);
  assert.match(r.reason, /begin on the next page/);
});

it('a list that carries on past what was read is refused as incomplete', () => {
  const pages = [page(['Emptying the tray', '1. Slide the tray out.'], ['Something else entirely here.'], { footer: 30 })];
  const r = P.findProcedure(pages, P.reference('Empty the tray, Page 30.'));
  assert.equal(r.found, true);
  // The independent reading has the steps the layout pass missed.
  const c = P.check(r, 'Emptying the tray\n1. Slide the tray out.\n2. Tip it into the sink.\n3. Push it back.');
  assert.equal(c.found, false);
  assert.match(c.reason, /carries on past/);
});

it('the next heading ends the procedure — its text is not the last step\'s note', () => {
  const pages = [page([
    'Adjusting the panel',
    '1. Loosen the screws.',
    '2. Tighten the screws.',
    '   If they spin, back them out fully.',
    '',
    'Fitting the drawer',
    'Sharp edges can mark the panel.',
  ], ['A figure of a screwdriver.'], { footer: 21 })];
  const r = P.findProcedure(pages, P.reference('Adjust the panel, Page 21.'));
  assert.equal(r.found, true, r.reason);
  assert.equal(r.steps.length, 2);
  assert.ok(!r.steps[1].notes.some((n) => /Sharp edges|Fitting/.test(n)), JSON.stringify(r.steps[1].notes));
});

it('a heading on another page than the one cited is not accepted', () => {
  const r = P.findProcedure(PAGES, P.reference('Empty the tray, Page 31.'));
  assert.equal(r.found, false);
});

it('an inline pointer is kept apart from the step, and chapter headings are never notes', () => {
  const pages = [page(['Switching on', '1. Connect it to the supply. Page 11', '2. Set the temperature.'], ['Nothing.'], { footer: 15 })];
  const r = P.findProcedure(pages, P.reference('Switch on, Page 15.'));
  const c = P.check(r, 'Switching on\n1. Connect it to the supply. Page 11\n2. Set the temperature.');
  assert.equal(c.found, true, c.reason);
  assert.equal(c.steps[0].text, 'Connect it to the supply.');
  assert.equal(c.steps[0].see, 11);
});

it('the page is found by its printed number, not its position in the file', () => {
  const pages = ['cover', ...PAGES];
  assert.equal(P.pageIndex(pages, 30), 1);
  assert.equal(P.findProcedure(pages, P.reference('Empty the tray, Page 30.')).found, true);
});

console.log(`\n${passed} passed`);
