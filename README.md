# faultgraph

**Read the fault-code table out of an equipment service manual and turn it into something you can
diagnose with.** Zero dependencies, no network, no model.

```bash
npm install github:vidigoat/faultgraph
```

Not on the npm registry yet — the name is unclaimed, and `npm install faultgraph` would 404 today.
Installing from GitHub gets the same thing. (Written this way on purpose: a README whose first code
block does not work is the fastest way to lose a reader, and "it'll be published soon" is not an
install command.)

**In 30 seconds** — paste this into a file and run it; the manual page is inline, so nothing else is
needed:

```js
// quick start
const { parse, spaceFor, next } = require('faultgraph');

const manualPage = `
E24  Water cannot leave the machine
Check the drain filter for debris.
Straighten the drain hose.
Replace the drain pump if it does not turn.
`;

const graph = parse({ text: manualPage, sourceName: 'Bosch service manual' });
console.log(graph.coverage);                // 1 fault code recovered
console.log(graph.codes.E24.meaning);       // Water cannot leave the machine

const { space, tests } = spaceFor(graph, 'E24');
console.log(space.map((c) => c.label));     // the causes, cheapest and likeliest first
console.log(next({ space, tests }).test.question); // Check the drain filter for debris. — did that fix it?
```

It starts with the cheapest, likeliest check — the filter — and when that is not it, the next
question is not "replace the drain pump". It is the one the manual hid inside that remedy, *does it
turn?*, asked before anyone buys a pump, because answering it is free (`examples/diagnose.js` walks
the whole thing). The README's own test runs this block, so it cannot quietly stop working.

---

## The problem

Every manufacturer ships a page that says *"if the machine shows E24, check these three things, in
this order"*. It is the most useful page in the manual and the least machine-readable: a table in a
PDF, a sticker inside a door, a scan somebody photographed.

Tools that read manuals treat that page as prose, and in doing so throw away the two things on it
that are worth having:

1. **The ordering is expertise.** Manuals list remedies cheapest-and-likeliest first, because the
   people who built the machine know which fault they see most. That sequence is a prior, written
   down by the manufacturer, and free.
2. **The remedies carry their own conditions.** *"Replace the drain pump **if it does not turn**"* —
   that subordinate clause is not part of the repair. It is the observation that justifies the
   repair, and as a question it is enormously cheaper.

`faultgraph` keeps both.

---

## What it does, in one run

```bash
node examples/diagnose.js
```

```
  Read the page
  2 fault codes recovered from Bosch service manual
  E24, E15

  E24 — Water cannot leave the machine
     49%  Drain filter — debris
          Bosch service manual, line 5
     30%  Drain hose is kinked
          Bosch service manual, line 6
     22%  Drain pump has failed
          Bosch service manual, line 7

  1.50 bits unknown

  Check the drain filter for debris. — did that fix it?
    Rules out the most for the least effort.  ·  0.999 bits  ·  easy
    → no, still faulty

    ✗ Drain filter — debris

  Does it turn?                                              ←
    Rules out the most for the least effort.  ·  0.981 bits  ·  easy
    derived from: "Replace the drain pump if it does not turn."
    → yes, it turns

    ✗ Drain pump has failed

  One cause left
    Drain hose is kinked
    Bosch service manual: "Straighten the drain hose."
    Bosch service manual, line 6
    cost: unknown — a manual lists remedies, not prices

    Asked 2 questions. The manual lists 3.
```

**Look at the line marked ←.** The manual's instruction is *"replace the drain pump"*. A tool that
follows the manual literally asks you to buy a pump in order to find out whether the pump is the
problem. `faultgraph` lifted the condition out of that same sentence and asked *"does it turn?"* —
the identical information, answered by looking.

That is the difference between a list of things to try and a diagnosis.

---

## The design constraint: it does not guess

There is no model in this library and no inference. Every cause traces to a line that was printed on
the page, and a page with no fault table on it recovers nothing and says so:

```js
parse({ text: 'Before first use, remove all packaging…' }).coverage
// 'nothing usable found'
```

