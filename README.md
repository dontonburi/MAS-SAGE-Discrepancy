# Material Usage Log

A small website for the team to record material usage: **material code, lot, quantity, date used, shift (1/2/3), which production lines** (multi-select), **who entered it, and optional notes**. The log is grouped by the day entries were added, each with a day checkbox — tick a day (or individual rows) and **Copy table** copies just those (or the whole view if nothing is ticked) as a table — paste it straight into an email for management approval, or into Excel. Each entry also has a **checkmark** to mark discrepancies as rectified — rectified rows show struck through. The full item list — 4,214 material codes and descriptions from the BOM / MAS item list — is built in, so the description fills itself when a code is picked.

No build tools, no frameworks to install. Plain HTML/CSS/JS — push it and it runs.

## What's in this repo

| File | What it does |
|---|---|
| `index.html` | The page |
| `styles.css` | The look |
| `app.js` | All the behavior (search, line board, log, CSV export) |
| `materials.js` | The item list (code + description, one per line) |
| `config.js` | Optional shared-database settings (see below) |

## Run it

**Locally:** just double-click `index.html` — it opens and works in any browser.

**On GitHub Pages (so the team can open it from a link):**

1. Create a new repository on github.com (e.g. `material-usage-log`). Public repos get free GitHub Pages.
2. From this folder, run:

   ```bash
   git init
   git add .
   git commit -m "Material usage log"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/material-usage-log.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Branch: `main` / (root) → Save**.
4. After a minute the site is live at `https://YOUR-USERNAME.github.io/material-usage-log/`. Share that link with the team.

## How an entry is filled

1. **Material** — type `10498` *or* "granulated sugar" and pick the match (code + description lock in together).
2. **Lot code** — e.g. `S340C` (optional). If the lot isn't defined yet, enter the **PO #** instead — the log shows whichever one exists.
3. **Quantity** — e.g. `250`.
4. **When used** — defaults to yesterday (the production day being reported).
5. **Shift** — tap **1**, **2**, and/or **3** — all that apply.
6. **Lines** — tap every line it applies to, e.g. **Processing B** and **Processing C**.
7. **Entered by** — pick your name from the list, or choose "Other" and type it. Remembered on your device after the first save. (To change the roster, edit the `TEAM` list at the top of `app.js`.)
8. **Notes** — optional, anything worth remembering about the entry.
9. **Save entry.**

There's a **Load example** button in the app that fills the form exactly like this.

## Where the records go

**Out of the box** entries save in each person's browser (`localStorage`). That's fine if everyone logs from **one shared computer**, but entries won't sync between devices, and clearing browser data erases them — so export to CSV regularly.

