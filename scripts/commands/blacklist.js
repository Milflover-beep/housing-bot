const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function blacklistCommands(ctx) {
  const { pool, requireLevel, isAdminOrOwner, parseDurationToDate, defer, normalizeIgn } = ctx;

  async function handleBlacklist(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const reason = interaction.options.getString('reason');
    const duration = interaction.options.getString('duration');
    const expires = parseDurationToDate(duration);
    if (expires === undefined) {
      return interaction.editReply({
        content:
          '❌ Could not parse duration. Use e.g. `7d`, `24h`, `permanent`, or leave blank for permanent.',
      });
    }
    await pool.query(
      `INSERT INTO blacklists (ign, time_length, reason, blacklist_expires, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [ign, duration || 'permanent', reason, expires]
    );
    await interaction.editReply({
      content: `✅ Blacklisted **${ign}**. Reason: ${reason}${
        expires ? ` (expires <t:${Math.floor(expires.getTime() / 1000)}:R>)` : ' (permanent)'
      }`,
    });
  }

  async function handlePardon(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const table = interaction.options.getString('table');
    const id = interaction.options.getInteger('id');
    if (table === 'admin_blacklists') {
      await pool.query('UPDATE admin_blacklists SET is_pardoned = true WHERE id = $1', [id]);
    } else {
      await pool.query('DELETE FROM blacklists WHERE id = $1', [id]);
    }
    await interaction.editReply({ content: `✅ Pardoned / removed entry **#${id}** from **${table}**.` });
  }

  async function handleViewblacklist(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const r = await pool.query(
      'SELECT * FROM blacklists WHERE LOWER(ign) = $1 ORDER BY id DESC LIMIT 20',
      [ign]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No blacklist rows for **${ign}**.` });
    }
    const now = Date.now();
    const desc = r.rows
      .map((row) => {
        const expiresAt = row.blacklist_expires ? new Date(row.blacklist_expires) : null;
        const isActive = !expiresAt || expiresAt.getTime() > now;
        const status = isActive ? 'active' : 'expired';
        let timingText = ' — permanent';
        if (expiresAt) {
          timingText = isActive
            ? ` — expires ${expiresAt.toLocaleString()}`
            : ` — expired ${expiresAt.toLocaleString()}`;
        }
        return `**#${row.id}** — ${row.reason} (${row.time_length || '?'}) — **${status}**${timingText}`;
      })
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`Blacklist history: ${ign}`)
      .setColor(0xe74c3c)
      .setDescription(desc.slice(0, 3900))
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleAdminblacklist(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 4)) {
      return interaction.editReply({ content: '❌ Admins or higher only.' });
    }
    const ignOpt = interaction.options.getString('ign');
    const q = ignOpt
      ? await pool.query(
          'SELECT * FROM admin_blacklists WHERE LOWER(ign) = $1 ORDER BY id DESC LIMIT 25',
          [normalizeIgn(ignOpt)]
        )
      : await pool.query('SELECT * FROM admin_blacklists ORDER BY id DESC LIMIT 25');
    if (q.rows.length === 0) {
      return interaction.editReply({ content: 'No admin blacklist rows.' });
    }
    const desc = q.rows
      .map(
        (row) =>
          `**#${row.id}** \`${row.ign}\` — ${row.reason || '?'} | pardoned: ${row.is_pardoned}`
      )
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Admin blacklist')
      .setColor(0xc0392b)
      .setDescription(desc.slice(0, 3900));
    await interaction.editReply({ embeds: [embed] });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Blacklist a player with specified duration and reason')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('duration')
          .setDescription('e.g. 7d, 30d, permanent')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('pardon')
      .setDescription('Pardon a specific blacklist entry')
      .addStringOption((o) =>
        o
          .setName('table')
          .setDescription('Which table')
          .setRequired(true)
          .addChoices(
            { name: 'blacklists', value: 'blacklists' },
            { name: 'admin_blacklists (sets pardoned)', value: 'admin_blacklists' }
          )
      )
      .addIntegerOption((o) => o.setName('id').setDescription('Row id').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('viewblacklist')
      .setDescription('View blacklist history for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('adminblacklist')
      .setDescription('View admin blacklist records with IDs')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Filter by IGN (optional)').setRequired(false)
      ),
  ];

  return {
    commands,
    handlers: {
      blacklist: handleBlacklist,
      pardon: handlePardon,
      viewblacklist: handleViewblacklist,
      adminblacklist: handleAdminblacklist,
    },
  };
};