It also tells apart the two ways of finding nothing, because they need opposite things from the
person holding the manual:

```js
parse({ text: columnsMadeOfSpaces }).coverage
// '2 fault codes seen, none with remedies beneath them — this looks like the right page
//  in a layout I cannot read (remedies in a column to the right?)'
```

A wrong page means go and find the fault table. A layout it cannot read means you are already
looking at the right page — and reporting that as "nothing usable found" sends somebody hunting for
something in their hands. `orphanCodes` carries the count, and `orphans` the codes themselves. An article that only
mentions codes in its paragraphs says so, rather than blaming the layout: nothing in prose is read
as a remedy.

A table whose columns reached the text as **delimiters** is read: pipes, tabs, or a markdown table.
Each row becomes a code, its meaning and its remedies — the remedy cell split at sentence ends,
semicolons, bullets and "1. … 2. …", in the manual's order — and every cause cites the row it came
from. A row with its code cell left empty continues the code above it, as a merged cell prints. What still defeats
it is columns made of nothing but spacing, which is what that message is for. A header row, when there
is one, decides which column is which: "Common Cause" is the cause, "Fix" is the remedy, and a "DIY?"
column is neither. On two real error-code pages copied out of a browser, that recovered 11 of 15
codes (the other four rows were technician-only, and are counted as seen) and 3 of 14 on a page
whose only "fix" column says who should do the work rather than what to do. A header holds for its
own table only; a row of another width is read by position. One thing still defeats it here: sub-codes.
A washer that prints E:30-10 (blocked inlet filters) and E:30-20 (a critical malfunction) gives
two faults one key, E30, and only the later entry is kept.

Outside tables, a remedy is recognised by its verb. Words that are as often nouns — "drain",
"tilt", "empty" — count only as an instruction's first word, so "Drain pump blocked" stays a reason
and "Tilt the machine to drain the base" is a remedy. A cause the manual names before a colon
("Blocked filter: clean the filter") is the label, and "Cause: … Remedy: …" on one line is read
as the two lines it stands for.

This matters because the output is meant to be **acted on** — somebody opening a machine, or
spending money on a part. A plausible-sounding invented remedy is worse than no answer at all. So:

| Rule | Why |
|---|---|
| Every cause carries `evidence` and `source.line` | You can go and look at the line. A test asserts the quoted remedy is actually sitting on the line the citation names, in all four fixtures. |
| Unknown cost is `null`, never `0` | A manual lists remedies, not prices. Written as `0` this once told somebody that replacing a drain pump "costs nothing to fix". |
| An impossible answer is a contradiction, not certainty | If a result rules out every listed cause, `prune()` says so rather than handing back an empty space that reads as confidence. |
| "Nothing left to ask" is a real answer | `next()` returns `stuck`, not the most expensive part and a hope. |
| Causes behind mains voltage are flagged | `cause.mains`. The library has no authority and stops nobody; it makes the flag available so a caller that *does* decide things cannot say it did not know. |

### Where a model belongs, and where it does not

Most manual pages exist as paper or as a photograph, so something has to turn pixels into
characters, and a vision model is very good at that. It is deliberately **not in this library**.

```
   photograph ──► vision model ──► text ──► faultgraph.parse() ──► causes
                  (transcribes)             (deterministic, cites lines)
```

The ordering is the point. The model produces *characters*; code you can read turns characters into
causes. An invented remedy cannot arrive wearing a citation to a line that does not exist, because
the line number is counted here, from the string that was handed in. Reverse the two and the
guarantee is gone.

---

## API

### `parse({ text, equipment?, sourceName? })`

Reads a fault table out of manual text. Deterministic: same text in, same graph out.

```js
{
  equipment: 'Bosch SMS46',
  source: 'Bosch service manual',
  method: 'parsed',
  found: 2,
  coverage: '2 fault codes recovered',
  codes: {
    E24: {
      meaning: 'Water cannot leave the machine',
      causes: [ /* … */ ],
      tests:  [ /* observations first, then remedy checks */ ],
    },
  },
}
```

