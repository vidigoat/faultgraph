/**
 * faultgraph — tests.
 *
 *   node test.js
 *
 * No framework, no dependencies, no network. The library is deterministic, so the tests can be too.
 *
 * The four tests worth reading before the rest are the ones that check what this library is *for*:
 *
 *   · every citation lands on the line it claims          ("cites the line it actually read")
 *   · unknown cost is null and never 0                    ("a cost it does not know is null")
 *   · a page with no fault table recovers nothing         ("a page that is not a fault table")
 *   · a contradiction is reported, not swallowed          ("an answer that rules out everything")
 *
 * Everything else is machinery. Those four are the promises.
 */

const assert = require('node:assert');
const fg = require('./index.js');

let passed = 0;
const failures = [];
const it = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok   ', name);
  } catch (e) {
    failures.push(name);
    console.error('  FAIL ', name, '\n         ', e.message);
    process.exitCode = 1;
  }
};
const group = (name) => console.log(`\n${name}`);

/* ── Fixtures ────────────────────────────────────────────────────────────────
 *
 * Four manufacturers, because they disagree with each other about what a fault code looks like and
 * that disagreement is most of the difficulty. These are written in the house style of each — not
 * copied from any manual, which would be somebody's copyright rather than a test fixture.
 */

const BOSCH = `
Fault codes and remedies

E24  Water cannot leave the machine
Check the drain filter for debris.
Straighten the drain hose.
Replace the drain pump if it does not turn.

E15  Water in the base tray
Check the door seal for damage.
`;

/** Miele-style: the code sits alone in its own column, meaning underneath. */
const MIELE = `
F11
Drain blocked
Clean the drain filter.
Check the outlet hose is not kinked.
`;

/** LG-style: two-letter codes, no separator but a run of spaces. */
const LG = `
OE   The machine will not drain
Clean the drain pump filter.
Check the drain hose for kinks.

UE   Load is unbalanced
Check the machine is level on all four feet.
`;

/** A page from a manual for something that is not a household appliance at all. */
const COMPRESSOR = `
Alarm codes — reciprocating compressor

A12: Discharge pressure high
Check the condenser fan is running.
Clean the condenser coil.
Replace the pressure switch if it does not reset.

A31: Motor overload
Check the terminal block for loose connections.
`;

const parse = (text, sourceName = 'test manual') => fg.parse({ text, sourceName });

/* ── The promises ──────────────────────────────────────────────────────────── */

group('the promises');

it('cites the line it actually read', () => {
  // Every piece of evidence quotes a remedy. That remedy must be sitting on the line the citation
  // names, in the text that was handed in. This is the property the whole design exists to keep:
  // a cause that cannot be traced back to printed text is a cause somebody made up.
  for (const [name, text] of Object.entries({ BOSCH, MIELE, LG, COMPRESSOR })) {
    const lines = text.split('\n');
    const graph = parse(text, name);
    let checked = 0;

    for (const [code, entry] of Object.entries(graph.codes)) {
      for (const cause of entry.causes) {
        const cited = lines[cause.source.line - 1];
        assert.ok(cited !== undefined, `${name} ${code}: cited line ${cause.source.line} is off the page`);
        assert.equal(cited.trim(), cause.remedy, `${name} ${code}: line ${cause.source.line} does not hold the quoted remedy`);
        assert.ok(cause.evidence.includes(cause.remedy), `${name} ${code}: evidence does not contain the remedy it quotes`);
        checked++;
      }
    }
    assert.ok(checked > 0, `${name} produced no causes to check`);
  }
});

it('a cost it does not know is null, never 0', () => {
  // A manual lists remedies; it does not list prices. Written as 0 this once told somebody that
  // replacing a drain pump costs nothing — a confident wrong answer, which is worse than no answer.
  const graph = parse(BOSCH);
  for (const entry of Object.values(graph.codes)) {
    for (const cause of entry.causes) {
      assert.strictEqual(cause.cost, null, `${cause.label} carries a cost this library cannot know`);
      assert.notStrictEqual(cause.cost, 0);
    }
  }
});

it('a page that is not a fault table recovers nothing, and says so', () => {
  const prose = `
    Before first use, remove all packaging. The appliance must be installed by a competent person.
    Warning: do not connect to the mains until the water supply has been checked and the machine
    is level. See the installation guide for the correct clearances around the unit.
  `;
  const graph = parse(prose);
  assert.deepEqual(graph.codes, {}, 'invented a fault code from prose');
  assert.equal(graph.found, 0);
  assert.equal(graph.coverage, 'nothing usable found');
});

