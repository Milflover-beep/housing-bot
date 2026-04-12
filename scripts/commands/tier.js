const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { syncTierListChannel, getTierListChannelId } = require('../lib/tierListChannelSync');

module.exports = function tierCommands(ctx) {
  const {
    pool,
    requireLevel,
    getMemberLevel,
    hasBoosterOrAbove,
    isOwner,
    VALID_TIERS,
    tierRank,
    typeLetterToName,
    tierListEmbedHeading,
    defer,
    normalizeIgn,
    tierResultsLadderSqlParam,
  } = ctx;

  async function submitRating(interaction, fixedType) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers (or higher) only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const tier = interaction.options.getString('tier').toUpperCase();
    const discordUser = interaction.options.getUser('discord');
    const tester = interaction.user.username;
    const type = fixedType;

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

    const typeName = typeLetterToName(type);
    const embed = new EmbedBuilder()
      .setTitle(`${typeName} tier rating submitted`)
      .setColor(0x00bcd4)
      .addFields(
        { name: 'Player', value: ign, inline: true },
        { name: 'Tier', value: tier, inline: true },
        { name: 'Discord', value: `<@${discordUser.id}>`, inline: true },
        { name: 'Tester', value: tester, inline: true }
      )
      .setTimestamp();

    if (existing.rows.length > 0) {
      embed.addFields({ name: 'Note', value: `Previously ${existing.rows[0].tier}` });
    }
    await interaction.editReply({ embeds: [embed] });
    await syncTierListChannel(interaction.client, pool);
  }

  async function handleViewtier(interaction) {
    await defer(interaction, false);
    if (getMemberLevel(interaction.member) < 1 && !hasBoosterOrAbove(interaction.member)) {
      return interaction.editReply({ content: '❌ PM (or booster) or higher required.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const r = await pool.query(
      `SELECT DISTINCT ON (type) type, tier, ign
       FROM tier_results
       WHERE LOWER(ign) = $1
       ORDER BY type, id DESC`,
      [ign]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No tier results for **${ign}**.` });
    }
    const embed = new EmbedBuilder()
      .setTitle(`Tier: ${r.rows[0].ign}`)
      .setColor(0x9b59b6)
      .setDescription(
        r.rows.map((row) => `**${typeLetterToName(row.type)}** — ${row.tier}`).join('\n')
      );
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleRemovetier(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers (or higher) only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const typeOpt = interaction.options.getString('type');
    const letter = typeOpt === 'prime' ? 'P' : typeOpt === 'elite' ? 'E' : 'A';
    const q = await pool.query(
      'DELETE FROM tier_results WHERE LOWER(ign) = $1 AND type = $2 RETURNING *',
      [ign, letter]
    );
    if (q.rows.length === 0) {
      return interaction.editReply({
        content: `❌ No **${typeOpt}** tier entry for **${ign}**.`,
      });
    }
    const r = q.rows[0];
    await interaction.editReply({
      content: `✅ Removed **${typeLetterToName(r.type)}** tier **${r.tier}** for **${r.ign}**.`,
    });
    await syncTierListChannel(interaction.client, pool);
  }

  async function handleTierids(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers (or higher) only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const [tr, th] = await Promise.all([
      pool.query('SELECT id, type, tier, created_at FROM tier_results WHERE LOWER(ign) = $1 ORDER BY id', [
        ign,
      ]),
      pool.query('SELECT id, type, tier, rated_at FROM tier_history WHERE LOWER(ign) = $1 ORDER BY id', [
        ign,
      ]),
    ]);
    const lines = [
      '**tier_results**',
      ...tr.rows.map((row) => `• id \`${row.id}\` — ${row.type} ${row.tier}`),
      '**tier_history**',
      ...th.rows.map((row) => `• id \`${row.id}\` — ${row.type} ${row.tier}`),
    ];
    await interaction.editReply({
      content: lines.slice(0, 40).join('\n').slice(0, 3900) || 'No rows.',
    });
  }

  async function handleTierlist(interaction) {
    await defer(interaction, false);
    if (!hasBoosterOrAbove(interaction.member)) {
      return interaction.editReply({ content: '❌ Booster (or PM+) or higher required.' });
    }
    const fightType = interaction.options.getString('type');
    const letter = fightType === 'prime' ? 'P' : fightType === 'elite' ? 'E' : 'A';
    const res = await pool.query(
      `SELECT DISTINCT ON (LOWER(tr.ign)) tr.ign, tr.tier, tr.tester, tr.created_at
       FROM tier_results tr
       WHERE ${tierResultsLadderSqlParam('tr')}
         AND COALESCE(TRIM(tr.tier), '') <> ''
       ORDER BY LOWER(tr.ign), tr.id DESC`,
      [letter]
    );
    const rows = [...res.rows].sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
    const name = typeLetterToName(letter);
    const heading = tierListEmbedHeading(name);
    const body = rows.length
      ? rows.map((r) => `**${r.ign}** — ${r.tier}`).join('\n')
      : '_Empty._';
    const MAX = 4096;
    const overhead = heading.length + 2;
    let truncated = false;
    let listPart = body;
    if (overhead + body.length > MAX) {
      truncated = true;
      listPart = `${body.slice(0, MAX - overhead - 40)}\n… _(truncated)_`;
    }
    const desc = `${heading}\n\n${listPart}`;
    const embed = new EmbedBuilder().setColor(0x3498db).setDescription(desc).setTimestamp();
    if (truncated) {
      embed.setFooter({
        text: `${rows.length} players — list cut at Discord limit; lower grades sort last.`,
      });
    }
    await interaction.editReply({ embeds: [embed] });
  }

  async function handlePublictierlistupdate(interaction) {
    await defer(interaction, false);
    if (!isOwner(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Bot owner only.' });
    }
    const channelId =
      interaction.options.getString('channel-id')?.trim() || getTierListChannelId();
    if (!channelId) {
      return interaction.editReply({
        content:
          '❌ Set `TIERLIST_PUBLIC_CHANNEL_ID` / `TIERLIST_CHANNEL_ID` in .env or pass `channel-id`.',
      });
    }
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return interaction.editReply({ content: '❌ Invalid channel.' });
    }
    await syncTierListChannel(interaction.client, pool, channelId);
    await interaction.editReply({ content: `✅ Tier list (Prime + Elite + Apex) reposted in <#${channelId}>.` });
  }

  const mgr = PermissionFlagsBits.ManageRoles;

  const commands = [
    new SlashCommandBuilder()
      .setName('primerate')
      .setDescription('Submit a Prime tier rating')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('tier').setDescription('Tier').setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('eliterate')
      .setDescription('Submit an Elite tier rating')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('tier').setDescription('Tier').setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('apexrate')
      .setDescription('Submit an Apex tier rating')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('tier').setDescription('Tier').setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('viewtier')
      .setDescription('View the tier result for a specific player (PM rank and higher)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('removetier')
      .setDescription('Remove a player tier entry by IGN and rank type (Manager+ only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Which rank ladder to clear')
          .setRequired(true)
          .addChoices(
            { name: 'Prime', value: 'prime' },
            { name: 'Elite', value: 'elite' },
            { name: 'Apex', value: 'apex' }
          )
      )
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('tierids')
      .setDescription('View all database IDs for a player tier entries (Manager+ only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('tierlist')
      .setDescription('View the tier list for a specific fight type (Booster rank and higher)')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Rank type')
          .setRequired(true)
          .addChoices(
            { name: 'Prime', value: 'prime' },
            { name: 'Elite', value: 'elite' },
            { name: 'Apex', value: 'apex' }
          )
      ),
    new SlashCommandBuilder()
      .setName('publictierlistupdate')
      .setDescription('Post the public tier list leaderboard (Bot owners only)')
      .addStringOption((o) =>
        o.setName('channel-id').setDescription('Channel ID (optional if TIERLIST_CHANNEL_ID set)')
      ),
  ];

  return {
    commands,
    handlers: {
      primerate: (i) => submitRating(i, 'P'),
      eliterate: (i) => submitRating(i, 'E'),
      apexrate: (i) => submitRating(i, 'A'),
      viewtier: handleViewtier,
      removetier: handleRemovetier,
      tierids: handleTierids,
      tierlist: handleTierlist,
      publictierlistupdate: handlePublictierlistupdate,
    },
  };
};
