# Material Usage Log

A small website for the team to record material usage: **material code, lot, quantity, date used, shift (1/2/3), which production lines** (multi-select), **who entered it, and optional notes**. A **Copy table** button puts the current view on the clipboard as a table — paste it straight into an email for management approval, or into Excel. Each entry also has a **checkmark** to track which discrepancies are being rectified. The full item list — 3,273 material codes and descriptions from the BOM / MAS item list — is built in, so the description fills itself when a code is picked.

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
2. **Lot code** — e.g. `S340C` (optional — leave blank if there isn't one).
3. **Quantity** — e.g. `250`.
4. **When used** — defaults to today.
5. **Shift** — tap **1**, **2**, or **3**.
6. **Lines** — tap every line it applies to, e.g. **Processing B** and **Processing C**.
7. **Entered by** — your name (remembered on your device after the first save).
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
     add column if not exists rectified boolean not null default false;

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

## Updating the item list

New material in the system? Open `materials.js` and add a line inside the big quoted block, in the same format as the others: the code, a tab (`\t`), then the description. Commit and push — the search picks it up immediately. (Unlisted codes can still be logged in the meantime; they're just flagged "not in item list.")

## Production lines covered

Aerosol A–D · Pops A–E · Rainbow (Drinks) · Gallon · 2.5 Gallon · Processing A–D · Pops Processing · Drinks Processing.

To change these, edit `LINE_GROUPS` near the top of `app.js`.
