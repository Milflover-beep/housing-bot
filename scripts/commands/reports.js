const { SlashCommandBuilder } = require('discord.js');

module.exports = function reportsCommands(ctx) {
  const { pool, requireLevel, defer, resolveIgnIdentity } = ctx;

  async function handleAcceptreport(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const reason = interaction.options.getString('reason');
    const evidenceLink = interaction.options.getString('evidence-link');
    const punished = interaction.options.getBoolean('punishment-issued');

    const q = await pool.query(
      `INSERT INTO reports (ign, reason, evidence_link, punishment_issued, discord_user_id, date_issued)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [ign, reason, evidenceLink, punished, interaction.user.id]
    );
    const totalReports = await pool.query('SELECT COUNT(*)::int AS c FROM reports WHERE LOWER(ign) = $1', [ign]);
    const totalWithPunishment = await pool.query(
      'SELECT COUNT(*)::int AS c FROM reports WHERE LOWER(ign) = $1 AND punishment_issued = true',
      [ign]
    );

    await interaction.editReply({
      content:
        `✅ Logged report **#${q.rows[0].id}** for **${ign}**.\n` +
        `- Punishment issued: **${punished}**\n` +
        `- Total reports on player: **${totalReports.rows[0]?.c || 0}**\n` +
        `- Reports with punishment issued: **${totalWithPunishment.rows[0]?.c || 0}**`,
    });
  }

  async function handleReportcheck(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const q = await pool.query(
      `SELECT id, ign, reason, evidence_link, punishment_issued, date_issued
       FROM reports
       WHERE LOWER(ign) = ANY($1::text[])
       ORDER BY date_issued DESC, id DESC
       LIMIT 200`,
      [ignAliases]
    );
    if (!q.rows.length) {
      return interaction.editReply({ content: `No reports found for **${ign}**.` });
    }
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = [];
    const older = [];
    for (const row of q.rows) {
      const t = row.date_issued ? new Date(row.date_issued).getTime() : 0;
      const line =
        `**#${row.id}** — ${row.date_issued ? new Date(row.date_issued).toLocaleString() : '—'}\n` +
        `Reason: ${row.reason || '—'}\n` +
        `Punishment issued: **${row.punishment_issued ? 'Yes' : 'No'}**\n` +
        `Evidence: ${row.evidence_link || '—'}`;
      if (t >= cutoffMs) recent.push(line);
      else older.push(line);
    }
    const recentBody = recent.length ? recent.join('\n\n').slice(0, 1700) : '_No reports in the last 30 days._';
    const olderBody = older.length ? older.join('\n\n').slice(0, 1700) : '_No older reports._';
    const content =
      `**Report check: ${ign}**\n\n` +
      `**Reports in last 30 days**\n${recentBody}\n\n` +
      `**Older reports**\n${olderBody}`;
    await interaction.editReply({ content: content.slice(0, 3900) });
  }

  async function handleRemovereport(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const id = interaction.options.getInteger('id', true);
    const q = await pool.query(
      `DELETE FROM reports
       WHERE id = $1
       RETURNING id, ign, reason, punishment_issued`,
      [id]
    );
    if (!q.rows.length) {
      return interaction.editReply({ content: `❌ No report found with ID **${id}**.` });
    }
    const row = q.rows[0];
    await interaction.editReply({
      content:
        `✅ Removed report **#${row.id}** for **${row.ign || 'unknown'}**.\n` +
        `Reason: ${row.reason || '—'}\n` +
        `Punishment issued: **${row.punishment_issued ? 'Yes' : 'No'}**`,
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('acceptreport')
      .setDescription('Log an accepted player report')
      .addStringOption((o) => o.setName('ign').setDescription('Reported player IGN').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Staff reason / note').setRequired(true))
      .addStringOption((o) =>
        o.setName('evidence-link').setDescription('Evidence URL').setRequired(true)
      )
      .addBooleanOption((o) =>
        o.setName('punishment-issued').setDescription('Punishment issued?').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('reportcheck')
      .setDescription('View report history for a player (last 30 days and older)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('removereport')
      .setDescription('Remove a report by report ID (Manager+ only)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Report ID')
          .setRequired(true)
          .setMinValue(1)
      ),
  ];

  return {
    commands,
    handlers: {
      acceptreport: handleAcceptreport,
      reportcheck: handleReportcheck,
      removereport: handleRemovereport,
    },
  };
};
