# Telltale

Paste writing. See AI-style and human-style flags land on the same page as each passage finishes.

Telltale is stylistic analysis on Cloudflare Workers, not verified authorship detection. It uses Muse Spark with compact, independent chunk requests.

One page: paste a draft, then marks and numbered notes appear on that same text. Red is AI-style, green is specific or contextual writing.

## Develop

```bash
cd aidetector
cp .dev.vars.example .dev.vars
# Put MUSE_API_KEY and SITE_PASSWORD in .dev.vars
# For `npm run dev`, also put SITE_PASSWORD in `.env.local`
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app is password-gated.

Production: [https://telltaleai.app](https://telltaleai.app). Secrets:

```bash
npx wrangler secret put SITE_PASSWORD
npx wrangler secret put MUSE_API_KEY
```

`./dev/dev.sh` runs Cloudflare preview. `./dev/prod.sh` pushes and deploys.

## How scanning works

1. The draft is split into sentence records with stable IDs and UTF-16 offsets.
2. Sentences are packed into ~450–650 token targets, plus ~100 tokens of context on each side.
3. Each chunk is an independent Muse call with the same compact system prompt (`telltale-scan-v2` in `src/lib/scan/prompt.ts`).
4. `/api/detect` streams SSE events (`scan_started`, `chunk_result`, …). The browser places highlights by source offset, not completion order.
5. After chunks finish, the page shows AI %, human %, and a flag summary. Numbered marks match the notes under the draft.

Unscanned text stays unmarked. Green marks are counter-signals (specific or contextual writing), not “human-written.”

## Configuration

Set these in `.dev.vars` / `.env.local` (and Wrangler vars or secrets in production):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SITE_PASSWORD` | (required) | Gate password. Set with `wrangler secret put SITE_PASSWORD`. Three wrong guesses lock that browser for 10 minutes. |
| `SCAN_TARGET_TOKENS_MIN` / `MAX` | 450 / 650 | New text per chunk |
| `SCAN_CONTEXT_TOKENS` | 100 | Context before/after |
| `SCAN_CONCURRENCY` | 2 | Parallel Muse calls |
| `SCAN_TIMEOUT_MS` | 90000 | Per Muse request |
| `SCAN_RETRY_LIMIT` | 2 | Transient retries |
| `SCAN_MAX_DOCUMENT_CHARS` | 40000 | Document cap |
| `SCAN_REVIEW_ENABLED` | false | Extra document-summary Muse call (off; the page uses flag counts instead) |
| `SCAN_REVIEW_INPUT_TOKENS` | 800 | Review payload budget |

Token counts are estimates (~3.2 UTF-16 units per token). Muse does not expose a tokenizer, `max_tokens`, structured outputs, or prompt caching on this endpoint. Cancellation uses `AbortController` on the fetch.

## Tests

```bash
npm test
npm run build
```

`src/lib/scan/fixtures/quality.ts` is a manual inspection set, not an authorship benchmark.
