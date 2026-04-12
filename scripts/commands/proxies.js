const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = function proxiesCommands(ctx) {
  const { pool, isAdminOrOwner, defer } = ctx;

  async function handleProxies(interaction) {
    await defer(interaction, false);
    const r = await pool.query('SELECT * FROM proxies ORDER BY id DESC LIMIT 50');
    if (r.rows.length === 0) {
      return interaction.editReply({ content: 'Proxy list is empty.' });
    }
    const desc = r.rows.map((row) => `**#${row.id}** ${row.content?.slice(0, 200)} (by ${row.added_by})`).join('\n');
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Proxies').setDescription(desc.slice(0, 3900))],
    });
  }

  async function handleAddproxy(interaction) {
    await defer(interaction, false);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only (`[ADMIN BOT ACCESS]` or owner).' });
    }
    const content = interaction.options.getString('content');
    try {
      await pool.query(
        `INSERT INTO proxies (content, added_by, created_at) VALUES ($1, $2, NOW())`,
        [content, interaction.user.username]
      );
    } catch (e) {
      if (e.code === '23505' && /proxies/i.test(String(e.message))) {
        await pool.query(
          `SELECT setval(
            pg_get_serial_sequence('proxies', 'id'),
            (SELECT MAX(id) FROM proxies)
          )`
        );
        await pool.query(
          `INSERT INTO proxies (content, added_by, created_at) VALUES ($1, $2, NOW())`,
          [content, interaction.user.username]
        );
      } else {
        throw e;
      }
    }
    await interaction.editReply({ content: '✅ Proxy entry added.' });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('proxies')
      .setDescription('View the proxy list'),
    new SlashCommandBuilder()
      .setName('addproxy')
      .setDescription('Add an entry to the proxy list (Admin only)')
      .addStringOption((o) => o.setName('content').setDescription('Proxy text').setRequired(true)),
  ];

  return {
    commands,
    handlers: {
      proxies: handleProxies,
      addproxy: handleAddproxy,
    },
  };
};