A **cause**:

```js
{
  id: 'e24-2',
  label: 'Drain pump has failed',        // the instruction, turned back into what is wrong
  likelihood: 0.278,                     // from the manual's own ordering
  cost: null,                            // unknown. Never 0.
  mains: false,
  ownerFixable: true,
  evidence: 'Bosch service manual: "Replace the drain pump if it does not turn."',
  remedy:   'Replace the drain pump if it does not turn.',   // verbatim; this is what to read aloud
  source: { line: 7, codeLine: 4, manual: 'Bosch service manual' },
}
```

A **test** is either a derived `observation` or a `remedy` check, each with `outcomes` saying which
causes survive which answer.

### The diagnosable half

Four pure functions. No I/O, no clock, no model — you supply the answers, from a person, a sensor,
or a test rig.

```js
spaceFor(graph, 'E24')        // → { known, meaning, space, tests, bits }
next({ space, tests, performed })
                              // → { test, bits, effort, why } | { test: null, done } | { test: null, stuck }
prune({ space, outcome })     // → { space, eliminated, bits } | { contradiction: true, reason }
entropy(space)                // → bits still unknown
```

`next()` ranks every available test by **expected information gain divided by what it costs the
person to perform**:

```
value = bits / (1 + EFFORT[test.effort])

EFFORT = { free: 0, easy: 1, awkward: 4, heavy: 12 }
```

That divisor is why a free look beats a sharper check that means dismantling something — and why
`replace the …` (always `heavy`) is the last thing reached for rather than the first.

### `merge(verified, graph)`

Merges a parsed graph **under** data you already trust. Verified entries always win: a parser is a
good way to cover a machine nobody has written up yet and a bad way to overwrite one somebody has.

---

## Code schemes it handles

Four manufacturers, because they disagree with each other and one regex does not cover it.

| Shape | Example | Note |
|---|---|---|
| Letter + digits, meaning alongside | `E24  Water cannot leave the machine` | Bosch, Siemens, Neff |
| Code alone, meaning on the line below | `F11` ⏎ `Drain blocked` | Miele. Common in printed tables where the code has its own narrow column — and what a vision model produces when it transcribes one honestly. |
| Two or three letters, separated by spaces | `OE   The machine will not drain` | LG, Samsung |
| Code with a colon | `A12: Discharge pressure high` | Industrial plant |

Nothing in the library knows what a dishwasher is. The test fixtures include a reciprocating
compressor for exactly that reason.

`NOT_A_CODE` keeps common words (`THE`, `NOTE`, `WARNING`…) from being read as fault codes at the
start of a line, and a code with no remedy lines beneath it is discarded — an index entry or a page
number that happens to look like a code is not a fault entry.

---

### `readSymptoms({ text, sourceName?, page? })`

Reads a troubleshooting table keyed on a **described symptom** rather than a fault code.

Not every manual prints codes. Measured across ten *current* Bosch US dishwasher manuals fetched
from the manufacturer's own site: **zero fault codes between them**, and ten to thirteen pages each
of `Fault | Cause and troubleshooting` whose left column is a sentence. A 2019 European manual for
the same kind of machine has ten code mentions. So for a lot of equipment this is not a fallback,
it is the only door.

```
Fault                  Cause and troubleshooting
Excessive formation of Rinse aid has been spilled.
foam occurs.              Remove the rinse aid with a cloth.
                       Detergent used causes excessive foaming.
                          Change the brand of detergent.
```

```js
{
  found: 1,
  boundary: 23,
  coverage: '1 symptom recovered',
  symptoms: [{
    id: 'excessive-formation-of-foam-occurs',
    symptom: 'Excessive formation of foam occurs.',
    causes: [
      { label: 'Rinse aid has been spilled.', remedies: ['Remove the rinse aid with a cloth.'], cost: null, likelihood: 0.625 },
      { label: 'Detergent used causes excessive foaming.', remedies: ['Change the brand of detergent.'], cost: null, likelihood: 0.385 },
    ],
  }],
}
```

