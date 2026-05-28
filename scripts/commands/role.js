const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function roleCommands(ctx) {
  const { pool, isAdminOrOwner, defer } = ctx;

  async function handleViewroleblacklist(interaction) {
    await defer(interaction, false);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const r = await pool.query('SELECT * FROM role_blacklists ORDER BY id DESC LIMIT 40');
    if (!r.rows.length) {
      return interaction.editReply({ content: 'No role blacklist rows.' });
    }
    const desc = r.rows
      .map((row) => `**#${row.id}** \`${row.ign}\` — ${row.role_type} — ${row.reason}`)
      .join('\n');
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Role blacklists').setDescription(desc.slice(0, 3900))],
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('viewroleblacklist')
      .setDescription('View role blacklist entries (Admin/Owner Only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  return {
    commands,
    handlers: {
      viewroleblacklist: handleViewroleblacklist,
    },
  };
};
