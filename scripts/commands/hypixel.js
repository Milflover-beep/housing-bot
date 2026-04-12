const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { fetchNetworkLevelForCheck } = require('../lib/hypixel');

module.exports = function hypixelSlash(ctx) {
  const { defer, normalizeIgn, requireLevel } = ctx;

  async function handleHypixel(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const result = await fetchNetworkLevelForCheck(process.env.HYPIXEL_API_KEY, ign);
    const embed = new EmbedBuilder().setTitle(`Hypixel: ${ign}`).setTimestamp();

    if (!result.ok) {
      embed.setColor(0xff1744).setDescription(result.message);
      return interaction.editReply({ embeds: [embed] });
    }
    if (!result.hasPlayer) {
      embed
        .setColor(0xffa000)
        .setDescription('No Hypixel player profile for this name/UUID (never joined or invalid).');
    } else {
      embed
        .setColor(0x57f287)
        .setDescription(`**Network level:** ${result.level.toFixed(2)}`);
    }
    return interaction.editReply({ embeds: [embed] });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('hypixel')
        .setDescription('Look up Hypixel network level for an IGN or UUID (Staff)')
        .addStringOption((o) =>
          o
            .setName('ign')
            .setDescription('Minecraft IGN, or UUID if longer than 16 characters')
            .setRequired(true)
        ),
    ],
    handlers: { hypixel: handleHypixel },
  };
};
