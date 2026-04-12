const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function punishmentCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn, getSlashSubcommand, resolveGuildMember } = ctx;
  const mgr = PermissionFlagsBits.ManageRoles;

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
    const userIgn = interaction.options.getString('user-ign');
    const details = interaction.options.getString('details');
    const evidence = interaction.options.getString('evidence') || '';
    const punishment = interaction.options.getString('punishment') || 'other';
    const staffIgn = interaction.user.username;
    const staffDiscordId = String(interaction.user.id);

    try {
      const ins = await pool.query(
        `INSERT INTO punishment_logs (user_ign, staff_ign, evidence, punishment_details, date, discord_user, punishment, created_at, status, punishment_status)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, NOW(), 'queued', 'pending_review')
         RETURNING id`,
        [userIgn, staffIgn, evidence, details, staffDiscordId, punishment]
      );
      const logId = ins.rows[0].id;

      const summary = `${punishment}: ${(details || '').slice(0, 200)}`;
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
          `Managers use \`/checkqueue list\` → \`/checkqueue proof\` → \`/checkqueue accept\` or \`/deny\`.`,
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
          `Confirm \`punishment_logs\` and \`punishment_queue\` match \`schema.sql\` (including \`punishment_log_id\` on the queue).`,
      });
    }
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
        line: `**Punishment** #${row.id} — ${row.punishment || '?'} — ${(row.punishment_details || '').slice(0, 120)} (${row.status}/${row.punishment_status})`,
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
        `**#${row.id}** ${row.punishment}\nDetails: ${row.punishment_details || '—'}\nEvidence: ${
          row.evidence || '—'
        }\nStatus: ${row.status} / ${row.punishment_status}\n`
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
        content: 'No finalized active punishments (manager-approved). Pending items are in `/checkqueue list`.',
      });
    }
    const desc = r.rows.map((row) => `**${row.user_ign}** — ${row.punishment} (#${row.id})`).join('\n');
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Active punishments').setDescription(desc.slice(0, 3900))],
    });
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

  async function handleCheckqueue(interaction) {
    const sub = getSlashSubcommand(interaction);
    const ephemeral = sub === 'proof';
    await defer(interaction, ephemeral);
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
    if (!sub) {
      return interaction.editReply({
        content:
          '❌ Pick a subcommand: `list`, `proof`, `accept`, or `deny`. If you did, re-register slash commands and pick the subcommand from the menu.',
      });
    }

    if (sub === 'list') {
      const r = await pool.query(
        "SELECT * FROM punishment_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 25"
      );
      if (r.rows.length === 0) {
        return interaction.editReply({ content: 'Queue is empty (no pending items).' });
      }
      const lines = r.rows.map(
        (row) =>
          `**Queue #${row.id}** → log **#${row.punishment_log_id || '?'}** — \`${row.ign}\` — ${(row.details || '').slice(0, 100)}`
      );
      return interaction.editReply({ content: lines.join('\n').slice(0, 3900) });
    }

    if (sub === 'proof') {
      const queueId = interaction.options.getInteger('queue-id');
      const row = await getQueueRow(queueId);
      if (!row || row.status !== 'pending') {
        return interaction.editReply({ content: '❌ No pending queue item with that id.' });
      }
      const log = await getLogForQueue(row);
      if (!log) {
        return interaction.editReply({ content: '❌ Queue row has no linked punishment log.' });
      }
      const embed = new EmbedBuilder()
        .setTitle(`Proof — queue #${queueId} / log #${log.id}`)
        .setColor(0x5865f2)
        .addFields(
          { name: 'Player', value: log.user_ign || '—', inline: true },
          { name: 'Punishment', value: log.punishment || '—', inline: true },
          { name: 'Staff', value: log.staff_ign || '—', inline: true },
          { name: 'Details', value: (log.punishment_details || '—').slice(0, 1000) },
          { name: 'Evidence', value: (log.evidence || '—').slice(0, 1000) },
          { name: 'Status', value: `${log.status} / ${log.punishment_status}`, inline: true }
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    const queueId = interaction.options.getInteger('queue-id');
    const row = await getQueueRow(queueId);
    if (!row || row.status !== 'pending') {
      return interaction.editReply({ content: '❌ No pending queue item with that id.' });
    }
    const log = await getLogForQueue(row);
    if (!log) {
      return interaction.editReply({ content: '❌ Missing punishment log for this queue row.' });
    }

    if (sub === 'accept') {
      await pool.query(
        `UPDATE punishment_logs SET status = 'active', punishment_status = 'active' WHERE id = $1`,
        [log.id]
      );
      await pool.query(`UPDATE punishment_queue SET status = 'accepted' WHERE id = $1`, [queueId]);
      return interaction.editReply({
        content: `✅ Accepted punishment **log #${log.id}** (queue **#${queueId}**). It is now enforced.`,
      });
    }

    if (sub === 'deny') {
      await pool.query(
        `UPDATE punishment_logs SET status = 'void', punishment_status = 'denied' WHERE id = $1`,
        [log.id]
      );
      await pool.query(`UPDATE punishment_queue SET status = 'denied' WHERE id = $1`, [queueId]);
      return interaction.editReply({
        content: `✅ Denied punishment **log #${log.id}** (queue **#${queueId}**).`,
      });
    }

    return interaction.editReply({ content: '❌ Unknown subcommand.' });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('log')
      .setDescription('Log a punishment and send it to the manager review queue')
      .addStringOption((o) => o.setName('user-ign').setDescription('Player IGN').setRequired(true))
      .addStringOption((o) => o.setName('details').setDescription('Details').setRequired(true))
      .addStringOption((o) => o.setName('evidence').setDescription('Evidence URL/text').setRequired(false))
      .addStringOption((o) =>
        o.setName('punishment').setDescription('Type').setRequired(false)
      )
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('history')
      .setDescription('View punishment and blacklist history for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('getproof')
      .setDescription('View evidence and details for punishments of a player (Manager+)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('totalhistory')
      .setDescription('View all punishments by status (Staff only)')
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('boosterpuncheck')
      .setDescription('View active (manager-approved) punishments')
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('checkqueue')
      .setDescription('Review punishment queue from /log (Manager+)')
      .addSubcommand((s) => s.setName('list').setDescription('List pending items'))
      .addSubcommand((s) =>
        s
          .setName('proof')
          .setDescription('Show full proof for a queue item')
          .addIntegerOption((o) =>
            o.setName('queue-id').setDescription('punishment_queue.id').setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName('accept')
          .setDescription('Approve the punishment')
          .addIntegerOption((o) =>
            o.setName('queue-id').setDescription('punishment_queue.id').setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName('deny')
          .setDescription('Reject the punishment')
          .addIntegerOption((o) =>
            o.setName('queue-id').setDescription('punishment_queue.id').setRequired(true)
          )
      ),
  ];

  return {
    commands,
    handlers: {
      log: handleLog,
      history: handleHistory,
      getproof: handleGetproof,
      totalhistory: handleTotalhistory,
      boosterpuncheck: handleBoosterpuncheck,
      checkqueue: handleCheckqueue,
    },
  };
};
