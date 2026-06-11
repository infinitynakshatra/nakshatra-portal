/**
 * Cloudflare Pages Function — relay portal POSTs to Google Apps Script Web App.
 * Browser calls https://nakshatra-portal.pages.dev/api/collection (same origin).
 * Set APPS_SCRIPT_EXEC_URL in Cloudflare Pages → Settings → Environment variables (optional).
 */

const DEFAULT_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbymDJTDSDm-p9jSL7Y1TMJs3tb5ZKXJAQTlqq6b49hcO4Zr4sGS4bOslKEOfgOtJQ8w/exec";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const target = String(env.APPS_SCRIPT_EXEC_URL || DEFAULT_EXEC_URL).trim();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method === "GET") {
    const msg = `Nakshatra collection proxy OK. POST JSON to this URL; forwards to Apps Script. Target: ${target ? "configured" : "missing"}`;
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
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "text/plain",
      },
      body,
      redirect: "follow",
    });
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
