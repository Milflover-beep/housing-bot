const { EmbedBuilder } = require('discord.js');

/** Default @Staff role for unban pings; override with PUNISHMENT_STAFF_ROLE_ID. */
const DEFAULT_STAFF_PING_ROLE_ID = '1299685590119223327';

/** Channel for cooldown-expired pings (first match wins). */
function getPunishmentPingsChannelId() {
  return (
    process.env.PUNISHMENT_PINGS_CHANNEL_ID ||
    process.env.PINGS_CHANNEL_ID ||
    process.env.PUNISHMENT_ACCEPT_NOTIFY_CHANNEL_ID ||
    ''
  ).trim();
}

function buildExpiryEmbed(row) {
  const issued = row.date || row.created_at;
  const exp = row.reversal_remind_at;
  return new EmbedBuilder()
    .setTitle('⏰ Punishment expired')
    .setColor(0xe74c3c)
    .addFields(
      { name: '👤 Player IGN', value: String(row.user_ign || '—'), inline: true },
      { name: '👮 Staff Member', value: String(row.staff_ign || '—'), inline: true },
      {
        name: '📅 Date Issued',
        value: issued ? new Date(issued).toLocaleDateString() : '—',
        inline: true,
      },
      {
        name: '⏰ Punishment ended',
        value: exp ? new Date(exp).toLocaleString() : '—',
        inline: true,
      },
      { name: '📄 Details', value: String(row.punishment_details || '—').slice(0, 1024) }
    )
    .setFooter({ text: 'Evidence not shown.' })
    .setTimestamp();
}

/**
 * When a manager accepts /checkqueue, `reversal_remind_at` = DB time at accept + cooldown (from `cooldown_raw`).
 * This loop finds rows where that time has passed and posts a ping. Poll often enough for short post-accept windows (e.g. 1m).
 */
function startPunishmentExpiryPoller(client, pool) {
  const intervalMs = 15_000;

  async function tick() {
    const channelId = getPunishmentPingsChannelId();
    if (!channelId) return;

    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) {
      console.warn(
        'punishmentExpiryPoller: cannot use channel (set PUNISHMENT_PINGS_CHANNEL_ID, PINGS_CHANNEL_ID, or PUNISHMENT_ACCEPT_NOTIFY_CHANNEL_ID)'
      );
      return;
    }

    let rows;
    try {
      // Claim rows only after we know the channel works. Removed rows never RETURN.
      const r = await pool.query(
        `UPDATE punishment_logs
         SET reversal_reminded = true
         WHERE id IN (
           SELECT id FROM punishment_logs
           WHERE status = 'active' AND punishment_status = 'active'
             AND reversal_remind_at IS NOT NULL
             AND reversal_remind_at <= NOW()
             AND COALESCE(reversal_reminded, false) = false
           ORDER BY id ASC
           LIMIT 25
         )
         RETURNING *`
      );
      rows = r.rows;
    } catch (e) {
      console.warn('punishmentExpiryPoller query:', e.message);
      return;
    }
    if (!rows.length) return;

    const roleId =
      process.env.PUNISHMENT_STAFF_ROLE_ID || process.env.STAFF_PING_ROLE_ID || DEFAULT_STAFF_PING_ROLE_ID;

    for (const row of rows) {
      const embed = buildExpiryEmbed(row);
      const content = `<@&${roleId}>`;
      try {
        await ch.send({
          content,
          embeds: [embed],
        });
      } catch (e) {
        console.warn(`punishmentExpiryPoller send log #${row.id}:`, e.message);
        await pool
          .query(`UPDATE punishment_logs SET reversal_reminded = false WHERE id = $1`, [row.id])
          .catch(() => {});
      }
    }
  }

  setInterval(tick, intervalMs);
  tick();
}

module.exports = { startPunishmentExpiryPoller, getPunishmentPingsChannelId };
