const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = function altsCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn } = ctx;

  async function handleAddalt(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const orig = normalizeIgn(interaction.options.getString('original-ign'));
    const alt = normalizeIgn(interaction.options.getString('alt-ign'));
    await pool.query(
      `INSERT INTO alts (original_ign, alt_ign, created_at, is_whitelisted) VALUES ($1, $2, NOW(), false)`,
      [orig, alt]
    );
    await interaction.editReply({ content: `✅ Linked alt **${alt}** → **${orig}**.` });
  }

  async function handleViewalts(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const r = await pool.query(
      `SELECT * FROM alts WHERE LOWER(original_ign) = $1 OR LOWER(alt_ign) = $1`,
      [ign]
    );
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No alts found for **${ign}**.` });
    }
    const lines = r.rows.map(
      (row) =>
        `• \`${row.original_ign}\` ↔ \`${row.alt_ign}\` (whitelist: ${row.is_whitelisted}) #${row.id}`
    );
    await interaction.editReply({ content: lines.join('\n').slice(0, 3900) });
  }

  async function handleDeletealt(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const id = interaction.options.getInteger('id', true);
    const q = await pool.query(
      'DELETE FROM alts WHERE id = $1 RETURNING id, original_ign, alt_ign',
      [id]
    );
    if (q.rows.length === 0) {
      return interaction.editReply({ content: `❌ No alt row with id **${id}**.` });
    }
    const row = q.rows[0];
    await interaction.editReply({
      content: `✅ Deleted alt row **#${row.id}** (\`${row.original_ign}\` ↔ \`${row.alt_ign}\`).`,
    });
  }

  async function handleClearalt(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const orig = normalizeIgn(interaction.options.getString('original-ign'));
    const q = await pool.query('DELETE FROM alts WHERE LOWER(original_ign) = $1 RETURNING id', [orig]);
    await interaction.editReply({
      content: q.rowCount ? `✅ Cleared **${q.rowCount}** alt row(s) for **${orig}**.` : '❌ No rows.',
    });
  }

  async function handleEditalt(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const id = interaction.options.getInteger('id');
    const newOrig = interaction.options.getString('new-original-ign');
    const newAlt = interaction.options.getString('new-alt-ign');
    const sets = [];
    const vals = [];
    let n = 1;
    if (newOrig) {
      sets.push(`original_ign = $${n++}`);
      vals.push(normalizeIgn(newOrig));
    }
    if (newAlt) {
      sets.push(`alt_ign = $${n++}`);
      vals.push(normalizeIgn(newAlt));
    }
    if (!sets.length) {
      return interaction.editReply({ content: '❌ Provide at least one field to change.' });
    }
    vals.push(id);
    await pool.query(`UPDATE alts SET ${sets.join(', ')} WHERE id = $${n}`, vals);
    await interaction.editReply({ content: `✅ Updated alt row **#${id}**.` });
  }

  async function handleWhitelist(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const ignLower = normalizeIgn(interaction.options.getString('ign'));
    const on = interaction.options.getBoolean('whitelisted');
    await pool.query('UPDATE alts SET is_whitelisted = $1 WHERE LOWER(original_ign) = $2', [
      on,
      ignLower,
    ]);
    if (on) {
      await pool.query('INSERT INTO original_whitelist (original_ign, created_at) VALUES ($1, NOW())', [
        ignLower,
      ]);
    }
    await interaction.editReply({
      content: `✅ Set whitelist flag for alts with original **${ignLower}** to **${on}**.`,
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('addalt')
      .setDescription('Add an alternative IGN to an original IGN')
      .addStringOption((o) =>
        o.setName('original-ign').setDescription('Original IGN').setRequired(true)
      )
      .addStringOption((o) => o.setName('alt-ign').setDescription('Alt IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('viewalts')
      .setDescription('View all alt IGNs associated with a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('deletealt')
      .setDescription('Delete one alt link by database id (see /viewalts)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('alts.id from /viewalts').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('clearalt')
      .setDescription('Clear all alt relationships for an original IGN')
      .addStringOption((o) =>
        o.setName('original-ign').setDescription('Original IGN').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('editalt')
      .setDescription('Edit an original IGN or specific alt IGN')
      .addIntegerOption((o) => o.setName('id').setDescription('alts.id').setRequired(true))
      .addStringOption((o) =>
        o.setName('new-original-ign').setDescription('New original (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('new-alt-ign').setDescription('New alt (optional)').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('whitelist')
      .setDescription('Set whitelist status for an IGN to control visibility in viewalts')
      .addStringOption((o) => o.setName('ign').setDescription('Original IGN').setRequired(true))
      .addBooleanOption((o) =>
        o.setName('whitelisted').setDescription('Whitelisted?').setRequired(true)
      ),
  ];

  return {
    commands,
    handlers: {
      addalt: handleAddalt,
      viewalts: handleViewalts,
      deletealt: handleDeletealt,
      clearalt: handleClearalt,
      editalt: handleEditalt,
      whitelist: handleWhitelist,
    },
  };
};
