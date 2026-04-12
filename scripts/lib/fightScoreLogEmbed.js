const { EmbedBuilder } = require('discord.js');

const DEFAULT_FIGHT_SCORE_LOG_CHANNEL_ID = '1476294539152068668';

function getFightScoreLogChannelId() {
  return (process.env.FIGHT_SCORE_LOG_CHANNEL_ID || DEFAULT_FIGHT_SCORE_LOG_CHANNEL_ID).trim();
}

function formatFightType(ft) {
  if (!ft) return '—';
  const s = String(ft).toLowerCase();
  if (s === 'prime') return 'Prime';
  if (s === 'elite') return 'Elite';
  if (s === 'apex') return 'Apex';
  if (s === 'pm') return 'PM';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isSameLocalCalendarDay(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/** "Today" vs numeric date for the Date field (fight date). */
function fightDateFieldValue(createdAt) {
  if (!createdAt) return '—';
  if (isSameLocalCalendarDay(createdAt, Date.now())) return 'Today';
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
}

/** Footer line like `4/5/26, 5:46 PM` */
function footerDateTime(date) {
  return new Date(date).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function winnerHeadThumbnailUrl(winnerIgn) {
  const ign = String(winnerIgn || 'Steve').trim() || 'Steve';
  return `https://minotar.net/helm/${encodeURIComponent(ign)}/64.png`;
}

/**
 * @param {object} row - scores row
 * @param {{ actorUsername: string, mode: 'logged' | 'edited' }} opts
 */
function buildFightScoreLogEmbed(row, { actorUsername, mode }) {
  const isEdit = mode === 'edited';
  const title = isEdit ? 'Fight Score Edited' : 'Fight Score Logged';
  const footerText = isEdit
    ? `Edited by ${actorUsername} • ${footerDateTime(Date.now())}`
    : `Logged by ${actorUsername} • ${footerDateTime(row.created_at)}`;

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x57f287)
    .setThumbnail(winnerHeadThumbnailUrl(row.winner_ign))
    .addFields(
      { name: 'Winner', value: String(row.winner_ign || '—'), inline: true },
      { name: 'Loser', value: String(row.loser_ign || '—'), inline: true },
      { name: 'Score', value: String(row.final_score || '—'), inline: true },
      { name: 'Fight #', value: String(row.fight_number ?? '—'), inline: true },
      { name: 'Fight Type', value: formatFightType(row.fight_type), inline: true },
      { name: 'Date', value: fightDateFieldValue(row.created_at), inline: false }
    )
    .setFooter({ text: footerText });
}

async function sendFightScoreLogEmbed(client, embed) {
  const id = getFightScoreLogChannelId();
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch?.isTextBased?.()) {
    console.warn('fightScoreLog: channel not found or not text-based (FIGHT_SCORE_LOG_CHANNEL_ID)');
    return;
  }
  try {
    await ch.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (e) {
    console.warn('fightScoreLog send:', e.message);
  }
}

module.exports = {
  getFightScoreLogChannelId,
  buildFightScoreLogEmbed,
  sendFightScoreLogEmbed,
};
