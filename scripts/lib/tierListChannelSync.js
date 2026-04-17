const { EmbedBuilder } = require('discord.js');
const { tierRank, tierListEmbedHeading, sqlTierResultsPublicListRowsForLadder } = require('./helpers');

/** Tier lists use only `tier_results` (seed from database_export.xlsx `tier_results` sheet + bot ratings). Not pm_list. */

const DEFAULT_TIERLIST_CHANNEL_ID = '1472779161352274076';

/** One embed per ladder (Prime / Elite / Apex) in a single message. */
const LADDER_COLORS = {
  P: 0x5865f2,
  E: 0x9b59b6,
  A: 0xe67e22,
};

function getTierListChannelId() {
  return (
    process.env.TIERLIST_PUBLIC_CHANNEL_ID ||
    process.env.TIERLIST_CHANNEL_ID ||
    DEFAULT_TIERLIST_CHANNEL_ID
  ).trim();
}

function typeLetterToName(letter) {
  const m = { P: 'Prime', E: 'Elite', A: 'Apex' };
  return m[letter] || letter;
}

function selectCurrentTierRowsSql() {
  return sqlTierResultsPublicListRowsForLadder();
}

const BUCKET_EMOJI = {
  S: '🟥',
  'A+': '🟧',
  A: '🟧',
  'A-': '🟧',
  'B+': '🟨',
  B: '🟨',
  'B-': '🟨',
  'C+': '🟩',
  C: '🟩',
  'C-': '🟩',
  D: '⬛',
  'N/A': '⬛',
};

const TIER_BUCKET_ORDER = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'N/A'];

function displayTierLabel(rawTier) {
  const t = String(rawTier || '')
    .trim()
    .toUpperCase();
  if (t === 'HB') return 'B-';
  return t;
}

/** Classic bucket layout: one block per exact tier label. */
function buildTierListEmbedDescription(rows) {
  const buckets = Object.fromEntries(TIER_BUCKET_ORDER.map((tier) => [tier, []]));
  for (const r of rows) {
    const tier = displayTierLabel(r.tier);
    if (buckets[tier]) buckets[tier].push(r);
  }
  for (const tier of TIER_BUCKET_ORDER) {
    buckets[tier].sort((a, c) => {
      const tr = tierRank(a.tier) - tierRank(c.tier);
      if (tr !== 0) return tr;
      return String(a.ign).localeCompare(String(c.ign));
    });
  }

  const lines = [];
  let hasAny = false;
  for (const tier of TIER_BUCKET_ORDER) {
    const list = buckets[tier];
    if (!list.length) continue;
    hasAny = true;
    lines.push(`${BUCKET_EMOJI[tier] || '⬜'} **${tier}** (${list.length})`);
    lines.push('```');
    lines.push(...list.map((r) => `- ${r.ign}`));
    lines.push('```');
    lines.push('');
  }
  if (!hasAny) {
    lines.push('_No entries._');
  }
  return lines.join('\n').slice(0, 4096);
}

async function buildCombinedEmbeds(pool) {
  /** Visual order: Apex (top) → Elite → Prime (bottom). */
  const letters = ['A', 'E', 'P'];
  const embeds = [];
  for (const letter of letters) {
    const res = await pool.query(selectCurrentTierRowsSql(), [letter]);
    const rows = [...res.rows];
    const typeName = typeLetterToName(letter);
    const heading = tierListEmbedHeading(typeName);
    const body = buildTierListEmbedDescription(rows);
    const desc = `${heading}\n\n${body}`.slice(0, 4096);
    embeds.push(
      new EmbedBuilder().setColor(LADDER_COLORS[letter] || 0x5865f2).setDescription(desc)
    );
  }
  return embeds;
}

/**
 * Deletes any previously tracked tier-list messages, then posts one new message with
 * Apex + Elite + Prime embeds top-to-bottom (avoids Discord’s “(edited)” tag).
 */
async function syncTierListChannel(client, pool, channelIdOverride) {
  const channelId = (channelIdOverride || getTierListChannelId()).trim();
  if (!channelId) return;

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased?.()) {
    console.warn('tierListChannelSync: invalid channel (TIERLIST_PUBLIC_CHANNEL_ID / TIERLIST_CHANNEL_ID)');
    return;
  }

  try {
    const tracked = await pool.query('SELECT message_id FROM tier_list_messages');
    for (const row of tracked.rows) {
      if (row.message_id) {
        await ch.messages.delete(row.message_id).catch(() => {});
      }
    }
    await pool.query('DELETE FROM tier_list_messages');

    const embeds = await buildCombinedEmbeds(pool);
    const sent = await ch.send({
      embeds,
      allowedMentions: { parse: [] },
    });

    await pool.query(
      `INSERT INTO tier_list_messages (position, message_id, channel_id, updated_at)
       VALUES (0, $1, $2, NOW())`,
      [sent.id, channelId]
    );
  } catch (e) {
    console.warn('tierListChannelSync:', e.message);
  }
}

module.exports = {
  getTierListChannelId,
  buildTierListEmbedDescription,
  syncTierListChannel,
  syncAllTierListMessages: syncTierListChannel,
};
