const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = function discordExtrasCommands(ctx) {
  const { pool, requireLevel, defer } = ctx;

  async function handleRevokeargument(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const user = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.editReply({ content: '❌ Could not fetch member (enable **Server Members Intent**).' });
    }
    await member.timeout(10 * 60 * 1000, 'revoke argument privileges');
    await interaction.editReply({ content: `✅ Timed out ${user} for 10 minutes.` });
  }

  async function handleGradientrequests(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const rows = await pool.query(
      "SELECT * FROM gradient_requests WHERE status = 'pending' ORDER BY id ASC LIMIT 25"
    );
    if (!rows.rows.length) {
      return interaction.editReply({ content: 'No pending gradient requests.' });
    }
    const desc = rows.rows.map((r) => `**#${r.id}** <@${r.discord_user_id}> — ${r.note || ''}`).join('\n');
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Gradient requests').setDescription(desc.slice(0, 3900))],
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('revokeargument')
      .setDescription('Revoke argument privileges for a user for 10 minutes')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    new SlashCommandBuilder()
      .setName('gradientrequests')
      .setDescription('View pending gradient role requests'),
  ];

  return {
    commands,
    handlers: {
      revokeargument: handleRevokeargument,
      gradientrequests: handleGradientrequests,
    },
  };
};
