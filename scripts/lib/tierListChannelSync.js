const { EmbedBuilder } = require('discord.js');
const { tierRank, tierResultsLadderSqlParam, tierListEmbedHeading } = require('./helpers');

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

/** Latest row per IGN per ladder; ignores empty tier text. */
function selectCurrentTierRowsSql() {
  return `SELECT DISTINCT ON (LOWER(tr.ign)) tr.ign, tr.tier
          FROM tier_results tr
          WHERE ${tierResultsLadderSqlParam('tr')}
            AND COALESCE(TRIM(tr.tier), '') <> ''
          ORDER BY LOWER(tr.ign), tr.id DESC`;
}

/** Map letter grade to S/A/B/C/D bucket for public list layout. */
function tierToBucket(tier) {
  const t = String(tier || '')
    .trim()
    .toUpperCase();
  if (t === 'S') return 'S';
  if (['A+', 'A', 'A-', 'HB'].includes(t)) return 'A';
  if (['B+', 'B', 'B-'].includes(t)) return 'B';
  if (['C+', 'C', 'C-'].includes(t)) return 'C';
  if (['D', 'N/A', 'F'].includes(t)) return 'D';
  return null;
}

const BUCKET_EMOJI = {
  S: '🟥',
  A: '🟧',
  B: '🟨',
  C: '🟩',
  D: '⬛',
};

/** Markdown: S/A/B/C/D buckets, yaml lists — no extra prose (ladder name is embed title). */
function buildTierListEmbedDescription(rows) {
  const buckets = { S: [], A: [], B: [], C: [], D: [] };
  for (const r of rows) {
    const b = tierToBucket(r.tier);
    if (b && buckets[b]) buckets[b].push(r);
  }
  const order = ['S', 'A', 'B', 'C', 'D'];
  for (const b of order) {
    buckets[b].sort((a, c) => {
      const tr = tierRank(a.tier) - tierRank(c.tier);
      if (tr !== 0) return tr;
      return String(a.ign).localeCompare(String(c.ign));
    });
  }

  const lines = [];
  let hasAny = false;
  for (const b of order) {
    const list = buckets[b];
    if (!list.length) continue;
    hasAny = true;
    lines.push(`${BUCKET_EMOJI[b]} **${b}** (${list.length})`);
    lines.push('```yaml');
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
