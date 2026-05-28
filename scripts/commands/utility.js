const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = function utilityCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn } = ctx;

  const FIND_TARGETS = [
    {
      key: 'blacklists',
      label: 'blacklists',
      sql: 'SELECT id, ign FROM blacklists WHERE LOWER(ign) LIKE $1 LIMIT 10',
      sqlById: 'SELECT id, ign FROM blacklists WHERE id = $1 LIMIT 10',
    },
    {
      key: 'tier_results',
      label: 'tier_results',
      sql: 'SELECT id, ign, type, tier FROM tier_results WHERE LOWER(ign) LIKE $1 LIMIT 10',
      sqlById: 'SELECT id, ign, type, tier FROM tier_results WHERE id = $1 LIMIT 10',
    },
    {
      key: 'scores',
      label: 'scores',
      sql: 'SELECT id, winner_ign, loser_ign, created_at FROM scores WHERE LOWER(winner_ign) LIKE $1 OR LOWER(loser_ign) LIKE $1 ORDER BY created_at DESC, id DESC LIMIT 10',
      sqlById: 'SELECT id, winner_ign, loser_ign, created_at FROM scores WHERE id = $1 LIMIT 10',
    },
    {
      key: 'punishment_logs',
      label: 'punishment_logs',
      sql: 'SELECT id, user_ign, staff_ign, punishment, punishment_status FROM punishment_logs WHERE LOWER(user_ign) LIKE $1 LIMIT 10',
      sqlById:
        'SELECT id, user_ign, staff_ign, punishment, punishment_status FROM punishment_logs WHERE id = $1 LIMIT 10',
    },
    {
      key: 'reports',
      label: 'reports',
      sql: 'SELECT id, ign, punishment_issued FROM reports WHERE LOWER(ign) LIKE $1 LIMIT 10',
      sqlById: 'SELECT id, ign, punishment_issued FROM reports WHERE id = $1 LIMIT 10',
    },
    {
      key: 'alts',
      label: 'alts',
      sql: 'SELECT id, original_ign, alt_ign FROM alts WHERE LOWER(original_ign) LIKE $1 OR LOWER(alt_ign) LIKE $1 LIMIT 10',
      sqlById: 'SELECT id, original_ign, alt_ign FROM alts WHERE id = $1 LIMIT 10',
    },
    {
      key: 'uuid_registry',
      label: 'uuid_registry',
      sql: 'SELECT id, ign, uuid FROM uuid_registry WHERE LOWER(ign) LIKE $1 LIMIT 10',
      sqlById: 'SELECT id, ign, uuid FROM uuid_registry WHERE id = $1 LIMIT 10',
    },
  ];

  async function handleUpdate(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 4)) {
      return interaction.editReply({ content: '❌ Admins or higher only.' });
    }
    const oldIgn = normalizeIgn(interaction.options.getString('old-ign'));
    const newIgn = normalizeIgn(interaction.options.getString('new-ign'));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const run = (sql, params) => client.query(sql, params);
      await run('UPDATE admin_blacklists SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run(
        'UPDATE alts SET original_ign = $2 WHERE LOWER(original_ign) = $1',
        [oldIgn, newIgn]
      );
      await run('UPDATE alts SET alt_ign = $2 WHERE LOWER(alt_ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE apr_logs SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE blacklists SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE pm_list SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE pm_membership_periods SET ign = $2 WHERE LOWER(TRIM(ign)) = $1', [
        oldIgn,
        newIgn,
      ]);
      await run('UPDATE punishment_logs SET user_ign = $2 WHERE LOWER(user_ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE reports SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE role_blacklists SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE scores SET winner_ign = $2 WHERE LOWER(winner_ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE scores SET loser_ign = $2 WHERE LOWER(loser_ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE tier_history SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE tier_results SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE timeouts SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE uuid_registry SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE watchlist SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await run('UPDATE application_denials SET ign = $2 WHERE LOWER(ign) = $1', [oldIgn, newIgn]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(e);
      return interaction.editReply({ content: `❌ Update failed: ${e.message}` });
    } finally {
      client.release();
    }
    await interaction.editReply({
      content: `✅ Renamed **${oldIgn}** → **${newIgn}** across supported tables.`,
    });
  }

  async function handleFind(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 4)) {
      return interaction.editReply({ content: '❌ Admins or higher only.' });
    }
    const rawQuery = interaction.options.getString('query');
    const normalizedQuery = rawQuery ? normalizeIgn(rawQuery) : '';
    const q = normalizedQuery ? `%${normalizedQuery}%` : null;
    const id = interaction.options.getInteger('id');
    if (!Number.isFinite(id) && !q) {
      return interaction.editReply({
        content:
          '❌ Provide at least one search input: **id** (exact row id) or **query** (text match).',
      });
    }
    const target = interaction.options.getString('target') || 'all';
    const tables = target === 'all' ? FIND_TARGETS : FIND_TARGETS.filter((t) => t.key === target);
    const available = FIND_TARGETS.map((t) => `\`${t.key}\``).join(', ');
    const lines = [];
    for (const table of tables) {
      const useIdSearch = Number.isFinite(id) && typeof table.sqlById === 'string';
      if (!useIdSearch && !q) continue;
      const r = useIdSearch ? await pool.query(table.sqlById, [id]) : await pool.query(table.sql, [q]);
      if (r.rows.length) {
        lines.push(`**${table.label}**: ${r.rows.map((row) => JSON.stringify(row)).join('; ')}`);
      }
    }
    const searchMode = Number.isFinite(id) ? `id=${id}` : `query=${rawQuery}`;
    const body = lines.join('\n').slice(0, 3600) || 'No hits.';
    await interaction.editReply({
      content: `Search mode: ${searchMode}\nSearchable targets: ${available}\n${body}`,
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('update')
      .setDescription('Update IGN across all database tables')
      .addStringOption((o) => o.setName('old-ign').setDescription('Current IGN').setRequired(true))
      .addStringOption((o) => o.setName('new-ign').setDescription('New IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('find')
      .setDescription('Find rows by ID or text across moderation/player tables (Admin+)')
      .addStringOption((o) =>
        o
          .setName('query')
          .setDescription('Optional text query (IGN/name substring)')
          .setRequired(false)
      )
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Optional exact row ID lookup (e.g. punishment log id)')
          .setRequired(false)
          .setMinValue(1)
      )
      .addStringOption((o) =>
        o
          .setName('target')
          .setDescription('What table/group to search (default: all)')
          .setRequired(false)
          .addChoices(
            { name: 'All', value: 'all' },
            { name: 'blacklists', value: 'blacklists' },
            { name: 'tier_results', value: 'tier_results' },
            { name: 'scores', value: 'scores' },
            { name: 'punishment_logs', value: 'punishment_logs' },
            { name: 'reports', value: 'reports' },
            { name: 'alts', value: 'alts' },
            { name: 'uuid_registry', value: 'uuid_registry' }
          )
      ),
  ];

  return {
    commands,
    handlers: {
      update: handleUpdate,
      find: handleFind,
    },
  };
};
