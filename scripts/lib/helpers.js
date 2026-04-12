const { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } = require('discord.js');

/** Allowed tier labels; TIER_ORDER is best → worst for /tierlist sorting. */
const VALID_TIERS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'N/A'];

const TIER_ORDER = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'N/A'];

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
  defer,
  fail,
  errorEmbed,
  getSlashSubcommand,
  resolveGuildMember,
};
