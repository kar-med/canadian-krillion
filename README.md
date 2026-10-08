# Canadian Krillion 🍁 — v2.1 Internet-Verified

Canadian Krillion is an open-ended Canadian knowledge game. Players get six categories and one answer per category. New answers are verified with OpenAI's live web search, valid answers are stored in a growing Netlify Blobs database, and rarer answers are worth more.

## Categories

- Canadian beer
- Canadian city west of Toronto
- Canadian slang
- Canadian university with a medical school
- Canadian company
- Canadian holiday/tradition

## Scoring

Each question is worth **10–700 points**.

- Common answers score around 10–20 points.
- Less common answers score more.
- A genuinely rare/new answer can approach 700 points.
- The score uses the growing answer-frequency data in Netlify Blobs plus a small starter prior so obvious answers do not all start at 700.

## Architecture

`player browser → Netlify Function → OpenAI Responses API + live web search → Netlify Blobs → score`

The OpenAI API key stays server-side in Netlify environment variables. It is never placed in the public browser code.

## OpenAI setup

Add this Netlify environment variable:

- `OPENAI_API_KEY` = your OpenAI API key

Optional:

- `OPENAI_MODEL` = `gpt-6-astra`

The function explicitly requires the OpenAI Responses API `web_search` tool for a new answer, so an uncached answer is actually checked against live web results. Previously verified answers are cached in Netlify Blobs.

## Netlify setup

Connect the repository to Netlify. The included `netlify.toml` configures:

- published website files: `public/`
- serverless functions: `netlify/functions/`

After adding `OPENAI_API_KEY`, trigger a new deploy.

## Files

- `public/index.html` — game UI
- `public/styles.css` — styling
- `public/app.js` — game logic
- `public/answers.js` — client-side category definitions
- `seed.json` — starter rarity prior used by the server
- `netlify/functions/verify-answer.mjs` — server-side verification, caching, frequency tracking, and scoring
- `netlify.toml` — Netlify configuration
- `package.json` — Netlify Blobs dependency

## Security

Never commit an OpenAI API key to GitHub. Store it only in Netlify environment variables.
