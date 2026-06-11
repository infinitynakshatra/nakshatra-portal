---
marp: true
theme: default
paginate: true
header: "Infinity Nakshatra Society — Resident Portal"
footer: "Confidential overview • No personal or plot data included"
style: |
  section { font-size: 26px; }
  h1 { color: #1a365d; }
  h2 { color: #2c5282; }
  ul { line-height: 1.35; }
---

<!-- 
  HOW TO USE THIS DECK
  • VS Code: install “Marp for VS Code”, open this file, export to PDF or HTML.
  • Or copy each slide (between --- lines) into Google Slides / PowerPoint.
-->

# Infinity Nakshatra Society  
## Resident & Maintenance Portal

**Purpose-built web application** for housing-society operations: maintenance collection, owner self-service, and administration—aligned with your master plot register.

---

# What this platform delivers

- **Single sign-in experience** for administrators and plot owners  
- **Live operational picture** of plots, contacts, maintenance receipts, and dues  
- **Controlled workflows** so owners propose payments; admins confirm and post  
- **Optional cloud sync** so data and settings are shared across devices  
- **Mobile-friendly** layout for day-to-day use in the field  

---

# Service & commercial model

| Offering | Detail |
|----------|--------|
| **Hosting** | Included at **no charge** on standard static hosting suitable for this portal |
| **Licence use** | **Lifetime use** of the delivered application for the same scope of features described in this deck |
| **Premium tiers** | **None** — no paid modules or feature paywalls in this programme |
| **Enhancements** | **First-year enhancement service included**: refinements, minor adjustments, and alignment with your processes (within agreed scope) |

*Exact legal terms are defined in your project agreement; this deck is a functional summary only.*

---

# Technical foundation (high level)

- **Master data** is maintained in a **spreadsheet-backed register** (plot list, sale status, contacts). The portal **reads** this source on load and on periodic refresh.  
- **Optional backend** (Google Apps Script web app) can **write** collection logs, shared portal state, and selected field updates—so backups and multi-device behaviour stay consistent.  
- **No screenshots or live data** are required for onboarding; configuration uses your existing workbook and deployment URLs.

---

# Module map — overview

**Admin experience:** dashboard metrics, maintenance analytics, plot directory, payment tools, approvals, communications, documents, banking display, reporting.

**Owner experience:** secure login, payment summary, payment requests, notices, documents, society contacts, banking details, optional messages from the office.

---

# Authentication & security

- **Role-based login:** Administrator vs Owner  
- **Password management:** change password, admin-assisted reset for owners  
- **Session handling:** secure logout; access can be restricted per owner where configured  
- **Optional portal access rules:** default behaviour tied to maintenance payment status, with explicit overrides for special cases  

---

# Admin — top bar & quick actions

- Open the **linked master workbook** (where your society maintains plot data)  
- **Add payment** (single plot) and **add multiple payments** (batch by month)  
- **Download report** (maintenance received — structured export)  
- **Profile:** admin notes, reset owner password, change password, logout  
- **Community link** (e.g. messaging group) when configured  

---

# Admin — dashboard statistics

At-a-glance **counts** (illustrative categories):

- Total plots  
- Sold vs unsold  
- Missing primary contact  
- Registered owners using the portal  

*Figures derive from the loaded register and portal usage—not from sample owner names in this document.*

---

# Admin — owner payment approvals

- Owners **cannot** post directly to the official ledger from their login  
- They **submit** a maintenance request with month and amounts  
- Admins **review, approve, or reject** in a dedicated queue  
- Months already recorded by admin are **locked** for duplicate owner submissions  

**Outcome:** audit-friendly flow and fewer data conflicts.

---

# Admin — maintenance collection & filters

**Filters**

- Financial year scope (multi-select for admin views)  
- **Owner portal financial year** selector (what owners see as “current” FY)  
- **Month-in-scope** multi-select (defaults to **all months** in the FY for new sessions)  

**KPI cards (for the selected scope)**

- Received amount  
- Expected amount  
- Pending / due amount  
- Late fee amount  

**Shortcuts:** lists of **payment-completed** and **payment-pending** owners  

---

# Admin — payments & ledger alignment

- **See payment** per plot: month-wise grid with paid, pending, or missed status; **total received**, **late fee received**, and counts  
- **Add payment** modal: per-plot, per-month amounts and late fees  
- **Bulk payment** flow for many plots in one month  
- **Backup to sheet** (when backend is configured): push stored payment history into **collection logs** and month archive tabs  
- **Plot directory** includes **total amount paid** aligned with the same rules as **See payment** (admin FY scope)  

---

# Admin — plot directory & access

**Table features**

- Search across columns  
- Filters: sold/unsold, contact present/absent, single- vs multi-plot owners  
- **Access** column: allow or deny owner login (with defaults tied to payment totals and overrides)  
- **Total amount paid** column (consistent with See payment totals)  
- Per-row actions: **add payment**, **see payment**  
- **Multi-plot owner** condensed view with chips per plot  

**Unsold plots:** admin path to **add or update** unsold rows and sync key fields to the workbook (where API is enabled)  

---

# Admin — banking & UPI

- **Society banking / UPI** details maintained centrally  
- **View** for quick reference; **edit** restricted to admin  
- Owners see the same information through their **Account & UPI** view (presentation differs for clarity)  

---

# Admin — notices

- Create and publish **society notices** (title, body, audience, optional attachment link)  
- Owners see an up-to-date **notices** list on their home page  
- Supports operational announcements without separate mailing tools  

---

# Admin — project documents

- Curate **project or society documents** (name, details, link)  
- **Owner view:** read-only list with optional engagement (e.g. appreciation counts where enabled)  
- Keeps drawings, guidelines, and handouts in one place  

---

# Admin — service contacts

- Maintain **vendors and service numbers** (electrician, plumber, security, etc.)  
- **Owner view:** same contacts for self-service coordination  
- Reduces ad-hoc phone lists and outdated PDFs  

---

# Owner portal — home & profile

- **Welcome strip** with context and optional guided tips  
- **Account & UPI details**  
- **Add payment** (opens request / approval flow, not direct ledger write)  
- **Profile:** change password, logout  
- **Messages inbox** (when the office posts items to the member): read state, mark read  

---

# Owner portal — notices & information

- **Notices** table: date, title, details, attachment  
- **Project documents** aligned with admin-published list  
- **Service contacts** for day-to-day society services  

---

# Owner portal — payments summary & history

- **Summary KPIs:** plots linked to the login, amounts paid, expected, pending, late fee — for the **active owner financial year**  
- **Footnotes** explain due dates and how totals combine when multiple plots share one login  
- **Interactive chart** of payment history (where data exists)  
- **Plot picker** when one mobile maps to **multiple plots**  

---

# Owner portal — plot detail & updates

- Read-only **plot and owner fields** from the register  
- **Update primary / alternate contact** where allowed; changes can sync to the workbook via the optional API  
- Transparency without exposing other households’ data  

---

# Cross-cutting services

- **Automatic refresh** of register data on a timer (configurable)  
- **Global loading** indicator for long operations  
- **Responsive layout** for phones and desktops  
- **Accessibility-minded** labels on primary controls  

---

# First-year enhancement programme (included)

Typical items covered under the **included first-year enhancement service** (subject to your agreement):

- Fine-tuning labels, defaults, and filter behaviour  
- Minor workflow tweaks (e.g. approval texts, banner copy)  
- Alignment of FY/month logic with society resolutions  
- Light UX polish after real-world committee feedback  

*Major new modules or third-party integrations are usually scoped separately.*

---

# Lifetime use — what “no premium” means

- **All features described in this deck** remain available without a subscription paywall for this deployment  
- **Hosting** on a suitable static tier is positioned as **no additional hosting fee** from this programme  
- **Ongoing infrastructure** (domain, spreadsheet quotas, any future server capacity) remains the society’s or host’s responsibility as per your setup  

---

# Summary

| Stakeholder | Value |
|-------------|--------|
| **Committee / admin** | Faster collections visibility, approvals, notices, documents, contacts |
| **Owners** | Clarity on dues, self-service requests, society information in one place |
| **Society** | No premium tier for core features; first-year enhancement included; lifetime use of delivered scope |

---

# Thank you

**Infinity Nakshatra Society — Resident & Maintenance Portal**  
Operational clarity • Owner convenience • Sustainable, transparent maintenance management  

*This deck describes product capabilities only. It contains no personal data, plot identifiers, screenshots, or implementation source code.*