it('the two ways of finding nothing are told apart', () => {
  /*
   * Both used to be "nothing usable found", and they need opposite things from the person holding
   * the manual. A wrong page means go and find the fault table. A two-column layout means you are
   * already looking at the right page and the parser cannot read it — telling that person to keep
   * hunting sends them looking for something on the page in their hands.
   */
  const wrongPage = parse('Before first use, remove all packaging. Install by a competent person.');
  assert.equal(wrongPage.found, 0);
  assert.equal(wrongPage.orphanCodes, 0);
  assert.equal(wrongPage.coverage, 'nothing usable found');

  // Remedies to the RIGHT of the code rather than below it. A real and common table layout.
  const twoColumn = parse('E24  Water cannot leave    Check the drain filter\nE15  Water in base tray    Check the door seal');
  assert.equal(twoColumn.found, 0, 'the fixture has stopped being unparseable');
  assert.equal(twoColumn.orphanCodes, 2, 'codes were seen and not counted');
  assert.match(twoColumn.coverage, /none with remedies beneath them/);
  assert.match(twoColumn.coverage, /column to the right/, 'it does not say what is probably wrong');
  assert.notEqual(twoColumn.coverage, wrongPage.coverage);
});

it('a page it reads fully reports no orphans', () => {
  const graph = parse(BOSCH);
  assert.equal(graph.orphanCodes, 0, 'a clean parse is reporting codes it could not use');
  assert.match(graph.coverage, /recovered/);
});

it('an answer that rules out everything is a contradiction, not certainty', () => {
  const graph = parse(BOSCH);
  const { space } = fg.spaceFor(graph, 'E24');
  const result = fg.prune({ space, outcome: { value: 'no', consistentWith: [] } });

  assert.equal(result.contradiction, true);
  assert.equal(result.space.length, space.length, 'a contradiction must not silently empty the space');
  assert.match(result.reason, /Something else is going on/);
});

/* ── Reading the table ─────────────────────────────────────────────────────── */

group('reading the table');

it("Bosch's E-codes, meaning on the same line", () => {
  const graph = parse(BOSCH, 'Bosch service manual');
  assert.deepEqual(Object.keys(graph.codes).sort(), ['E15', 'E24']);
  assert.equal(graph.codes.E24.meaning, 'Water cannot leave the machine');
  assert.equal(graph.codes.E24.causes.length, 3);
  assert.equal(graph.coverage, '2 fault codes recovered');
});

it("Miele's orphan code, meaning on the line below", () => {
  const graph = parse(MIELE);
  assert.ok(graph.codes.F11, 'a code alone on its line was dropped — this is the commonest table shape');
  assert.equal(graph.codes.F11.meaning, 'Drain blocked');
  assert.equal(graph.codes.F11.causes.length, 2);
});

it("LG's two-letter codes, separated by nothing but spaces", () => {
  const graph = parse(LG);
  assert.deepEqual(Object.keys(graph.codes).sort(), ['OE', 'UE']);
  assert.equal(graph.codes.UE.meaning, 'Load is unbalanced');
});

it('a code with a colon, on equipment that is not an appliance', () => {
  const graph = parse(COMPRESSOR, 'compressor manual');
  assert.deepEqual(Object.keys(graph.codes).sort(), ['A12', 'A31']);
  assert.equal(graph.codes.A12.meaning, 'Discharge pressure high');
  // Nothing in this library knows what a dishwasher is. If that ever stops being true, this fails.
  assert.equal(graph.codes.A12.causes[0].label, 'Condenser fan is running');
});

it('codes are normalised, so E-24 and E24 are the same code', () => {
  assert.equal(parse('E-24  Water cannot leave the machine\nCheck the filter.').found, 1);
  assert.ok(parse('E-24  Water cannot leave the machine\nCheck the filter.').codes.E24);
});

it('a code with no remedies under it is not a fault entry', () => {
  // A bare code with nothing actionable beneath it is an index entry, a heading, or a page number
  // that happens to look like a code. An entry with no causes cannot be diagnosed, so it is not one.
  const graph = parse('E24  Water cannot leave the machine\n\nSomething else entirely follows.');
  assert.deepEqual(graph.codes, {});
});

it('common words are not fault codes', () => {
  const graph = parse('THE  machine must be level before use\nCheck the feet.\nAND  so on and so forth\nCheck it.');
  assert.deepEqual(graph.codes, {}, 'a word at the start of a line was read as a fault code');
});

it('a remedy belonging to the next code does not attach to this one', () => {
  const graph = parse(BOSCH);
  const e24 = graph.codes.E24.causes.map((c) => c.remedy).join(' ');
  assert.ok(!e24.includes('door seal'), "E15's remedy was filed under E24");
});

/* ── The shapes real manuals actually use ────────────────────────────────── */

group('real manuals, not fixtures');

/*
 * Everything in this section came from one real Bosch dishwasher manual, downloaded from Bosch's
 * own CDN. Three fixtures written from imagination all parsed on the first try; the real document
 * recovered NOTHING, for two reasons neither fixture had.
 */

