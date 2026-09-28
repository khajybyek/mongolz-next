#!/usr/bin/env node
/**
 * External uptime probe — run by .github/workflows/uptime-probe.yml.
 *
 * The pg_cron monitor (private.uptime_collect) lives INSIDE Postgres, so a
 * complete database or Supabase outage silences it instead of alerting. This
 * probe runs on GitHub's runners, calls the public /api/uptime endpoint and
 * talks to the Telegram Bot API directly — nothing on the alert path depends
 * on Supabase or Vercel.
 *
 * It alerts on the two things the in-database monitor cannot report on its
 * own: the web app not answering, and the web app answering that its database
 * check fails. ML outages stay with pg_cron (it keeps running while the
 * database is up), so the same ML incident is not reported twice.
 *
 * State ({web, db, …}) is a small JSON file that the workflow carries between
 * runs with actions/cache; a message is sent only when a component changes
 * state, never once per run. A missing state file counts as "everything was
 * up", so an outage that is already under way when the cache is empty is
 * still reported.
 *
 * Exit code: 0 when web + db are up, 1 when either is down or an alert could
 * not be delivered — GitHub then e-mails the owner about the failed scheduled
 * run, which works even before the Telegram secrets are configured.
 *
 * No dependencies: plain Node (fetch, AbortSignal.timeout), so the workflow
 * needs no `npm ci`.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  url: "https://aicctv.dev/api/uptime",
  attempts: 3,
  retryDelayMs: 20_000,
  timeoutMs: 15_000,
};

/**
 * One probe result → component states. The web app counts as answering only
 * when /api/uptime returned its JSON contract (checks.db.ok and checks.ml.ok
 * are booleans) — a 200/503 from the app itself. Anything else (timeout,
 * DNS/TLS error, Vercel's HTML 5xx) is "web down" and the database state is
 * unknown (null), not "down".
 */
function classify(result) {
  const checks = result && result.body && typeof result.body === "object" ? result.body.checks : null;
  const dbOk = checks && checks.db && typeof checks.db.ok === "boolean" ? checks.db.ok : null;
  const mlOk = checks && checks.ml && typeof checks.ml.ok === "boolean" ? checks.ml.ok : null;
  const answered = dbOk !== null && mlOk !== null;
  let detail;
  if (result.error) detail = result.error;
  else if (!answered) detail = `HTTP ${result.status} without the /api/uptime JSON body`;
  else detail = `HTTP ${result.status}`;
  return {
    web: answered,
    db: answered ? dbOk : null,
    ml: answered ? mlOk : null,
    detail,
  };
}

/**
 * Kinds to announce between the previous and the current state. The
 * database is only compared when the web app answered both times — an
 * unknown database state is not a transition.
 */
function transitions(prev, cur) {
  const before = { web: true, db: true, ...(prev || {}) };
  const kinds = [];
  if (before.web !== cur.web) kinds.push(cur.web ? "web_recovered" : "web_down");
  if (cur.web && before.web && typeof before.db === "boolean" && before.db !== cur.db) {
    kinds.push(cur.db ? "db_recovered" : "db_down");
  }
  return kinds;
}

