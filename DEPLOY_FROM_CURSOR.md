# Deploy from Cursor (GitHub + Apps Script)

This folder is connected to:

| Target | URL |
|--------|-----|
| **GitHub** | [infinitynakshatra/nakshatra-portal](https://github.com/infinitynakshatra/nakshatra-portal) |
| **Apps Script** | [Script project](https://script.google.com/u/5/home/projects/1N9V_DwNhgW3yvOsrga0_tioOseAmokCFA5vjO7iaC6TK4pw5h0awAMuC/edit) |

Open the workspace with **`Nakshatra.code-workspace`** so Cursor uses this folder as the project root.

---

## One-time setup

### 1. Install Node tools (in this folder)

```powershell
cd C:\HC\Reports\cursor\Nakshatra
npm install
```

### 2. Sign in to Google Apps Script (once per machine)

```powershell
npm run apps-script:login
```

A browser window opens — sign in with the Google account that owns the Apps Script project.  
Credentials are stored locally by [clasp](https://github.com/google/clasp).

### 3. GitHub push access

Ensure you can push to `infinitynakshatra/nakshatra-portal` (GitHub login, SSH key, or personal access token).  
Test:

```powershell
git fetch origin
git status -sb
```

---

## Daily workflow from Cursor

### Edit portal HTML

1. Change `infinity_nakshatra_dashboard.html` (and related files).
2. Commit and push to GitHub when ready:

```powershell
git add infinity_nakshatra_dashboard.html
git commit -m "Describe your change"
git push origin main
```

Or use **Terminal → Run Task → Nakshatra: Git push (main)**.

### Edit Apps Script backend

1. Change `apps_script_collection_data.gs` in this folder (source of truth).
2. Push to Google:

```powershell
npm run apps-script:push
```

To also publish the **live Web app** (same `/exec` URL as today):

```powershell
npm run apps-script:deploy
```

Or use **Terminal → Run Task → Nakshatra: Apps Script deploy (push + live web app)**.

> **Note:** `apps-script:push` updates the script project. `apps-script:deploy` pushes **and** updates the existing Web app deployment (ID in `APP SCRIP LINKS_HC.txt`).

### Pull latest from GitHub

```powershell
npm run git:pull
```

### Pull script from Google (if someone edited in the browser)

```powershell
npm run apps-script:pull
```

Review the diff — local `apps_script_collection_data.gs` will be overwritten.

---

## Cursor tasks (quick menu)

**Terminal → Run Task…** (or `Ctrl+Shift+P` → “Tasks: Run Task”):

| Task | What it does |
|------|----------------|
| Nakshatra: Apps Script deploy | Push `.gs` + update live Web app |
| Nakshatra: Apps Script push | Push code only |
| Nakshatra: Git push (main) | Push commits to GitHub |
| Nakshatra: Git pull (main) | Pull latest from GitHub |
| Nakshatra: Apps Script login | One-time Google sign-in |

---

## Files managed by clasp

Edit **`apps_script_collection_data.gs`** at the project root (same as GitHub).  
Before each push, npm copies it to `apps-script/Code.gs` (generated folder, gitignored).

Only the Apps Script project receives:

- `Code.gs` (from your root `.gs` file)
- `appsscript.json`

The HTML portal is **not** uploaded to Apps Script — it lives in GitHub and is served separately (see `How to Use Project.txt`).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `User has not authenticated` | Run `npm run apps-script:login` |
| `Script API has not been enabled` | Enable [Apps Script API](https://script.google.com/home/usersettings) for your Google account |
| Git push rejected | `git pull --rebase origin main` then push again |
| Portal still old after script deploy | Web app may need **deploy** (`npm run apps-script:deploy`), not push only |
| API key mismatch | Keep `SCRIPT_API_KEY` in `.gs` and `COLLECTION_API_KEY` in HTML identical |

See also **`APPS_SCRIPT_DEPLOY.txt`** and **`COLLECTION_SETUP.md`**.
