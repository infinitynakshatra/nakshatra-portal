/**
 * Cloudflare Pages Function — relay portal POSTs to Google Apps Script Web App.
 * Browser calls https://nakshatra-portal.pages.dev/api/collection (same origin).
 * Set APPS_SCRIPT_EXEC_URL in Cloudflare Pages → Settings → Environment variables (optional).
 *
 * Apps Script flow (doPost):
 *   1) POST body to …/exec  → 302 Location → script.googleusercontent.com/macros/echo?…
 *   2) GET that Location     → JSON result
 * Re-POSTing the echo URL returns HTTP 405. Auto-follow that keeps POST also returns 405.
 */

const DEFAULT_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbymDJTDSDm-p9jSL7Y1TMJs3tb5ZKXJAQTlqq6b49hcO4Zr4sGS4bOslKEOfgOtJQ8w/exec";

const RETRY_STATUSES = new Set([524, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;

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

/** POST once to /exec, then GET each redirect Location until a non-redirect response. */
async function postAppsScript(target, body, contentType) {
  let response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    redirect: "manual",
  });

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (response.status < 300 || response.status >= 400) return response;
    const loc = response.headers.get("Location");
    if (!loc) return response;
    const nextUrl = new URL(loc, target).href;
    // Echo URL only accepts GET (POST → 405 Method Not Allowed).
    response = await fetch(nextUrl, {
      method: "GET",
      redirect: "manual",
    });
    target = nextUrl;
  }
  return response;
}

async function fetchUpstreamWithRetry(target, body, contentType) {
  let lastResponse = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await postAppsScript(target, body, contentType);
      lastResponse = upstream;
      if (RETRY_STATUSES.has(upstream.status) && attempt < MAX_ATTEMPTS) {
        await sleep(1200 * attempt);
        continue;
      }
      return upstream;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(1200 * attempt);
    }
  }
  return lastResponse;
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
      (target ? "configured" : "missing");
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
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      },
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : "Upstream fetch failed";
    return new Response(msg, {
      status: 502,
      headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
