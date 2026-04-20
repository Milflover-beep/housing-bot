const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const WHOIS_FILE_PATH = path.join(__dirname, '..', 'data', 'whois.txt');

function loadWhoisOverrides() {
  try {
    const raw = fs.readFileSync(WHOIS_FILE_PATH, 'utf8');
    const map = new Map();
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sep = trimmed.indexOf('|');
      if (sep <= 0) continue;
      const ign = trimmed.slice(0, sep).trim().toLowerCase();
      const text = trimmed.slice(sep + 1).trim();
      if (!ign || !text) continue;
      map.set(ign, text);
    }
    return map;
  } catch (err) {
    console.warn(
      `⚠️ Failed to load whois overrides from ${WHOIS_FILE_PATH}: ${err?.message || err}`
    );
    return new Map();
  }
}

module.exports = function utilityCommands(ctx) {
  const { pool, requireLevel, isOwner, defer, normalizeIgn } = ctx;

  const FIND_TARGETS = [
    { key: 'blacklists', label: 'blacklists', sql: 'SELECT id, ign FROM blacklists WHERE LOWER(ign) LIKE $1 LIMIT 10' },
    { key: 'tier_results', label: 'tier_results', sql: 'SELECT id, ign, type, tier FROM tier_results WHERE LOWER(ign) LIKE $1 LIMIT 10' },
    {
      key: 'scores',
      label: 'scores',
      sql: 'SELECT id, winner_ign, loser_ign FROM scores WHERE LOWER(winner_ign) LIKE $1 OR LOWER(loser_ign) LIKE $1 LIMIT 10',
    },
    {
      key: 'punishment_logs',
      label: 'punishment_logs',
      sql: 'SELECT id, user_ign, staff_ign, punishment_status FROM punishment_logs WHERE LOWER(user_ign) LIKE $1 LIMIT 10',
    },
    { key: 'reports', label: 'reports', sql: 'SELECT id, ign, punishment_issued FROM reports WHERE LOWER(ign) LIKE $1 LIMIT 10' },
    {
      key: 'alts',
      label: 'alts',
      sql: 'SELECT id, original_ign, alt_ign FROM alts WHERE LOWER(original_ign) LIKE $1 OR LOWER(alt_ign) LIKE $1 LIMIT 10',
    },
    { key: 'uuid_registry', label: 'uuid_registry', sql: 'SELECT id, ign, uuid FROM uuid_registry WHERE LOWER(ign) LIKE $1 LIMIT 10' },
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
    const q = `%${normalizeIgn(interaction.options.getString('query'))}%`;
    const target = interaction.options.getString('target') || 'all';
    const tables = target === 'all' ? FIND_TARGETS : FIND_TARGETS.filter((t) => t.key === target);
    const available = FIND_TARGETS.map((t) => `\`${t.key}\``).join(', ');
    const lines = [];
    for (const table of tables) {
      const r = await pool.query(table.sql, [q]);
      if (r.rows.length) {
        lines.push(`**${table.label}**: ${r.rows.map((row) => JSON.stringify(row)).join('; ')}`);
      }
    }
    const body = lines.join('\n').slice(0, 3700) || 'No hits.';
    await interaction.editReply({
      content: `Searchable targets: ${available}\n${body}`,
    });
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

  async function handleWhois(interaction) {
    await defer(interaction, false);
    const raw = interaction.options.getString('ign', true).trim();
    if (!raw) {
      return interaction.editReply({ content: 'Give an IGN to whois.' });
    }
    const key = raw.toLowerCase();
    const overrides = loadWhoisOverrides();
    const text = overrides.get(key) || `${raw} is mid`;
    await interaction.editReply({ content: text });
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
      .setName('whois')
      .setDescription('PvP facts about an IGN')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Minecraft IGN').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('update')
      .setDescription('Update IGN across all database tables')
      .addStringOption((o) => o.setName('old-ign').setDescription('Current IGN').setRequired(true))
      .addStringOption((o) => o.setName('new-ign').setDescription('New IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('find')
      .setDescription('Search IGN entries across moderation/player tables (Admin+)')
      .addStringOption((o) => o.setName('query').setDescription('Substring to search').setRequired(true))
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
      whois: handleWhois,
      update: handleUpdate,
      find: handleFind,
      errorcheck: handleErrorcheck,
      removeflag: handleRemoveflag,
    },
  };
};
