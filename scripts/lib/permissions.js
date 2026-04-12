const { PermissionFlagsBits } = require('discord.js');

/**
 * Role hierarchy (higher number = more power):
 * 0 = normal member (no bot access role)
 * 1 = PM, 2 = staff, 3 = manager, 4 = admin
 *
 * **Recommended:** set role **IDs** (comma-separated for main + test servers):
 *   BOT_ROLE_PM_ID=id1,id2 BOT_ROLE_STAFF_ID=... etc.
 * Optional: BOT_ROLE_BOOSTER_ID, BOT_ROLE_APPLICANT_ID (/check grants for PM+, /deny removes)
 *
 * If any ID is set for a tier, **any** of those roles grants that level (name is ignored).
 * If no IDs for that tier, falls back to **exact role name** (BOT_ROLE_*_NAME).
 * Defaults: [PM BOT ACCESS], [STAFF BOT ACCESS], [MANAGER BOT ACCESS], [ADMIN BOT ACCESS]
 *
 * BOT_OWNER_IDS: comma-separated user IDs — always owner for owner-only commands.
 */

function parseSnowflake(s) {
  if (!s) return null;
  let t = String(s).trim();
  t = t.replace(/^\uFEFF/, '');
  t = t.replace(/\r/g, '');
  t = t.replace(/^[`'"]+|['"`]+$/g, '').trim();
  return /^\d{17,20}$/.test(t) ? t : null;
}

/** Comma-separated snowflakes from env, e.g. BOT_ROLE_PM_ID=111,222 */
function parseRoleIdList(envKey) {
  const raw = process.env[envKey];
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((x) => x.trim())
    .map(parseSnowflake)
    .filter(Boolean);
}

const OWNER_IDS = new Set(
  (process.env.BOT_OWNER_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
);

const DEFAULT_ROLE_NAMES = {
  pm: '[PM BOT ACCESS]',
  staff: '[STAFF BOT ACCESS]',
  manager: '[MANAGER BOT ACCESS]',
  admin: '[ADMIN BOT ACCESS]',
};

/** Resolved display name for each tier (env override or default). */
function roleName(tier) {
  const envKey = `BOT_ROLE_${tier.toUpperCase()}_NAME`;
  return process.env[envKey] || DEFAULT_ROLE_NAMES[tier];
}

/** All snowflakes for a tier (comma-separated BOT_ROLE_*_ID). */
function roleIds(tier) {
  return parseRoleIdList(`BOT_ROLE_${tier.toUpperCase()}_ID`);
}

function hasRoleName(member, name) {
  if (!name || !member?.roles?.cache) return false;
  return member.roles.cache.some((r) => r.name === name);
}

function hasRoleId(member, snowflake) {
  if (!snowflake || !member?.roles?.cache) return false;
  return member.roles.cache.has(snowflake);
}

/** One access tier: any configured ID, else exact role name match. */
function hasTierRole(member, tier) {
  const ids = roleIds(tier);
  if (ids.length > 0) {
    return ids.some((id) => hasRoleId(member, id));
  }
  return hasRoleName(member, roleName(tier));
}

/** Applicant role IDs for /deny (comma-separated); empty → use name only. */
function applicantRoleIds() {
  return parseRoleIdList('BOT_ROLE_APPLICANT_ID');
}

/** True when BOT_ROLE_APPLICANT_ID is non-empty but parses to no valid snowflakes (quotes, typos, etc.). */
function applicantRoleIdEnvPresentButInvalid() {
  const raw = process.env.BOT_ROLE_APPLICANT_ID;
  if (raw == null || !String(raw).trim()) return false;
  return parseRoleIdList('BOT_ROLE_APPLICANT_ID').length === 0;
}

function applicantRoleName() {
  const raw = process.env.BOT_ROLE_APPLICANT_NAME;
  if (raw == null || !String(raw).trim()) return '[APPLICANT]';
  let t = String(raw).trim().replace(/^\uFEFF/, '');
  t = t.replace(/^[`'"]+|['"`]+$/g, '').trim();
  return t || '[APPLICANT]';
}

/**
 * 0–4 from Discord roles. Checks highest tier first (someone with admin + PM only counts as admin).
 * Also: BOT_OWNER_IDS, guild owner, and Discord Administrator count as level 4 so staff+ commands work
 * when role IDs are misconfigured or the member object had an incomplete role cache.
 */
function getMemberLevel(member) {
  if (!member) return 0;
  const uid = member.user?.id ?? member.id;
  if (uid && OWNER_IDS.has(uid)) return 4;
  if (member.guild?.ownerId === member.id) return 4;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return 4;
  if (hasTierRole(member, 'admin')) return 4;
  if (hasTierRole(member, 'manager')) return 3;
  if (hasTierRole(member, 'staff')) return 2;
  if (hasTierRole(member, 'pm')) return 1;
  return 0;
}

/** Tier list / “booster+” style access: PM+ by default, or optional booster role (IDs or name). */
function hasBoosterOrAbove(member) {
  if (getMemberLevel(member) >= 1) return true;
  const boosterIds = parseRoleIdList('BOT_ROLE_BOOSTER_ID');
  if (boosterIds.some((id) => hasRoleId(member, id))) return true;
  const booster = process.env.BOT_ROLE_BOOSTER_NAME;
  if (booster && hasRoleName(member, booster)) return true;
  return false;
}

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

function isAdminOrOwner(member, userId) {
  if (isOwner(userId)) return true;
  return getMemberLevel(member) >= 4;
}

function requireLevel(member, min) {
  return getMemberLevel(member) >= min;
}

function accessLabel(tier) {
  const ids = roleIds(tier);
  if (ids.length > 0) return `ids:${ids.join(',')}`;
  return roleName(tier);
}

function getRoleNames() {
  const boosterIds = parseRoleIdList('BOT_ROLE_BOOSTER_ID');
  return {
    pm: accessLabel('pm'),
    staff: accessLabel('staff'),
    manager: accessLabel('manager'),
    admin: accessLabel('admin'),
    booster:
      boosterIds.length > 0
        ? `ids:${boosterIds.join(',')}`
        : process.env.BOT_ROLE_BOOSTER_NAME || null,
  };
}

module.exports = {
  OWNER_IDS,
  parseSnowflake,
  parseRoleIdList,
  getMemberLevel,
  hasBoosterOrAbove,
  isOwner,
  isAdminOrOwner,
  requireLevel,
  getRoleNames,
  hasRoleName,
  hasRoleId,
  hasTierRole,
  roleName,
  roleIds,
  applicantRoleName,
  applicantRoleIds,
  applicantRoleIdEnvPresentButInvalid,
};
