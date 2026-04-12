const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function reportsCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn } = ctx;
  const mgr = PermissionFlagsBits.ManageRoles;

  async function handleReport(interaction) {
    await defer(interaction, true);
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const reason = interaction.options.getString('reason');
    await pool.query(
      `INSERT INTO reports (ign, reason, punishment_issued, discord_user_id, date_issued)
       VALUES ($1, $2, false, $3, NOW())`,
      [ign, reason, interaction.user.id]
    );
    await interaction.editReply({
      content: `✅ Report submitted for **${ign}**. Staff will review it.`,
    });
  }

  async function handleBancheck(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const r = await pool.query(
      'SELECT * FROM reports WHERE LOWER(ign) = $1 ORDER BY id DESC LIMIT 25',
      [ign]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No reports for **${ign}**.` });
    }
    const desc = r.rows
      .map(
        (row) =>
          `**#${row.id}** — ${row.reason?.slice(0, 120)} — punishment: ${row.punishment_issued}`
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
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const id = interaction.options.getInteger('id');
    const reason = interaction.options.getString('reason');
    const punished = interaction.options.getBoolean('punishment-issued');
    const q = await pool.query(
      `UPDATE reports SET punishment_issued = $1, reason = COALESCE($2, reason) WHERE id = $3 RETURNING *`,
      [punished, reason, id]
    );
    if (q.rows.length === 0) {
      return interaction.editReply({ content: '❌ No report with that id.' });
    }
    await interaction.editReply({ content: `✅ Updated report **#${id}**.` });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('report')
      .setDescription('Submit a report against a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder()
      .setName('bancheck')
      .setDescription('View reports for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('acceptreport')
      .setDescription('Accept a player report with reason and punishment status')
      .addIntegerOption((o) => o.setName('id').setDescription('report id').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Staff reason / note').setRequired(true))
      .addBooleanOption((o) =>
        o.setName('punishment-issued').setDescription('Punishment issued?').setRequired(true)
      )
      .setDefaultMemberPermissions(mgr),
  ];

  return {
    commands,
    handlers: {
      report: handleReport,
      bancheck: handleBancheck,
      acceptreport: handleAcceptreport,
    },
  };
};
