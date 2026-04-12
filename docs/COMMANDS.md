# Housing Bot — Slash command reference

This document describes every slash command registered by `scripts/commands/` (built in `scripts/commands/index.js`). Permissions use Discord’s **Manage Roles** / **Administrator** defaults where set; the bot also checks **named roles** in your server (see **Access levels**).

---

## Access levels (bot role names)

The bot maps power using **role IDs** (recommended) or **exact role names** (fallback). See `scripts/lib/permissions.js`.

| Level | Default role name (if no IDs) | Env for IDs (comma‑separated) |
|-------|-------------------------------|--------------------------------|
| 1 PM  | `[PM BOT ACCESS]`             | `BOT_ROLE_PM_ID`               |
| 2 Staff | `[STAFF BOT ACCESS]`        | `BOT_ROLE_STAFF_ID`            |
| 3 Manager | `[MANAGER BOT ACCESS]`    | `BOT_ROLE_MANAGER_ID`          |
| 4 Admin | `[ADMIN BOT ACCESS]`        | `BOT_ROLE_ADMIN_ID`            |

- **Name overrides** (when no IDs for that tier): `BOT_ROLE_PM_NAME`, `BOT_ROLE_STAFF_NAME`, etc.
- **Owner**: `BOT_OWNER_IDS` — comma‑separated user IDs for owner-only commands.
- **Booster+**: optional `BOT_ROLE_BOOSTER_NAME` for some read-only tier commands.
- **Applicant** (for `/deny`): `BOT_ROLE_APPLICANT_ID` (comma‑separated) or `BOT_ROLE_APPLICANT_NAME` (default `[APPLICANT]`).

Commands below say **Staff+** meaning `requireLevel(2)`, **Manager+** = 3, **Admin+** = 4, **Owner** = `BOT_OWNER_IDS`.

---

## Export this file to PDF