const BOSCH_REAL = `FAULT CODE TABLE

Fault code E24 is lit.
Waste-water hose kinked or blocked.
Install hose without kinks, remove any residue.
Siphon connection still sealed.
Check connection to siphon and open if required.
Cover on the waste water pump loose.
Lock cover correctly.

Fault code E25 is lit.
Waste water pump blocked or cover not locked in position.
Clean pump and lock cover correctly.
`;

it('a code embedded in a sentence is still a code', () => {
  /*
   * "Fault code E24 is lit." — the code in the middle of a line rather than at the start of one.
   * Every other pattern here anchors to the line start, so this format recovered nothing at all.
   * It is what a three-column table becomes when it is read aloud: the first column turns into a
   * sentence and the code lands inside it.
   */
  const graph = parse(BOSCH_REAL, 'Bosch service manual');
  assert.deepEqual(Object.keys(graph.codes).sort(), ['E24', 'E25']);
  assert.equal(graph.found, 2);
});

it("the manufacturer's stated reason is preferred to our derived one", () => {
  /*
   * The second real-world gap. Only the ACTION lines carry a remedy verb, so an earlier version
   * kept those and threw the reasons away, then derived a cause back out of the remedy.
   *
   * "Waste-water hose kinked or blocked" is Bosch's sentence. "Hose has failed" is our guess at
   * Bosch's sentence. When the page prints the reason, printing our guess instead is strictly
   * worse and harder to defend.
   */
  const graph = parse(BOSCH_REAL, 'Bosch service manual');
  const labels = graph.codes.E24.causes.map((c) => c.label);
  assert.ok(labels.includes('Waste-water hose kinked or blocked'), `derived instead of read: ${labels}`);
  assert.ok(labels.includes('Siphon connection still sealed'));
});

it('an explicitly labelled row beats inferring from verbs', () => {
  /*
   * A vision transcription that says REASON: and REMEDY: has already said which cell is which, and
   * guessing from verbs when the answer is written down would be perverse. The inference happens to
   * work on most rows — but "Check the door seal" as a REASON would fool it completely, and a
   * labelled line never can.
   */
  const graph = parse(`E:07 is lit.
REASON: Intake opening covered by utensils.
REMEDY: Arrange utensils so that the intake opening is not obstructed.
E:22 is lit.
REASON: Check the door seal for damage.
REMEDY: Clean filters.`, 'Bosch manual p39');

  assert.deepEqual(Object.keys(graph.codes).sort(), ['E07', 'E22']);
  assert.equal(graph.codes.E07.causes[0].label, 'Intake opening covered by utensils');
  assert.match(graph.codes.E07.causes[0].remedy, /^Arrange utensils/, 'the REMEDY: prefix survived into the remedy');

  // The row that would fool a verb-based guess: a reason that reads like a remedy.
  assert.equal(graph.codes.E22.causes[0].label, 'Check the door seal for damage',
    'a labelled REASON was mistaken for a remedy');
});

it('"is lit" is not a fault description', () => {
  // "E:07 is lit." parses cleanly and hands back the meaning "is lit.", which tells a reader
  // nothing and looks like a bug. The page states no meaning for these codes; the causes carry it.
  const graph = parse('E:07 is lit.\nREASON: Filters blocked.\nREMEDY: Clean filters.', 'm');
  assert.equal(graph.codes.E07.meaning, '', 'a meaningless meaning was kept');
  assert.equal(graph.codes.E07.causes.length, 1, 'dropping the meaning cost us the causes');

  // And a real meaning still survives.
  const real = parse('E24  Water cannot leave the machine\nCheck the drain filter.', 'm');
  assert.equal(real.codes.E24.meaning, 'Water cannot leave the machine');
});

it('a reason with no remedy under it is not invented into a cause', () => {
  // A dangling reason has nothing to do about it, and a cause you cannot act on is noise.
  const graph = parse('Fault code E31 is lit.\nSomething is wrong and the manual does not say what.\n', 'm');
  assert.deepEqual(graph.codes, {}, 'a reason with no remedy became a cause');
});

it('several reason/action pairs under one code all survive', () => {
  // The window used to be five lines, sized for a short fixture. A real table runs longer and was
  // being truncated at the third cause.
  const graph = parse(BOSCH_REAL, 'm');
  assert.ok(graph.codes.E24.causes.length >= 3, `only ${graph.codes.E24.causes.length} causes recovered`);
});

it('every cause still cites a line that holds its remedy', () => {
  // The new path must not break the property the whole library rests on.
  const lines = BOSCH_REAL.split('\n');
  const graph = parse(BOSCH_REAL, 'Bosch service manual');
  for (const entry of Object.values(graph.codes)) {
    for (const cause of entry.causes) {
      assert.equal(lines[cause.source.line - 1].trim(), cause.remedy);
    }
  }
});

