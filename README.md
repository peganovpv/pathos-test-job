# Press release quality checker

Scores a draft press release out of 100 against a PR rubric and tells you what to fix first.

Written for the Junior Software Engineer application at Pathos Communications.

```
$ prq check tests/fixtures/weak.md --offline

Press release quality check — tests/fixtures/weak.md

  OVERALL  30/100   Rewrite

  Structure & length  ░░░░░░░░░░░░░░░░░░░░    0/5  deterministic
  Headline strength   ███████████████░░░░░  3.8/5  deterministic

  Not scored: newsworthiness and quoteability — no model call was made, so the overall is out of the remaining categories.

  What to fix first
   1. [high] 829 words of news copy, against a 300-500 target. Past 800 words a journalist stops reading before the point arrives.
      → Cut to 500 words. Anything a reader could skip without losing the news belongs in the boilerplate or a follow-up.
   2. [high] The lead runs to 67 words, against a 30-word maximum.
      “Vertexa is delighted to announce that it has been on an incredible journey since it was founded in 2019 by a…”
      → State the news in one sentence, then stop. Everything else is paragraph two.
   3. [high] Sentences average 75 words, against a 25-word target.
      “It is also worth noting that the Vertexa Nexus platform has been built in close and continuous collaboration…”
      → Split on every 'and' and every subordinate clause that carries a second idea.
   4. [high] No direct quotes. There is nothing here a journalist can lift.
      → Add one quote that makes an argument the surrounding copy cannot make for itself.
   5. [high] 27 instances of PR boilerplate language.
      “empowers (×2), leading provider, world-class, best-in-class, cutting-edge, game-changing”
      → Replace each with the specific claim underneath it, or cut it. A journalist reads these as padding.
   … and 10 more

  Measured  829 words · 11 paragraphs · mean sentence 75.4 words
            0 quotes (0 attributed) · no dateline · no contact details · 27 jargon instances
```

