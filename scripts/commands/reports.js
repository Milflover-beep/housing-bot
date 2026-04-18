const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = function reportsCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn, resolveIgnIdentity } = ctx;

  async function handleBancheck(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const r = await pool.query(
      'SELECT * FROM reports WHERE LOWER(ign) = ANY($1::text[]) ORDER BY id DESC LIMIT 25',
      [ignAliases]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No reports for **${ign}**.` });
    }
    const desc = r.rows
      .map(
        (row) =>
          `**#${row.id}** — ${row.reason?.slice(0, 120)} — punishment: ${row.punishment_issued}${row.evidence_link ? ` — [evidence](${row.evidence_link})` : ''}`
      )
      .join('\n');
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Reports: ${ign}`)
          .setColor(0xf1c40f)
          .setDescription(desc.slice(0, 3900)),
      ],
    });
  }

  async function handleAcceptreport(interaction) {
    await defer(interaction, false);
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

  const commands = [
    new SlashCommandBuilder()
      .setName('bancheck')
      .setDescription('View reports for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
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
  ];

  return {
    commands,
    handlers: {
      bancheck: handleBancheck,
      acceptreport: handleAcceptreport,
    },
  };
};
