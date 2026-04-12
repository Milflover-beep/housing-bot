const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } = require('discord.js');

/** Allowed tier labels; TIER_ORDER is best → worst for /tierlist sorting. */
const VALID_TIERS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'N/A'];

const TIER_ORDER = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'N/A'];

/** Minecraft IGNs are matched case-insensitively (trim + lowercase for DB keys). */
function normalizeIgn(s) {
  return String(s || '').trim().toLowerCase();
}

function tierRank(tier) {
  let key = String(tier || '')
    .trim()
    .toUpperCase();
  // Legacy label from older bot versions (High B) — sort near B-
  if (key === 'HB') key = 'B-';
  const i = TIER_ORDER.indexOf(key);
  return i === -1 ? 999 : i;
}

function typeLetterToName(letter) {
  const m = { P: 'Prime', E: 'Elite', A: 'Apex' };
  return m[letter] || letter;
}

function parseDurationToDate(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || t === 'perm' || t === 'permanent' || t === 'never') return null;
  const m = t.match(/^(\d+)\s*(d|day|days|h|hr|hour|hours|m|min|mins)$/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const ms = Date.now();
  if (u.startsWith('d')) return new Date(ms + n * 86400000);
  if (u.startsWith('h')) return new Date(ms + n * 3600000);
  if (u.startsWith('m')) return new Date(ms + n * 60000);
  return undefined;
}

/** Single-unit cooldown for /log, e.g. `3d`, `12h`, `30m`. Returns ms, null if empty, undefined if invalid. */
function parseCooldownToMs(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+)\s*(d|h|m)$/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (n < 1) return undefined;
  const u = m[2].toLowerCase();
  if (u === 'd') return n * 86400000;
  if (u === 'h') return n * 3600000;
  if (u === 'm') return n * 60000;
  return undefined;
}

/**
 * Extract http(s) URLs as plain text (newline-separated).
 * Use in embed **descriptions**: Discord auto-linkifies bare URLs (blue, clickable).
 * Avoid `[label](url)` markdown here — it breaks when the URL contains `)` etc.
 */
function formatEvidencePlainUrls(text) {
  const t = String(text || '').trim();
  if (!t) return '—';
  const urlRe = /(https?:\/\/[^\s<]+)/gi;
  const urls = [];
  let m;
  while ((m = urlRe.exec(t)) !== null) urls.push(m[0]);
  if (urls.length) return urls.join('\n').slice(0, 2000);
  return t.slice(0, 1024);
}

async function defer(interaction, ephemeral = false) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
}

/**
 * Reliable subcommand name (discord.js getSubcommand() can be null on some payloads).
 */
function getSlashSubcommand(interaction) {
  if (!interaction.isChatInputCommand?.()) return null;
  const direct = interaction.options.getSubcommand(false);
  if (direct) return direct;

  const data = interaction.options?.data;
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0];
  const T = ApplicationCommandOptionType;
  if (first?.type === T.Subcommand) return first.name ?? null;
  if (first?.type === T.SubcommandGroup && Array.isArray(first.options) && first.options.length > 0) {
    const inner = first.options[0];
    if (inner?.type === T.Subcommand) return inner.name ?? null;
  }
  return null;
}

/**
 * Guild slash commands should include member; if missing, fetch (needs Guild Members intent for uncached users).
 */
async function resolveGuildMember(interaction) {
  if (interaction.member) return interaction.member;
  const g = interaction.guild;
  if (!g) return null;
  try {
    return await g.members.fetch(interaction.user.id);
  } catch {
    return null;
  }
}

async function fail(interaction, msg, ephemeral = true) {
  const payload = { content: msg, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply(payload);
}

function errorEmbed(title, body) {
  return new EmbedBuilder().setColor(0xed4245).setTitle(title).setDescription(body);
}

module.exports = {
  VALID_TIERS,
  TIER_ORDER,
  normalizeIgn,
  tierRank,
  typeLetterToName,
  parseDurationToDate,
  parseCooldownToMs,
  formatEvidencePlainUrls,
  defer,
  fail,
  errorEmbed,
  getSlashSubcommand,
  resolveGuildMember,
};
