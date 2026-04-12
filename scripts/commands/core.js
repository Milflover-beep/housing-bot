const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { buildFightScoreLogEmbed, sendFightScoreLogEmbed } = require('../lib/fightScoreLogEmbed');
const { syncTierListChannel } = require('../lib/tierListChannelSync');
const { fetchNetworkLevelForCheck } = require('../lib/hypixel');

module.exports = function coreCommands(ctx) {
  const {
    pool,
    getMemberLevel,
    requireLevel,
    VALID_TIERS,
    defer,
    normalizeIgn,
    minecraftHeadUrl,
    applicantRoleIds,
    applicantRoleName,
    applicantRoleIdEnvPresentButInvalid,
    resolveGuildMember,
  } = ctx;

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
    await defer(interaction, false);
    const runner = await resolveGuildMember(interaction);
    if (!runner || !requireLevel(runner, 1)) {
      return interaction.editReply({
        content:
          '❌ PM or higher only. If you have the role, enable **Server Members Intent** for the bot (Developer Portal) and restart it, then try again.',
      });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const discordUser = interaction.options.getUser('discord', true);
    const discord = discordUser.id;
    const rankType = interaction.options.getString('rank-type');
    const applyLadderLetter = rankType.charAt(0).toUpperCase(); // P | E | A
    const LADDER_ORDER = { P: 0, E: 1, A: 2 };
    const LADDER_NAME = { P: 'Prime', E: 'Elite', A: 'Apex' };

    const hypixelKey = process.env.HYPIXEL_API_KEY;
    const [blacklistRows, adminBlacklistRows, timeoutRows, altRows, allTierRows, hypixelResult] =
      await Promise.all([
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
        pool.query(
          `SELECT DISTINCT ON (type) type, tier, created_at
         FROM tier_results
         WHERE LOWER(ign) = $1 AND type IN ('P','E','A')
         ORDER BY type, id DESC`,
          [ign]
        ),
        fetchNetworkLevelForCheck(hypixelKey, ign),
      ]);

    let denialRows = { rows: [] };
    try {
      denialRows = await pool.query(
        `SELECT * FROM application_denials
         WHERE discord_id = $1 AND cooldown_until > NOW()`,
        [discord]
      );
    } catch (e) {
      if (e && e.code !== '42P01') throw e;
    }

    const embed = new EmbedBuilder().setTitle(`Check: ${ign}`).setTimestamp();
    let eligible = true;
    const issues = [];

    /** API/config failures: do not block eligibility; staff verify with `/hypixel`. */
    let hypixelDegradedNote = '';
    if (!hypixelResult.ok) {
      const detail =
        hypixelResult.message.length > 500
          ? `${hypixelResult.message.slice(0, 497)}…`
          : hypixelResult.message;
      hypixelDegradedNote = `Hypixel could not verify network level automatically (${detail}). Use **\`/hypixel\`** to check manually before tryout.`;
    } else if (hypixelResult.level < 30) {
      eligible = false;
      if (!hypixelResult.hasPlayer) {
        issues.push(
          '📊 **Hypixel network level** — no Hypixel profile for this name/UUID (never joined, or invalid). ' +
            'They must be **network level 30** or higher.'
        );
      } else {
        issues.push(
          `📊 **Hypixel network level too low** — **${hypixelResult.level.toFixed(
            2
          )}** (minimum **30**).`
        );
      }
    }

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

    /** Latest tier row per ladder (Prime / Elite / Apex). Re-applying on the same ladder is OK (higher tier goal). */
    const latestByLadder = {};
    for (const row of allTierRows.rows) {
      if (!latestByLadder[row.type]) latestByLadder[row.type] = row;
    }
    let maxHeldOrder = -1;
    let maxHeldLetter = null;
    for (const letter of ['P', 'E', 'A']) {
      if (latestByLadder[letter]) {
        const o = LADDER_ORDER[letter];
        if (o > maxHeldOrder) {
          maxHeldOrder = o;
          maxHeldLetter = letter;
        }
      }
    }
    const applyOrder = LADDER_ORDER[applyLadderLetter];
    if (maxHeldOrder > applyOrder && maxHeldLetter) {
      const held = latestByLadder[maxHeldLetter];
      issues.push(
        `📉 **Applying below current ladder** — on file they have **${LADDER_NAME[maxHeldLetter]}** ` +
          `(tier **${held.tier}**, ${timeAgo(held.created_at)}). They are checking for **${
            LADDER_NAME[applyLadderLetter]
          }**, which is a lower ladder. Confirm this is intentional.`
      );
    }

    /** Alts are never shown on the public reply — ephemeral follow-up to the invoker only. */
    let altStaffMessage = '';
    if (altRows.rows.length > 0) {
      const altList = altRows.rows.map((a) => `\`${a.original_ign}\` → \`${a.alt_ign}\``).join('\n');
      altStaffMessage = `🔀 **Known alts on file for \`${ign}\`** (only you can see this message):\n${altList}`;
      if (getMemberLevel(runner) < 2) {
        altStaffMessage +=
          '\n\n**Ping a Manager** — include this message (or copy the alt lines above) when you ping them.';
      }
    }

    /** Full pass: no hard blocks and no public notes (timeouts, ladder mismatch, etc.). Applicant role only here. */
    const passedCheck = eligible && issues.length === 0;

    let roleNote = '';
    if (passedCheck) {
      if (interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(discordUser.id);
          const ids = applicantRoleIds();
          if (ids.length > 0) {
            let foundInGuild = 0;
            for (const rid of ids) {
              let role = interaction.guild.roles.cache.get(rid);
              if (!role) role = await interaction.guild.roles.fetch(rid).catch(() => null);
              if (!role) continue;
              foundInGuild += 1;
              if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
              }
            }
            if (foundInGuild === 0) {
              roleNote = `\n\n⚠️ Applicant role: none of the configured role IDs exist in this server. Check **BOT_ROLE_APPLICANT_ID** (Server Settings → Roles → right‑click role → Copy ID).`;
            }
          } else {
            const name = applicantRoleName();
            const role = interaction.guild.roles.cache.find((r) => r.name === name);
            if (!role) {
              if (applicantRoleIdEnvPresentButInvalid()) {
                roleNote =
                  '\n\n⚠️ Applicant role: **BOT_ROLE_APPLICANT_ID** is set but is not a valid snowflake (17–20 digits, comma-separated). Remove quotes/spaces from the value or fix the ID. ' +
                  'Alternatively set **BOT_ROLE_APPLICANT_NAME** to the role’s exact Discord name (e.g. `Premium/PM Applicant`).';
              } else {
                const hostHint =
                  name === '[APPLICANT]'
                    ? ' If the bot runs on Railway or similar, add these in the **host’s Variables** (your local `.env` is not deployed).'
                    : '';
                roleNote = `\n\n⚠️ No role named **${name}**. Set **BOT_ROLE_APPLICANT_ID** or **BOT_ROLE_APPLICANT_NAME** in the environment the bot process uses.${hostHint}`;
              }
            } else if (!member.roles.cache.has(role.id)) {
              await member.roles.add(role);
            }
          }
        } catch (e) {
          const code = e && e.code;
          const raw = e && e.message ? String(e.message) : String(e);
          console.warn('check: applicant role:', raw);
          let hint = raw;
          if (code === 50013 || /missing permissions/i.test(raw)) {
            hint =
              'Missing permissions. Move **this bot’s role** above the applicant role in **Server Settings → Roles**, and ensure the bot has **Manage Roles**.';
          } else if (code === 50001 || /lacks access/i.test(raw)) {
            hint = 'Missing access to that member or role.';
          } else if (code === 10007 || /unknown member/i.test(raw)) {
            hint =
              'That user is not in this server (or **Server Members Intent** is off — enable it for the bot and restart).';
          }
          roleNote = `\n\n⚠️ Could not assign applicant role: ${hint}`;
        }
      } else {
        roleNote = '\n\n⚠️ Run this command in the server to assign the applicant role.';
      }
    }

    if (passedCheck) {
      const ok = `✅ **${ign} is eligible** for ${rankType} tryout.\nNo issues found.${roleNote}`;
      if (roleNote) {
        embed.setColor(0xffa000);
        embed.setDescription(ok);
      } else {
        embed.setColor(0x00c853);
        embed.setDescription(ok);
      }
    } else if (!eligible) {
      embed.setColor(0xff1744);
      embed.setDescription(`❌ **${ign} is NOT eligible** for ${rankType} tryout.\n\n${issues.join('\n\n')}`);
    } else {
      embed.setColor(0xffa000);
      embed.setDescription(`⚠️ **${ign} is eligible** but has notes:\n\n${issues.join('\n\n')}`);
    }

    let hypixelLevelField;
    if (hypixelDegradedNote) {
      hypixelLevelField = '— *(not fetched)*';
    } else if (!hypixelResult.hasPlayer) {
      hypixelLevelField = '— *(no Hypixel profile)*';
    } else {
      hypixelLevelField = `**${hypixelResult.level.toFixed(2)}**`;
    }
    embed.addFields({ name: 'Hypixel network level', value: hypixelLevelField, inline: false });
    if (hypixelDegradedNote) {
      embed.addFields({
        name: 'Hypixel API',
        value: hypixelDegradedNote.slice(0, 1024),
        inline: false,
      });
    }

    const headUrl = minecraftHeadUrl(ign);
    if (headUrl) embed.setThumbnail(headUrl);

    await interaction.editReply({ embeds: [embed] });

    if (altStaffMessage) {
      let content = altStaffMessage;
      if (content.length > 2000) content = `${content.slice(0, 1997)}…`;
      await interaction
        .followUp({ content, flags: MessageFlags.Ephemeral })
        .catch((e) => console.warn('check: alt staff followUp failed:', e.message));
    }

    // Optional: send a channel message (e.g. prefix command) for another bot — Discord does not allow invoking another app's slash commands.
    if (interaction.channel?.isTextBased?.() && process.env.CHECK_LEVELBOT_MESSAGE?.trim()) {
      const when = (process.env.CHECK_LEVELBOT_WHEN || 'pass').toLowerCase();
      let shouldSend = false;
      if (when === 'always') shouldSend = true;
      else if (when === 'pass') shouldSend = passedCheck;
      else if (when === 'fail') shouldSend = !passedCheck;
      if (shouldSend) {
        const msg = process.env.CHECK_LEVELBOT_MESSAGE.trim()
          .replace(/\{ign\}/gi, ign)
          .replace(/\{discord\}/gi, discordUser.id)
          .replace(/\{mention\}/gi, `<@${discordUser.id}>`);
        await interaction.channel.send({ content: msg }).catch((e) => {
          console.warn('check: CHECK_LEVELBOT_MESSAGE send failed:', e.message);
        });
      }
    }
  }

  async function handleScore(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff only.' });
    }
    const winnerIgn = normalizeIgn(interaction.options.getString('winner-ign'));
    const loserIgn = normalizeIgn(interaction.options.getString('loser-ign'));
    const finalScore = interaction.options.getString('final-score');
    const fightNumber = interaction.options.getInteger('fight-number');
    const fightType = interaction.options.getString('fight-type');

    const insertScore = await pool.query(
      `INSERT INTO scores (winner_ign, loser_ign, final_score, fight_number, reported_by, fight_type, is_voided, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
       RETURNING *`,
      [winnerIgn, loserIgn, finalScore, fightNumber, interaction.user.id, fightType]
    );
    const row = insertScore.rows[0];

    const embed = buildFightScoreLogEmbed(row, {
      actorUsername: interaction.user.username,
      mode: 'logged',
    });
    const replyEmbed = EmbedBuilder.from(embed).addFields({
      name: '🆔 Fight ID',
      value: String(row.id),
      inline: true,
    });

    await interaction.editReply({ embeds: [replyEmbed] });
    await sendFightScoreLogEmbed(interaction.client, embed);
  }

  function fightHistoryEncodeIgn(ignLower) {
    return Buffer.from(ignLower, 'utf8').toString('base64url');
  }

  function fightHistoryDecodeIgn(b64) {
    return Buffer.from(b64, 'base64url').toString('utf8');
  }

  function fightHistoryComponents(ignLower, safePage, totalPages, debugIds) {
    if (totalPages <= 1) return [];
    const enc = fightHistoryEncodeIgn(ignLower);
    const d = debugIds ? '1' : '0';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fh|${safePage - 1}|${enc}|${d}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 1),
      new ButtonBuilder()
        .setCustomId(`fh|${safePage + 1}|${enc}|${d}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages)
    );
    return [row];
  }

  async function buildFightHistoryPayload(ignDisplay, ignLower, page, showIds) {
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
        const idPart = showIds ? ` · **ID** \`${r.id}\`` : '';
        return `${won ? '✅' : '❌'} **${won ? 'W' : 'L'}** vs \`${opponent}\` — ${r.final_score} (Fight #${
          r.fight_number
        }) — ${date}${idPart}`;
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
        text:
          `Page ${safePage} of ${totalPages} · ${perPage} per page · Use ◀ ▶ or the optional \`page\` parameter` +
          (showIds ? ' · IDs for /updatescore' : ''),
      })
      .setTimestamp();

    const headUrl = minecraftHeadUrl(ignDisplay);
    if (headUrl) embed.setThumbnail(headUrl);

    return {
      embed,
      components: fightHistoryComponents(ignLower, safePage, totalPages, showIds),
    };
  }

  async function handleFightHistory(interaction) {
    await defer(interaction, false);
    const ignLower = normalizeIgn(interaction.options.getString('ign'));
    const ign = ignLower;
    const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
    const wantsDebug = interaction.options.getBoolean('debug') === true;
    if (wantsDebug && !requireLevel(interaction.member, 2)) {
      return interaction.editReply({
        content: '❌ Only staff can use **debug** (shows database fight IDs for `/updatescore`).',
      });
    }
    const showIds = wantsDebug && requireLevel(interaction.member, 2);
    const payload = await buildFightHistoryPayload(ign, ignLower, page, showIds);
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
    if (parts.length !== 3 && parts.length !== 4) return false;
    const targetPage = parseInt(parts[1], 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return false;
    let ignLower;
    try {
      ignLower = fightHistoryDecodeIgn(parts[2]);
    } catch {
      return false;
    }
    const debugFromButton = parts.length === 4 && parts[3] === '1';
    if (debugFromButton && !requireLevel(interaction.member, 2)) {
      await interaction.reply({
        content: '❌ Only staff can use debug fight history.',
        ephemeral: true,
      });
      return true;
    }
    const showIds = debugFromButton && requireLevel(interaction.member, 2);
    await interaction.deferUpdate();
    const ignDisplay = ignLower;
    const payload = await buildFightHistoryPayload(ignDisplay, ignLower, targetPage, showIds);
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
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const type = interaction.options.getString('type');
    const tier = interaction.options.getString('tier');
    const discordUser = interaction.options.getUser('discord');
    const tester = interaction.user.username;

    if (!VALID_TIERS.includes(tier)) {
      return interaction.editReply({
        content: `❌ Invalid tier \`${tier}\`. Valid tiers: ${VALID_TIERS.join(', ')}`,
      });
    }

    const existing = await pool.query(
      'SELECT * FROM tier_results WHERE LOWER(ign) = $1 AND type = $2 ORDER BY created_at DESC LIMIT 1',
      [ign, type]
    );

    await pool.query('DELETE FROM tier_results WHERE LOWER(ign) = $1 AND type = $2', [ign, type]);
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
    await syncTierListChannel(interaction.client, pool);
  }

  async function handleCheckcommands(interaction) {
    await defer(interaction, false);
    const lv = getMemberLevel(interaction.member);
    const lines = [];
    const add = (tier, cmds) => {
      lines.push(`**${tier}**\n${cmds.filter(Boolean).join('\n')}`);
    };

    const everyone = [
      '`/fighthistory` — fight history',
      '`/profile` — public player snapshot',
      '`/checkcommands` — this list',
      '`/pmlist` — PM list',
    ];
    add('Everyone', everyone);

    if (lv >= 1 || ctx.hasBoosterOrAbove(interaction.member)) {
      add('Booster+ / PM+', ['`/tierlist` — tier list', '`/viewtier` — view a player tier']);
    }
    if (lv >= 1) {
      add('PM+', ['`/pmstats`', '`/check`']);
    }
    if (lv >= 2) {
      add('Staff+', [
        '`/hypixel`',
        '`/deny`',
        '`/accept`',
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
        '`/deletealt`',
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
        '`/removepunishment`',
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
      .addStringOption((o) =>
        o
          .setName('ign')
          .setDescription('Minecraft IGN, or UUID if longer than 16 characters')
          .setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
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
      ),

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
      )
      .addBooleanOption((o) =>
        o
          .setName('debug')
          .setDescription('Staff only: show database fight ID per row (for /updatescore)')
          .setRequired(false)
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
          .setDescription('Tier')
          .setRequired(true)
          .addChoices(...VALID_TIERS.map((t) => ({ name: t, value: t })))
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