**The column boundary comes from the page's own header**, not a constant — it is 23 in one manual
and 26 in another. Within column two, **indent is the grammar**: flush with the boundary is a cause,
indented past it is a remedy under that cause. Which is why `pdftotext -layout` is required, and
why a de-layouted extraction destroys it.

**What it refuses is the part worth knowing about.** Some rows have columns that have collided — the
left column ran long and the typesetter squeezed the gap to a single space, so
`Home Connect cannot Home Connect set incorrectly.` could break before the second "Home" or after
it, with nothing in the text to say which. Backing off to the nearest space gives the symptom
*"Home Connect cannot Home"* and the cause *"Connect set incorrectly."* — wrong in a way that looks
right. Those rows are skipped, along with the rest of the symptom they belong to, and counted.

### `procedures` — following "see Page N"

A troubleshooting table points rather than explains: *"Clean the Filters, Page 35."* Read aloud to
somebody with their hands in a machine, that is an instruction to go and find a page. This follows
the pointer to the procedure printed there.

```js
const { reference, findProcedure, check } = require('faultgraph').procedures;

const ref = reference('Clean the Filters, Page 35.');   // { title: 'Clean the Filters', page: 35 }
const found = findProcedure(layoutPages, ref);          // pages from `pdftotext -layout`, in file order
const kept = check(found, readingOrderText);            // a SECOND reading: `pdftotext -f 35 -l 36 file -`
```

```js
{
  found: true, checked: true, heading: 'Cleaning filters', page: 35, pages: [35, 36],
  steps: [
    { n: 1, text: 'Check the filters for residue after each wash.', notes: [], page: 35 },
    { n: 2, text: 'Turn the coarse filter counterclockwise and remove the filter system.',
      notes: ['Ensure that foreign objects do not fall into the sump.'], page: 35 },
    // … seven in all, across the page break
  ],
}
```

Two-column pages are split **per band** at the right column's left edge (a page can open with a
full-width table and end in two columns), headings are matched by stem (*"Clean the Filters"* is
printed *"Cleaning filters"*), and steps are taken **in sequence** across column and page breaks so
the other column's own numbered list never gets in.

**`check` is the part that matters.** Every step must be re-found in an independent reading of the
same pages or the whole procedure is refused — a procedure with one wrong step is worse than the
pointer it replaces, because it will be followed. And words on the page are not enough: run over a
real library, every word of five wrong procedures *was* on the page — the defrosting steps under
*"Switch on ice cube production"*, a power adapter under *"Align the appliance"*, one step of seven.
So step 1 must be on the page the manual cited and follow its heading, and the manual's numbering
must not carry on past the last step kept. On that library: 73 references, 10 procedures kept, the
rest refused by reason — and the kept ten read by a person before anything used them.

## What it will not do, honestly

- **It does not read PDFs or images.** Give it text. Extraction is somebody else's job, and keeping
  it out is what makes the rest deterministic.
- **It does not know what anything costs.** `cost` is always `null` from a parse. Prices come from
  service data, which is a different kind of source.
- **It does not handle a table split across a page break**, or one where the remedy column is to the
  *right* of the code rather than below it. Both would need layout information this does not have —
  but it recognises the second case and says so rather than claiming the page was empty.
- **It does not do multi-code faults.** One code, one hypothesis space.
- **`readSymptoms` needs a column header** to find the boundary. Guessing it from whitespace finds
  one in ordinary prose too, and produced confident nonsense out of a safety page. No header, no
  parse.
- **A table that runs across a page break** must be joined before parsing, or a symptom is split
  from its causes at the seam — and joining drops the first page's number and the second page's
  column header into the middle of the rows. Both are recognised and skipped, and the repeated
  header is also where the columns are **re-anchored**: each page is laid out on its own and
  nothing says the two agree. A row that runs past the bottom of a page has its symptom repeated at
  the top of the next one, and two ADJACENT identical symptoms are merged back into one — but two
  non-adjacent ones are left alone, because a manual listing the same symptom in two places is
  telling you something. Anything else a manual prints in its margins is not handled.
