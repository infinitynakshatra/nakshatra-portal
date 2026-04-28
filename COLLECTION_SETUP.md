# Google Sheets ↔ Portal (read, collection backup, owner contact writeback)

**Deploy checklist:** see **`APPS_SCRIPT_DEPLOY.txt`** (paste `COLLECTION_API_URL` after deployment; API key is pre-set in the script + HTML).

Spreadsheet:  
[plot_owners_data tab](https://docs.google.com/spreadsheets/d/1vthuqpQqwaRGaJhaoJxVaHXv3Fd87M4eHeU9h3jDHWA/edit?pli=1&gid=1304899070#gid=1304899070)

---

## A. Read owner data into the portal (CSV)

1. **Share the spreadsheet** so the CSV URL works in the browser:
   - **Share** → *Anyone with the link* → **Viewer** (or publish the file), **or** ensure all admins/owners are signed into Google in the same browser profile.
2. In **`infinity_nakshatra_dashboard.html`**, **`SHEET_EXPORT_GIDS`** lists tab gids to try **in order**. The portal uses the **first** tab that returns at least one row with **Plot No.** filled.
   - Default: `["0", "1304899070"]` — first sheet tab, then `plot_owners_data`.
   - If counts stay at zero, put the gid of the tab that actually has your rows **first** in the array.
3. **Header names** don’t have to match letter‑for‑letter: the portal maps common variants (e.g. `Plot No` → `Plot No.`). Your real columns should still mean the same thing (`Sold/Unsold`, `Primary Contact Number`, etc.).
4. After a successful load, the footer shows **`tab gid …`**. That gid is used when writing contact updates back to the sheet.

---

## B. Google Apps Script (one Web app URL)

1. In the spreadsheet: **Extensions → Apps Script**.
2. Paste **`apps_script_collection_data.gs`** (replace default code if needed).
3. Set **`SCRIPT_API_KEY`** to a long random secret.
4. **Deploy → New deployment** → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (or restricted, if you accept extra auth work).
5. Copy the **`/exec`** URL into the HTML as **`COLLECTION_API_URL`**, and set **`COLLECTION_API_KEY`** to the same value as **`SCRIPT_API_KEY`**.

---

## C. Portal HTML (`COLLECTION_API_*`)

```js
const COLLECTION_API_URL = "https://script.google.com/macros/s/XXXX/exec";
const COLLECTION_API_KEY = "same-secret-as-SCRIPT_API_KEY";
```

Use the **exact** deployment URL.

---

## D. What the script writes

| Action | Tabs |
|--------|------|
| Default **`entry`** POST | **`collection_data`** + **`collection_m_YYYYMM`** (month mirror). |
| **`action: "bulk"`** | Same, for many collection rows. |
| **`action: "updatePlotRow"`** | Updates **cells on the owner tab** identified by **`sheetGid`** (same gid the portal used for CSV) for the given **Plot No.** and column names (`Primary Contact Number`, `Alternate Number`, …). |
| **`action: "upsertPlotRow"`** | **`insert: true`** — append a new row (all sheet columns from form values; defaults **Sold/Unsold** to **Unsold** if empty). **`insert: false`** — update every key in **`values`** for an existing **Plot No.** (admin **Unsold → Update** modal). |

Collection columns: `atIso`, `plotNo`, `ym`, `monthLabel`, `amount`, `lateFee`, `role`, `ownerName`, `mobile`, `groupStatus`, `userAgent`, `note`.

---

## E. Two-way behaviour (what you get today)

| Direction | Behaviour |
|-----------|-----------|
| **Sheet → Portal** | `loadCsv()` pulls CSV on login and on **`AUTO_REFRESH_MS`**. Change the sheet → next refresh updates stats and tables. |
| **Portal → Sheet (contacts)** | Owner **Update** on primary/alternate numbers → saved locally **and** POST **`updatePlotRow`** (if API + gid are set). |
| **Portal → Sheet (unsold row editor)** | Admin **Unsold** stat box **Update** → modal with **every column from the loaded CSV**; **Save** calls **`upsertPlotRow`** (update existing unsold plot or add a new unsold row). |
| **Portal → Sheet (payments)** | Admin **Add Payment** / approve / **Backup payments to Sheet** → **`collection_data`** + month tabs (not the main owner grid). |

Editing arbitrary cells in the main owner table from the portal (full grid edit) is **not** implemented; only **contact** fields above sync to the sheet row for that plot.

---

## F. When rows are sent (collections)

- Admin saves payment → collection rows.
- Admin approves owner request → collection row (`note: approved_owner_request`).
- **Backup payments to Sheet** → bulk upload from this browser’s payment storage.

---

## G. Testing

1. `py -3 -m http.server 8080` in the `Nakshatra` folder; open `http://127.0.0.1:8080/infinity_nakshatra_dashboard.html`.
2. Confirm **totals are not all zero**; check **Last loaded … tab gid …**.
3. Configure **`COLLECTION_API_*`**, redeploy script, then test owner contact save and/or payment backup.

---

## H. Troubleshooting

| Issue | What to check |
|--------|----------------|
| **401 unauthorized** | `COLLECTION_API_KEY` matches `SCRIPT_API_KEY`. |
| **CORS / fetch errors** | Use **`http://localhost`**, not `file://`. |
| **All zeros / empty grid** | **`SHEET_EXPORT_GIDS`** order; sheet shared for CSV; row 1 = headers; **Plot No.** column populated. |
| **Sheet update failed (contacts)** | Web app deployed; **Plot No.** column exists; plot exists on that tab; gid matches loaded tab. |
| **Month tab missing** | `ym` must be **`YYYY-MM`**. |