That is the deterministic half. With an API key it also scores newsworthiness and quoteability, and gives the headline a hybrid score — see [The rubric](#the-rubric).

## Running it

```bash
npm install
npm test                                            # 236 tests, no network, no API key needed
npm run check -- tests/fixtures/weak.md --offline    # deterministic checks only
```

For the full four-category score, set a credential and drop `--offline`:

```bash
cp .env.example .env    # then fill in ANTHROPIC_API_KEY
npm run check -- tests/fixtures/weak.md
```

Either credential the SDK understands works. `ANTHROPIC_API_KEY` is sent as
`x-api-key`; `ANTHROPIC_AUTH_TOKEN` is sent as `Authorization: Bearer`, for an
`ant auth login` access token or a gateway in front of the API. The SDK only
attaches the `anthropic-beta: oauth-2025-04-20` header on its resolved-profile
path, never for a bare `ANTHROPIC_AUTH_TOKEN`, so `prq` adds it whenever bearer
auth is in play — without it the API returns 401 on a valid token.

The web UI is the same grader behind one page:

```bash
npm run serve      # http://localhost:3000
```

To install the `prq` binary on your path:

```bash
npm run build && npm link
```

## Options

| Flag | Effect |
| --- | --- |
| `--offline` | Skip the model call. Only the deterministic categories are scored, and the report says so. |
| `--json` | Emit the whole report, including every finding rather than just the printed ones. |
| `--model <id>` | Judge with a different model. Defaults to `claude-sonnet-5`, or `PRQ_MODEL`. |
| `--config <path>` | Threshold config. `./prq.config.json` is picked up automatically if present. |
| `--min-score <n>` | Exit 1 if the score falls below `n`, so it works as a CI gate. |
| `--no-colour` | Never colourise. Colour otherwise follows `FORCE_COLOR`, `NO_COLOR`, then the terminal. |

Exit codes: `0` pass · `1` below `--min-score` · `2` usage or IO · `3` the model call failed.

`prq check -` reads the draft from standard input.

## The rubric

| Category | Weight | Scored by |
| --- | --- | --- |
| Newsworthiness | 30 | the model |
| Structure & length | 30 | code |
| Quoteability | 20 | the model, given the extracted quotes |
| Headline strength | 20 | both |

Each category scores 0–5. The overall is the weighted average expressed out of 100, and it divides by the weight of whichever categories actually ran — so `--offline` renormalises rather than silently scoring out of 50.

Bands: **80+ ready to send**, **60–79 needs work**, **under 60 rewrite**.

Deterministic categories start at 5 and lose 1.0 per high-severity finding, 0.5 per medium and 0.25 per low, floored at zero. Headline strength is a hybrid: the deterministic faults are subtracted from the model's judgement, so a headline the model likes still loses marks for being twenty words long.

Weights and thresholds are configurable — see `prq.config.example.json`.

## How it is put together

```
draft
  │
  ├─► src/rubric/   pure functions, no network
  │     text.ts       words, sentences, paragraphs, quote extraction
  │     facts.ts      one pass over the draft producing every measurement
  │     structure.ts  15 checks over those facts
  │     headline.ts   6 more
  │                       │
  │                       │  measurements passed into the prompt as fact
  │                       ▼
  └─► src/llm/      Judge port ──► AnthropicJudge  (real)
                               └─► FakeJudge       (tests)
                          │
        src/score.ts ─────┴──► weighted score, band, ranked fixes
                          │
   src/report.ts ─────────┼──► terminal · JSON
                          │
        src/cli.ts ───────┴──── src/web/server.ts
```

Four decisions worth explaining:

**The code counts; the model judges.** Every measurement — word counts, the extracted quotes with their attributions, the jargon hits — is computed deterministically and handed to the model as established fact, with an instruction not to recount. Language models are unreliable at counting, and letting the model form its own view of the length would let the two halves of the report contradict each other.

**The model is told what *not* to comment on.** It scores newsworthiness, quoteability and headline strength and nothing else. Length, paragraph size, datelines, contact details and jargon are already reported deterministically, and a model commenting on them again would double-count the same fault in the ranked fix list.

**The API's structured output is treated as shape-only.** The SDK's zod-to-JSON-Schema conversion renders value constraints (`minimum`, `maximum`, `maxItems`) as prose inside a `description` field rather than as schema keywords, so the API guarantees the response's *shape* and nothing about the numbers in it. A score of 7 would validate and flow straight into the weighted average. Every payload is therefore re-validated locally against the full zod schema, with one corrective retry before the run fails.

**Boilerplate is segmented out before length runs.** The "About …" block and the contact details are not news copy. Counting them toward the 300–500 word target makes every release read as longer and flabbier than it is.

## Tests

```bash
npm test          # vitest, 236 tests
npm run typecheck
```

No test touches the network. The model is reached through a `Judge` interface, so unit tests inject a `FakeJudge`, the `AnthropicJudge` tests drive a stubbed client, and the web tests mount the app with `offlineOnly`. `npm test` passes with no `ANTHROPIC_API_KEY` set.

The deterministic layer is where the logic is, and it is tested per check rather than only end to end. Fixture properties are asserted in `tests/fixtures.test.ts`, so editing a fixture fails there rather than causing confusing failures downstream.

## Limitations

Worth being straight about:

- **The heuristics are heuristics.** "No news verb detected" means the headline contained nothing from a word list, and the finding says so. Lead who/when/where detection is pattern matching on capitalisation and date formats — it reports *not detected*, never *missing*.
- **Passive-voice detection over-reports.** `is|are|was|were + -ed` also catches predicate adjectives such as "is delighted". Flagging that in a press release is useful anyway, so the finding is worded as "passive or weak linking constructions" rather than claiming grammatical passive voice.
- **Only double quotes delimit a quote.** Single quotes in running prose are overwhelmingly apostrophes. A draft using single quotes for speech will be read as having none.
- **English only**, and the jargon list is tuned to British and American business writing.
- **The model's scores are not deterministic.** Two runs on the same draft can differ by a point in a category. The deterministic 30 points do not move.

## Licence

MIT
