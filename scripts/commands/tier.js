const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { syncTierListChannel, getTierListChannelId } = require('../lib/tierListChannelSync');

module.exports = function tierCommands(ctx) {
  const {
    pool,
    requireLevel,
    getMemberLevel,
    hasBoosterOrAbove,
    VALID_TIERS,
    tierRank,
    typeLetterToName,
    tierListEmbedHeading,
    defer,
    normalizeIgn,
    tierResultsLadderSqlParam,
    sqlTierResultsPublicListRowsForLadder,
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
      'SELECT * FROM tier_results WHERE LOWER(ign) = $1 ORDER BY id DESC LIMIT 1',
      [ign]
    );

    /** One active row per IGN: clear any ladder before inserting the new placement. */
    await pool.query('DELETE FROM tier_results WHERE LOWER(ign) = $1', [ign]);
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
      const ex = existing.rows[0];
      embed.addFields({
        name: 'Note',
        value: `Replaced **${typeLetterToName(ex.type)}** \`${ex.tier}\`.`,
      });
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
      `SELECT type, tier, ign FROM (
         SELECT DISTINCT ON (LOWER(TRIM(ign))) *
         FROM tier_results
         WHERE LOWER(TRIM(ign)) = LOWER(TRIM($1::text))
         ORDER BY LOWER(TRIM(ign)), id DESC
       ) x`,
      [ign]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No tier results for **${ign}**.` });
    }
    const row = r.rows[0];
    const hist = await pool.query(
      `SELECT type, tier, rated_at, tester FROM tier_history
       WHERE LOWER(TRIM(ign)) = LOWER(TRIM($1::text))
       ORDER BY rated_at DESC NULLS LAST, id DESC
       LIMIT 18`,
      [ign]
    );
    let histRows = hist.rows;
    if (
      histRows.length > 0 &&
      String(histRows[0].type) === String(row.type) &&
      String(histRows[0].tier) === String(row.tier)
    ) {
      histRows = histRows.slice(1);
    }
    let desc =
      `**Current**\n**${typeLetterToName(row.type)}** — \`${row.tier}\`\n\n` +
      '**History** (newest first)\n';
    if (histRows.length === 0) {
      desc += '_No earlier placements._';
    } else {
      desc += histRows
        .map((h) => {
          const ts = h.rated_at ? Math.floor(new Date(h.rated_at).getTime() / 1000) : null;
          const when = ts ? `<t:${ts}:d>` : '—';
          const who = h.tester ? ` · ${h.tester}` : '';
          return `• **${typeLetterToName(h.type)}** \`${h.tier}\` — ${when}${who}`;
        })
        .join('\n');
    }
    const embed = new EmbedBuilder()
      .setTitle(`Tier: ${row.ign}`)
      .setColor(0x9b59b6)
      .setDescription(desc.slice(0, 4096));
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleRemovetier(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers (or higher) only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const q = await pool.query(
      'DELETE FROM tier_results WHERE LOWER(ign) = $1 RETURNING type, tier, ign',
      [ign]
    );
    if (q.rowCount === 0) {
      return interaction.editReply({ content: `❌ No tier entry for **${ign}**.` });
    }
    const parts = q.rows.map((r) => `**${typeLetterToName(r.type)}** ${r.tier}`);
    const list = parts.length <= 5 ? parts.join(', ') : `${parts.slice(0, 5).join(', ')} … (+${parts.length - 5} more)`;
    await interaction.editReply({
      content: `✅ Removed **${q.rowCount}** tier row(s) for **${q.rows[0].ign}**: ${list}`,
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
    const res = await pool.query(`${sqlTierResultsPublicListRowsForLadder()}
       ORDER BY LOWER(t.ign)`, [letter]);
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
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const channelId = getTierListChannelId();
    if (!channelId) {
      return interaction.editReply({
        content:
          '❌ Set **TIERLIST_PUBLIC_CHANNEL_ID** or **TIERLIST_CHANNEL_ID** in the bot environment.',
      });
    }
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return interaction.editReply({ content: '❌ Invalid channel.' });
    }
    await syncTierListChannel(interaction.client, pool, channelId);
    await interaction.editReply({ content: `✅ Tier list (Prime + Elite + Apex) reposted in <#${channelId}>.` });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('primerate')
      .setDescription('Submit a Prime tier rating')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('tier').setDescription('Tier').setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true)),
    new SlashCommandBuilder()
      .setName('eliterate')
      .setDescription('Submit an Elite tier rating')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('tier').setDescription('Tier').setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true)),
    new SlashCommandBuilder()
      .setName('apexrate')
      .setDescription('Submit an Apex tier rating')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o.setName('tier').setDescription('Tier').setRequired(true)
      )
      .addUserOption((o) => o.setName('discord').setDescription('Discord user').setRequired(true)),
    new SlashCommandBuilder()
      .setName('viewtier')
      .setDescription('View the tier result for a specific player (PM rank and higher)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('removetier')
      .setDescription('Remove all tier_results rows for an IGN (Manager+ only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('tierids')
      .setDescription('View all database IDs for a player tier entries (Manager+ only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
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
      .setDescription('Repost public tier list (Apex/Elite/Prime) to configured channel (Manager+)'),
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
