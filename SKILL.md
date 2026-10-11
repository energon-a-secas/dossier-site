# Emit a Dossier work report

A work report is a JSON document that renders as a dashboard in the browser. The agent states facts, the renderer derives the math: deltas, totals, chart axes. A malformed block renders as an error card and the page keeps rendering.

## Minimum valid report

```json
{
  "dossier": {
    "version": 1,
    "title": "The work you did",
    "pages": [
      {
        "title": "First page",
        "blocks": [
          {
            "type": "prose",
            "text": "What happened."
          }
        ]
      }
    ]
  }
}
```

## Block choice guide

### Narrative

**Heading** (`heading`): A page covers more than one thing and the reader needs to skip.

**Prose** (`prose`): The reader needs the reasoning, not another number.

**Callout** (`callout`): A caveat, a risk, or the one thing that is still broken.

**Quote** (`quote`): A reviewer, a ticket, or an error message said it better.

**Steps** (`steps`): The reader has to do something, or repeat what you did.

**Facts** (`kv`): Short, flat, unrelated facts: versions, owners, identifiers.

**Grid** (`grid`): Two or three blocks are read together, not in sequence.

### Measurement

**Metric tiles** (`metrics`): Always, near the top. This is the block a reader looks at first.

**Chart** (`chart`): A shape over time or across categories says it faster than a table.

**Gauge** (`gauge`): A single figure has a budget, a threshold or a ceiling.

**Scorecard** (`scorecard`): The work was judged against a list someone else wrote.

**Table** (`table`): The reader needs the individual records, not a shape.

### Work

**Files touched** (`files`): Any report about a code change. This is the table of contents of the work.

**Diff** (`diff`): A change is small enough to read and important enough to show.

**Code** (`code`): The reader needs to see the shape of something, not a change to it.

**Log** (`log`): The evidence is a terminal. Paste it rather than describing it.

**Checklist** (`checklist`): The scope was a list. This is the block that reports honestly.

**Timeline** (`timeline`): The sequence matters: an incident, a rollout, a long investigation.

**Findings** (`findings`): A scanner, a linter or a review produced a list against the code.

**Tests** (`tests`): Something was verified by running it. The strongest evidence there is.

### Comparison

**Side-by-side comparison** (`compare`): Compare outputs from two prompts or runs, or inspect a visual change.

### Judgment

**Risks** (`risks`): The work is shipped and the reader has to decide whether to worry.

**Action items** (`actions`): The report ends and work remains. Borrowed from the SRE postmortem.

**Decision** (`decision`): A judgment call was made that a later reader will question.

### Attachment

**Image** (`image`): The change is visual, or a diagram beats three paragraphs.

**Embed** (`embed`): You already have an HTML artefact and will not rewrite it as blocks.

**Evidence** (`evidence`): A page needs a sources section, rather than a pointer per block.

## Core rules

1. Every page needs at least one block. A document needs at least one page.
2. Derived fields (delta, passed, done, totals, id) are never supplied. The renderer computes them from the stated facts.
3. Narrative fields (text, detail, excerpt) accept inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[link](url)`. Never block HTML.
4. Evidence is optional on any claim block. Supply a checkedBy to say who verified it: code (test/linter), human (someone looked), llm (a model asserted it).
5. Unknown block types cause an error. Unknown fields on known blocks are carried through but never rendered.

## Validate

```bash
node bin/validate.mjs <file.json>
```

0 = clean, 1 = findings, 2 = could not parse.
