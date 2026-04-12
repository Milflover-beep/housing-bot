const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const RANK_LETTER = { prime: 'P', elite: 'E', apex: 'A' };
const WEEKS = { prime: 1, elite: 2, apex: 3 };

module.exports = function applicationsCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn, applicantRoleName, applicantRoleIds } = ctx;
  const mgr = PermissionFlagsBits.ManageRoles;

  async function handleClearcooldown(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const discordUser = interaction.options.getUser('discord', true);
    const r = await pool.query('DELETE FROM application_denials WHERE discord_id = $1', [
      discordUser.id,
    ]);
    if (r.rowCount === 0) {
      return interaction.editReply({
        content: `No active application cooldown row for <@${discordUser.id}>.`,
      });
    }
    await interaction.editReply({
      content: `✅ Cleared application tryout cooldown for <@${discordUser.id}>.`,
    });
  }

  async function handleDeny(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const discordUser = interaction.options.getUser('discord', true);
    const typeStr = interaction.options.getString('type');
    const letter = RANK_LETTER[typeStr];
    const weeks = WEEKS[typeStr];
    const cooldownUntil = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO application_denials (discord_id, ign, rank_type, cooldown_until)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_id) DO UPDATE SET
         ign = EXCLUDED.ign,
         rank_type = EXCLUDED.rank_type,
         cooldown_until = EXCLUDED.cooldown_until,
         created_at = NOW()`,
      [discordUser.id, ign, letter, cooldownUntil]
    );

    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      const ids = applicantRoleIds();
      if (ids.length > 0) {
        for (const rid of ids) {
          let role = interaction.guild.roles.cache.get(rid);
          if (!role) role = await interaction.guild.roles.fetch(rid).catch(() => null);
          if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
          }
        }
      } else {
        const name = applicantRoleName();
        const role = interaction.guild.roles.cache.find((r) => r.name === name);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
        }
      }
    } catch (e) {
      console.warn('deny: applicant role:', e.message);
    }

    await interaction.editReply({
      content:
        `✅ Denied **${ign}** (<@${discordUser.id}>) for **${typeStr}** tryout.\n` +
        `Cooldown until <t:${Math.floor(cooldownUntil.getTime() / 1000)}:F> (${weeks} week${
          weeks > 1 ? 's' : ''
        }).`,
    });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('clearcooldown')
        .setDescription('Remove application tryout cooldown (undo a mistaken /deny)')
        .addUserOption((o) =>
          o.setName('discord').setDescription('Discord user').setRequired(true)
        )
        .setDefaultMemberPermissions(mgr),
      new SlashCommandBuilder()
        .setName('deny')
        .setDescription('Deny an application: remove applicant role and set tryout cooldown')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
        .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Rank ladder (cooldown: Prime 1wk, Elite 2wk, Apex 3wk)')
            .setRequired(true)
            .addChoices(
              { name: 'Prime (1 week)', value: 'prime' },
              { name: 'Elite (2 weeks)', value: 'elite' },
              { name: 'Apex (3 weeks)', value: 'apex' }
            )
        )
        .setDefaultMemberPermissions(mgr),
    ],
    handlers: { clearcooldown: handleClearcooldown, deny: handleDeny },
  };
};
