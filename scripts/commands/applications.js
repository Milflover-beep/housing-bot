const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const RANK_LETTER = { prime: 'P', elite: 'E', apex: 'A' };
const WEEKS = { prime: 1, elite: 2, apex: 3 };
const RANK_LABEL = { prime: 'Prime', elite: 'Elite', apex: 'Apex' };

module.exports = function applicationsCommands(ctx) {
  const {
    pool,
    requireLevel,
    defer,
    normalizeIgn,
    applicantRoleName,
    applicantRoleIds,
    parseRoleIdList,
    resolveGuildMember,
  } = ctx;

  /** Remove configured applicant role(s) from a guild member (same logic as /deny). */
  async function removeApplicantRole(guild, member) {
    const ids = applicantRoleIds();
    if (ids.length > 0) {
      for (const rid of ids) {
        let role = guild.roles.cache.get(rid);
        if (!role) role = await guild.roles.fetch(rid).catch(() => null);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
        }
      }
    } else {
      const name = applicantRoleName();
      const role = guild.roles.cache.find((r) => r.name === name);
      if (role && member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
      }
    }
  }

  /** Role to ping on /accept rank-request message: ACCEPT_PING_ROLE_ID, else RANK_REQUEST_PING_ROLE_ID, else default. */
  const DEFAULT_RANK_REQUEST_PING_ROLE_ID = '1141836985711997039';

  function acceptPingRoleId() {
    const fromAccept = parseRoleIdList('ACCEPT_PING_ROLE_ID');
    if (fromAccept.length > 0) return fromAccept[0];
    const fromRank = parseRoleIdList('RANK_REQUEST_PING_ROLE_ID');
    if (fromRank.length > 0) return fromRank[0];
    return DEFAULT_RANK_REQUEST_PING_ROLE_ID;
  }

  async function handleClearcooldown(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
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
    const staff = await resolveGuildMember(interaction);
    if (!requireLevel(staff, 2)) {
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
      await removeApplicantRole(interaction.guild, member);
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

  async function handleAccept(interaction) {
    await defer(interaction, false);
    const staff = await resolveGuildMember(interaction);
    if (!requireLevel(staff, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const discordUser = interaction.options.getUser('discord', true);
    const typeStr = interaction.options.getString('type');
    const winFraction = interaction.options.getString('win-fraction');

    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      await removeApplicantRole(interaction.guild, member);
    } catch (e) {
      console.warn('accept: applicant role:', e.message);
    }

    try {
      await pool.query('DELETE FROM application_denials WHERE discord_id = $1', [discordUser.id]);
    } catch (e) {
      if (e && e.code !== '42P01') throw e;
    }

    const notifyChannelId = parseRoleIdList('ACCEPT_NOTIFY_CHANNEL_ID')[0];
    const pingRoleId = acceptPingRoleId();
    const rankLabel = RANK_LABEL[typeStr] || typeStr;
    const winPart = winFraction && String(winFraction).trim() ? ` ${String(winFraction).trim()}` : '';

    if (notifyChannelId && pingRoleId) {
      try {
        const channel = await interaction.client.channels.fetch(notifyChannelId);
        if (channel?.isTextBased?.()) {
          const pingMention = `<@&${pingRoleId}>`;
          const bodyLine = `**${ign}** <@${discordUser.id}> needs **${rankLabel}**!${winPart}`;
          const embed = new EmbedBuilder()
            .setTitle('Rank Request')
            .setDescription(`${bodyLine} ${pingMention}`)
            .setColor(0xffc107)
            .addFields(
              { name: 'Player IGN', value: ign, inline: true },
              { name: 'Discord User', value: `<@${discordUser.id}>`, inline: true },
              { name: 'Rank Type', value: typeStr, inline: true }
            )
            .setTimestamp();
          if (winFraction && String(winFraction).trim()) {
            embed.addFields({ name: 'Win fraction', value: String(winFraction).trim(), inline: true });
          }
          await channel.send({ content: pingMention, embeds: [embed] });
        }
      } catch (e) {
        console.warn('accept: notify channel:', e?.message || e);
      }
    }

    let note = '';
    if (!notifyChannelId) {
      note = '\n\n⚠️ Set **ACCEPT_NOTIFY_CHANNEL_ID** in the bot environment to post rank-request embeds.';
    }

    await interaction.editReply({
      content: `✅ Accepted **${ign}** (<@${discordUser.id}>) for **${typeStr}** tryout. Applicant role removed.${note}`,
    });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('clearcooldown')
        .setDescription('Remove application tryout cooldown (undo a mistaken /deny)')
        .addUserOption((o) =>
          o.setName('discord').setDescription('Discord user').setRequired(true)
        ),
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
        ),
      new SlashCommandBuilder()
        .setName('accept')
        .setDescription('Accept an applicant: remove applicant role and notify managers')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
        .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Rank ladder they are applying for')
            .setRequired(true)
            .addChoices(
              { name: 'Prime', value: 'prime' },
              { name: 'Elite', value: 'elite' },
              { name: 'Apex', value: 'apex' }
            )
        )
        .addStringOption((o) =>
          o.setName('win-fraction').setDescription('Optional, e.g. 14/20').setRequired(false)
        ),
    ],
    handlers: { clearcooldown: handleClearcooldown, deny: handleDeny, accept: handleAccept },
  };
};
