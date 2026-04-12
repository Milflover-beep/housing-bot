const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function utilityCommands(ctx) {
  const { pool, requireLevel, isOwner, defer, normalizeIgn } = ctx;
  const mgr = PermissionFlagsBits.ManageRoles;

  async function handleUpdate(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
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
    if (!isOwner(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Bot owner only.' });
    }
    const q = `%${normalizeIgn(interaction.options.getString('query'))}%`;
    const tables = [
      ['blacklists', 'SELECT id, ign FROM blacklists WHERE LOWER(ign) LIKE $1 LIMIT 10'],
      ['tier_results', 'SELECT id, ign FROM tier_results WHERE LOWER(ign) LIKE $1 LIMIT 10'],
      ['scores', 'SELECT id, winner_ign, loser_ign FROM scores WHERE LOWER(winner_ign) LIKE $1 OR LOWER(loser_ign) LIKE $1 LIMIT 10'],
    ];
    const lines = [];
    for (const [name, sql] of tables) {
      const r = await pool.query(sql, [q]);
      if (r.rows.length) lines.push(`**${name}**: ${r.rows.map((row) => JSON.stringify(row)).join('; ')}`);
    }
    await interaction.editReply({ content: lines.join('\n').slice(0, 3900) || 'No hits.' });
  }

  async function handleErrorcheck(interaction) {
    await defer(interaction, true);
    if (!isOwner(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Bot owner only.' });
    }
    const flagged = await pool.query('SELECT database_name, entry_id FROM flagged_errors');
    const issues = [];
    const ignTables = [
      ['blacklists', 'SELECT id FROM blacklists WHERE ign IS NULL OR TRIM(ign) = \'\''],
    ];
    for (const [t, sql] of ignTables) {
      const r = await pool.query(sql);
      for (const row of r.rows) {
        const skip = flagged.rows.some(
          (f) => f.database_name === t && f.entry_id === row.id
        );
        if (!skip) issues.push(`${t}#${row.id}: empty IGN`);
      }
    }
    await interaction.editReply({
      content: issues.length ? issues.join('\n').slice(0, 3900) : '✅ No obvious issues found.',
    });
  }

  async function handleRemoveflag(interaction) {
    await defer(interaction, true);
    if (!isOwner(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Bot owner only.' });
    }
    const databaseName = interaction.options.getString('database');
    const entryId = interaction.options.getInteger('entry-id');
    await pool.query(
      `INSERT INTO flagged_errors (database_name, entry_id, created_at) VALUES ($1, $2, NOW())`,
      [databaseName, entryId]
    );
    await interaction.editReply({
      content: `✅ Flagged **${databaseName}** entry **${entryId}** to ignore in /errorcheck.`,
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('update')
      .setDescription('Update IGN across all database tables')
      .addStringOption((o) => o.setName('old-ign').setDescription('Current IGN').setRequired(true))
      .addStringOption((o) => o.setName('new-ign').setDescription('New IGN').setRequired(true))
      .setDefaultMemberPermissions(mgr),
    new SlashCommandBuilder()
      .setName('find')
      .setDescription('Search a database table for IGN entries (Bot Owner Only)')
      .addStringOption((o) => o.setName('query').setDescription('Substring to search').setRequired(true)),
    new SlashCommandBuilder()
      .setName('errorcheck')
      .setDescription('Check all databases for potential errors and typos (Bot Owner Only)'),
    new SlashCommandBuilder()
      .setName('removeflag')
      .setDescription('Flag a database entry to be ignored by /errorcheck (Bot Owner Only)')
      .addStringOption((o) =>
        o.setName('database').setDescription('Table name').setRequired(true)
      )
      .addIntegerOption((o) =>
        o.setName('entry-id').setDescription('Primary key id').setRequired(true)
      ),
  ];

  return {
    commands,
    handlers: {
      update: handleUpdate,
      find: handleFind,
      errorcheck: handleErrorcheck,
      removeflag: handleRemoveflag,
    },
  };
};
