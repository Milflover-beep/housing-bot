const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function uuidCommands(ctx) {
  const { pool, isAdminOrOwner, defer, normalizeIgn } = ctx;

  async function handleEdituuid(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const ign = interaction.options.getString('ign').trim();
    const uuid = interaction.options.getString('uuid').trim();
    const existing = await pool.query('SELECT id FROM uuid_registry WHERE LOWER(ign) = $1', [
      normalizeIgn(ign),
    ]);
    if (existing.rows.length) {
      await pool.query('UPDATE uuid_registry SET uuid = $1 WHERE id = $2', [uuid, existing.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO uuid_registry (ign, uuid, created_at) VALUES ($1, $2, NOW())',
        [ign, uuid]
      );
    }
    await interaction.editReply({ content: `✅ UUID for **${ign}** set to \`${uuid}\`.` });
  }

  async function handleRemoveuuid(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const q = await pool.query('DELETE FROM uuid_registry WHERE LOWER(ign) = $1 RETURNING id', [ign]);
    await interaction.editReply({
      content: q.rowCount ? `✅ Removed UUID row(s) for **${ign}**.` : '❌ No row found.',
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('edituuid')
      .setDescription('Edit or add a UUID for an IGN (Admin Only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) => o.setName('uuid').setDescription('UUID').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('removeuuid')
      .setDescription('Remove a UUID from an IGN (Admin Only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  return {
    commands,
    handlers: {
      edituuid: handleEdituuid,
      removeuuid: handleRemoveuuid,
    },
  };
};