- **It stops where the table stops**, on a numbered section heading or two consecutive full-width
  lines — because prose has no column gap and a table row always does. One gapless line is not
  enough: a collided row has no gap either, and those are worth noticing rather than cutting the
  table short at.
- **Explanation inside a procedure is a heuristic.** A cause with numbered steps prints sentences
  flush with the column boundary between them — what happens next, how long it takes — and those
  are attached to the step above rather than read as new causes. It works because a procedure's
  later lines are indented continuations; a layout without them would confuse it.
- **It does not catch every column collision.** Where the columns collide part-way down a symptom
  rather than on its first line, the rest survives and the cause comes out truncated — beginning
  mid-sentence. It cannot be repaired from the text, but it IS detectable: a cause that begins in
  lower case is flagged `suspect: true`, because a manual does not start a sentence that way. Four
  rows across twelve real manuals. The library cannot fix them and does not pretend to; it points
  at them, which is the difference between a question and a fact.
- **The priors are ordinal, not measured.** `1/(k + 1.6)` turns rank into a number. It encodes "the
  manufacturer listed this first" and nothing more; it is not a failure rate.
- **`conjugate()` is a heuristic** for English verbs, used so a spoken answer reads as
  "yes, it turns" rather than "yes, it turn". It leaves alone anything it is not sure about.

---

## Tests

```bash
npm test      # 60 checks, no network — plus 29 for symptom tables, 12 for procedures and 8 that check this README
```

The four worth reading first are the ones that check what the library is *for*: every citation lands
on the line it claims, unknown cost is `null`, a page that is not a fault table recovers nothing, and
a contradiction is reported rather than swallowed.

One test walks **every sequence of answers on every code in every fixture** and asserts each one
terminates — a loop there is not a slow run, it is a person being asked the same question forever.

### What a real manual did to it

Three fixtures written from imagination all parsed on the first try. The first **real** service
manual — a Bosch dishwasher, from Bosch's own CDN — recovered **nothing**, for two reasons no
fixture had:

- **The codes are not at the start of the line.** The page says *"Fault code E24 is lit."* — a
  three-column table (Fault | Reason | Remedial action) turns into a sentence when it is read
  aloud, and the code lands in the middle of it. Every pattern here anchored to the line start.
- **Only the action lines carry a verb.** The reasons — *"Waste-water hose kinked or blocked"* —
  have none, so they were discarded, and a cause was derived back out of the remedy instead. That
  works, and it is strictly worse than reading the reason the manufacturer printed. Their sentence
  beats our guess at their sentence.

Both are handled, and the manufacturer's stated reason now wins wherever the page gives one.

There is a third thing a real manual does that this library cannot fix: the fault codes are set in
a seven-segment display face, so `E:24` extracts from the PDF text layer as `“:‹ˆ`. The text is not
wrong about the *page*; it is wrong about the *codes*. That is an argument for reading a rendered
image rather than a text layer, and it belongs to whatever is feeding this library — not here.

### Two bugs these tests found

- **Citations drifted after an orphan join.** Joining a code to the line below it shortens the array,
  which shifted every line number after that point. The citations still looked plausible; they
  pointed at the wrong line of a page somebody was holding. Line numbers are now carried alongside
  the joined text rather than recomputed from it.
- **A whole branch of `next()` was unreachable.** There was a second pass — *"among tests within 85%
  of the best, take the cheapest"* — carrying its own explanation string shown to the user. Ranking
  already divides bits by `(1 + effort)`, so for a costlier test to rank first it must carry
  proportionally more information; the smallest step on the scale is a factor of two, well past the
  15% the filter allowed. The two conditions contradict each other at every pair of effort levels.
  The test asserting that second message could not be made to pass. Both are gone.

---

## Origin

Extracted from a repair assistant that reads an appliance's fault code off a photograph and works
out what is wrong before anybody spends money, and generalised on the way out: nothing here is
specific to household appliances.

## Licence

MIT.
