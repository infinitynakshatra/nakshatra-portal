/**
 * Cloudflare Pages Function — relay portal POSTs to Google Apps Script Web App.
 * Browser calls https://nakshatra-portal.pages.dev/api/collection (same origin).
 * Optional env: APPS_SCRIPT_EXEC_URL = full …/macros/s/…/exec URL
 *
 * Apps Script doPost flow:
 *   1) POST body to …/exec → 302 Location → script.googleusercontent.com/macros/echo?…
 *   2) GET that Location → JSON body
 * Re-POSTing the echo URL → HTTP 405. Workers that keep POST on redirect follow → 405.
 * Google sometimes returns HTML 404 for the echo GET from edge IPs — retry the full cycle.
 */

const DEFAULT_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbymDJTDSDm-p9jSL7Y1TMJs3tb5ZKXJAQTlqq6b49hcO4Zr4sGS4bOslKEOfgOtJQ8w/exec";

const MAX_ATTEMPTS = 4;
const MAX_REDIRECTS = 5;
const RETRY_STATUSES = new Set([404, 405, 408, 429, 500, 502, 503, 504, 524]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeGoogleHtml(text) {
  const s = String(text || "").slice(0, 400).toLowerCase();
  return (
    s.includes("<!doctype html") ||
    s.includes("<html") ||
    s.includes("ppconfig") ||
    s.includes("page not found") ||
    s.includes("accounts.google.com")
  );
}

function deploymentHint(target) {
  try {
    const m = String(target).match(/\/macros\/s\/([^/]+)\//i);
    return m ? m[1].slice(-12) : "unknown";
  } catch {
    return "unknown";
  }
}

/** POST once to /exec, then GET each redirect Location until a non-redirect response. */
async function postAppsScript(target, body, contentType) {
  let response = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Accept: "application/json,text/plain,*/*",
    },
    body,
    redirect: "manual",
  });

  let base = target;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (response.status < 300 || response.status >= 400) return response;
    const loc = response.headers.get("Location");
    if (!loc) return response;
    const nextUrl = new URL(loc, base).href;
    // Brief pause — echo tokens are occasionally not ready on the edge.
    await sleep(80);
    response = await fetch(nextUrl, {
      method: "GET",
      headers: { Accept: "application/json,text/plain,*/*" },
      redirect: "manual",
    });
    base = nextUrl;
  }
  return response;
}

function shouldRetry(status, text) {
  if (RETRY_STATUSES.has(status)) return true;
  if (status >= 200 && status < 300 && looksLikeGoogleHtml(text)) return true;
  return false;
}

async function fetchUpstreamWithRetry(target, body, contentType) {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await postAppsScript(target, body, contentType);
      const text = await upstream.text();
      lastStatus = upstream.status;
      lastText = text;
      const ct = upstream.headers.get("Content-Type") || "application/json; charset=utf-8";
      if (!shouldRetry(upstream.status, text) || attempt >= MAX_ATTEMPTS) {
        return { status: upstream.status, text, contentType: ct, attempts: attempt };
      }
    } catch (err) {
      lastStatus = 502;
      lastText = err && err.message ? String(err.message) : "Upstream fetch failed";
      if (attempt >= MAX_ATTEMPTS) {
        return { status: 502, text: lastText, contentType: "text/plain; charset=utf-8", attempts: attempt };
      }
    }
    await sleep(400 * attempt);
  }
  return { status: lastStatus || 502, text: lastText, contentType: "text/plain; charset=utf-8", attempts: MAX_ATTEMPTS };
}

export async function onRequest(context) {
  const { request, env } = context;
  const target = String(env.APPS_SCRIPT_EXEC_URL || DEFAULT_EXEC_URL).trim();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method === "GET") {
    const msg =
      "Nakshatra collection proxy OK. POST JSON to this URL; forwards to Apps Script. Target: " +
      (target ? "configured …" + deploymentHint(target) : "missing");
    return new Response(msg, {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  if (!target) {
    return new Response("APPS_SCRIPT_EXEC_URL is not configured", {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const body = await request.text();
    const contentType = request.headers.get("Content-Type") || "text/plain;charset=utf-8";
    const upstream = await fetchUpstreamWithRetry(target, body, contentType);

    // Never pass Google HTML error pages through — portal expects JSON-ish responses.
    if (looksLikeGoogleHtml(upstream.text) || (upstream.status >= 400 && !String(upstream.text || "").trim().startsWith("{"))) {
      const payload = JSON.stringify({
        ok: false,
        error: "apps_script_upstream_failed",
        upstreamStatus: upstream.status,
        attempts: upstream.attempts,
        hint: "Retry in a few seconds. If it keeps failing, check Apps Script deployment access (Anyone) and APPS_SCRIPT_EXEC_URL.",
      });
      return new Response(payload, {
        status: 502,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json; charset=utf-8",
          "X-Nakshatra-Upstream-Status": String(upstream.status),
          "X-Nakshatra-Attempts": String(upstream.attempts || 1),
        },
      });
    }

    return new Response(upstream.text, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        "Content-Type": upstream.contentType || "application/json; charset=utf-8",
        "X-Nakshatra-Attempts": String(upstream.attempts || 1),
      },
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : "Upstream fetch failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
