const { SlashCommandBuilder } = require('discord.js');

module.exports = function discordExtrasCommands(ctx) {
  const { requireLevel, defer } = ctx;

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

  const commands = [
    new SlashCommandBuilder()
      .setName('revokeargument')
      .setDescription('Revoke argument privileges for a user for 10 minutes')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
  ];

  return {
    commands,
    handlers: {
      revokeargument: handleRevokeargument,
    },
  };
};