**For a true shared team log** (everyone sees the same records from any device), connect a free [Supabase](https://supabase.com) database — about 10 minutes, one time:

1. Sign up at supabase.com and create a new project (free tier is plenty).
2. In the project, open **SQL Editor**, paste this, and click **Run**:

   ```sql
   create table if not exists usage_entries (
     id uuid primary key default gen_random_uuid(),
     code text not null,
     description text not null,
     qty numeric not null,
     used_on date not null,
     lines text[] not null,
     created_at timestamptz not null default now()
   );

   alter table usage_entries
     add column if not exists lot text,
     add column if not exists shift smallint,
     add column if not exists entered_by text,
     add column if not exists note text,
     add column if not exists rectified boolean not null default false,
     add column if not exists shifts smallint[],
     add column if not exists po text;

   alter table usage_entries enable row level security;

   drop policy if exists "team read"   on usage_entries;
   drop policy if exists "team insert" on usage_entries;
   drop policy if exists "team delete" on usage_entries;
   drop policy if exists "team update" on usage_entries;

   create policy "team read"   on usage_entries for select using (true);
   create policy "team insert" on usage_entries for insert with check (true);
   create policy "team delete" on usage_entries for delete using (true);
   create policy "team update" on usage_entries for update using (true) with check (true);
   ```

   This script is safe to run repeatedly — on a brand-new project or an existing table. It never
   deletes data; it only creates whatever is missing.

4. Paste both into `config.js`, commit, and push. Done — the header pill switches to **"Live shared log."**


Notes on that setup:

- The `anon` key is designed to be public (it ends up in the browser either way); access is controlled by the policies above.
- Those policies let **anyone who has your site URL** add or delete entries — same as a shared clipboard on the floor. Keep the link internal. If you later want logins or read-only viewers, Supabase Auth can be added on top.
- Records can always be pulled back out with the **Export CSV** button, filtered or in full.

## Paperwork compliance page

`compliance.html` is a second page for logging documentation errors — date of production, shift (one per record, so blame lands cleanly), lines involved, and type of error (editable list at the top of `compliance.js`, plus an "Other" option). The scoreboard above the records shows totals by shift, by error type, and by line, plus a week-by-week matrix per shift so improvement is visible over time; **Copy summary** puts that matrix on the clipboard as a paste-ready table. CSV export (full history) uses the same password as the usage log. **Drag an email onto the entry form** (.eml — new Outlook / Outlook web: &#8943; &rarr; Download) and it auto-fills the date, shift, lines, and error type from the message, keeps the subject as the note, and stages any attached images; they upload to a Supabase Storage bucket on save. Dropping image files directly also works. Click any record row to see the full email details and images. A ready-made `sample-error-email.eml` is in the repo for testing the flow. Records live in their own table — run this once in the Supabase SQL Editor:

```sql
create table if not exists compliance_entries (
  id uuid primary key default gen_random_uuid(),
  prod_date date not null,
  shift smallint not null,
  lines text[] not null,
  error_type text not null,
  note text,
  created_at timestamptz not null default now()
);

alter table compliance_entries enable row level security;

drop policy if exists "team read"   on compliance_entries;
drop policy if exists "team insert" on compliance_entries;
drop policy if exists "team delete" on compliance_entries;

create policy "team read"   on compliance_entries for select using (true);
create policy "team insert" on compliance_entries for insert with check (true);
create policy "team delete" on compliance_entries for delete using (true);

alter table compliance_entries
  add column if not exists attachments jsonb,
  add column if not exists detail text;

insert into storage.buckets (id, name, public)
values ('compliance', 'compliance', true)
on conflict (id) do nothing;

drop policy if exists "compliance read"   on storage.objects;
drop policy if exists "compliance upload" on storage.objects;
create policy "compliance read"   on storage.objects for select using (bucket_id = 'compliance');
create policy "compliance upload" on storage.objects for insert with check (bucket_id = 'compliance');
```

## Material summary page (password protected)

`summary.html` breaks the usage log down by material type and product line. It is **not** linked into the log's contents and asks for the same password as the CSV export before showing anything, because it displays costs.

Categories come from the item description prefix: `PK` packaging and `IN` ingredients, then the product line — A aerosol, P pops, D drinks, W water (plus any other letters in use, shown as-is until named). The parser tolerates the messy real-world variants (`IN_A_...`, `PK- A- ...`, `IN-A 3 Fold Vanilla`), and a short override list catches materials that predate the convention (city/spring/distilled water, pallets and CHEP). Anything else — mostly finished goods — is counted honestly as "Unclassified" rather than guessed at. To name a category or add an override, edit the top of `taxonomy.js`.

The top of the page is a compact dashboard: a single row of headline numbers, a stacked bar for packaging vs ingredients, a stacked bar by product line, and a sparkline of the monthly trend. **Everything there is clickable** — pick a colour or a label (or a row in the month table) and the whole page drills into that slice: the tables, the trend, the CSV, and the one-page report all follow. Filters stack, so Packaging + Aerosol shows just that combination; the amber "Filtered to" chip says what is applied and clears it. The bars keep showing the full period while filtered, so context isn't lost.

Below that: a **month-over-month** table where each month is compared with the one before it (▲ up, ▼ down, with the percentage); a week-by-week table (Monday–Sunday, by production date); and the 15 most-affected items.

**One-page report** builds a printable summary of whatever filter is currently applied — period and count/value toggle included — and opens the browser print dialog, where "Save as PDF" produces a file to email or file away. It fits a single portrait page: headline numbers, packaging vs ingredients, product-line split, the last six months with their change, and the top ten items. Nothing else on the page prints. A toggle switches every number between **count of entries** and **value in dollars**, and entries whose item has no unit cost on file are reported as a count rather than silently treated as $0. Copy summary puts the weekly table on the clipboard; Export CSV writes the whole breakdown.

## Drop an email onto the compliance form

Drag a saved email file onto the dashed box on the compliance page and it reads the message, prefills date of production, shift, lines, and error type from the subject/body, puts the subject in the note, and stages the attached images (tiny signature logos are ignored). Review, adjust, Save. Clicking any record (or its **View** button) opens the details: the email's sender, subject, and body, plus the attached photos.

Getting the file out of Outlook: the desktop app won't hand a file to the browser directly — **drag the email to your Desktop first** (that creates a `.msg` file), then drag that file into the page. "Save As" works too. Outlook on the web downloads `.eml`, which also works, and you can drop plain images or PDFs to attach them without an email. `sample-error-email.eml` in this repo is a working example to try.

Attachments upload to a **public** Supabase Storage bucket — anyone with a file's link can open it, so treat it like the rest of this app: fine for the floor, not for secrets. In device-only mode, files are kept inside the browser and capped at 400 KB each. Run this once in the SQL Editor to add the columns and the bucket:

```sql
alter table compliance_entries
  add column if not exists details jsonb,
  add column if not exists files jsonb;

insert into storage.buckets (id, name, public) values ('compliance-files','compliance-files', true)
on conflict (id) do nothing;

drop policy if exists "compliance files read"   on storage.objects;
drop policy if exists "compliance files insert" on storage.objects;
drop policy if exists "compliance files delete" on storage.objects;

create policy "compliance files read"   on storage.objects for select using (bucket_id = 'compliance-files');
create policy "compliance files insert" on storage.objects for insert with check (bucket_id = 'compliance-files');
create policy "compliance files delete" on storage.objects for delete using (bucket_id = 'compliance-files');
```

## Updating the item list

New material in the system? Open `materials.js` and add a line inside the big quoted block, in the same format as the others: the code, a tab (`\t`), then the description. Commit and push — the search picks it up immediately. (Unlisted codes can still be logged in the meantime; they're just flagged "not in item list.")

## Filters, prices, and the export password

The log filters by search, production date, status, name, and line. The default status view ("Open + rectified") shows every open entry plus rectified entries from the last 3 days — so once everything is resolved, it reads as all records from the last 3 days. "Open only" and "Resolved only" each show the complete history for that status, and the CSV export always contains everything. Item unit costs can be stored as a hidden third column in `materials.js` (`CODE<TAB>DESC<TAB>PRICE`) — they never appear on screen or in Copy table; only the CSV export and the password-protected summary page include them. Costs come from the `AverageUnitCost` column of a CI_Item export.

**Export CSV always contains the complete history** — every entry ever logged, ignoring the on-screen filters — and asks for a password before downloading. The password lives in `config.js` (`EXPORT_PASSWORD`; blank turns it off). It deters casual clicks, but anyone reading the page source can find it. Copy table follows the current view/selection and is not password-gated.

## Production lines covered

Aerosol A–D · Pops A–E · Rainbow (Drinks) · Gallon · 2.5 Gallon · Processing A–D · Pops Processing · Drinks Processing.

To change these, edit `LINE_GROUPS` near the top of `app.js`.
