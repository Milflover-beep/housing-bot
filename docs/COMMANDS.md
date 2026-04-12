# Housing Bot — Slash command reference

This document describes every slash command registered by `scripts/commands/` (built in `scripts/commands/index.js`). Permissions use Discord’s **Manage Roles** / **Administrator** defaults where set; the bot also checks **named roles** in your server (see **Access levels**).

---

## Access levels (bot role names)

The bot maps power using roles whose **names** must match (override with `BOT_ROLE_*_NAME` in `.env`):

| Level | Default role name        | Env override example      |
|-------|--------------------------|---------------------------|
| 1 PM  | `[PM BOT ACCESS]`        | `BOT_ROLE_PM_NAME`        |
| 2 Staff | `[STAFF BOT ACCESS]`   | `BOT_ROLE_STAFF_NAME`     |
| 3 Manager | `[MANAGER BOT ACCESS]` | `BOT_ROLE_MANAGER_NAME` |
| 4 Admin | `[ADMIN BOT ACCESS]`   | `BOT_ROLE_ADMIN_NAME`     |

- **Owner**: user IDs in `BOT_OWNER_IDS` — treated as owner for owner-only commands.
- **Booster+**: optional `BOT_ROLE_BOOSTER_NAME` for some read-only tier commands.
- **`/deny` applicant role**: `BOT_ROLE_APPLICANT_NAME` (default `[APPLICANT]`) — must match the role name in Discord exactly.

Commands below say **Staff+** meaning `requireLevel(2)`, **Manager+** = 3, **Admin+** = 4, **Owner** = `BOT_OWNER_IDS`.

---

## Export this file to PDF

- **VS Code / Cursor**: Open this file → Print → **Save as PDF**.
- **macOS Preview**: Open Markdown in an app that renders it, then Print → PDF.
- **Pandoc** (if installed):  
  `pandoc docs/COMMANDS.md -o housing-bot-commands.pdf`

---

## Applications & eligibility

### `/check`

- **Description**: Check if a player is eligible for a tryout/application for a given rank ladder.
- **Default permission**: Manage Roles (bot also requires **Staff+**).
- **Options**:
  - `ign` (string, required) — Minecraft IGN.
  - `discord` (string, required) — Discord user ID or mention (used for cooldown and context).
  - `rank-type` (choice, required) — `Prime` | `Elite` | `Apex` (must match the ladder you’re checking).
- **Behavior**: Queries blacklists, admin blacklists, timeouts, alts, existing `tier_results` for that ladder, and **application denial cooldown** (`application_denials` by Discord ID + ladder). Builds an embed: eligible / not eligible / eligible with notes.

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
- **Behavior**: Inserts into `scores`. Reply includes **Fight ID** (`scores.id`) for `/updatescore` and `/voidscore`.

### `/fighthistory`

- **Description**: Paginated fight history (15 fights per page) plus career W/L and win rate.
- **Options**:
  - `ign` (string, required)
  - `page` (integer, optional, min 1)
- **Behavior**: Embed + **Previous / Next** buttons to change page.

### `/updatescore`

- **Description**: Correct a miscored fight (Admin/owner only in code).
- **Default permission**: Administrator.
- **Options**:
  - `id` (integer, required) — **Fight ID** from `/score` (`scores.id`).
  - `winner-ign`, `loser-ign`, `final-score` (optional) — at least one field required to update.

### `/voidscore`

- **Description**: Mark a fight as voided (excluded from stats).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**:
  - `id` (integer, required) — `scores.id`.

---

## Tier lists

### `/primerate` / `/eliterate` / `/apexrate`

- **Description**: Submit a tier rating for Prime / Elite / Apex.
- **Default permission**: Manage Roles (**Manager+**).
- **Options**:
  - `ign` (string, required)
  - `tier` (string, required) — must be a valid tier (`VALID_TIERS` in code).
  - `discord` (user, required)
- **Behavior**: Inserts into `tier_results` and `tier_history`.

### `/submit`

