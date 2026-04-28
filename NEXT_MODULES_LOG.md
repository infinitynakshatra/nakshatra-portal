# Next modules — backlog log

_Last updated: 2026-04-28. Resume work from this list when ready._

Planned items (not yet fully delivered in the portal):

1. **Complaints / tickets** — Owner submit + track; admin triage, status, comments. (Backend stubs/tabs may exist; full UI + flows TBD.)
2. **Receipts** — Per-payment receipt (view / print / PDF) for owner and admin.
3. **Reminders & export** — Better pending/completed exports + WhatsApp (or similar) message text from selected months.
4. **Owner i18n** — Extend EN/HI/MR across all owner UI, alerts, and new areas.

Notes:

- Main portal: `infinity_nakshatra_dashboard.html` (+ `nakshatra_collection_exec_url.js`, `assets/`, Apps Script `apps_script_collection_data.gs`).
- Production use: serve over **HTTPS** (not `file://`) so `COLLECTION_API_URL` (`https://script.google.com/.../exec`) and Sheet CSV loads work in the browser.
