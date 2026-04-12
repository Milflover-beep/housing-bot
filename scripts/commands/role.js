const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function roleCommands(ctx) {
  const { pool, isAdminOrOwner, defer } = ctx;

  async function handleRoleblacklist(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const ign = interaction.options.getString('ign');
    const roleType = interaction.options.getString('role-type');
    const reason = interaction.options.getString('reason');
    const user = interaction.options.getUser('user');
    await pool.query(
      `INSERT INTO role_blacklists (ign, role_type, reason, discord_user_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [ign, roleType, reason, user ? user.id : null]
    );
    await interaction.editReply({ content: `✅ Added role blacklist for **${ign}** (${roleType}).` });
  }

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
      .setName('roleblacklist')
      .setDescription('Add a player to the role blacklist (Admin/Owner Only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('role-type').setDescription('Role type').setRequired(true)
      )
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Discord user (optional)').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('viewroleblacklist')
      .setDescription('View role blacklist entries (Admin/Owner Only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  return {
    commands,
    handlers: {
      roleblacklist: handleRoleblacklist,
      viewroleblacklist: handleViewroleblacklist,
    },
  };
};