- **VS Code / Cursor**: Open this file → Print → **Save as PDF**.
- **macOS Preview**: Open Markdown in an app that renders it, then Print → PDF.
- **npm** (requires [Pandoc](https://pandoc.org/) on your PATH):  
  `npm run docs:pdf` → writes `housing-bot-commands.pdf` in the repo root.
- **CLI**: `pandoc docs/COMMANDS.md -o housing-bot-commands.pdf`

---

## Applications & eligibility

### `/check`

- **Description**: Check if a player is eligible for a tryout/application for a given rank ladder.
- **Default permission**: None at the Discord level (the bot requires **PM+** by role).
- **Options**:
  - `ign` (string, required) — Minecraft IGN, or **UUID** when the value is longer than 16 characters (passed to Hypixel as `name` vs `uuid`).
  - `discord` (user, required) — linked Discord account (cooldown + applicant role).
  - `rank-type` (choice, required) — `Prime` | `Elite` | `Apex` (must match the ladder you’re checking).
- **Behavior**: Calls the **Hypixel** `GET /v2/player` API (`HYPIXEL_API_KEY`) using `player.networkExp` and the standard formula for **network level**. When the API **succeeds**, players must be **network level 30+** with a real profile or the check is **not eligible** (red). When the API **fails** (HTTP errors, rate limits, missing key, bad JSON, etc.), **Hypixel is not enforced** for that run — pass/fail follows only the other rules below, and an embed field tells staff to use **`/hypixel`** to verify level manually. Then queries `blacklists` (active: no expiry or expiry in the future), `admin_blacklists` (non‑pardoned), timeouts, alts, latest `tier_results` per ladder, and **application denial cooldown** (`application_denials` for that Discord user). **Blacklist / admin blacklist / denial cooldown** set **not eligible** (red). Other notes (timeout, “applying below current ladder”) can yield **eligible with warnings** (amber). **Known alts** are not included in the public embed; the invoker gets an **ephemeral** follow-up with alt details (PM+ and Staff+). **PM-only** runners get an extra line instructing them to **ping a Manager** and include that information. Full pass (green) assigns the applicant role when configured (including when the only extra context was alts).

### `/hypixel`

- **Description**: Staff-only lookup of **Hypixel network level** for an IGN or UUID (same API as `/check`).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (string, required) — Minecraft IGN, or UUID when longer than 16 characters.
- **Behavior**: Ephemeral reply. Uses `HYPIXEL_API_KEY` and shows calculated network level, “no profile”, or the API error text.

### `/deny`

- **Description**: Deny an application: records cooldown, removes applicant role if present.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `ign` (string, required)
  - `discord` (user, required)
  - `type` (choice, required) — `Prime (1 week)` | `Elite (2 weeks)` | `Apex (3 weeks)` — sets cooldown length.
- **Behavior**: Upserts `application_denials` for `(discord_id, rank_type)`. Removes role named `BOT_ROLE_APPLICANT_NAME`. Must be used **in a server** (needs guild + member).

---

## Fights & scores

### `/score`

- **Description**: Log a fight result to the database.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `winner-ign`, `loser-ign` (string, required)
  - `final-score` (string, required) — e.g. `10-8`
  - `fight-number` (integer, required)
  - `fight-type` (choice, required) — Prime | Elite | Apex
- **Behavior**: Inserts into `scores` (`RETURNING *`). Reply embed matches the **fight log** format plus **Fight ID** for staff. Sends a **second message** (no ping) to the fight log channel: embed **Fight Score Logged** (green), winner head thumbnail via `https://minotar.net/helm/<winner>/64.png`, fields Winner / Loser / Score / Fight # / Fight Type / Date — see `scripts/lib/fightScoreLogEmbed.js`. Channel: `FIGHT_SCORE_LOG_CHANNEL_ID` (default in code if unset).

### `/fighthistory`

- **Description**: Paginated fight history (15 fights per page) plus career W/L and win rate.
- **Options**:
  - `ign` (string, required)
  - `page` (integer, optional, min 1)
  - `debug` (boolean, optional) — staff: show DB fight IDs on rows
- **Behavior**: Embed + **Previous / Next** buttons to change page.

### `/updatescore`

- **Description**: Correct a miscored fight (admin or owner only).
- **Default permission**: Administrator.
- **Options**:
  - `id` (integer, required) — **Fight ID** from `/score` (`scores.id`).
  - `winner-ign`, `loser-ign`, `final-score` (optional) — at least one field required to update.
- **Behavior**: Updates `scores`. Sends a **Fight Score Edited** embed to the same fight log channel (no ping); reply is a short confirmation only.

### `/voidscore`

- **Description**: Mark a fight as voided (`is_voided = true`) — excluded from stats; row **remains** in the DB.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `id` (integer, required) — `scores.id`.

### `/deletescore`

- **Description**: **Permanently delete** a row from `scores` (admin or owner only).
- **Default permission**: Administrator.
- **Options**:
  - `id` (integer, required) — `scores.id`.

---

## Tier lists

Tier letter grades are defined in `VALID_TIERS` (`scripts/lib/helpers.js`): `S`, `A+`, `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `C-`, `D`, `N/A`.

### `/primerate` / `/eliterate` / `/apexrate`

- **Description**: Submit a tier rating for Prime / Elite / Apex.
- **Default permission**: Manage Roles (**Manager+**).
- **Options**:
  - `ign` (string, required)
  - `tier` (string, required) — must match `VALID_TIERS`.
  - `discord` (user, required)
- **Behavior**: Deletes any existing `tier_results` row for the same `ign` + ladder, then inserts the new row; appends `tier_history`. Refreshes the **public tier list** message (see below).

### `/submit`

- **Description**: Submit a tier result (unified command; same data model as rate commands).
- **Default permission**: Manage Roles (**Manager+**).
- **Options**:
  - `ign` (required)
  - `type` (choice) — Prime (`P`) | Elite (`E`) | Apex (`A`)
  - `tier` (choice, required) — **dropdown** of all `VALID_TIERS` (not free text).
  - `discord` (user, required)
- **Behavior**: Same replace‑then‑insert as above; refreshes public tier list.

### `/viewtier`

- **Description**: View current tier rows for an IGN (one row per ladder when duplicates were cleaned up).
- **Permission**: PM+ or booster role (see `hasBoosterOrAbove`).
- **Options**: `ign` (required)
- **Behavior**: One line per ladder: **ladder name** and **tier** only (no dates).

### `/profile`

- **Description**: **Public** compact snapshot for an IGN — same general size as **`/fighthistory`**: **last 8** fights in the embed body, **W/L**, **win rate** (with **average points scored per fight** when `final_score` parses), **total fights** inline, **one tier line** (latest `tier_results` row: ladder + label, or *Not placed in a tier*), and **tryout cooldown: Yes/No** (active application cooldown only). Does **not** include blacklists, admin blacklists, timeouts, alts, or other hidden moderation flags.
- **Default permission**: None (any member can run it; reply is **not** ephemeral).
- **Options**: `ign` (required)

### `/removetier`

- **Description**: Remove the current tier entry for one ladder for that IGN.
- **Default permission**: Manage Roles (**Manager+**).
- **Options**:
  - `ign` (string, required)
  - `type` (choice, required) — Prime | Elite | Apex
- **Behavior**: `DELETE FROM tier_results` for that `ign` + P/E/A. Refreshes public tier list.

### `/tierids`

- **Description**: List database IDs for `tier_results` and `tier_history` for an IGN (staff tooling).
- **Default permission**: Manage Roles (**Manager+**).
- **Options**: `ign` (required)

### `/tierlist`

- **Description**: Show tier list for one fight type (in the command reply).
- **Permission**: Booster+ or PM+.
- **Options**: `type` — Prime | Elite | Apex

### Public tier list channel (auto + owner refresh)

- **Channel**: `TIERLIST_PUBLIC_CHANNEL_ID` or `TIERLIST_CHANNEL_ID` (see **Environment variables**). Default channel id is set in `scripts/lib/tierListChannelSync.js` if unset.
- **Layout**: **One message** with **three embeds**, top to bottom: **Apex** → **Elite** → **Prime**. Each embed uses bucketed **S / A / B / C / D** sections with `yaml` lists (see `buildTierListEmbedDescription`).
- **Updates**: On `/submit`, `/primerate`, `/eliterate`, `/apexrate`, and `/removetier`, the bot **deletes** previously tracked message(s) in that channel and **posts a new message** (avoids Discord’s “(edited)” tag). Message id is stored in `tier_list_messages` (`position = 0`).
- **Deduping**: Before insert, old `tier_results` row for the same normalized IGN + ladder is removed so each player appears once per ladder. Reads use `DISTINCT ON` where needed for legacy duplicate rows.

### `/publictierlistupdate`

- **Description**: Owner-only manual refresh of the public tier list message(s) in the configured channel (same delete + repost flow as above).
- **Permission**: **Owner** only.
- **Options**: `channel-id` (optional) — overrides env default for that run.

---

## Blacklists & reports

### `/blacklist`

- **Description**: Add a row to `blacklists`.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `ign`, `reason` (required)
  - `duration` (optional) — e.g. `7d`, `24h`, `permanent`; blank = permanent.

### `/viewblacklist`

- **Description**: Recent blacklist rows for an IGN.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (required)

### `/adminblacklist`

- **Description**: View `admin_blacklists` (optionally filter by IGN).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (optional)

### `/pardon`

- **Description**: Remove or pardon a blacklist row by **table + row id**.
- **Default permission**: Administrator.
- **Options**:
  - `table` — `blacklists` (delete row) | `admin_blacklists` (set `is_pardoned`)
  - `id` (integer, required) — primary key of that table.

### `/report`

- **Description**: Anyone can file a report (no staff level check in handler).
- **Options**: `ign`, `reason` (required)
- **Behavior**: Inserts into `reports` with reporter Discord id.

### `/bancheck`

- **Description**: List recent reports for an IGN.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (required)

### `/acceptreport`

- **Description**: Update a report row by id.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `id` (integer, required) — `reports.id`
  - `reason` (string, required)
  - `punishment-issued` (boolean, required)

---

## Punishments & queue

### `/log`

- **Description**: Create a punishment log and enqueue for manager review.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `user-ign`, `details` (required)
  - `evidence` (optional) — if provided, must include at least one `http://` or `https://` link (shown as links in `/checkqueue`).
  - `cooldown` (optional) — one unit after manager accept: `d` days, `h` hours, `m` minutes (e.g. `1d`, `12h`, `1m`). Used to schedule the **unban reminder** ping when the period ends (not on accept).

### `/history`

- **Description**: Combined **punishment** and **blacklist** history for an IGN (merged, newest first).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (required)

### `/getproof`

- **Description**: Full punishment details and evidence for an IGN.
- **Default permission**: Manage Roles (**Manager+**).
- **Options**: `ign` (required)

### `/totalhistory`

- **Description**: Aggregate punishment counts by status.
- **Default permission**: Manage Roles (**Staff+**).

### `/boosterpuncheck`

- **Description**: List active manager-approved punishments.
- **Default permission**: Manage Roles (**Staff+**).

### `/checkqueue`

- **Description**: Manager review of pending `/log` items: **paged** embed (Previous / Next) with **Accept** / **Deny** buttons. Ephemeral to the invoker.
- **Default permission**: Manage Roles (**Manager+**).
- **Behavior**: **Accept** sets `punishment_logs` active and schedules `reversal_remind_at` from `cooldown_raw` if set. **Deny** voids the log. No channel ping on accept.

### `/removepunishment`

- **Description**: Delete a punishment log by id (and linked queue row).
- **Default permission**: Manage Roles (**Manager+**).
- **Options**: `id` (integer) — id shown in `/history`.

### Punishment ended pings (background)

- **Poller** (`scripts/lib/punishmentExpiryPoller.js`): when `reversal_remind_at` passes, posts **Punishment expired** to the pings channel (embed with details, no evidence; embed field **Punishment ended** for the reminder time). Configure **`PUNISHMENT_PINGS_CHANNEL_ID`** or **`PINGS_CHANNEL_ID`**. Role: **`PUNISHMENT_STAFF_ROLE_ID`** or **`STAFF_PING_ROLE_ID`**. Rows are claimed atomically; deleted logs do not ping.

---

## PM list

### `/pmlist`

- **Description**: Lists PMs grouped by manager type (Prime / Elite / Apex / N/A).
- **Permission**: **Everyone** (no Discord permission gate; no bot role check).

### `/addpm`

- **Description**: Add a PM row.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `ign` (required)
  - `manager-type` (optional) — Prime | Elite | Apex | N/A
  - `ping`, `uuid` (optional)

### `/editpm`

- **Description**: Update ping and/or manager type by IGN.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `ign` (required)
  - `ping` (optional)
  - `manager-type` (optional) — at least one of ping or manager-type required.

### `/deletepm`

- **Description**: Delete PM row(s) matching IGN (admin/owner in code).
- **Default permission**: Administrator.
- **Options**: `ign` (required)
- **Behavior**: Ephemeral reply.

### `/pmstats`

- **Description**: Fight stats (W/L, win rate) for an IGN from `scores`.
- **Default permission**: Manage Roles (**PM+**).
- **Options**:
  - `ign` (required)
  - `start-date`, `end-date` (optional) — filter `scores.created_at`
  - `debug` (optional, boolean) — **Staff+** only: **ephemeral** embed with extra breakdowns (margin PM−opp avg/median in wins vs losses, average PM/opponent/total points per fight where `final_score` parses as `winner–loser`, W/L and win% **by fight type** (Prime / Elite / Apex), current and best win/loss streaks, first/last fight dates). Up to **3000** fights loaded.

---

## Alts

### `/addalt`

- **Description**: Link an alt IGN to an original.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `original-ign`, `alt-ign` (required)

### `/viewalts`

- **Description**: Rows in `alts` touching this IGN.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (required)
- **Behavior**: Ephemeral reply (only you see the list).

### `/deletealt`

- **Description**: Delete **one** alt link by `alts.id` (the number shown on `/viewalts` lines).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `id` (integer, required)
- **Behavior**: Ephemeral confirmation.

### `/clearalt`

- **Description**: Delete **all** alt rows where `original_ign` matches.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `original-ign` (required)

### `/editalt`

- **Description**: Edit one alt row **by database id** (`alts.id` — use `/viewalts` for `#id`).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `id` (integer, required)
  - `new-original-ign`, `new-alt-ign` (optional) — at least one required.

### `/whitelist`

- **Description**: Set `is_whitelisted` on alts for an original IGN; may insert `original_whitelist`.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign`, `whitelisted` (boolean, required)

---

## Watchlist

### `/watchlist`

- **Description**: Add or remove watchlist entries (**Admin/owner** in code).
- **Default permission**: Administrator (slash default; handler checks admin/owner).
- **Subcommands**:
  - `add` — `ign`, `reason`, `threat-level` (Low | Medium | High)
  - `remove` — `ign`

### `/viewwatchlist`

- **Description**: List watchlist (up to 50 rows).
- **Default permission**: Manage Roles (**Manager+**).

---

## Proxies & UUID

### `/proxies`

- **Description**: Show recent proxy list entries (up to 50).
- **Permission**: No extra level check (anyone who can run the command).

### `/addproxy`

- **Description**: Add a proxy string to `proxies`.
- **Permission**: Admin or owner in code.

### `/edituuid`

- **Description**: Insert or update `uuid_registry` for an IGN.
- **Default permission**: Administrator (**Admin/owner** in handler).

### `/removeuuid`

- **Description**: Delete UUID row(s) for an IGN.
- **Default permission**: Administrator.

---

## Role blacklist

### `/roleblacklist`

- **Description**: Insert `role_blacklists` row.
- **Permission**: Admin/owner.
- **Options**:
  - `ign`, `role-type` (string, required — no fixed choices in code), `reason` (required)
  - `user` (optional) — Discord user to store id

### `/viewroleblacklist`

- **Description**: Recent role blacklist rows.
- **Permission**: Admin/owner.

---

## Utility (owner / staff)

### `/update`

- **Description**: Rename an IGN across many tables (blacklists, scores, tiers, PM list, `application_denials`, etc.) in one transaction.
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `old-ign`, `new-ign` (required)

### `/find`

- **Description**: Search a few tables by IGN substring.
- **Permission**: **Owner** only.
- **Options**: `query` (required)

### `/errorcheck`

- **Description**: Sanity checks (e.g. empty IGN rows); respects `flagged_errors`.
- **Permission**: **Owner** only.

### `/removeflag`

- **Description**: Add a row to `flagged_errors` to ignore an entry in `/errorcheck`.
- **Permission**: **Owner** only.
- **Options**: `database`, `entry-id` (required)

---

## Discord extras

### `/revokeargument`

- **Description**: Discord **timeout** the user for 10 minutes (moderation).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `user` (required)
- **Note**: Needs **Server Members Intent** if member not cached.

### `/gradientrequests`

- **Description**: List pending `gradient_requests`.
- **Default permission**: Manage Roles (**Staff+**).

---

## Meta

### `/checkcommands`

- **Description**: Ephemeral-style help listing commands available to **your** current role level.
- **Permission**: Everyone who can invoke it.

### `/help`

- **Description**: Generic help text; uses `HELP_STAFF_ROLE_ID` and `HELP_CHANNEL_ID` if set in `.env`.

---

## Environment variables (quick reference)

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Discord bot token |
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_SSL` | Optional: `true` / `false` for pool TLS (see `scripts/lib/pool.js`) |
| `GUILD_ID` | If set, guild-scoped slash commands (instant update) |
| `CLEAR_GLOBAL_COMMANDS` | When using `GUILD_ID`, clear global commands unless `false` |
| `BOT_OWNER_IDS` | Comma-separated user IDs (owner-only commands) |
| `BOT_ROLE_PM_ID`, `BOT_ROLE_STAFF_ID`, `BOT_ROLE_MANAGER_ID`, `BOT_ROLE_ADMIN_ID` | Comma-separated role snowflakes per tier (recommended) |
| `BOT_ROLE_APPLICANT_ID` | Applicant role id(s) for `/deny` |
| `BOT_ROLE_*_NAME` | Override role **names** when no IDs set for that tier |
| `BOT_ROLE_BOOSTER_NAME` | Optional booster role for `/tierlist` / `/viewtier` |
| `ENABLE_GUILD_MEMBERS_INTENT` | `true` if using privileged member fetch |
| `FIGHT_SCORE_LOG_CHANNEL_ID` | Channel for **Fight Score Logged** / **Fight Score Edited** embeds from `/score` and `/updatescore` |
| `TIERLIST_PUBLIC_CHANNEL_ID` | Public tier list channel (preferred); falls back to `TIERLIST_CHANNEL_ID` |
| `TIERLIST_CHANNEL_ID` | Legacy fallback for tier list channel |
| `PUNISHMENT_PINGS_CHANNEL_ID` or `PINGS_CHANNEL_ID` | Channel for **punishment ended** (scheduled reminder) pings |
| `PUNISHMENT_STAFF_ROLE_ID` or `STAFF_PING_ROLE_ID` | Role to @mention when a punishment reminder fires |
| `ACCEPT_NOTIFY_CHANNEL_ID` | Channel for **Rank Request** embed when staff uses `/accept` |
| `ACCEPT_PING_ROLE_ID` | Optional: role to @mention on `/accept` (overrides rank-request ping) |
| `RANK_REQUEST_PING_ROLE_ID` | Role to @mention on `/accept` if `ACCEPT_PING_ROLE_ID` unset (defaults in code to the server’s rank-request role) |
| `HELP_STAFF_ROLE_ID`, `HELP_CHANNEL_ID` | `/help` mentions |
| `CHECK_LEVELBOT_MESSAGE`, `CHECK_LEVELBOT_WHEN` | Optional extra channel message after `/check` (`always` / `pass` / `fail`) |
| `HYPIXEL_API_KEY` | Hypixel API key for `/check` network level (30+) verification |
| `BOT_SHOW_ERRORS` | Include error detail in generic failure message |

---

## Command count

**60+** distinct top-level slash commands (including subcommands such as `watchlist add/remove`). Re-register commands after code changes (`node scripts/index.js` or your deploy process).

---

*Generated from the housing-bot codebase. Behavior matches `scripts/commands/*` at time of writing.*
