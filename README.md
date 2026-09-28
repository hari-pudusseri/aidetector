# Telltale

Paste writing. See what sounds generated, and what still sounds like a person.

Telltale is an AI writing detector on Cloudflare Workers. It uses Muse Spark (same Chat Completions path as apprentice-app) and Wikipedia's Signs of AI writing.

Left pane: paste a draft. Right pane: AI-like score, human-like score, and highlighted spans.

## Develop

```bash
cd aidetector
cp .dev.vars.example .dev.vars
# Put MUSE_API_KEY in .dev.vars
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Preview on Workers

Local Cloudflare runtime (kills leftover workerd/OpenNext processes, then tails the log):

```bash
./dev/dev.sh
```

Same as `npm run preview:watch`. One-shot preview without the wrapper:

```bash
npm run preview
```

## Deploy

```bash
npx wrangler secret put MUSE_API_KEY
./dev/prod.sh
```

`prod.sh` commits if needed, pushes `main`, then runs `npm run deploy`. One-shot deploy without git:

```bash
npm run deploy
```

Non-secret Muse settings live in `wrangler.jsonc` (`MUSE_BASE_URL`, `MUSE_MODEL`, `MUSE_REASONING_EFFORT`).

## Stack

- Next.js App Router
- Tailwind CSS
- OpenNext Cloudflare adapter (`@opennextjs/cloudflare`)
- Wrangler
- Muse Spark at `https://api.meta.ai/v1/chat/completions`