function kstClock(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} KST`;
}

/** Plain-text Telegram message (no parse_mode, so nothing needs escaping). */
function message(kind, cur, url, now) {
  const at = kstClock(now);
  const src = "гадаад шалгалт · GitHub Actions";
  switch (kind) {
    case "web_down":
      return [
        "🔴 MONGOLZ вэб апп хариу өгөхгүй байна",
        `Шалтгаан: ${cur.detail}`,
        `Шалгасан: ${url}`,
        `Цаг: ${at}`,
        `(${src}; дотоод pg_cron мониторинг энэ үед мэдэгдэхгүй байж болно)`,
      ].join("\n");
    case "web_recovered":
      return ["🟢 MONGOLZ вэб апп сэргэлээ", `Цаг: ${at}`, `(${src})`].join("\n");
    case "db_down":
      return [
        "🔴 MONGOLZ өгөгдлийн сан хариу өгөхгүй байна",
        "Вэб апп ажиллаж байгаа ч Supabase-тэй холбогдож чадахгүй байна.",
        "Postgres бүрэн унасан бол дотоод pg_cron мониторинг мэдэгдэж чадахгүй — RUNBOOK §5.",
        `Цаг: ${at}`,
        `(${src})`,
      ].join("\n");
    case "db_recovered":
      return ["🟢 MONGOLZ өгөгдлийн сан сэргэлээ", `Цаг: ${at}`, `(${src})`].join("\n");
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

async function probeOnce(fetchImpl, url, timeoutMs) {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": "mongolz-uptime-probe (github-actions)", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, body, error: null };
  } catch (err) {
    const name = err && err.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : String((err && err.message) || err);
    return { status: 0, body: null, error: name.slice(0, 200) };
  }
}

/** Probe up to `attempts` times; the first healthy answer wins. */
async function probe({ fetchImpl, url, attempts, retryDelayMs, timeoutMs, sleep }) {
  let cur = null;
  for (let i = 0; i < attempts; i++) {
    cur = classify(await probeOnce(fetchImpl, url, timeoutMs));
    if (cur.web && cur.db) return cur;
    if (i < attempts - 1) await sleep(retryDelayMs);
  }
  return cur;
}

async function sendTelegram(fetchImpl, token, chatId, text) {
  // The token is part of the URL — never log the URL or the error object.
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage answered HTTP ${res.status}`);
}

function nonNegative(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * One probe run. Returns the exit code. Everything the outside world touches
 * is injectable so the flow is unit-tested without network or disk.
 */
async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => new Date(),
  log = console.log,
  writeFile = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  },
  readStateFile = readState,
} = {}) {
  const url = env.PROBE_URL || DEFAULTS.url;
  const stateFile = env.STATE_FILE || ".uptime-state/state.json";
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const chatId = env.TELEGRAM_CHAT_ID || "";

  const prev = readStateFile(stateFile);
  const cur = await probe({
    fetchImpl,
    url,
    attempts: Math.max(1, Math.floor(nonNegative(env.PROBE_ATTEMPTS, DEFAULTS.attempts)) || DEFAULTS.attempts),
    retryDelayMs: nonNegative(env.PROBE_RETRY_DELAY_MS, DEFAULTS.retryDelayMs),
    timeoutMs: DEFAULTS.timeoutMs,
    sleep,
  });
  const at = now();
  const kinds = transitions(prev, cur);

  log(`web=${cur.web} db=${cur.db} ml=${cur.ml} (${cur.detail}); previous=${prev ? JSON.stringify({ web: prev.web, db: prev.db }) : "none"}; alerts=${kinds.join(",") || "none"}`);

  let delivered = true;
  if (kinds.length) {
    if (!token || !chatId) {
      log("::warning::TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set — state change recorded, no Telegram message sent.");
    } else {
      for (const kind of kinds) {
        try {
          await sendTelegram(fetchImpl, token, chatId, message(kind, cur, url, at));
          log(`sent ${kind}`);
        } catch (err) {
          delivered = false;
          log(`::error::could not deliver ${kind}: ${String((err && err.message) || err).replace(token, "***")}`);
        }
      }
    }
  }

  // Keep the previous state when an alert failed, so the next run retries it.
  if (delivered) {
    writeFile(stateFile, JSON.stringify({ web: cur.web, db: cur.db, ml: cur.ml, detail: cur.detail, at: at.toISOString() }));
  }

  if (env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `| component | state |\n|---|---|\n| web app | ${cur.web ? "up" : "DOWN"} |\n| database (via web) | ${cur.db === null ? "unknown" : cur.db ? "up" : "DOWN"} |\n| ML (reported by pg_cron) | ${cur.ml === null ? "unknown" : cur.ml ? "up" : "down"} |\n\n${cur.detail}; alerts: ${kinds.join(", ") || "none"}\n`,
      );
    } catch {
      /* a summary is optional */
    }
  }

  if (!delivered) return 1;
  return cur.web && cur.db ? 0 : 1;
}

module.exports = { classify, transitions, message, kstClock, probe, run, DEFAULTS };

if (require.main === module) {
  run().then(
    (code) => process.exit(code),
    (err) => {
      console.log(`::error::uptime probe crashed: ${String((err && err.message) || err)}`);
      process.exit(1);
    },
  );
}
