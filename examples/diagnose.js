#!/usr/bin/env node
/**
 * A whole diagnosis, from a page of text to one surviving cause.
 *
 *   node examples/diagnose.js
 *
 * The answers are scripted so the run is reproducible — but nothing about the *questions* is. They
 * are chosen at each step from what is still unknown, and if you change an answer below the machine
 * asks something different.
 *
 * Read the two lines marked ← : they are the whole argument. The manual's own remedy is "replace
 * the drain pump", and that is not what gets asked first.
 */

const { parse, spaceFor, next, prune, entropy } = require('../index.js');

/* A page of a service manual, as text. In real use this comes from a PDF, an OCR pass, or a vision
 * model transcribing a photograph — the library does not care which, and cannot tell. */
const PAGE = `
Fault codes

E24  Water cannot leave the machine
Check the drain filter for debris.
Straighten the drain hose.
Replace the drain pump if it does not turn.

E15  Water in the base tray
Check the door seal for damage.
Replace the water inlet valve if it does not close.
`;

/* How this run answers. Change one and watch the questioning change shape. */
const ANSWERS = { 'Does it turn?': 'yes', default: 'no' };

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const graph = parse({ text: PAGE, equipment: 'Bosch SMS46', sourceName: 'Bosch service manual' });

console.log(bold('\n  Read the page'));
console.log(`  ${graph.coverage} from ${graph.source}`);
console.log(dim(`  ${Object.keys(graph.codes).join(', ')}\n`));

const CODE = 'E24';
let { space, tests, meaning } = spaceFor(graph, CODE);

console.log(bold(`  ${CODE} — ${meaning}`));
for (const cause of space) {
  const flag = cause.mains ? red('  ⚠ behind mains') : '';
  console.log(`    ${(cause.prior * 100).toFixed(0).padStart(3)}%  ${cause.label}${flag}`);
  console.log(dim(`          ${graph.source}, line ${cause.source.line}`));
}
console.log(dim(`\n  ${entropy(space).toFixed(2)} bits unknown\n`));

const performed = [];
let step;

while ((step = next({ space, tests, performed })).test) {
  const { test } = step;
  const answer = ANSWERS[test.question] ?? ANSWERS.default;
  const outcome = test.outcomes.find((o) => o.value === answer);

  const mark = test.kind === 'observation' ? green(' ←') : '';
  console.log(`  ${bold(test.question)}${mark}`);
  console.log(dim(`    ${step.why}  ·  ${step.bits} bits  ·  ${test.effort}`));
  if (test.kind === 'observation') {
    console.log(dim(`    derived from: "${test.derivedFrom}"`));
  }
  console.log(`    → ${outcome.say}\n`);

  const after = prune({ space, outcome });
  if (after.contradiction) {
    console.log(red(`  ${after.reason}`));
    process.exit(0);
  }

  for (const gone of after.eliminated) console.log(dim(`    ✗ ${gone.label}`));
  if (after.eliminated.length) console.log('');

  space = after.space;
  performed.push(test.id);
}

console.log(bold(`  ${step.done ? 'One cause left' : 'Stuck'}`));

if (step.done) {
  const [cause] = space;
  console.log(`    ${cause.label}`);
  console.log(dim(`    ${cause.evidence}`));
  console.log(dim(`    ${graph.source}, line ${cause.source.line}`));
  console.log(`    cost: ${cause.cost === null ? dim('unknown — a manual lists remedies, not prices') : `$${cause.cost}`}`);
  if (cause.mains) console.log(red('    Behind mains voltage. Not an owner repair.'));
  console.log(dim(`\n    Asked ${performed.length} question${performed.length === 1 ? '' : 's'}. ` +
    `The manual lists ${graph.codes[CODE].causes.length}.`));
} else {
  // The important half. A diagnostic tool that cannot get to one answer is supposed to say so.
  console.log(`    ${step.reason}`);
  console.log(dim(`    ${space.length} causes still standing. Nothing here has earned the right to be called the fault.`));
}

console.log('');
