const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getPunishmentPingsChannelId } = require('../lib/punishmentExpiryPoller');

const DEFAULT_STAFF_PING_ROLE_ID = '1299685590119223327';

module.exports = function punishmentCommands(ctx) {
  const {
    pool,
    requireLevel,
    defer,
    normalizeIgn,
    resolveGuildMember,
    parseCooldownToMs,
    formatEvidencePlainUrls,
  } = ctx;

  function buildUnbanEmbed(logRow) {
    const issued = logRow.date || logRow.created_at;
    const exp = logRow.reversal_remind_at;
    return new EmbedBuilder()
      .setTitle('⏰ Punishment expired')
      .setColor(0xe74c3c)
      .addFields(
        { name: '👤 Player IGN', value: String(logRow.user_ign || '—'), inline: true },
        { name: '👮 Staff Member', value: String(logRow.staff_ign || '—'), inline: true },
        { name: '📅 Date Issued', value: issued ? new Date(issued).toLocaleDateString() : '—', inline: true },
        { name: '⏰ Punishment ended', value: exp ? new Date(exp).toLocaleString() : '—', inline: true },
        { name: '📄 Details', value: String(logRow.punishment_details || '—').slice(0, 1024) }
      )
      .setFooter({ text: 'Evidence not shown.' })
      .setTimestamp();
  }

  async function sendImmediateUnbanPing(client, logRow) {
    const channelId = getPunishmentPingsChannelId();
    if (!channelId) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    const roleId =
      process.env.PUNISHMENT_STAFF_ROLE_ID || process.env.STAFF_PING_ROLE_ID || DEFAULT_STAFF_PING_ROLE_ID;
    await ch.send({
      content: `<@&${roleId}>`,
      embeds: [buildUnbanEmbed(logRow)],
    });
  }

  async function nextProgressiveCooldownRaw(userIgn) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM punishment_logs
       WHERE LOWER(TRIM(user_ign)) = LOWER(TRIM($1::text))
         AND COALESCE(progressive_ban, true) = true
         AND status = 'active'
         AND punishment_status = 'active'`,
      [userIgn]
    );
    const acceptedCount = r.rows[0]?.c || 0;
    const days = 3 * Math.pow(2, acceptedCount);
    return `${days}d`;
  }

  async function getQueueRow(queueId) {
    const q = await pool.query('SELECT * FROM punishment_queue WHERE id = $1', [queueId]);
    return q.rows[0] || null;
  }

  async function getLogForQueue(row) {
    if (!row?.punishment_log_id) return null;
    const l = await pool.query('SELECT * FROM punishment_logs WHERE id = $1', [row.punishment_log_id]);
    return l.rows[0] || null;
  }

  async function getPendingQueueItems() {
    const q = await pool.query(
      "SELECT * FROM punishment_queue WHERE status = 'pending' ORDER BY id ASC"
    );
    const items = [];
    for (const row of q.rows) {
      const log = await getLogForQueue(row);
      if (log) items.push({ queue: row, log });
    }
    return items;
  }

  function buildQueueReviewEmbed(queue, log, pageNum, totalPages) {
    const evidenceText = formatEvidencePlainUrls(log.evidence);
    const description = `**Player:** \`${log.user_ign}\`\n**Staff:** ${log.staff_ign || '—'}\n\n**📎 Evidence**\n${evidenceText}`;
    return new EmbedBuilder()
      .setTitle(`Manager queue — ${pageNum}/${totalPages} (queue #${queue.id} · log #${log.id})`)
      .setColor(0x5865f2)
      .setDescription(description.slice(0, 4096))
      .addFields(
        { name: '📄 Details', value: (log.punishment_details || '—').slice(0, 1024) },
        {
          name: '⏱️ Ban duration',
          value: log.cooldown_raw
            ? `\`${log.cooldown_raw}\` (**d**=days **h**=hours **m**=minutes)`
            : 'None (no timed unban ping)',
          inline: false,
        }
      )
      .setFooter({ text: 'Accept approves the punishment; Deny voids it.' })
      .setTimestamp();
  }

  async function renderQueuePage(interaction, items, index) {
    if (!items.length) {
      return interaction.editReply({
        content: 'Queue is empty (no pending items).',
        embeds: [],
        components: [],
      });
    }
    const safeIdx = Math.min(Math.max(0, index), items.length - 1);
    const { queue, log } = items[safeIdx];
    const embed = buildQueueReviewEmbed(queue, log, safeIdx + 1, items.length);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pq|nav|${queue.id}|prev`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeIdx === 0),
      new ButtonBuilder()
        .setCustomId(`pq|nav|${queue.id}|next`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeIdx >= items.length - 1),
      new ButtonBuilder()
        .setCustomId(`pq|acc|${queue.id}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`pq|den|${queue.id}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  async function applyAccept(queueId) {
    const row = await getQueueRow(queueId);
    if (!row || row.status !== 'pending') return { ok: false, reason: 'no_pending' };
    const log = await getLogForQueue(row);
    if (!log) return { ok: false, reason: 'no_log' };

    await pool.query(
      `UPDATE punishment_logs SET status = 'active', punishment_status = 'active',
         reversal_reminded = COALESCE(reversal_reminded, false) WHERE id = $1`,
      [log.id]
    );
    await pool.query(`UPDATE punishment_queue SET status = 'accepted' WHERE id = $1`, [queueId]);
    return { ok: true, logId: log.id, queueId };
  }

  async function applyDeny(queueId) {
    const row = await getQueueRow(queueId);
    if (!row || row.status !== 'pending') return { ok: false, reason: 'no_pending' };
    const log = await getLogForQueue(row);
    if (!log) return { ok: false, reason: 'no_log' };

    await pool.query(
      `UPDATE punishment_logs
       SET status = 'void', punishment_status = 'denied', reversal_reminded = true
       WHERE id = $1`,
      [log.id]
    );
    await pool.query(`UPDATE punishment_queue SET status = 'denied' WHERE id = $1`, [queueId]);
    return { ok: true, logId: log.id, queueId, log };
  }

  async function handleCheckqueue(interaction) {
    await defer(interaction, true);
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      return interaction.editReply({
        content:
          '❌ Managers or higher only. If you have the manager role, enable **Server Members Intent** for the bot or try again.',
      });
    }
    const items = await getPendingQueueItems();
    if (items.length === 0) {
      return interaction.editReply({ content: 'Queue is empty (no pending items).' });
    }
    return renderQueuePage(interaction, items, 0);
  }

  async function handlePunishmentQueueButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('pq|')) return false;
    if (!interaction.guild) {
      await interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });
      return true;
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      await interaction.reply({ content: '❌ Managers only.', ephemeral: true });
      return true;
    }

    const parts = interaction.customId.split('|');
    if (parts.length < 3) return false;

    await interaction.deferUpdate();

    if (parts[1] === 'nav') {
      const queueId = parseInt(parts[2], 10);
      const dir = parts[3];
      const items = await getPendingQueueItems();
      if (!items.length) {
        return interaction.editReply({
          content: 'Queue is empty.',
          embeds: [],
          components: [],
        });
      }
      const idx = items.findIndex((x) => x.queue.id === queueId);
      const base = idx >= 0 ? idx : 0;
      let newIdx = base;
      if (dir === 'prev') newIdx = Math.max(0, base - 1);
      else if (dir === 'next') newIdx = Math.min(items.length - 1, base + 1);
      return renderQueuePage(interaction, items, newIdx);
    }

    if (parts[1] === 'acc') {
      const queueId = parseInt(parts[2], 10);
      const res = await applyAccept(queueId);
      if (!res.ok) {
        const items = await getPendingQueueItems();
        if (!items.length) {
          return interaction.editReply({
            content: '❌ That item is no longer pending (or was already processed). Queue is empty.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, items, 0);
      }
      const items = await getPendingQueueItems();
      if (!items.length) {
        return interaction.editReply({
          content: `✅ Accepted punishment **log #${res.logId}** (queue **#${res.queueId}**). Queue is now empty.`,
          embeds: [],
          components: [],
        });
      }
      return renderQueuePage(interaction, items, 0);
    }

    if (parts[1] === 'den') {
      const queueId = parseInt(parts[2], 10);
      const res = await applyDeny(queueId);
      if (!res.ok) {
        const items = await getPendingQueueItems();
        if (!items.length) {
          return interaction.editReply({
            content: '❌ That item is no longer pending. Queue is empty.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, items, 0);
      }
      if (!res.log?.reversal_reminded) {
        await sendImmediateUnbanPing(interaction.client, res.log).catch(() => {});
      }
      const items = await getPendingQueueItems();
      if (!items.length) {
        return interaction.editReply({
          content: `✅ Denied punishment **log #${res.logId}** (queue **#${res.queueId}**). Queue is now empty.`,
          embeds: [],
          components: [],
        });
      }
      return renderQueuePage(interaction, items, 0);
    }

    return false;
  }

  async function handleLog(interaction) {
    await defer(interaction, true);
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 2)) {
      return interaction.editReply({
        content:
          '❌ Staff or higher only. If you have the staff role, try again or ask an admin to enable **Server Members Intent** so the bot can see your roles.',
      });
    }
    const userIgn = normalizeIgn(interaction.options.getString('user-ign'));
    const details = interaction.options.getString('details');
    const evidence = interaction.options.getString('evidence', true) || '';
    const evidenceTrim = evidence.trim();
    if (!/https?:\/\//i.test(evidenceTrim)) {
      return interaction.editReply({
        content:
          '❌ **Evidence** must include at least one **`http://`** or **`https://`** link (paste the proof URL).',
      });
    }
    const cooldownRaw = await nextProgressiveCooldownRaw(userIgn);
    const cooldownMs = parseCooldownToMs(cooldownRaw);
    const reversalAt = cooldownMs ? new Date(Date.now() + cooldownMs) : null;
    const staffIgn = interaction.user.username;
    const staffDiscordId = String(interaction.user.id);

    try {
      const ins = await pool.query(
        `INSERT INTO punishment_logs (user_ign, staff_ign, evidence, punishment_details, date, discord_user, punishment, created_at, status, punishment_status, cooldown_raw, reversal_remind_at, reversal_reminded, progressive_ban)
         VALUES ($1, $2, $3, $4, NOW(), $5, NULL, NOW(), 'queued', 'pending_review', $6, $7, false, true)
         RETURNING id`,
        [userIgn, staffIgn, evidence, details, staffDiscordId, cooldownRaw || null, reversalAt]
      );
      const logId = ins.rows[0].id;

      const summary = (details || '').slice(0, 200);
      try {
        await pool.query(
          `INSERT INTO punishment_queue (ign, staff_discord_id, details, status, punishment_log_id, created_at)
           VALUES ($1, $2, $3, 'pending', $4, NOW())`,
          [userIgn, staffDiscordId, summary, logId]
        );
      } catch (e) {
        const code = e && e.code;
        const msg = String(e && e.message);
        const missingLogIdCol = code === '42703' || /punishment_log_id/i.test(msg);
        if (missingLogIdCol) {
          await pool.query(
            `INSERT INTO punishment_queue (ign, staff_discord_id, details, status, created_at)
             VALUES ($1, $2, $3, 'pending', NOW())`,
            [userIgn, staffDiscordId, summary]
          );
        } else {
          throw e;
        }
      }

      await interaction.editReply({
        content:
          `✅ Logged punishment **#${logId}** for **${userIgn}** and added it to the **manager review queue**.\n` +
          `Duration set to **${cooldownRaw}** (progressive 3d -> 6d -> 12d...). Managers use **/checkqueue** (pages + Accept/Deny).`,
      });
    } catch (e) {
      console.error('handleLog:', e);
      const hint =
        process.env.BOT_SHOW_ERRORS === 'true'
          ? `\n\`${String(e.message || e).slice(0, 400)}\``
          : '';
      return interaction.editReply({
        content:
          `❌ Database error while logging punishment.${hint}\n` +
          `Confirm \`punishment_logs\` and \`punishment_queue\` match \`schema.sql\`.`,
      });
    }
  }

  async function handleAdminlog(interaction) {
    await defer(interaction, true);
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 4)) {
      return interaction.editReply({ content: '❌ Admin or higher only.' });
    }
    const userIgn = normalizeIgn(interaction.options.getString('user-ign'));
    const details = interaction.options.getString('details');
    const evidence = interaction.options.getString('evidence') || '';
    const evidenceTrim = evidence.trim();
    if (evidenceTrim && !/https?:\/\//i.test(evidenceTrim)) {
      return interaction.editReply({
        content:
          '❌ **Evidence** must include at least one **`http://`** or **`https://`** link (paste the proof URL).',
      });
    }
    const cooldownOpt = interaction.options.getString('cooldown');
    let cooldownRaw = cooldownOpt && String(cooldownOpt).trim() ? String(cooldownOpt).trim() : '';
    let progressiveBan = false;
    if (!cooldownRaw) {
      cooldownRaw = await nextProgressiveCooldownRaw(userIgn);
      progressiveBan = true;
    }
    const cooldownMs = parseCooldownToMs(cooldownRaw);
    if (cooldownMs === undefined || cooldownMs === null || cooldownMs <= 0) {
      return interaction.editReply({
        content:
          '❌ Invalid **duration**. Use one number and one unit: **`d`** days, **`h`** hours, **`m`** minutes (e.g. `1d`, `12h`, `1m`). Leave blank to use normal progressive duration.',
      });
    }
    const reversalAt = new Date(Date.now() + cooldownMs);
    const staffIgn = interaction.user.username;
    const staffDiscordId = String(interaction.user.id);

    const ins = await pool.query(
      `INSERT INTO punishment_logs (user_ign, staff_ign, evidence, punishment_details, date, discord_user, punishment, created_at, status, punishment_status, cooldown_raw, reversal_remind_at, reversal_reminded, progressive_ban)
       VALUES ($1, $2, $3, $4, NOW(), $5, NULL, NOW(), 'queued', 'pending_review', $6, $7, false, false)
       RETURNING id`,
      [userIgn, staffIgn, evidenceTrim || null, details, staffDiscordId, cooldownRaw, reversalAt]
    );
    const logId = ins.rows[0].id;
    const summary = (details || '').slice(0, 200);
    await pool.query(
      `INSERT INTO punishment_queue (ign, staff_discord_id, details, status, punishment_log_id, created_at)
       VALUES ($1, $2, $3, 'pending', $4, NOW())`,
      [userIgn, staffDiscordId, summary, logId]
    );
    if (progressiveBan) {
      await pool.query(`UPDATE punishment_logs SET progressive_ban = true WHERE id = $1`, [logId]);
    }

    await interaction.editReply({
      content:
        `✅ Admin logged punishment **#${logId}** for **${userIgn}** and added it to manager review queue.\n` +
        `${progressiveBan ? 'Auto progressive duration' : 'Custom duration'}: **${cooldownRaw}**.`,
    });
  }

  async function handleStaffstats(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const staffIgn = normalizeIgn(interaction.options.getString('ign'));
    const start = interaction.options.getString('start-date');
    const end = interaction.options.getString('end-date');
    const params = [staffIgn];
    let where = `LOWER(TRIM(staff_ign)) = $1`;
    if (start && end) {
      where += ' AND created_at BETWEEN $2 AND $3';
      params.push(new Date(start), new Date(end));
    }
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN status = 'active' AND punishment_status = 'active' THEN 1 ELSE 0 END)::int AS accepted,
         SUM(CASE WHEN punishment_status = 'denied' THEN 1 ELSE 0 END)::int AS denied
       FROM punishment_logs
       WHERE ${where}`,
      params
    );
    const row = r.rows[0] || {};
    const total = row.total || 0;
    const accepted = row.accepted || 0;
    const denied = row.denied || 0;
    const decided = accepted + denied;
    const accuracy = decided > 0 ? ((accepted / decided) * 100).toFixed(1) : '0.0';
    const embed = new EmbedBuilder()
      .setTitle(`Staff stats: ${staffIgn}`)
      .setColor(0x3498db)
      .addFields(
        { name: 'Logs made', value: String(total), inline: true },
        { name: 'Accepted', value: String(accepted), inline: true },
        { name: 'Denied', value: String(denied), inline: true },
        { name: 'Accuracy', value: `${accuracy}%`, inline: true }
      )
      .setFooter({ text: start && end ? `Range: ${start} - ${end}` : 'All time' })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleHistory(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const [pun, bl] = await Promise.all([
      pool.query(
        `SELECT id, punishment, punishment_details, status, punishment_status, created_at
         FROM punishment_logs WHERE LOWER(user_ign) = $1 ORDER BY created_at DESC LIMIT 25`,
        [ign]
      ),
      pool.query(
        `SELECT id, reason, time_length, blacklist_expires, created_at
         FROM blacklists WHERE LOWER(ign) = $1 ORDER BY created_at DESC LIMIT 25`,
        [ign]
      ),
    ]);
    const merged = [
      ...pun.rows.map((row) => ({
        t: new Date(row.created_at).getTime(),
        line: `**Punishment** #${row.id} — ${(row.punishment_details || '—').slice(0, 120)} (${row.status}/${row.punishment_status})`,
      })),
      ...bl.rows.map((row) => ({
        t: new Date(row.created_at).getTime(),
        line: `**Blacklist** #${row.id} — ${row.reason || '?'} (${row.time_length || '?'})${
          row.blacklist_expires
            ? ` — expires ${new Date(row.blacklist_expires).toLocaleString()}`
            : ''
        }`,
      })),
    ]
      .sort((a, b) => b.t - a.t)
      .slice(0, 30)
      .map((x) => x.line);
    if (merged.length === 0) {
      return interaction.editReply({
        content: `No punishment or blacklist history for **${ign}**.`,
      });
    }
    const embed = new EmbedBuilder()
      .setTitle(`History: ${ign}`)
      .setColor(0x95a5a6)
      .setDescription(merged.join('\n').slice(0, 3900));
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleGetproof(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const r = await pool.query(
      `SELECT * FROM punishment_logs WHERE LOWER(user_ign) = $1 ORDER BY created_at DESC`,
      [ign]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No punishments for **${ign}**.` });
    }
    const chunks = r.rows.map(
      (row) =>
        `**#${row.id}**\nDetails: ${row.punishment_details || '—'}\nEvidence: ${row.evidence || '—'}\nStatus: ${
          row.status
        } / ${row.punishment_status}\n`
    );
    await interaction.editReply({ content: chunks.join('\n').slice(0, 3900) });
  }

  async function handleTotalhistory(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const r = await pool.query(
      `SELECT status, punishment_status, COUNT(*)::int AS c FROM punishment_logs GROUP BY status, punishment_status`
    );
    const lines = r.rows.map((row) => `${row.status || '?'} / ${row.punishment_status || '?'}: **${row.c}**`);
    await interaction.editReply({
      content: lines.length ? lines.join('\n') : 'No punishment rows.',
    });
  }

  async function handleRemovepunishment(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const id = interaction.options.getInteger('id', true);
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query('DELETE FROM punishment_queue WHERE punishment_log_id = $1', [id]);
      const del = await conn.query('DELETE FROM punishment_logs WHERE id = $1 RETURNING user_ign', [id]);
      await conn.query('COMMIT');
      if (del.rowCount === 0) {
        return interaction.editReply({
          content: `❌ No punishment log with id **${id}**. Use the number from **/history** (e.g. **Punishment #42** → \`42\`).`,
        });
      }
      return interaction.editReply({
        content: `✅ Removed punishment log **#${id}** for **${del.rows[0].user_ign}** (and any linked queue row).`,
      });
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => {});
      console.error('removepunishment:', e);
      return interaction.editReply({
        content: `❌ Could not remove punishment: ${String(e.message || e).slice(0, 200)}`,
      });
    } finally {
      conn.release();
    }
  }

  async function handleBoosterpuncheck(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const r = await pool.query(
      `SELECT * FROM punishment_logs
       WHERE status = 'active' AND punishment_status = 'active'
       ORDER BY created_at DESC LIMIT 25`
    );
    if (r.rows.length === 0) {
      return interaction.editReply({
        content: 'No finalized active punishments (manager-approved). Pending items are in `/checkqueue`.',
      });
    }
    const desc = r.rows
      .map((row) => `**${row.user_ign}** (#${row.id}) — ${(row.punishment_details || '').slice(0, 60)}`)
      .join('\n');
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Active punishments').setDescription(desc.slice(0, 3900))],
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('log')
      .setDescription('Log a punishment and send it to the manager review queue')
      .addStringOption((o) => o.setName('user-ign').setDescription('Player IGN').setRequired(true))
      .addStringOption((o) => o.setName('details').setDescription('Details').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('evidence')
          .setDescription('Proof link(s) — must include https:// (shown as links in /checkqueue)')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('adminlog')
      .setDescription('Admin: log punishment with custom duration (evidence optional)')
      .addStringOption((o) => o.setName('user-ign').setDescription('Player IGN').setRequired(true))
      .addStringOption((o) => o.setName('details').setDescription('Details').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('cooldown')
          .setDescription('Optional custom duration: d=days h=hours m=minutes (e.g. 1d, 12h, 1m)')
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('evidence')
          .setDescription('Optional proof link(s) (http/https)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('staffstats')
      .setDescription('View punishment log count and accuracy for a staff member')
      .addStringOption((o) => o.setName('ign').setDescription('Staff IGN / username').setRequired(true))
      .addStringOption((o) =>
        o.setName('start-date').setDescription('ISO date start (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('end-date').setDescription('ISO date end (optional)').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('history')
      .setDescription('View punishment and blacklist history for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('getproof')
      .setDescription('View evidence and details for punishments of a player (Manager+)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('totalhistory')
      .setDescription('View all punishments by status (Staff only)'),
    new SlashCommandBuilder()
      .setName('boosterpuncheck')
      .setDescription('View active (manager-approved) punishments'),
    new SlashCommandBuilder()
      .setName('checkqueue')
      .setDescription('Review punishment queue from /log — paged proof, Accept / Deny (Manager+)'),
    new SlashCommandBuilder()
      .setName('removepunishment')
      .setDescription('Delete a punishment log row (removes it from /history)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Punishment log id from /history (e.g. Punishment #42 → 42)')
          .setRequired(true)
          .setMinValue(1)
      ),
  ];

  return {
    commands,
    handlers: {
      log: handleLog,
      adminlog: handleAdminlog,
      staffstats: handleStaffstats,
      history: handleHistory,
      getproof: handleGetproof,
      totalhistory: handleTotalhistory,
      boosterpuncheck: handleBoosterpuncheck,
      checkqueue: handleCheckqueue,
      removepunishment: handleRemovepunishment,
    },
    buttonHandlers: [handlePunishmentQueueButton],
  };
};