/* ── Remedies into causes ──────────────────────────────────────────────────── */

group('remedies into causes');

it('an instruction becomes the thing that is wrong', () => {
  // "Replace the drain pump" is something to DO. A list headed "possible causes" full of
  // instructions reads as nonsense to the person looking at it.
  assert.equal(fg.remedyToCause('Replace the drain pump if it does not turn'), 'Drain pump has failed');
  assert.equal(fg.remedyToCause('Clean the drain filter'), 'Drain filter is blocked');
  assert.equal(fg.remedyToCause('Straighten the drain hose'), 'Drain hose is kinked');
  assert.equal(fg.remedyToCause('Tighten the terminal block'), 'Terminal block is loose');
  assert.equal(fg.remedyToCause('Check the drain filter for debris'), 'Drain filter — debris');
});

it('an unrecognised remedy survives as itself', () => {
  // Better a clumsy label taken verbatim than a confident rewrite of something not understood.
  assert.equal(fg.remedyToCause('Bleed the hydraulic line at the union'), 'Bleed the hydraulic line at the union');
});

it('the manual ordering becomes the prior, and it is strictly decreasing', () => {
  const causes = parse(BOSCH).codes.E24.causes;
  for (let i = 1; i < causes.length; i++) {
    assert.ok(causes[i].likelihood < causes[i - 1].likelihood,
      'a later remedy is at least as likely as an earlier one — the ordering has stopped being information');
  }
});

/* ── Effort and danger ─────────────────────────────────────────────────────── */

group('effort and danger');

it('replacing a part is the most expensive thing that can be asked for', () => {
  assert.equal(fg.effortOf('Replace the drain pump'), 'heavy');
  assert.equal(fg.effortOf('Pull the machine out from under the counter'), 'heavy');
  assert.equal(fg.effortOf('Unscrew the base panel'), 'awkward');
  assert.equal(fg.effortOf('Listen for the pump'), 'free');
  assert.equal(fg.effortOf('Clean the drain filter'), 'easy');
});

it('effort is ordered, and ordering is what the chooser uses', () => {
  const { EFFORT } = fg;
  assert.ok(EFFORT.free < EFFORT.easy && EFFORT.easy < EFFORT.awkward && EFFORT.awkward < EFFORT.heavy);
  assert.equal(EFFORT.free, 0, 'a check that costs nothing must not be penalised at all');
});

it('causes behind something that can hurt you are flagged', () => {
  assert.equal(fg.isMains('Replace the heating element'), true);
  assert.equal(fg.isMains('Check the terminal block for loose connections'), true);
  assert.equal(fg.isMains('Discharge the capacitor before proceeding'), true);
  assert.equal(fg.isMains('Check the gas valve'), true);
  assert.equal(fg.isMains('Clean the drain filter'), false);
});

it('a flagged cause is not marked owner-fixable', () => {
  const graph = parse(COMPRESSOR, 'compressor manual');
  const terminal = graph.codes.A31.causes[0];
  assert.equal(terminal.mains, true);
  assert.equal(terminal.ownerFixable, false,
    'a cause behind a terminal block was offered to an owner as a job they can do');
});

/* ── Observations: the part worth stealing ─────────────────────────────────── */

group('observations derived from conditions');

it("a remedy's own condition becomes a question that costs nothing", () => {
  const tests = parse(BOSCH).codes.E24.tests;
  const observation = tests.find((t) => t.kind === 'observation');

  assert.ok(observation, 'the condition printed on the page was thrown away');
  assert.equal(observation.question, 'Does it turn?');
  assert.equal(observation.effort, 'easy');
  assert.equal(observation.derivedFrom, 'Replace the drain pump if it does not turn.');
});

it('an observation is asked before the remedy it came from', () => {
  // The entire reason for deriving it. Both questions carry the same information; one is answered
  // by looking and the other by buying a pump.
  const graph = parse(BOSCH);
  const { space, tests } = fg.spaceFor(graph, 'E24');
  const chosen = fg.next({ space, tests });
  const heavy = tests.find((t) => t.effort === 'heavy');

  assert.ok(chosen.test, 'nothing was chosen at all');
  assert.notEqual(chosen.test.id, heavy.id, 'the first thing asked was to buy a part');
  assert.ok(fg.EFFORT[chosen.test.effort] <= fg.EFFORT.easy);
});

it('the spoken answers are grammatical, because they are read aloud', () => {
  const observation = parse(BOSCH).codes.E24.tests.find((t) => t.kind === 'observation');
  const said = observation.outcomes.map((o) => o.say);
  assert.ok(said.includes('yes, it turns'), `"yes, it turn" is not a detail when a machine says it: ${said}`);
  assert.ok(said.includes('no, it does not turn'));
});

