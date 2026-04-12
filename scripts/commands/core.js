const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

module.exports = function coreCommands(ctx) {
  const { pool, getMemberLevel, requireLevel, VALID_TIERS, defer } = ctx;

  function isBlacklisted(rows) {
    return rows.some((row) => {
      if (!row.blacklist_expires) return true;
      return new Date(row.blacklist_expires) > new Date();
    });
  }

  function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  async function handleCheck(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff only.' });
    }
    const ign = interaction.options.getString('ign').toLowerCase();
    const discord = interaction.options.getString('discord').replace(/[<@!>]/g, '');
    const rankType = interaction.options.getString('rank-type');
    const rankLetter = { prime: 'P', elite: 'E', apex: 'A' }[rankType];

    const [blacklistRows, adminBlacklistRows, timeoutRows, altRows, tierRows] = await Promise.all([
      pool.query('SELECT * FROM blacklists WHERE LOWER(ign) = $1', [ign]),
      pool.query(
        'SELECT * FROM admin_blacklists WHERE LOWER(ign) = $1 AND (is_pardoned = false)',
        [ign]
      ),
      pool.query(
        'SELECT * FROM timeouts WHERE LOWER(ign) = $1 ORDER BY created_at DESC LIMIT 1',
        [ign]
      ),
      pool.query('SELECT * FROM alts WHERE LOWER(original_ign) = $1 OR LOWER(alt_ign) = $1', [
        ign,
      ]),
      pool.query('SELECT * FROM tier_results WHERE LOWER(ign) = $1 AND type = $2', [
        ign,
        rankType.charAt(0).toUpperCase(),
      ]),
    ]);

    let denialRows = { rows: [] };
    try {
      denialRows = await pool.query(
        `SELECT * FROM application_denials
         WHERE discord_id = $1 AND rank_type = $2 AND cooldown_until > NOW()`,
        [discord, rankLetter]
      );
    } catch (e) {
      if (e && e.code !== '42P01') throw e;
    }

    const embed = new EmbedBuilder().setTitle(`Check: ${ign}`).setTimestamp();
    let eligible = true;
    const issues = [];

    if (isBlacklisted(blacklistRows.rows)) {
      eligible = false;
      const bl = blacklistRows.rows[blacklistRows.rows.length - 1];
      issues.push(
        `🚫 **Blacklisted** — ${bl.reason}${
          bl.blacklist_expires
            ? ` (expires ${new Date(bl.blacklist_expires).toDateString()})`
            : ' (permanent)'
        }`
      );
    }

    if (adminBlacklistRows.rows.length > 0) {
      eligible = false;
      const abl = adminBlacklistRows.rows[0];
      issues.push(`🚫 **Admin Blacklisted** — ${abl.reason}`);
    }

    if (timeoutRows.rows.length > 0) {
      const timeout = timeoutRows.rows[0];
      issues.push(`⏱️ **Last timeout** — ${timeout.timeout_duration} (${timeAgo(timeout.created_at)})`);
    }

    if (denialRows.rows.length > 0) {
      eligible = false;
      const d = denialRows.rows[0];
      const ts = Math.floor(new Date(d.cooldown_until).getTime() / 1000);
      issues.push(`⏳ **Application cooldown** — cannot re-apply until <t:${ts}:F> (<t:${ts}:R>)`);
    }

    if (tierRows.rows.length > 0) {
      const existing = tierRows.rows[tierRows.rows.length - 1];
      issues.push(
        `📋 **Already ranked** — ${rankType} ${existing.tier} (submitted ${timeAgo(existing.created_at)})`
      );
    }

    if (altRows.rows.length > 0) {
      const altList = altRows.rows.map((a) => `\`${a.original_ign}\` → \`${a.alt_ign}\``).join('\n');
      issues.push(`🔀 **Known alts:**\n${altList}`);
    }

    if (eligible && issues.length === 0) {
      embed.setColor(0x00c853);
      embed.setDescription(`✅ **${ign} is eligible** for ${rankType} tryout.\nNo issues found.`);
    } else if (!eligible) {
      embed.setColor(0xff1744);
      embed.setDescription(`❌ **${ign} is NOT eligible** for ${rankType} tryout.\n\n${issues.join('\n\n')}`);
    } else {
      embed.setColor(0xffa000);
      embed.setDescription(`⚠️ **${ign} is eligible** but has notes:\n\n${issues.join('\n\n')}`);
    }

    await interaction.editReply({ embeds: [embed] });
  }

  async function handleScore(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff only.' });
    }
    const winnerIgn = interaction.options.getString('winner-ign');
    const loserIgn = interaction.options.getString('loser-ign');
    const finalScore = interaction.options.getString('final-score');
    const fightNumber = interaction.options.getInteger('fight-number');
    const fightType = interaction.options.getString('fight-type');
    const reportedBy = interaction.user.id;

    const insertScore = await pool.query(
      `INSERT INTO scores (winner_ign, loser_ign, final_score, fight_number, reported_by, fight_type, is_voided, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
       RETURNING id`,
      [winnerIgn, loserIgn, finalScore, fightNumber, reportedBy, fightType]
    );
    const fightDbId = insertScore.rows[0].id;

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Fight Recorded')
      .setColor(0x2196f3)
      .addFields(
        { name: '🆔 Fight ID', value: String(fightDbId), inline: true },
        { name: '🏆 Winner', value: winnerIgn, inline: true },
        { name: '💀 Loser', value: loserIgn, inline: true },
        { name: '📊 Score', value: finalScore, inline: true },
        { name: '🔢 Fight #', value: String(fightNumber), inline: true },
        {
          name: '🎖️ Type',
          value: fightType.charAt(0).toUpperCase() + fightType.slice(1),
          inline: true,
        },
        { name: '📝 Reported by', value: `<@${reportedBy}>`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  function fightHistoryEncodeIgn(ignLower) {
    return Buffer.from(ignLower, 'utf8').toString('base64url');
  }

  function fightHistoryDecodeIgn(b64) {
    return Buffer.from(b64, 'base64url').toString('utf8');
  }

  function fightHistoryComponents(ignLower, safePage, totalPages) {
    if (totalPages <= 1) return [];
    const enc = fightHistoryEncodeIgn(ignLower);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fh|${safePage - 1}|${enc}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 1),
      new ButtonBuilder()
        .setCustomId(`fh|${safePage + 1}|${enc}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages)
    );
    return [row];
  }

  async function buildFightHistoryPayload(ignDisplay, ignLower, page) {
    const perPage = 15;

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM scores
       WHERE (LOWER(winner_ign) = $1 OR LOWER(loser_ign) = $1) AND is_voided = false`,
      [ignLower]
    );
    const totalFights = countRes.rows[0].c || 0;

    if (totalFights === 0) {
      return {
        error: `No fight history found for **${ignDisplay}**.`,
      };
    }

    const statsRes = await pool.query(
      `SELECT
         SUM(CASE WHEN LOWER(winner_ign) = $1 THEN 1 ELSE 0 END)::int AS wins,
         SUM(CASE WHEN LOWER(loser_ign) = $1 THEN 1 ELSE 0 END)::int AS losses
       FROM scores
       WHERE (LOWER(winner_ign) = $1 OR LOWER(loser_ign) = $1) AND is_voided = false`,
      [ignLower]
    );
    const wins = statsRes.rows[0].wins || 0;
    const losses = statsRes.rows[0].losses || 0;
    const winRate = totalFights > 0 ? ((wins / totalFights) * 100).toFixed(1) : '0.0';

    const totalPages = Math.max(1, Math.ceil(totalFights / perPage));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const offset = (safePage - 1) * perPage;

    const result = await pool.query(
      `SELECT * FROM scores
       WHERE (LOWER(winner_ign) = $1 OR LOWER(loser_ign) = $1)
       AND is_voided = false
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [ignLower, perPage, offset]
    );

    const history = result.rows
      .map((r) => {
        const won = r.winner_ign.toLowerCase() === ignLower;
        const opponent = won ? r.loser_ign : r.winner_ign;
        const date = new Date(r.created_at).toLocaleDateString();
        return `${won ? '✅' : '❌'} **${won ? 'W' : 'L'}** vs \`${opponent}\` — ${r.final_score} (Fight #${
          r.fight_number
        }) — ${date}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Fight History: ${ignDisplay}`)
      .setColor(0x9c27b0)
      .setDescription(history || '_No fights on this page._')
      .addFields(
        { name: 'Wins (all)', value: String(wins), inline: true },
        { name: 'Losses (all)', value: String(losses), inline: true },
        { name: 'Win rate', value: `${winRate}%`, inline: true },
        { name: 'Total fights', value: String(totalFights), inline: true }
      )
      .setFooter({
        text: `Page ${safePage} of ${totalPages} · ${perPage} per page · Use ◀ ▶ or the optional \`page\` parameter`,
      })
      .setTimestamp();

    return {
      embed,
      components: fightHistoryComponents(ignLower, safePage, totalPages),
    };
  }

  async function handleFightHistory(interaction) {
    await defer(interaction, false);
    const ign = interaction.options.getString('ign');
    const ignLower = ign.toLowerCase().trim();
    const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
    const payload = await buildFightHistoryPayload(ign, ignLower, page);
    if (payload.error) {
      return interaction.editReply({ content: payload.error });
    }
    await interaction.editReply({
      embeds: [payload.embed],
      components: payload.components,
    });
  }

  async function handleFightHistoryButton(interaction) {
    if (!interaction.customId.startsWith('fh|')) return false;
    const parts = interaction.customId.split('|');
    if (parts.length !== 3) return false;
    const targetPage = parseInt(parts[1], 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return false;
    let ignLower;
    try {
      ignLower = fightHistoryDecodeIgn(parts[2]);
    } catch {
      return false;
    }
    await interaction.deferUpdate();
    const ignDisplay = ignLower;
    const payload = await buildFightHistoryPayload(ignDisplay, ignLower, targetPage);
    if (payload.error) {
      return interaction.editReply({ content: payload.error, embeds: [], components: [] });
    }
    await interaction.editReply({
      embeds: [payload.embed],
      components: payload.components,
    });
    return true;
  }

  async function handleSubmit(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers (or higher) only.' });
    }
    const ign = interaction.options.getString('ign');
    const type = interaction.options.getString('type');
    const tier = interaction.options.getString('tier').toUpperCase();
    const discordUser = interaction.options.getUser('discord');
    const tester = interaction.user.username;

    if (!VALID_TIERS.includes(tier)) {
      return interaction.editReply({
        content: `❌ Invalid tier \`${tier}\`. Valid tiers: ${VALID_TIERS.join(', ')}`,
      });
    }

    const existing = await pool.query(
      'SELECT * FROM tier_results WHERE LOWER(ign) = $1 AND type = $2 ORDER BY created_at DESC LIMIT 1',
      [ign.toLowerCase(), type]
    );

    await pool.query(
      `INSERT INTO tier_results (ign, type, tier, discord_id, created_at, tester)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [ign, type, tier, discordUser.id, tester]
    );

    await pool.query(
      `INSERT INTO tier_history (ign, type, tier, discord_id, rated_at, tester)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [ign, type, tier, discordUser.id, tester]
    );

    const typeNames = { P: 'Prime', E: 'Elite', A: 'Apex' };
    const typeName = typeNames[type];

    const embed = new EmbedBuilder()
      .setTitle('📋 Tier List Updated')
      .setColor(0x00bcd4)
      .setDescription(`**${ign}** has been added to the **${typeName}** tier list.`)
      .addFields(
        { name: '👤 Player', value: ign, inline: true },
        { name: '🎖️ Rank', value: typeName, inline: true },
        { name: '📊 Tier', value: tier, inline: true },
        { name: '🔗 Discord', value: `<@${discordUser.id}>`, inline: true },
        { name: '👨‍⚖️ Tester', value: tester, inline: true }
      )
      .setTimestamp();

    if (existing.rows.length > 0) {
      embed.addFields({
        name: '📝 Note',
        value: `Previously rated ${typeName} ${existing.rows[0].tier}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  async function handleCheckcommands(interaction) {
    await defer(interaction, false);
    const lv = getMemberLevel(interaction.member);
    const lines = [];
    const add = (tier, cmds) => {
      lines.push(`**${tier}**\n${cmds.filter(Boolean).join('\n')}`);
    };

    const everyone = ['`/fighthistory` — fight history', '`/checkcommands` — this list'];
    add('Everyone', everyone);

    if (lv >= 1 || ctx.hasBoosterOrAbove(interaction.member)) {
      add('Booster+ / PM+', ['`/tierlist` — tier list', '`/viewtier` — view a player tier']);
    }
    if (lv >= 1) {
      add('PM+', ['`/pmlist`', '`/pmstats`']);
    }
    if (lv >= 2) {
      add('Staff+', [
        '`/check`',
        '`/deny`',
        '`/score`',
        '`/blacklist`',
        '`/log` (→ manager queue)',
        '`/history`',
        '`/report`',
        '`/viewalts`',
        '`/viewblacklist`',
        '`/bancheck`',
        '`/addalt`',
        '`/editalt`',
        '`/clearalt`',
        '`/whitelist`',
        '`/update` (IGN)',
        '`/totalhistory`',
        '`/boosterpuncheck`',
        '`/acceptreport`',
      ]);
    }
    if (lv >= 3) {
      add('Manager+', [
        '`/submit`',
        '`/primerate`',
        '`/eliterate`',
        '`/apexrate`',
        '`/removetier`',
        '`/tierids`',
        '`/viewwatchlist`',
        '`/checkqueue`',
        '`/getproof`',
      ]);
    }
    if (lv >= 4) {
      add('Admin+', [
        '`/addproxy`',
        '`/watchlist`',
        '`/deletepm`',
        '`/edituuid`',
        '`/removeuuid`',
        '`/roleblacklist`',
        '`/viewroleblacklist`',
        '`/updatescore`',
        '`/adminblacklist`',
      ]);
    }
    if (ctx.isOwner(interaction.user.id)) {
      add('Bot owner', [
        '`/find`',
        '`/errorcheck`',
        '`/removeflag`',
        '`/publictierlistupdate`',
        '`/gradientrequests` (basic)',
      ]);
    }

    const rn = ctx.getRoleNames();
    const embed = new EmbedBuilder()
      .setTitle('Commands for your role')
      .setColor(0x5865f2)
      .setDescription(lines.join('\n\n'))
      .setFooter({
        text: `Level ${lv}/4 · Access roles: ${rn.pm} · ${rn.staff} · ${rn.manager} · ${rn.admin}`,
      });

    await interaction.editReply({ embeds: [embed] });
  }

  async function handleHelp(interaction) {
    await defer(interaction, false);
    const roleId = process.env.HELP_STAFF_ROLE_ID;
    const ch = process.env.HELP_CHANNEL_ID;
    let desc = 'If you need help, contact a staff member.';
    if (roleId) desc += `\n${roleId ? `<@&${roleId}>` : ''}`;
    if (ch) desc += `\nSee <#${ch}> for more info.`;
    const embed = new EmbedBuilder().setTitle('Help').setColor(0x57f287).setDescription(desc);
    await interaction.editReply({ embeds: [embed] });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Check player eligibility for applications')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('discord').setDescription('Discord user ID or @mention').setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName('rank-type')
          .setDescription('Rank type')
          .setRequired(true)
          .addChoices(
            { name: 'Prime', value: 'prime' },
            { name: 'Elite', value: 'elite' },
            { name: 'Apex', value: 'apex' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName('score')
      .setDescription('Log a fight score')
      .addStringOption((o) => o.setName('winner-ign').setDescription('Winner IGN').setRequired(true))
      .addStringOption((o) => o.setName('loser-ign').setDescription('Loser IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('final-score').setDescription('Final score e.g. 10-8').setRequired(true)
      )
      .addIntegerOption((o) => o.setName('fight-number').setDescription('Fight number').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('fight-type')
          .setDescription('Fight type')
          .setRequired(true)
          .addChoices(
            { name: 'Prime', value: 'prime' },
            { name: 'Elite', value: 'elite' },
            { name: 'Apex', value: 'apex' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName('fighthistory')
      .setDescription(
        'Fight history (15 per page). Use ◀ ▶ on the reply, or add optional page number'
      )
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addIntegerOption((o) =>
        o
          .setName('page')
          .setDescription('Page number, 1 = newest (optional; use buttons on the reply if hidden)')
          .setRequired(false)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName('submit')
      .setDescription('Submit a tier result for a player (Manager+ only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Rank type')
          .setRequired(true)
          .addChoices(
            { name: 'Prime', value: 'P' },
            { name: 'Elite', value: 'E' },
            { name: 'Apex', value: 'A' }
          )
      )
      .addStringOption((o) =>
        o
          .setName('tier')
          .setDescription('Tier (S, A+, A, A-, B+, B, B-, C+, C, C-, D, N/A)')
          .setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName('checkcommands')
      .setDescription('View available commands based on your role'),

    new SlashCommandBuilder().setName('help').setDescription('Request help from staff'),
  ];

  return {
    commands,
    handlers: {
      check: handleCheck,
      score: handleScore,
      fighthistory: handleFightHistory,
      submit: handleSubmit,
      checkcommands: handleCheckcommands,
      help: handleHelp,
    },
    buttonHandlers: [handleFightHistoryButton],
  };
};
