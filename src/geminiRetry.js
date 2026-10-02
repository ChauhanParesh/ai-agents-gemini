// Calls Gemini with: (1) retry + exponential backoff for transient errors on
// the current model, and (2) fallback to the next model in the list once a
// model's retries are exhausted, it's unavailable outright (e.g. removed), or
// its quota for the day is blown.
//
// "Sticky" model selection: once a fallback model succeeds, later calls start
// from that model instead of re-trying an overloaded/exhausted primary every
// turn. A later recovery of an earlier model isn't actively probed for — this
// optimizes for "stop hammering a model that's currently down," not for
// always using the best available one.

// HTTP statuses worth retrying on the *same* model (rate limited / transient
// server trouble). Anything else (400 bad request, 404 unknown model, 401/403
// auth) won't be fixed by waiting, so we move straight to the next model.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const MAX_RETRIES_PER_MODEL = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
// Server-suggested retry delays (from RetryInfo) are trusted, but capped —
// no point blocking a user's message for a minute on an automatic retry.
const MAX_SERVER_DELAY_MS = 15000;
// A daily-quota model gets parked for this long before we risk another call
// on it. The real reset is "midnight in Google's accounting", which we don't
// know exactly, so this just controls how often we waste a call re-checking.
const DAILY_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exp + Math.random() * 300; // jitter, avoids thundering-herd retries
}

/** Pulls Google's structured RESOURCE_EXHAUSTED details out of err.message (a JSON string). */
function parseQuotaInfo(err) {
  let body;
  try {
    body = JSON.parse(err?.message ?? '');
  } catch {
    return { isDailyQuota: false, retryDelayMs: null };
  }

  const details = body?.error?.details ?? [];
  const quotaFailure = details.find((d) => d['@type']?.includes('QuotaFailure'));
  const retryInfo = details.find((d) => d['@type']?.includes('RetryInfo'));

  const isDailyQuota = quotaFailure?.violations?.some((v) => /PerDay/i.test(v.quotaId ?? '')) ?? false;
  const retryDelayMs = retryInfo?.retryDelay ? parseFloat(retryInfo.retryDelay) * 1000 : null;

  return { isDailyQuota, retryDelayMs: Number.isFinite(retryDelayMs) ? retryDelayMs : null };
}

/**
 * Returns an async generateContent(params) that resolves to
 * { response, model } — `model` is whichever candidate actually served the
 * request, which may not be `models[0]` once a fallback has kicked in.
 */
export function createGeminiCaller(ai, models) {
  const candidates = [...new Set(models)]; // dedupe, keep priority order
  if (candidates.length === 0) throw new Error('createGeminiCaller requires at least one model');

  let modelIndex = 0;
  const cooldownUntil = new Map(); // model -> timestamp ms

  return async function generateContent(params) {
    let lastError;

    for (; modelIndex < candidates.length; modelIndex++) {
      const model = candidates[modelIndex];

      const parkedUntil = cooldownUntil.get(model);
      if (parkedUntil && Date.now() < parkedUntil) {
        console.warn(
          `  [gemini] ${model} skipped — daily quota hit earlier, cooling down for another ${Math.round((parkedUntil - Date.now()) / 1000)}s`,
        );
        continue; // don't waste a call on a model we already know is exhausted
      }

      for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
        try {
          const response = await ai.models.generateContent({ ...params, model });
          return { response, model };
        } catch (err) {
          lastError = err;
          const status = err?.status;
          const retryable = RETRYABLE_STATUSES.has(status);
          const { isDailyQuota, retryDelayMs } = status === 429 ? parseQuotaInfo(err) : { isDailyQuota: false, retryDelayMs: null };

          if (isDailyQuota) {
            cooldownUntil.set(model, Date.now() + DAILY_QUOTA_COOLDOWN_MS);
            console.warn(
              `  [gemini] ${model} hit its daily free-tier quota — parking it for ${DAILY_QUOTA_COOLDOWN_MS / 60000}min${
                modelIndex < candidates.length - 1 ? `, falling back to ${candidates[modelIndex + 1]}` : ''
              }`,
            );
            break; // no point retrying a per-day quota; move on immediately
          }

          if (!retryable || attempt === MAX_RETRIES_PER_MODEL) {
            console.warn(
              `  [gemini] ${model} failed (status ${status ?? 'unknown'})${
                retryable ? ` after ${attempt + 1} attempt(s)` : ''
              }${modelIndex < candidates.length - 1 ? ` — falling back to ${candidates[modelIndex + 1]}` : ''}`,
            );
            break; // give up on this model, try the next one
          }

          // Prefer the server's own suggested wait (e.g. per-minute rate
          // limits) over our blind exponential schedule, when it's sane.
          const delay =
            retryDelayMs != null ? Math.min(retryDelayMs, MAX_SERVER_DELAY_MS) : backoffDelay(attempt);
          console.warn(
            `  [gemini] ${model} returned ${status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL})`,
          );
          await sleep(delay);
        }
      }
    }

    // All models exhausted or cooling down — reset to the top so the next
    // user message gets a fresh chance (the cooldown map still protects
    // genuinely daily-exhausted models from being retried too soon).
    modelIndex = 0;
    throw lastError;
  };
}