it('conjugation leaves alone anything it is not sure about', () => {
  assert.equal(fg.conjugate('turn'), 'turns');
  assert.equal(fg.conjugate('turn on the tap'), 'turns on the tap');
  assert.equal(fg.conjugate('wash'), 'washes');
  assert.equal(fg.conjugate('empty'), 'empties');
  assert.equal(fg.conjugate('running'), 'running', 'an inflected word was inflected again');
  assert.equal(fg.conjugate('has power'), 'has power');
});

it('a manual with no conditions yields no observations, and still works', () => {
  const graph = parse(LG);
  const tests = graph.codes.OE.tests;
  assert.equal(tests.filter((t) => t.kind === 'observation').length, 0);
  assert.ok(tests.length > 0, 'a table without conditions must still be diagnosable');
  assert.ok(tests.every((t) => t.kind === 'remedy'));
});

it('every observation traces back to a clause that was printed', () => {
  for (const text of [BOSCH, MIELE, LG, COMPRESSOR]) {
    const graph = parse(text);
    for (const entry of Object.values(graph.codes)) {
      for (const test of entry.tests.filter((t) => t.kind === 'observation')) {
        assert.ok(text.includes(test.derivedFrom.replace(/\.$/, '')),
          `an observation was derived from text that is not on the page: ${test.derivedFrom}`);
      }
    }
  }
});

/* ── The diagnosable half ──────────────────────────────────────────────────── */

group('entropy, choosing, pruning');

it('entropy is zero for certainty and 2 bits for four equal causes', () => {
  assert.equal(fg.entropy([{ prior: 1 }]), 0);
  assert.equal(fg.entropy([{ prior: 0.25 }, { prior: 0.25 }, { prior: 0.25 }, { prior: 0.25 }]), 2);
  assert.equal(fg.entropy([]), 0);
});

it('priors sum to one whatever the input did', () => {
  const out = fg.normalise([{ prior: 3 }, { prior: 1 }]);
  assert.equal(out.reduce((n, c) => n + c.prior, 0), 1);
  const degenerate = fg.normalise([{ prior: 0 }, { prior: 0 }]);
  assert.equal(degenerate[0].prior, 0.5, 'an all-zero space must fall back to uniform, not divide by zero');
});

it('an unknown code is a known unknown', () => {
  const result = fg.spaceFor(parse(BOSCH), 'E99');
  assert.equal(result.known, false);
  assert.deepEqual(result.space, []);
  assert.match(result.reason, /E99/);
});

it('one cause left means done, not stuck', () => {
  const result = fg.next({ space: [{ id: 'a', prior: 1 }], tests: [] });
  assert.equal(result.done, true);
  assert.equal(result.stuck, false);
  assert.equal(result.test, null);
});

it('nothing left to ask means stuck, and stuck is a real answer', () => {
  const graph = parse(BOSCH);
  const { space, tests } = fg.spaceFor(graph, 'E24');
  const result = fg.next({ space, tests, performed: tests.map((t) => t.id) });
  assert.equal(result.stuck, true);
  assert.equal(result.done, false);
  assert.equal(result.test, null, 'a stuck diagnosis must not name a cause it has not established');
});

it('a test that eliminates nothing is never chosen', () => {
  const space = [{ id: 'a', prior: 0.5 }, { id: 'b', prior: 0.5 }];
  const useless = {
    id: 'useless', effort: 'free',
    outcomes: [{ value: 'yes', consistentWith: ['a', 'b'] }, { value: 'no', consistentWith: ['a', 'b'] }],
  };
  assert.equal(fg.score(space, useless).bits, 0);
  const result = fg.next({ space, tests: [useless] });
  assert.equal(result.test, null, 'a free test that says nothing was chosen because it was free');
  assert.equal(result.stuck, true);
});

it('a cheaper test wins over a sharper one it is not far behind', () => {
  // The whole reason effort is in the score. `sharp` splits four causes cleanly; `cheap` only
  // separates one. `sharp` is strictly more informative, and it still loses, because finding out
  // means buying a part.
  const space = ['a', 'b', 'c', 'd'].map((id) => ({ id, prior: 0.25 }));
  const sharp = {
    id: 'sharp', effort: 'heavy',
    outcomes: [{ value: 'yes', consistentWith: ['a', 'b'] }, { value: 'no', consistentWith: ['c', 'd'] }],
  };
  const cheap = {
    id: 'cheap', effort: 'free',
    outcomes: [{ value: 'yes', consistentWith: ['a'] }, { value: 'no', consistentWith: ['b', 'c', 'd'] }],
  };
  assert.ok(fg.score(space, sharp).bits > fg.score(space, cheap).bits, 'the fixture no longer tests anything');
  assert.equal(fg.next({ space, tests: [sharp, cheap] }).test.id, 'cheap');
});

