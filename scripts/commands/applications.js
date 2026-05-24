const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { syncTierListChannel } = require('../lib/tierListChannelSync');

const RANK_LETTER = { prime: 'P', elite: 'E', apex: 'A' };
const WEEKS = { prime: 1, elite: 2, apex: 3 };
const RANK_LABEL = { prime: 'Prime', elite: 'Elite', apex: 'Apex', pm: 'PM' };
const DEFAULT_COOLDOWN_MS = {
  prime: 7 * 24 * 60 * 60 * 1000,
  elite: 14 * 24 * 60 * 60 * 1000,
  apex: 21 * 24 * 60 * 60 * 1000,
};
const BOOSTER_COOLDOWN_MS = {
  prime: 4 * 24 * 60 * 60 * 1000,
  elite: 7 * 24 * 60 * 60 * 1000,
  apex: Math.floor(10.5 * 24 * 60 * 60 * 1000),
};
const DEFAULT_DENY_ACCEPT_RESULTS_CHANNEL_ID = '1439866722038452314';

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
    parseCooldownToMs,
    resolveIgnIdentity,
    VALID_TIERS,
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

  /** Role to ping on /accept rank-request message. */

  function acceptPingRoleId() {
    const fromAccept = parseRoleIdList('ACCEPT_PING_ROLE_ID');
    return fromAccept.length > 0 ? fromAccept[0] : null;
  }

  function isBoosterMember(member) {
    if (!member?.roles?.cache) return false;
    const boosterIds = parseRoleIdList('BOT_ROLE_BOOSTER_ID');
    if (boosterIds.length > 0) return boosterIds.some((id) => member.roles.cache.has(id));
    const boosterName = String(process.env.BOT_ROLE_BOOSTER_NAME || '').trim();
    return boosterName ? member.roles.cache.some((r) => r.name === boosterName) : false;
  }

  async function fetchApplicantMember(guild, discordUserId) {
    if (!guild || !discordUserId) return null;
    try {
      return await guild.members.fetch(discordUserId);
    } catch {
      return null;
    }
  }

  async function clearApplicationDenyCooldown(discordUserId) {
    try {
      await pool.query('DELETE FROM application_denials WHERE discord_id = $1', [discordUserId]);
    } catch (e) {
      if (e && e.code !== '42P01') throw e;
    }
  }

  async function applyDenyCooldownPolicy({ typeStr, customCooldownRaw, applicantMember, discordUserId, ign }) {
    const isPmDeny = typeStr === 'pm';
    if (isPmDeny) {
      await clearApplicationDenyCooldown(discordUserId);
      return {
        isPmDeny: true,
        cooldownUntil: null,
        cooldownSummary: 'none',
      };
    }

    const customCooldownMs = parseCooldownToMs(customCooldownRaw);
    if (customCooldownRaw && customCooldownMs === undefined) {
      return {
        error:
          '❌ Invalid cooldown format. Use one number and one unit: `d` days, `h` hours, `m` minutes (e.g. `3d`, `12h`, `30m`).',
      };
    }

    const letter = RANK_LETTER[typeStr];
    const boosterReduced = isBoosterMember(applicantMember);
    const baseCooldownMs = boosterReduced ? BOOSTER_COOLDOWN_MS[typeStr] : DEFAULT_COOLDOWN_MS[typeStr];
    const cooldownMs = customCooldownMs != null ? customCooldownMs : baseCooldownMs;
    const cooldownUntil = new Date(Date.now() + cooldownMs);
    const boosterCooldownLabel =
      typeStr === 'apex' ? '1.5 weeks' : typeStr === 'elite' ? '1 week' : '4 days';
    const cooldownSummary =
      customCooldownMs != null
        ? `custom duration **${customCooldownRaw.trim()}**`
        : boosterReduced
          ? `booster reduced duration **${boosterCooldownLabel}**`
          : `${WEEKS[typeStr]} week${WEEKS[typeStr] > 1 ? 's' : ''}`;

    await pool.query(
      `INSERT INTO application_denials (discord_id, ign, rank_type, cooldown_until)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_id) DO UPDATE SET
         ign = EXCLUDED.ign,
         rank_type = EXCLUDED.rank_type,
         cooldown_until = EXCLUDED.cooldown_until,
         created_at = NOW()`,
      [discordUserId, ign, letter, cooldownUntil]
    );

    return { isPmDeny: false, cooldownUntil, cooldownSummary };
  }

  async function applyPmAcceptPlacement(ign) {
    await pool.query(
      `INSERT INTO pm_list (ign, created_at)
       SELECT $1, NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM pm_list WHERE LOWER(TRIM(ign)) = LOWER(TRIM($1::text))
       )`,
      [ign]
    );
    try {
      await pool.query(
        `INSERT INTO pm_membership_periods (ign, start_at, created_at)
         SELECT $1, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1
           FROM pm_membership_periods
           WHERE LOWER(TRIM(ign)) = LOWER(TRIM($1::text))
             AND end_at IS NULL
         )`,
        [ign]
      );
    } catch (e) {
      if (e && e.code !== '42P01') throw e;
    }
  }

  async function applyTierAcceptPlacement({ ign, ignAliases, typeStr, tier, discordUserId, tester, client }) {
    const typeLetter = RANK_LETTER[typeStr];
    await pool.query('DELETE FROM tier_results WHERE LOWER(ign) = ANY($1::text[])', [ignAliases]);
    await pool.query(
      `INSERT INTO tier_results (ign, type, tier, discord_id, created_at, tester)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [ign, typeLetter, tier, discordUserId, tester]
    );
    await pool.query(
      `INSERT INTO tier_history (ign, type, tier, discord_id, rated_at, tester)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [ign, typeLetter, tier, discordUserId, tester]
    );
    await syncTierListChannel(client, pool);
  }

  async function sendApplicationResultLog(interaction, data) {
    try {
      const channelId =
        process.env.DENY_ACCEPT_RESULTS_CHANNEL_ID || DEFAULT_DENY_ACCEPT_RESULTS_CHANNEL_ID;
      if (!channelId) return;
      const channel = await interaction.client.channels.fetch(channelId);
      if (!channel?.isTextBased?.()) return;

      const statusColor = {
        accepted: 0x2ecc71, // green
        denied: 0xe74c3c, // red
        aborted: 0xf1c40f, // yellow
      };
      const statusTitle = {
        accepted: 'Application Accepted',
        denied: 'Application Denied',
        aborted: 'Application Aborted',
      };

      const embed = new EmbedBuilder()
        .setTitle(statusTitle[data.status] || 'Application Update')
        .setColor(statusColor[data.status] || 0x95a5a6)
        .addFields(
          { name: 'IGN', value: data.ign || 'N/A', inline: true },
          { name: 'Discord', value: data.discordMention || 'N/A', inline: true },
          { name: 'Rank Type', value: data.rankType || 'N/A', inline: true },
          { name: 'Cooldown', value: data.cooldown || 'None', inline: true },
          { name: 'Handled By', value: data.handledBy || 'N/A', inline: true }
        )
        .setTimestamp();

      if (data.tier) {
        embed.addFields({ name: 'Tier', value: data.tier, inline: true });
      }

      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.warn('application result log channel send failed:', e?.message || e);
    }
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

  async function handleViewcooldown(interaction) {
    await defer(interaction, true);
    let row = null;
    try {
      const r = await pool.query(
        `SELECT ign, rank_type, cooldown_until
         FROM application_denials
         WHERE discord_id = $1
           AND cooldown_until > NOW()
         ORDER BY cooldown_until DESC
         LIMIT 1`,
        [interaction.user.id]
      );
      row = r.rows[0] || null;
    } catch (e) {
      if (e && e.code !== '42P01') throw e;
    }

    if (!row) {
      return interaction.editReply({
        content: '✅ You currently have **no active application cooldown**.',
      });
    }
    const ts = Math.floor(new Date(row.cooldown_until).getTime() / 1000);
    const rankMap = { P: 'Prime', E: 'Elite', A: 'Apex' };
    const rankLabel = rankMap[String(row.rank_type || '').toUpperCase()] || 'Unknown';
    return interaction.editReply({
      content:
        `⏳ You are currently on cooldown.\n` +
        `IGN: **${row.ign || 'unknown'}**\n` +
        `Rank type: **${rankLabel}**\n` +
        `Ends: <t:${ts}:F> (<t:${ts}:R>)`,
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
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const discordUser = interaction.options.getUser('discord', true);
    const typeStr = interaction.options.getString('type');
    const customCooldownRaw = interaction.options.getString('cooldown');
    const applicantMember = await fetchApplicantMember(interaction.guild, discordUser.id);
    const cooldownPolicy = await applyDenyCooldownPolicy({
      typeStr,
      customCooldownRaw,
      applicantMember,
      discordUserId: discordUser.id,
      ign,
    });
    if (cooldownPolicy.error) {
      return interaction.editReply({ content: cooldownPolicy.error });
    }
    const { isPmDeny, cooldownUntil, cooldownSummary } = cooldownPolicy;

    try {
      if (applicantMember) await removeApplicantRole(interaction.guild, applicantMember);
    } catch (e) {
      console.warn('deny: applicant role:', e?.message || e);
    }

    await interaction.editReply({
      content:
        isPmDeny
          ? `✅ Denied **${ign}** (<@${discordUser.id}>) for **PM** tryout.\nNo cooldown was applied.`
          : `✅ Denied **${ign}** (<@${discordUser.id}>) for **${typeStr}** tryout.\nCooldown until <t:${Math.floor(
              cooldownUntil.getTime() / 1000
            )}:F> (${cooldownSummary}).`,
    });

    await sendApplicationResultLog(interaction, {
      status: 'denied',
      ign,
      discordMention: `<@${discordUser.id}>`,
      rankType: RANK_LABEL[typeStr] || typeStr,
      cooldown: isPmDeny ? 'None' : `<t:${Math.floor(cooldownUntil.getTime() / 1000)}:F>`,
      handledBy: `<@${interaction.user.id}>`,
    });
  }

  async function handleAbort(interaction) {
    await defer(interaction, false);
    const staff = await resolveGuildMember(interaction);
    if (!requireLevel(staff, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign', true));
    const ign = identity.canonicalIgn || identity.ign;
    const typeStr = interaction.options.getString('type', true);
    const discordUser = interaction.options.getUser('discord', true);

    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      await removeApplicantRole(interaction.guild, member);
    } catch (e) {
      console.warn('abort: applicant role:', e.message);
    }

    await interaction.editReply({ content: '✅ Application aborted. Application role removed.' });

    await sendApplicationResultLog(interaction, {
      status: 'aborted',
      ign,
      discordMention: `<@${discordUser.id}>`,
      rankType: RANK_LABEL[typeStr] || typeStr,
      cooldown: 'None',
      handledBy: `<@${interaction.user.id}>`,
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
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const discordUser = interaction.options.getUser('discord', true);
    const typeStr = interaction.options.getString('type');
    const tier = interaction.options.getString('tier');
    const isPmAccept = typeStr === 'pm';

    if (!isPmAccept && !tier) {
      return interaction.editReply({
        content: '❌ `tier` is required for Prime/Elite/Apex accepts.',
      });
    }
    if (!isPmAccept && !VALID_TIERS.includes(tier)) {
      return interaction.editReply({
        content: `❌ Invalid tier \`${tier}\`. Valid tiers: ${VALID_TIERS.join(', ')}`,
      });
    }
    const tester = interaction.user.username;
    if (isPmAccept) {
      await applyPmAcceptPlacement(ign);
    } else {
      await applyTierAcceptPlacement({
        ign,
        ignAliases,
        typeStr,
        tier,
        discordUserId: discordUser.id,
        tester,
        client: interaction.client,
      });
    }

    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      await removeApplicantRole(interaction.guild, member);
    } catch (e) {
      console.warn('accept: applicant role:', e.message);
    }

    await clearApplicationDenyCooldown(discordUser.id);

    const notifyChannelId = parseRoleIdList('ACCEPT_NOTIFY_CHANNEL_ID')[0];
    const pingRoleId = acceptPingRoleId();
    const rankLabel = RANK_LABEL[typeStr] || typeStr;

    if (notifyChannelId && pingRoleId) {
      try {
        const channel = await interaction.client.channels.fetch(notifyChannelId);
        if (channel?.isTextBased?.()) {
          const pingMention = `<@&${pingRoleId}>`;
          const bodyLine = `**${ign}** <@${discordUser.id}> needs **${rankLabel}**!`;
          const embed = new EmbedBuilder()
            .setTitle('Rank Request')
            .setDescription(`${bodyLine} ${pingMention}`)
            .setColor(0xffc107)
            .addFields(
              { name: 'Player IGN', value: ign, inline: true },
              { name: 'Discord User', value: `<@${discordUser.id}>`, inline: true },
              { name: 'Rank Type', value: rankLabel, inline: true },
              { name: 'Tier', value: tier || 'N/A', inline: true }
            )
            .setTimestamp();
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
      content:
        isPmAccept
          ? `✅ Accepted **${ign}** (<@${discordUser.id}>) for **PM**. Added to **pm_list** and ensured an open PM membership period. Applicant role removed.${note}`
          : `✅ Accepted **${ign}** (<@${discordUser.id}>) for **${typeStr}** (**${tier}**). Recorded in **tier_results** / **tier_history** and tier list channel synced. Applicant role removed.${note}`,
    });

    await sendApplicationResultLog(interaction, {
      status: 'accepted',
      ign,
      discordMention: `<@${discordUser.id}>`,
      rankType: RANK_LABEL[typeStr] || typeStr,
      cooldown: 'None',
      tier: isPmAccept ? null : tier,
      handledBy: `<@${interaction.user.id}>`,
    });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('viewcooldown')
        .setDescription('Check your own current application cooldown'),
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
            .setDescription('Rank ladder (PM denies do not apply cooldown)')
            .setRequired(true)
            .addChoices(
              { name: 'Prime (1 week)', value: 'prime' },
              { name: 'Elite (2 weeks)', value: 'elite' },
              { name: 'Apex (3 weeks)', value: 'apex' },
              { name: 'PM (no cooldown)', value: 'pm' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('cooldown')
            .setDescription('Optional override for Prime/Elite/Apex, e.g. 3d, 12h, 30m')
            .setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('abort')
        .setDescription('Abort an application: remove applicant role (no cooldown)')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Rank ladder they are applying for')
            .setRequired(true)
            .addChoices(
              { name: 'Prime', value: 'prime' },
              { name: 'Elite', value: 'elite' },
              { name: 'Apex', value: 'apex' },
              { name: 'PM', value: 'pm' }
            )
        )
        .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true)),
      new SlashCommandBuilder()
        .setName('accept')
        .setDescription(
          'Accept applicant: place tier, sync tier list, remove applicant role, notify managers'
        )
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
              { name: 'Apex', value: 'apex' },
              { name: 'PM', value: 'pm' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('tier')
            .setDescription('Tier placement (required for Prime/Elite/Apex; ignored for PM)')
            .setRequired(false)
            .addChoices(...VALID_TIERS.map((t) => ({ name: t, value: t })))
        ),
    ],
    handlers: {
      viewcooldown: handleViewcooldown,
      clearcooldown: handleClearcooldown,
      deny: handleDeny,
      abort: handleAbort,
      accept: handleAccept,
    },
  };
};
