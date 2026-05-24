const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function blacklistCommands(ctx) {
  const {
    pool,
    requireLevel,
    isAdminOrOwner,
    parseDurationToDate,
    defer,
    resolveIgnIdentity,
  } = ctx;
  const blacklistRoleId = String(process.env.BLACKLIST_ROLE_ID || '').trim();

  const BLACKLIST_TYPE_CHOICES = [
    { name: 'Type A (Cheating)', value: 'Type A (Cheating)' },
    { name: 'Type A.2 (Cheating II)', value: 'Type A.2 (Cheating II)' },
    { name: 'Type A.3 (Logging)', value: 'Type A.3 (Logging)' },
    { name: 'Type B (Security)', value: 'Type B (Security)' },
    { name: 'Type C (Security II)', value: 'Type C (Security II)' },
    { name: 'Type C.2 (Security III)', value: 'Type C.2 (Security III)' },
    { name: 'Type D (Conduct)', value: 'Type D (Conduct)' },
    { name: 'Type E (Conduct II)', value: 'Type E (Conduct II)' },
    { name: 'Type F (Conduct III)', value: 'Type F (Conduct III)' },
  ];

  async function handleBlacklist(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const ignInput = interaction.options.getString('ign');
    const discordUser = interaction.options.getUser('discord');
    if (!ignInput && !discordUser) {
      return interaction.editReply({
        content: '❌ Provide at least one target: **ign** or **discord**.',
      });
    }
    const identity = ignInput ? await resolveIgnIdentity(pool, ignInput) : null;
    const ign = identity ? identity.canonicalIgn || identity.ign : null;
    const discordUserId = discordUser ? String(discordUser.id) : null;
    const type = interaction.options.getString('type', true);
    const details = interaction.options.getString('details');
    const reason = details ? `${type} — ${details}` : type;
    const duration = interaction.options.getString('duration');
    const expires = parseDurationToDate(duration);
    if (expires === undefined) {
      return interaction.editReply({
        content:
          '❌ Could not parse duration. Use e.g. `7d`, `24h`, `permanent`, or leave blank for permanent.',
      });
    }
    await pool.query(
      `INSERT INTO blacklists (ign, discord_user_id, time_length, reason, blacklist_expires, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [ign, discordUserId, duration || 'permanent', reason, expires]
    );
    let roleNote = '';
    if (discordUserId && blacklistRoleId && interaction.guild) {
      const member = await interaction.guild.members.fetch(discordUserId).catch(() => null);
      if (member && !member.roles.cache.has(blacklistRoleId)) {
        await member.roles.add(blacklistRoleId, 'Blacklisted').catch(() => {});
      }
    } else if (discordUserId && !blacklistRoleId) {
      roleNote = '\n⚠️ `BLACKLIST_ROLE_ID` is not configured.';
    }
    await interaction.editReply({
      content: `✅ Blacklisted **${ign || 'unknown IGN'}**${discordUserId ? ` (<@${discordUserId}>)` : ''}. Reason: ${reason}${
        expires ? ` (expires <t:${Math.floor(expires.getTime() / 1000)}:R>)` : ' (permanent)'
      }${roleNote}`,
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
      return interaction.editReply({
        content: `✅ Marked premium blacklist entry **#${id}** as pardoned.`,
      });
    }
    await pool.query('DELETE FROM blacklists WHERE id = $1', [id]);
    await interaction.editReply({ content: `✅ Removed blacklist entry **#${id}**.` });
  }

  async function handleViewblacklist(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ignInput = interaction.options.getString('ign');
    const discordUser = interaction.options.getUser('discord');
    if (!ignInput && !discordUser) {
      return interaction.editReply({ content: '❌ Provide **ign** or **discord**.' });
    }
    const identity = ignInput ? await resolveIgnIdentity(pool, ignInput) : null;
    const ign = identity ? identity.canonicalIgn || identity.ign : 'unknown';
    const ignAliases = identity?.aliases?.length ? identity.aliases : [];
    const discordUserId = discordUser ? String(discordUser.id) : null;
    const r = await pool.query(
      `SELECT * FROM (
         SELECT
           'blacklists' AS source_table,
           id,
           ign,
           discord_user_id,
           reason,
           time_length,
           blacklist_expires,
           created_at,
           NULL::boolean AS is_pardoned
         FROM blacklists
         WHERE (cardinality($1::text[]) > 0 AND LOWER(ign) = ANY($1::text[]))
            OR (COALESCE($2::text, '') <> '' AND discord_user_id = $2)
         UNION ALL
         SELECT
           'admin_blacklists' AS source_table,
           id,
           ign,
           NULL::text AS discord_user_id,
           reason,
           NULL::text AS time_length,
           NULL::timestamp AS blacklist_expires,
           created_at,
           is_pardoned
         FROM admin_blacklists
         WHERE cardinality($1::text[]) > 0 AND LOWER(ign) = ANY($1::text[])
       ) q
       WHERE source_table <> 'admin_blacklists' OR COALESCE(is_pardoned, false) = false
       ORDER BY id DESC
       LIMIT 20`,
      [ignAliases, discordUserId]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({
        content: `No blacklist rows for **${ignInput || 'that target'}**${discordUserId ? ` (<@${discordUserId}>)` : ''}.`,
      });
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
        const source = row.source_table === 'admin_blacklists' ? 'Premium' : 'Standard';
        return `**#${row.id}** [${source}] — ${row.reason} (${row.time_length || '?'}) — **${status}**${timingText}`;
      })
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`Blacklist history: ${ignInput || ign}`)
      .setColor(0xe74c3c)
      .setDescription(desc.slice(0, 3900))
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Blacklist a player with a category type and optional details')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Blacklist category type')
          .setRequired(true)
          .addChoices(...BLACKLIST_TYPE_CHOICES)
      )
      .addStringOption((o) =>
        o
          .setName('ign')
          .setDescription('Minecraft IGN (optional if discord is provided)')
          .setRequired(false)
      )
      .addUserOption((o) =>
        o
          .setName('discord')
          .setDescription('Discord user (optional if ign is provided)')
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('details')
          .setDescription('Optional case-specific context')
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('duration')
          .setDescription('e.g. 7d, 30d, permanent')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('removeblacklist')
      .setDescription('Remove a specific premium blacklist entry')
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
      .setName('viewblacklists')
      .setDescription('View premium blacklist history for a player')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Minecraft IGN (optional if discord is provided)').setRequired(false)
      )
      .addUserOption((o) =>
        o.setName('discord').setDescription('Discord user (optional if ign is provided)').setRequired(false)
      ),
  ];

  return {
    commands,
    handlers: {
      blacklist: handleBlacklist,
      removeblacklist: handlePardon,
      viewblacklists: handleViewblacklist,
    },
  };
};