- **Description**: Submit a tier result (same idea as rate commands, unified command).
- **Default permission**: Manage Roles (**Manager+**).
- **Options**:
  - `ign`, `tier`, `discord` (required)
  - `type` (choice) — Prime (`P`) | Elite (`E`) | Apex (`A`)

### `/viewtier`

- **Description**: View stored tier rows for an IGN.
- **Permission**: PM+ or booster role (see `hasBoosterOrAbove`).
- **Options**: `ign` (required)

### `/removetier`

- **Description**: Remove the current tier entry for one ladder for that IGN.
- **Default permission**: Manage Roles (**Manager+**).
- **Options**:
  - `ign` (string, required)
  - `type` (choice, required) — Prime | Elite | Apex
- **Behavior**: `DELETE FROM tier_results` where `LOWER(ign)` matches and `type` is P/E/A.

### `/tierids`

- **Description**: List database IDs for `tier_results` and `tier_history` for an IGN (staff tooling).
- **Default permission**: Manage Roles (**Manager+**).
- **Options**: `ign` (required)

### `/tierlist`

- **Description**: Show tier list for one fight type.
- **Permission**: Booster+ or PM+.
- **Options**: `type` — Prime | Elite | Apex

### `/publictierlistupdate`

- **Description**: Update posted embeds for public tier lists (uses `tier_list_messages` + channel).
- **Permission**: **Owner** only.
- **Options**: `channel-id` (optional) — or use `TIERLIST_CHANNEL_ID` in `.env`.

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
  - `evidence` (optional)
  - `punishment` (optional)

### `/history`

- **Description**: Combined **punishment** and **blacklist** history for an IGN (merged, newest first).
- **Default permission**: Manage Roles (**Staff+**).
- **Options**: `ign` (required)

### `/getproof`

- **Description**: Full punishment details for an IGN (manager review).
- **Default permission**: Manage Roles (**Manager+**).
- **Options**: `ign` (required)

### `/totalhistory`

- **Description**: Aggregate punishment counts by status.
- **Default permission**: Manage Roles (**Staff+**).

### `/boosterpuncheck`

- **Description**: List active finalized punishments.
- **Default permission**: Manage Roles (**Staff+**).

### `/checkqueue`

- **Description**: Manager review of `/log` queue (subcommands).
- **Default permission**: Manage Roles (**Manager+**).
- **Subcommands**:
  - `list` — pending `punishment_queue` rows
  - `proof` — `queue-id` (integer, required)
  - `accept` — `queue-id` (required)
  - `deny` — `queue-id` (required) — *note: different from top-level `/deny` (applications).*

---

## PM list

### `/pmlist`

- **Description**: Lists PMs grouped by manager type (Prime / Elite / Apex / N/A).
- **Default permission**: Manage Roles (**PM+**).

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

### `/clearalt`

- **Description**: Delete alt rows where `original_ign` matches.
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
| `GUILD_ID` | If set, guild-scoped slash commands (instant update) |
| `CLEAR_GLOBAL_COMMANDS` | When using `GUILD_ID`, clear global commands unless `false` |
| `BOT_OWNER_IDS` | Comma-separated user IDs |
| `BOT_ROLE_*_NAME` | Override PM/staff/manager/admin role **display names** |
| `BOT_ROLE_BOOSTER_NAME` | Optional booster role for `/tierlist` / `/viewtier` |
| `BOT_ROLE_APPLICANT_NAME` | Applicant role removed by `/deny` |
| `ENABLE_GUILD_MEMBERS_INTENT` | `true` if using privileged member fetch |
| `TIERLIST_CHANNEL_ID` | Default channel for `/publictierlistupdate` |
| `HELP_STAFF_ROLE_ID`, `HELP_CHANNEL_ID` | `/help` mentions |
| `BOT_SHOW_ERRORS` | Include error detail in generic failure message |

---

## Command count

**60+** distinct top-level slash commands (including subcommands: `watchlist add/remove`, `checkqueue list/proof/accept/deny`). Re-register commands after code changes (`node scripts/index.js` or your deploy process).

---

*Generated from the housing-bot codebase. Behavior matches `scripts/commands/*` at time of writing.*
