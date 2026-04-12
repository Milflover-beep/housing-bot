const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function pmCommands(ctx) {
  const { pool, requireLevel, isAdminOrOwner, defer, normalizeIgn } = ctx;
  const mgr = PermissionFlagsBits.ManageRoles;

  const PM_MANAGER_CHOICES = [
    { name: 'Prime Manager', value: 'P' },
    { name: 'Elite Manager', value: 'E' },
    { name: 'Apex Manager', value: 'A' },
    { name: 'N/A', value: 'NA' },
  ];

  function parseManagerType(optionValue) {
    if (optionValue === null || optionValue === undefined || optionValue === 'NA') return null;
    return optionValue;
  }

  function formatPmRow(r) {
    return `\`${r.ign}\` — ping ${r.ping ?? '—'}`;
  }

  function truncateEmbedField(text, max = 1020) {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 20)}… _(truncated)_`;
  }

  async function handlePmlist(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 1)) {
      return interaction.editReply({ content: '❌ PM or higher only.' });
    }
    const rows = await pool.query('SELECT * FROM pm_list ORDER BY id ASC LIMIT 100');
    if (rows.rows.length === 0) {
      return interaction.editReply({ content: 'PM list is empty.' });
    }
    const buckets = { P: [], E: [], A: [], NA: [] };
    for (const r of rows.rows) {
      const t = r.manager_type;
      if (t === 'P') buckets.P.push(r);
      else if (t === 'E') buckets.E.push(r);
      else if (t === 'A') buckets.A.push(r);
      else buckets.NA.push(r);
    }
    const section = (list) => truncateEmbedField(list.length ? list.map(formatPmRow).join('\n') : '_None_');
    const embed = new EmbedBuilder()
      .setTitle('PM list')
      .setColor(0x1abc9c)
      .addFields(
        { name: 'Prime Manager', value: section(buckets.P), inline: false },
        { name: 'Elite Manager', value: section(buckets.E), inline: false },
        { name: 'Apex Manager', value: section(buckets.A), inline: false },
        { name: 'N/A', value: section(buckets.NA), inline: false }
      );
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleAddpm(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const ping = interaction.options.getInteger('ping');
    const uuid = interaction.options.getString('uuid');
    const mgrType = parseManagerType(interaction.options.getString('manager-type'));
    const pingVal = ping === null ? null : ping;
    const uuidVal = uuid && uuid.trim() ? uuid.trim() : null;
    try {
      await pool.query(
        `INSERT INTO pm_list (ign, ping, uuid, manager_type, created_at) VALUES ($1, $2, $3, $4, NOW())`,
        [ign, pingVal, uuidVal, mgrType]
      );
    } catch (e) {
      if (e.code === '23505' && /pm_list/i.test(String(e.message))) {
        await pool.query(
          `SELECT setval(
            pg_get_serial_sequence('pm_list', 'id'),
            (SELECT MAX(id) FROM pm_list)
          )`
        );
        await pool.query(
          `INSERT INTO pm_list (ign, ping, uuid, manager_type, created_at) VALUES ($1, $2, $3, $4, NOW())`,
          [ign, pingVal, uuidVal, mgrType]
        );
      } else {
        throw e;
      }
    }
    await interaction.editReply({ content: `✅ Added **${ign}** to PM list.` });
  }

  async function handleDeletepm(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const q = await pool.query(
      'DELETE FROM pm_list WHERE LOWER(TRIM(ign)) = $1 RETURNING ign',
      [ign]
    );
    if (q.rows.length === 0) {
      return interaction.editReply({ content: `❌ No PM list entry for **${ign}**.` });
    }
    const names = q.rows.map((r) => r.ign).join(', ');
    await interaction.editReply({
      content:
        q.rows.length === 1
          ? `✅ Removed **${q.rows[0].ign}** from the PM list.`
          : `✅ Removed **${q.rows.length}** PM list rows matching **${ign}**: ${names}`,
    });
  }

  async function handleEditpm(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const ping = interaction.options.getInteger('ping');
    const mgrOpt = interaction.options.getString('manager-type');
    if (ping === null && mgrOpt === null) {
      return interaction.editReply({
        content: '❌ Provide at least **ping** or **manager-type** to update.',
      });
    }
    const parts = [];
    const vals = [];
    let n = 1;
    if (ping !== null) {
      parts.push(`ping = $${n++}`);
      vals.push(ping);
    }
    if (mgrOpt !== null) {
      parts.push(`manager_type = $${n++}`);
      vals.push(parseManagerType(mgrOpt));
    }
    vals.push(ign);
    const q = await pool.query(
      `UPDATE pm_list SET ${parts.join(', ')} WHERE LOWER(TRIM(ign)) = $${n} RETURNING ign`,
      vals
    );
    if (q.rows.length === 0) {
      return interaction.editReply({ content: `❌ No PM list entry for **${ign}**.` });
    }
    const msg =
      q.rows.length === 1
        ? `✅ Updated **${q.rows[0].ign}**.`
        : `✅ Updated **${q.rows.length}** PM list rows matching **${ign}**.`;
    await interaction.editReply({ content: msg });
  }

  async function handlePmstats(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 1)) {
      return interaction.editReply({ content: '❌ PM or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const start = interaction.options.getString('start-date');
    const end = interaction.options.getString('end-date');

    let sql = `
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN LOWER(s.winner_ign) = $1 THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN LOWER(s.loser_ign) = $1 THEN 1 ELSE 0 END)::int AS losses
      FROM scores s
      WHERE (LOWER(s.winner_ign) = $1 OR LOWER(s.loser_ign) = $1)
      AND s.is_voided = false`;
    const params = [ign];
    if (start && end) {
      sql += ' AND s.created_at BETWEEN $2 AND $3';
      params.push(new Date(start), new Date(end));
    }
    const stats = await pool.query(sql, params);

    const row = stats.rows[0];
    const total = row.total || 0;
    const wins = row.wins || 0;
    const losses = row.losses || 0;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    const embed = new EmbedBuilder()
      .setTitle(`PM stats: ${ign}`)
      .setColor(0x1abc9c)
      .addFields(
        { name: 'Total fights', value: String(total), inline: true },
        { name: 'Wins', value: String(wins), inline: true },
        { name: 'Losses', value: String(losses), inline: true },
        { name: 'Win rate', value: `${winRate}%`, inline: true }
      )
      .setFooter({
        text: start && end ? `Range: ${start} – ${end}` : 'All recorded fights',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('pmlist')
      .setDescription('View the PM list')
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('addpm')
      .setDescription('Add a PM to the list')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('manager-type')
          .setDescription('Prime / Elite / Apex manager (default N/A)')
          .setRequired(false)
          .addChoices(...PM_MANAGER_CHOICES)
      )
      .addIntegerOption((o) =>
        o.setName('ping').setDescription('Ping ms (optional)').setRequired(false)
      )
      .addStringOption((o) => o.setName('uuid').setDescription('UUID (optional)').setRequired(false))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('deletepm')
      .setDescription('Delete a PM from the list by Minecraft IGN (Admin Only)')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Minecraft IGN to remove').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('editpm')
      .setDescription("Edit a PM's ping and/or manager type (Prime / Elite / Apex)")
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addIntegerOption((o) =>
        o.setName('ping').setDescription('New ping (optional if updating manager type)').setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('manager-type')
          .setDescription('Prime / Elite / Apex / N/A (optional if updating ping)')
          .setRequired(false)
          .addChoices(...PM_MANAGER_CHOICES)
      )
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('pmstats')
      .setDescription('Fight stats for one PM (wins, losses, win rate)')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Minecraft IGN (PM)').setRequired(true)
      )
      .addStringOption((o) =>
        o.setName('start-date').setDescription('ISO date start (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('end-date').setDescription('ISO date end (optional)').setRequired(false)
      )
      .setDefaultMemberPermissions(mgr),
  ];

  return {
    commands,
    handlers: {
      pmlist: handlePmlist,
      addpm: handleAddpm,
      deletepm: handleDeletepm,
      editpm: handleEditpm,
      pmstats: handlePmstats,
    },
  };
};
