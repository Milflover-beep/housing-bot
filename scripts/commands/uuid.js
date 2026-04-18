const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function formatUuid(raw) {
  const t = String(raw || '').replace(/-/g, '').trim();
  if (!/^[0-9a-fA-F]{32}$/.test(t)) return raw;
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;
}

module.exports = function uuidCommands(ctx) {
  const { pool, isAdminOrOwner, defer, normalizeIgn, resolveIgnIdentity } = ctx;

  async function handleUuid(interaction) {
    await defer(interaction, false);
    const ignInput = interaction.options.getString('ign', true).trim();
    const ign = normalizeIgn(ignInput);
    if (!ign) {
      return interaction.editReply({ content: '❌ Provide a valid IGN.' });
    }

    const url = `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      return interaction.editReply({
        content: `❌ Mojang lookup failed: ${String(e?.message || e).slice(0, 200)}`,
      });
    }

    if (res.status === 204 || res.status === 404) {
      return interaction.editReply({ content: `❌ No Mojang profile found for **${ignInput}**.` });
    }
    if (res.status === 429) {
      return interaction.editReply({
        content: '❌ Mojang API is rate-limiting right now. Try again in a moment.',
      });
    }
    if (!res.ok) {
      return interaction.editReply({
        content: `❌ Mojang API error: HTTP ${res.status}.`,
      });
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      return interaction.editReply({
        content: `❌ Mojang API returned invalid JSON: ${String(e?.message || e).slice(0, 200)}`,
      });
    }

    const uuidRaw = String(data?.id || '').trim();
    const name = String(data?.name || ignInput).trim();
    if (!uuidRaw) {
      return interaction.editReply({ content: '❌ Mojang response did not include a UUID.' });
    }

    await interaction.editReply({
      content: `**${name}** UUID: \`${formatUuid(uuidRaw)}\``,
    });
  }

  async function handleEdituuid(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const uuid = interaction.options.getString('uuid').trim();
    const existing = await pool.query('SELECT id FROM uuid_registry WHERE LOWER(ign) = ANY($1::text[])', [
      ignAliases,
    ]);
    if (existing.rows.length) {
      await pool.query('UPDATE uuid_registry SET uuid = $1 WHERE id = $2', [uuid, existing.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO uuid_registry (ign, uuid, created_at) VALUES ($1, $2, NOW())',
        [ign, uuid]
      );
    }
    await interaction.editReply({ content: `✅ UUID for **${ign}** set to \`${uuid}\`.` });
  }

  async function handleRemoveuuid(interaction) {
    await defer(interaction, true);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const q = await pool.query('DELETE FROM uuid_registry WHERE LOWER(ign) = ANY($1::text[]) RETURNING id', [
      ignAliases,
    ]);
    await interaction.editReply({
      content: q.rowCount ? `✅ Removed UUID row(s) for **${ign}**.` : '❌ No row found.',
    });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('uuid')
      .setDescription('Look up a player UUID from Mojang')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('edituuid')
      .setDescription('Edit or add a UUID for an IGN (Admin Only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) => o.setName('uuid').setDescription('UUID').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('removeuuid')
      .setDescription('Remove a UUID from an IGN (Admin Only)')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  return {
    commands,
    handlers: {
      uuid: handleUuid,
      edituuid: handleEdituuid,
      removeuuid: handleRemoveuuid,
    },
  };
};
