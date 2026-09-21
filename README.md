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

```js
const { parse, spaceFor, next, prune } = require('faultgraph');

const graph = parse({ text: manualPage, sourceName: 'Bosch service manual' });

graph.coverage            // '2 fault codes recovered'
graph.codes.E24.meaning   // 'Water cannot leave the machine'
graph.codes.E24.causes    // ranked, each citing the line it came from
```

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
parse({ text: twoColumnTable }).coverage
// '2 fault codes seen, none with remedies beneath them — this looks like the right page
//  in a layout I cannot read (remedies in a column to the right?)'
```

A wrong page means go and find the fault table. A layout it cannot read means you are already
looking at the right page — and reporting that as "nothing usable found" sends somebody hunting for
something in their hands. `orphanCodes` carries the count.

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

## What it will not do, honestly

- **It does not read PDFs or images.** Give it text. Extraction is somebody else's job, and keeping
  it out is what makes the rest deterministic.
- **It does not know what anything costs.** `cost` is always `null` from a parse. Prices come from
  service data, which is a different kind of source.
- **It does not handle a table split across a page break**, or one where the remedy column is to the
  *right* of the code rather than below it. Both would need layout information this does not have —
  but it recognises the second case and says so rather than claiming the page was empty.
- **It does not do multi-code faults.** One code, one hypothesis space.
- **The priors are ordinal, not measured.** `1/(k + 1.6)` turns rank into a number. It encodes "the
  manufacturer listed this first" and nothing more; it is not a failure rate.
- **`conjugate()` is a heuristic** for English verbs, used so a spoken answer reads as
  "yes, it turns" rather than "yes, it turn". It leaves alone anything it is not sure about.

---

## Tests

```bash
npm test      # 52 checks, no network — plus 7 that check this README against the code
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