it('the chosen test is always the one with the most bits per unit of effort', () => {
  // States the rule as an invariant rather than trusting one fixture. If a special case is ever
  // added to `next()`, this is what notices.
  for (const text of [BOSCH, MIELE, LG, COMPRESSOR]) {
    const graph = parse(text);
    for (const code of Object.keys(graph.codes)) {
      const { space, tests } = fg.spaceFor(graph, code);
      const step = fg.next({ space, tests });
      if (!step.test) continue;
      const best = Math.max(...tests.map((t) => fg.score(space, t).value));
      assert.ok(Math.abs(fg.score(space, step.test).value - best) < 1e-9,
        `${code}: chose ${step.test.id}, which is not the best value available`);
    }
  }
});

it('every choice comes with a reason it can say out loud', () => {
  const graph = parse(COMPRESSOR, 'compressor manual');
  const { space, tests } = fg.spaceFor(graph, 'A12');
  const chosen = fg.next({ space, tests });
  assert.ok(chosen.why && chosen.why.length > 10, 'a question with no stated reason should not be asked');
  assert.ok(chosen.bits > 0);
});

it('pruning eliminates, renormalises, and hands back what it removed', () => {
  const graph = parse(BOSCH);
  const { space } = fg.spaceFor(graph, 'E24');
  const result = fg.prune({ space, outcome: { consistentWith: ['e24-1', 'e24-2'] } });

  assert.equal(result.space.length, 2);
  assert.equal(result.eliminated.length, 1);
  assert.equal(result.eliminated[0].id, 'e24-0', 'the eliminated cause is what the interface strikes through');
  assert.ok(Math.abs(result.space.reduce((n, c) => n + c.prior, 0) - 1) < 1e-9);
  assert.ok(result.bits < fg.entropy(space), 'pruning did not reduce uncertainty');
});

it('a whole diagnosis terminates, on every answer path', () => {
  // Exhaustive rather than sampled: every sequence of answers, on every code, in every fixture.
  // A loop here is not a slow run — it is a person being asked the same question forever.
  let paths = 0;
  let worst = 0;

  const walk = (space, tests, performed, depth) => {
    assert.ok(depth < 20, 'a diagnosis did not terminate');
    const step = fg.next({ space, tests, performed });
    if (!step.test) { paths++; worst = Math.max(worst, depth); return; }

    for (const outcome of step.test.outcomes) {
      const after = fg.prune({ space, outcome });
      if (after.contradiction) { paths++; worst = Math.max(worst, depth + 1); continue; }
      walk(after.space, tests, [...performed, step.test.id], depth + 1);
    }
  };

  for (const text of [BOSCH, MIELE, LG, COMPRESSOR]) {
    const graph = parse(text);
    for (const code of Object.keys(graph.codes)) {
      const { space, tests } = fg.spaceFor(graph, code);
      walk(space, tests, [], 0);
    }
  }

  // Every code must contribute at least one terminating path, and the deepest must be short enough
  // that a person would actually reach the end of it.
  const codes = [BOSCH, MIELE, LG, COMPRESSOR].reduce((n, t) => n + parse(t).found, 0);
  assert.ok(paths > codes, `only ${paths} answer paths across ${codes} codes — the walk is not branching`);
  assert.ok(worst <= 4, `a diagnosis took ${worst} questions; nobody stays for that`);
  console.log(`         ${paths} answer paths walked across ${codes} codes, deepest ${worst} questions`);
});

/* ── Merging ───────────────────────────────────────────────────────────────── */

group('merging with data you trust');

it('verified data always beats parsed data', () => {
  const graph = parse(BOSCH);
  const verified = { E24: { meaning: 'Checked by a human', causes: [], tests: [] } };
  const merged = fg.merge(verified, graph);

  assert.equal(merged.E24.meaning, 'Checked by a human');
  assert.ok(merged.E15, 'a parsed code with no verified counterpart was dropped');
});

it('merging into nothing is just the parsed graph', () => {
  const graph = parse(BOSCH);
  assert.deepEqual(Object.keys(fg.merge(undefined, graph)).sort(), ['E15', 'E24']);
});

/* ── Input it was not designed for ─────────────────────────────────────────── */

group('input it was not designed for');

it('empty, blank and whitespace input recover nothing without throwing', () => {
  for (const text of ['', '   ', '\n\n\n', '\t']) {
    const graph = parse(text);
    assert.equal(graph.found, 0);
    assert.equal(graph.coverage, 'nothing usable found');
  }
});

it('a very long line does not hang the parser', () => {
  const started = Date.now();
  parse(`E24  ${'water '.repeat(20000)}`);
  assert.ok(Date.now() - started < 2000, 'catastrophic backtracking on a long line');
});

