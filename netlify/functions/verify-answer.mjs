import { getStore } from '@netlify/blobs';
import seed from '../../seed.json' with { type: 'json' };

const MAX_ANSWER_LENGTH = 80;
const MAX_RETRIES = 8;
const MODEL = process.env.OPENAI_MODEL || 'gpt-6-astra';
const STORE_NAME = 'canadian-krillion';
const headers = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[’']/g, "'")
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function safeKey(value) {
  return normalize(value)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'empty';
}

function categoryByKey(key) {
  return seed.find((category) => category.key === key) || null;
}

function seedStats(category, normalized) {
  const entries = category.answers.map((a) => ({
    answer: a.answer,
    share: Number(a.share) || 0,
    normalized: normalize(a.answer),
  }));
  const found = entries.find((entry) => entry.normalized === normalized);
  const pseudoTotal = entries.reduce(
    (sum, entry) => sum + Math.max(0.001, entry.share) * 1000,
    0,
  );
  const pseudoCount = found ? Math.max(1, Math.round(found.share * 1000)) : 0;
  return { found, pseudoCount, pseudoTotal };
}

async function readJson(store, key) {
  return store.getWithMetadata(key, {
    type: 'json',
    consistency: 'strong',
  });
}

async function atomicUpsert(store, key, createValue, updateValue) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const current = await readJson(store, key);

    if (!current) {
      try {
        const result = await store.setJSON(key, createValue(), { onlyIfNew: true });
        if (result.modified) return createValue();
      } catch (_) {
        // Another request may have created the key; retry from the latest state.
      }
      continue;
    }

    const next = updateValue(current.data);
    try {
      const result = await store.setJSON(key, next, { onlyIfMatch: current.etag });
      if (result.modified) return next;
    } catch (_) {
      // ETag changed; retry with the newest value.
    }
  }

  const latest = await readJson(store, key);
  return latest?.data ?? null;
}

function extractCitationUrls(response) {
  const urls = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) {
        if (annotation?.type === 'url_citation' && annotation?.url_citation?.url) {
          urls.push(annotation.url_citation.url);
        }
      }
    }
  }
  return [...new Set(urls)].slice(0, 3);
}

