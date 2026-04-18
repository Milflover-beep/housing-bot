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
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
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
      .setName('bancheck')
      .setDescription('View reports for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('acceptreport')
      .setDescription('Accept a player report with reason and punishment status')
      .addIntegerOption((o) => o.setName('id').setDescription('report id').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Staff reason / note').setRequired(true))
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