it('the source name is carried into every citation, including a strange one', () => {
  const graph = fg.parse({ text: BOSCH, sourceName: 'photo of a sticker inside the door' });
  assert.equal(graph.source, 'photo of a sticker inside the door');
  for (const cause of graph.codes.E24.causes) {
    assert.ok(cause.evidence.startsWith('photo of a sticker inside the door:'));
    assert.equal(cause.source.manual, 'photo of a sticker inside the door');
  }
});

it('equipment is carried through and never interpreted', () => {
  const graph = fg.parse({ text: BOSCH, equipment: 'Bosch SMS46' });
  assert.equal(graph.equipment, 'Bosch SMS46');
  assert.equal(graph.model, 'Bosch SMS46', 'the older field name still has to work');
});

it('parsing is deterministic — the same text gives the same graph', () => {
  assert.deepEqual(parse(COMPRESSOR), parse(COMPRESSOR));
});

it('a fault table in columns — pipes, tabs or markdown — is read, and cites the row', () => {
  // It used to come back "2 fault codes seen, none with remedies beneath them".
  const pipe = parse('Code | Meaning | Remedy\nE24 | Water cannot drain | Check the drain filter. Straighten the drain hose.\nE15 | Water in base tray | Check the door seal.');
  assert.equal(pipe.coverage, '2 fault codes recovered');
  assert.equal(pipe.codes.E24.meaning, 'Water cannot drain');
  assert.equal(pipe.codes.E24.causes.length, 2, 'the remedy cell was not split into its ordered list');
  assert.ok(pipe.codes.E24.causes.every((c) => c.source.line === 2), 'a cause lost the row it came from');
  const tab = parse('Code\tMeaning\tRemedy\nE24\tWater cannot drain\tCheck the drain filter; straighten the drain hose.');
  assert.equal(tab.codes.E24.causes.length, 2, 'a semicolon-separated cell was not split');
  const md = parse('| Code | Meaning | Remedy |\n|---|---|---|\n| E24 | Water cannot drain | Check the drain filter. |');
  assert.equal(md.codes.E24.causes[0].source.line, 3);
  assert.equal(Object.keys(md.codes).length, 1, 'the header or the divider row was read as a code');
});

it('a header row decides which column is which — a DIY column is not a cause, a cause column is', () => {
  // The shape of real error-code pages: Code | Meaning | Common Cause | Fix | DIY?. Read by
  // position, the DIY answer ("Pro") became a cause; and "turn off the water supply" was not
  // recognised as a remedy at all, so that code was dropped.
  const text = [
    'Error Code\tMeaning\tCommon Cause\tFix\tDIY?',
    'E15\tLeak sensor activated\tWater in base pan from a hose leak\tTurn off water supply; tilt machine to drain base\tInspect First',
    'E22\tDrain blocked\tFood debris in the filter\tClean the filter\tYes',
    'E09\tHeating element fault\tElement failure\tProfessional element testing required\tPro',
  ].join('\n');
  const g = parse(text);
  assert.ok(g.codes.E15, 'a remedy that starts "turn off" was not recognised');
  assert.equal(g.codes.E15.causes[0].label, 'Water in base pan from a hose leak', 'the cause column was not the cause');
  assert.ok(!JSON.stringify(g.codes).includes('"Pro"') && !JSON.stringify(g.codes).includes('Inspect First'), 'the DIY column leaked in');
  assert.equal(g.codes.E09, undefined, 'a technician-only row was given a do-it-yourself remedy');
  assert.equal(g.orphanCodes, 1, 'the technician-only row was not counted as seen');
  assert.deepEqual(g.orphans, ['E09'], 'which code was seen without a remedy was not said');
});

it('a header holds for its own table only, and names the code column wherever it is', () => {
  // A second, headerless table further down the page used to be read with the first table's
  // columns: its remedy cell was taken as a cause, whole, and its two steps became one.
  const two = parse([
    'Code | Meaning | Common Cause | Fix | DIY?',
    'E15 | Leak | Hose leak | Turn off the water supply | Yes',
    '',
    'Other errors',
    'E24 | Water cannot drain | Check the drain filter; straighten the drain hose',
  ].join('\n'));
  assert.equal(two.codes.E24.causes.length, 2, 'the second table was read with the first one\'s header');
  // Some pages put the meaning first; the header says so, and was not listened to.
  const moved = parse('Meaning\tCode\tFix\nWater cannot drain\tE24\tCheck the drain filter');
  assert.ok(moved.codes.E24, 'a code column that is not the first was never read');
  assert.equal(moved.codes.E24.meaning, 'Water cannot drain');
});

it('a cause the manual names before a colon is the label; a "Note:" is not a cause', () => {
  const g = parse('E24   Water cannot drain\nBlocked filter: clean the filter.\nNote: straighten the drain hose.');
  assert.deepEqual(g.codes.E24.causes.map((c) => c.label), ['Blocked filter', 'Drain hose is kinked']);
  assert.equal(g.codes.E24.causes[0].remedy, 'Blocked filter: clean the filter.', 'the remedy must stay as printed');
});

