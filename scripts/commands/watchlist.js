const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function watchlistCommands(ctx) {
  const { pool, requireLevel, isAdminOrOwner, defer, normalizeIgn, getSlashSubcommand } = ctx;

  async function handleWatchlistAdd(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const ign = interaction.options.getString('ign');
    const reason = interaction.options.getString('reason');
    const threat = interaction.options.getString('threat-level');
    await pool.query(
      `INSERT INTO watchlist (ign, reason, threat_level, created_at) VALUES ($1, $2, $3, NOW())`,
      [ign, reason, threat]
    );
    await interaction.editReply({ content: `✅ Added **${ign}** to watchlist.` });
  }

  async function handleWatchlistRemove(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const r = await pool.query(
      'DELETE FROM watchlist WHERE LOWER(ign) = $1 RETURNING id',
      [ign]
    );
    await interaction.editReply({
      content: r.rowCount ? `✅ Removed watchlist rows for **${ign}**.` : '❌ No matching rows.',
    });
  }

  async function handleViewwatchlist(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const rows = await pool.query('SELECT * FROM watchlist ORDER BY id DESC LIMIT 50');
    if (rows.rows.length === 0) {
      return interaction.editReply({ content: 'Watchlist is empty.' });
    }
    const desc = rows.rows
      .map(
        (r) =>
          `**${r.ign}** — ${r.threat_level || '?'} — ${r.reason || ''} (id ${r.id})`
      )
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Watchlist')
      .setColor(0xe67e22)
      .setDescription(desc.slice(0, 3900));
    await interaction.editReply({ embeds: [embed] });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('watchlist')
      .setDescription('Add or remove a player on the watchlist (Admin only)')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a player to the watchlist')
          .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('threat-level')
              .setDescription('Threat level')
              .setRequired(true)
              .addChoices(
                { name: 'Low', value: 'low' },
                { name: 'Medium', value: 'medium' },
                { name: 'High', value: 'high' }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a player from the watchlist')
          .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('viewwatchlist')
      .setDescription('View all players on the watchlist (Manager+)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  ];

  return {
    commands,
    handlers: {
      watchlist: async (interaction) => {
        const sub = getSlashSubcommand(interaction);
        if (sub === 'add') return handleWatchlistAdd(interaction);
        return handleWatchlistRemove(interaction);
      },
      viewwatchlist: handleViewwatchlist,
    },
  };
};
