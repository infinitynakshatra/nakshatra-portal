# Cursor / Agent session starter — Infinity Nakshatra Society portal

Paste the block below as the **first message** when you open a new agent, or add it to **Project Rules** for this folder.

---

```
You are working in this workspace:

  C:\HC\Reports\cursor\Nakshatra

Treat this folder as the project root. Do not assume another repo unless I say so.

## What this project is
- **Infinity Nakshatra Society** portal: single-file web app `infinity_nakshatra_dashboard.html` (HTML + inline CSS + inline JavaScript).
- **Static assets:** `assets/infinity-nakshatra-logo.png`, `assets/portal-hero-background.png` (paths are relative to the HTML file).
- **Google Apps Script (optional writeback / collection):** `apps_script_collection_data.gs` — referenced from comments in the dashboard; deploy separately in Google Apps Script.
- **Plot owner data helper:** `scripts/read_plot_owners_raw_data.py` exports an Excel workbook to CSV under `plot_owners_raw_data_export/` (default `--out-dir` is cwd-relative).

## Tech / behavior notes
- Dashboard loads sheet data via **Google Sheets CSV export URL** (constants in the HTML). Payments, banking text, sessions: **localStorage / sessionStorage** in the browser.
- **Admin** vs **owner** flows; maintenance filters/KPIs; Add Payment / approvals; Account & UPI; project documents; mobile-responsive rules live in the same HTML file.

## When I ask for changes
- Prefer editing only files required for the request; match existing patterns in the touched file.
- Default to `infinity_nakshatra_dashboard.html` unless I specify another path.
- Use **absolute paths** in tool arguments when possible: `C:\HC\Reports\cursor\Nakshatra\...`
- Run checks when relevant (e.g. search for `id=` / event listeners after UI changes).

## How I’ll work with you
- I describe the change; you implement and summarize files changed.
- If something is ambiguous, ask a short clarification before a large refactor.

Acknowledge the workspace path and that you’re ready for my first change request.
```

---

## Folder layout (after move)

| Path | Purpose |
|------|--------|
| `infinity_nakshatra_dashboard.html` | Main portal |
| `assets/` | Logos and hero image |
| `apps_script_collection_data.gs` | Apps Script: push rows to `collection_data` + `collection_m_YYYYMM` (see **COLLECTION_SETUP.md**) |
| `COLLECTION_SETUP.md` | Deploy Apps Script + set `COLLECTION_API_URL` / key in HTML |
| `scripts/read_plot_owners_raw_data.py` | Excel → CSV export helper |
| `plot_owners_raw_data_export/` | Example/export CSVs for plot data |

---

## If you see **404 File not found**

- **Whole browser page 404:** You are probably using an **old URL** (e.g. `llm-foundry-main`) or started `http.server` in the **wrong folder**. Use `C:\HC\Reports\cursor\Nakshatra`, then open `http://127.0.0.1:8080/infinity_nakshatra_dashboard.html` (see `How to Use Project.txt`).
- **Page loads but data fails:** Check **`SHEET_ID`** / **`SHEET_EXPORT_GIDS`** in `infinity_nakshatra_dashboard.html` and that the Google Sheet is shared so **CSV export** works for those tabs.