it('a verb that is also a noun is a remedy only as an instruction — "Drain pump blocked" is a reason', () => {
  const g = parse('E24   Water cannot drain\nDrain pump blocked\nClean the drain pump.\nTilt sensor faulty\nTilt machine to drain the base.');
  assert.deepEqual(g.codes.E24.causes.map((c) => [c.label, c.remedy]), [
    ['Drain pump blocked', 'Clean the drain pump.'],
    ['Tilt sensor faulty', 'Tilt machine to drain the base.'],
  ]);
});

it('steps in one cell — numbered, bulleted — and a row continuing the code above are all read', () => {
  const numbered = parse('Code\tMeaning\tRemedy\nE24\tWater cannot drain\t1. Clean the filter 2. Straighten the drain hose');
  assert.deepEqual(numbered.codes.E24.causes.map((c) => c.remedy), ['Clean the filter', 'Straighten the drain hose']);
  const bulleted = parse('Code\tMeaning\tRemedy\nE24\tWater cannot drain\t• Clean the filter • Straighten the drain hose');
  assert.equal(bulleted.codes.E24.causes.length, 2);
  const merged = parse('Code\tMeaning\tCause\tFix\nE24\tWater cannot drain\tFilter blocked\tClean the filter\n\tWater cannot drain\tDrain hose kinked\tStraighten the hose');
  assert.deepEqual(merged.codes.E24.causes.map((c) => [c.label, c.source.line]), [['Filter blocked', 2], ['Drain hose kinked', 3]]);
});

it('"Cause: … Remedy: …" on one line, and "Possible cause" / "Solution" labels, are read', () => {
  const g = parse('E24   Water cannot drain\nCause: blocked filter. Remedy: clean the filter.\nPossible cause: kinked drain hose\nSolution: straighten the hose');
  assert.deepEqual(g.codes.E24.causes.map((c) => [c.label, c.remedy, c.source.line]), [
    ['Blocked filter', 'Clean the filter.', 2],
    ['Kinked drain hose', 'Straighten the hose', 4],
  ]);
});

it('an article that mentions codes is called prose, not a table in a layout it cannot read', () => {
  // A repair blog: codes in paragraphs. "Remedies in a column to the right?" sent the reader
  // looking for a column that is not there.
  const article = parse([
    'Bosch error codes',
    'E24 is almost always a clogged filter or a kinked drain hose, and most people can fix it in twenty minutes with nothing more than a towel and a screwdriver.',
    'E15 means water got into the base pan and lifted the float switch; tilting the machine forward drains it, and then you go looking for where the water came from.',
  ].join('\n'));
  assert.equal(Object.keys(article.codes).length, 0, 'prose was read as a fault table');
  assert.match(article.coverage, /running prose rather than a table/);
  // A pasted table's rows are long too, and are never prose.
  const table = parse('E24\tWater cannot drain\t' + 'Check the drain filter and clear anything caught in it, then run a short programme and watch that the water leaves the tub. '.repeat(2));
  assert.match(table.coverage, /recovered/);
  // Nor is a two-column page from `pdftotext -layout`, whose long lines are columns spaced apart:
  // that one really is a layout it cannot read, and must still say so.
  const row = (c, m, r) => `${c}   ${m}`.padEnd(80) + '    ' + r;
  const columns = parse([
    row('E24', 'Water cannot drain because the filter or the drain hose is blocked', 'Check the drain filter and clear it; straighten the drain hose'),
    row('E25', 'Drain pump cover blocked by broken glass or foil from a tablet', 'Remove the pump cover and clear anything caught in the impeller'),
  ].join('\n'));
  assert.match(columns.coverage, /column to the right/);
});

it('a row copied out of a spreadsheet, with a quoted cell over several lines, is one row', () => {
  const g = parse('Code\tMeaning\tRemedy\r\nE24\tWater cannot drain\t"Check the drain filter.\r\nStraighten the drain hose."\r\nE25\tPump blocked\tRemove the pump cover\r\n');
  assert.deepEqual(g.codes.E24.causes.map((c) => [c.remedy, c.source.line]), [['Check the drain filter.', 2], ['Straighten the drain hose.', 2]]);
  assert.equal(g.codes.E25.causes[0].source.line, 4);
  // An inch mark is not an open quote: two rows with one each stay two rows.
  const inches = parse('Code\tMeaning\tRemedy\nE24\tDrain blocked\tCheck the 3" drain hose\nE25\tPump blocked\tCheck the 5" pump outlet');
  assert.deepEqual(Object.keys(inches.codes), ['E24', 'E25']);
});

console.log(`\n${passed} passed${failures.length ? `, ${failures.length} failed: ${failures.join(', ')}` : ''}`);