async function verifyOnWeb(category, answer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

  const rules = {
    beer: 'The answer must be a beer that is Canadian in origin, brand, or brewing identity. Being merely sold in Canada is not enough.',
    city: 'The answer must be a city or incorporated municipality in Canada that is geographically west of Toronto, Ontario. Use current geography.',
    slang: 'The answer must be a Canadian slang word, expression, or colloquialism that is genuinely used in Canada. It may also be used elsewhere, but Canadian usage must be supported.',
    university: 'The answer must be a Canadian university that currently has a medical school or faculty of medicine granting medical degrees. A university merely located in a city with a separate medical school does not count.',
    company: 'The answer must be a Canadian company: for example, headquartered in Canada or clearly Canadian-founded and currently described as Canadian. Merely operating in Canada does not count.',
    tradition: 'The answer must be a Canadian holiday, observance, celebration, ritual, or cultural tradition. It may be national, provincial, regional, or strongly Canadian in cultural identity.',
  };

  const prompt = `You are the factual verifier for Canadian Krillion, an open-ended Canadian knowledge game.

Category: ${category.label}
Player answer: ${answer}

Category rule: ${rules[category.key]}

You MUST use the live web search tool before deciding. Prefer authoritative or reputable Canadian sources when possible (government, university, official organization/company pages, or reputable reference sources). Do not accept a plausible-sounding answer without evidence.

Decide whether the player's answer satisfies the category rule. Treat spelling variants and common abbreviations as valid when they clearly refer to the same qualifying entity. If the evidence is conflicting or insufficient, return valid=false and confidence=low.

Return only the requested structured result.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'answer_verification',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              canonicalAnswer: { type: 'string' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              explanation: { type: 'string' },
            },
            required: ['valid', 'canonicalAnswer', 'confidence', 'explanation'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Verification service error ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  if (!data.output_text) throw new Error('Verification service returned no structured result.');

  let result;
  try {
    result = JSON.parse(data.output_text);
  } catch {
    throw new Error('Verification service returned invalid structured data.');
  }

  return {
    valid: Boolean(result.valid),
    canonicalAnswer: result.canonicalAnswer || answer,
    confidence: result.confidence || 'low',
    explanation: result.explanation || '',
    sourceUrls: extractCitationUrls(data),
  };
}

function scoreFor(count, total) {
  if (!total || total <= 0 || count <= 0) return 700;
  const share = Math.max(0.00001, Math.min(1, count / total));
  // Common answers land around 10–20 points; rare answers approach 700.
  const points = Math.round(10 + 690 / (1 + 45 * share));
  return Math.max(10, Math.min(700, points));
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const category = categoryByKey(body?.category);
  const rawAnswer = typeof body?.answer === 'string' ? body.answer.trim() : '';
  if (!category) return json({ error: 'Unknown category.' }, 400);
  if (!rawAnswer || rawAnswer.length > MAX_ANSWER_LENGTH) {
    return json({ error: 'Please enter a valid answer.' }, 400);
  }

  const normalized = normalize(rawAnswer);
  if (!normalized) return json({ error: 'Please enter a valid answer.' }, 400);

  const store = getStore(STORE_NAME);
  const answerKey = `answers/${safeKey(category.key)}/${safeKey(normalized)}`;
  const seedInfo = seedStats(category, normalized);

  let cached = await readJson(store, answerKey);
  let verification;

  if (cached?.data?.verified === true) {
    verification = cached.data;
  } else if (
    cached?.data?.verified === false &&
    cached.data.checkedAt &&
    Date.now() - cached.data.checkedAt < 7 * 86400000
  ) {
    return json({
      valid: false,
      points: 0,
      canonicalAnswer: cached.data.canonicalAnswer || rawAnswer,
      explanation: cached.data.explanation || 'Previously checked and not accepted.',
      sourceUrls: cached.data.sourceUrls || [],
      confidence: cached.data.confidence || 'low',
    });
  } else {
    try {
      verification = await verifyOnWeb(category, rawAnswer);
    } catch (error) {
      return json(
        {
          error: 'I could not verify that answer right now. Please try again.',
          detail: error instanceof Error ? error.message : String(error),
        },
        503,
      );
    }

    const baseRecord = {
      verified: verification.valid,
      canonicalAnswer: verification.canonicalAnswer,
      explanation: verification.explanation,
      sourceUrls: verification.sourceUrls,
      confidence: verification.confidence,
      checkedAt: Date.now(),
      count: seedInfo.pseudoCount,
      seedShare: seedInfo.found?.share || 0,
    };

    try {
      await store.setJSON(answerKey, baseRecord, { onlyIfNew: true });
    } catch (_) {
      // Another request may have cached the same answer simultaneously.
    }
    cached = await readJson(store, answerKey);
    verification = cached?.data || baseRecord;
  }

  if (!verification.verified) {
    return json({
      valid: false,
      points: 0,
      canonicalAnswer: verification.canonicalAnswer || rawAnswer,
      explanation: verification.explanation || 'The answer did not pass online verification.',
      sourceUrls: verification.sourceUrls || [],
      confidence: verification.confidence || 'low',
    });
  }

  const updated = await atomicUpsert(
    store,
    answerKey,
    () => ({ ...verification, count: seedInfo.pseudoCount + 1, lastUsedAt: Date.now() }),
    (data) => ({
      ...data,
      verified: true,
      count: Math.max(0, Number(data?.count) || 0) + 1,
      lastUsedAt: Date.now(),
    }),
  );

  const totalKey = `totals/${safeKey(category.key)}`;
  const totalRecord = await atomicUpsert(
    store,
    totalKey,
    () => ({ count: Math.max(seedInfo.pseudoTotal, 1) + 1 }),
    (data) => ({ count: Math.max(0, Number(data?.count) || 0) + 1 }),
  );

  const answerCount = Math.max(1, Number(updated?.count) || seedInfo.pseudoCount + 1);
  const totalCount = Math.max(
    answerCount,
    Number(totalRecord?.count) || seedInfo.pseudoTotal + 1,
  );
  const points = scoreFor(answerCount, totalCount);
  const share = answerCount / totalCount;

  return json({
    valid: true,
    points,
    canonicalAnswer: verification.canonicalAnswer || rawAnswer,
    explanation: verification.explanation || 'Verified with live web research.',
    sourceUrls: verification.sourceUrls || [],
    confidence: verification.confidence || 'medium',
    share,
    rarityPercent: share * 100,
    maxPoints: 700,
  });
};
