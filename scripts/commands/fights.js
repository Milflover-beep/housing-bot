const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { buildFightScoreLogEmbed, sendFightScoreLogEmbed } = require('../lib/fightScoreLogEmbed');

module.exports = function fightsCommands(ctx) {
  const { pool, isAdminOrOwner, requireLevel, defer, normalizeIgn, resolveIgnIdentity } = ctx;

  async function sendFightActionLog(client, action, row, actorUsername) {
    const title = action === 'voided' ? 'Fight Voided' : 'Fight Deleted';
    const color = action === 'voided' ? 0xe67e22 : 0xe74c3c;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .addFields(
        { name: 'Fight ID', value: String(row.id ?? '—'), inline: true },
        { name: 'Winner', value: String(row.winner_ign || '—'), inline: true },
        { name: 'Loser', value: String(row.loser_ign || '—'), inline: true },
        { name: 'Action', value: action === 'voided' ? 'fight voided' : 'fight deleted', inline: true },
        { name: 'By', value: String(actorUsername || '—'), inline: true }
      )
      .setTimestamp();
    await sendFightScoreLogEmbed(client, embed);
  }

  async function handleUpdatescore(interaction) {
    await defer(interaction, false);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const id = interaction.options.getInteger('id');
    const winner = interaction.options.getString('winner-ign');
    const loser = interaction.options.getString('loser-ign');
    const score = interaction.options.getString('final-score');
    const fightType = interaction.options.getString('fight-type');
    const voided = interaction.options.getBoolean('voided');
    const sets = [];
    const vals = [];
    let n = 1;
    if (winner) {
      const winnerIdentity = await resolveIgnIdentity(pool, winner);
      sets.push(`winner_ign = $${n++}`);
      vals.push(winnerIdentity.canonicalIgn || winnerIdentity.ign);
    }
    if (loser) {
      const loserIdentity = await resolveIgnIdentity(pool, loser);
      sets.push(`loser_ign = $${n++}`);
      vals.push(loserIdentity.canonicalIgn || loserIdentity.ign);
    }
    if (score) {
      sets.push(`final_score = $${n++}`);
      vals.push(score);
    }
    if (fightType) {
      sets.push(`fight_type = $${n++}`);
      vals.push(fightType);
    }
    if (voided !== null) {
      sets.push(`is_voided = $${n++}`);
      vals.push(voided);
    }
    if (!sets.length) {
      return interaction.editReply({ content: '❌ Provide at least one field to update.' });
    }
    vals.push(id);
    const q = await pool.query(`UPDATE scores SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`, vals);
    if (!q.rows.length) {
      return interaction.editReply({ content: '❌ No score with that id.' });
    }
    const row = q.rows[0];
    const logEmbed = buildFightScoreLogEmbed(row, {
      actorUsername: interaction.user.username,
      mode: 'edited',
    });
    await interaction.editReply({ content: `✅ Updated score **#${id}**.` });
    await sendFightScoreLogEmbed(interaction.client, logEmbed);
  }

  async function handleVoidscore(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const id = interaction.options.getInteger('id');
    const q = await pool.query(
      'UPDATE scores SET is_voided = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (!q.rows.length) {
      return interaction.editReply({ content: '❌ No score with that id.' });
    }
    await interaction.editReply({ content: `✅ Voided score **#${id}**.` });
    await sendFightActionLog(interaction.client, 'voided', q.rows[0], interaction.user.username);
  }

  async function handleDeletescore(interaction) {
    await defer(interaction, false);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const id = interaction.options.getInteger('id');
    const q = await pool.query(
      'DELETE FROM scores WHERE id = $1 RETURNING id, winner_ign, loser_ign',
      [id]
    );
    if (!q.rows.length) {
      return interaction.editReply({ content: '❌ No score with that id.' });
    }
    const r = q.rows[0];
    await interaction.editReply({
      content: `✅ Permanently deleted fight **#${id}** (\`${r.winner_ign}\` vs \`${r.loser_ign}\`).`,
    });
    await sendFightActionLog(interaction.client, 'deleted', r, interaction.user.username);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('updatescore')
      .setDescription('Fix a miscored fight (Admin/Owner only)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Fight ID from /score reply (🆔 Fight ID field)')
          .setRequired(true)
      )
      .addStringOption((o) =>
        o.setName('winner-ign').setDescription('New winner (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('loser-ign').setDescription('New loser (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('final-score').setDescription('New score (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('fight-type')
          .setDescription('New fight type (optional)')
          .setRequired(false)
          .addChoices(
            { name: 'Prime', value: 'prime' },
            { name: 'Elite', value: 'elite' },
            { name: 'Apex', value: 'apex' },
            { name: 'PM', value: 'pm' }
          )
      )
      .addBooleanOption((o) =>
        o
          .setName('voided')
          .setDescription('Set voided status (default false if provided)')
          .setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('deletescore')
      .setDescription('Permanently delete a fight from the database (Admin/Owner only)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Fight ID from /score (scores.id)')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('voidscore')
      .setDescription('Void/invalidate a fight by fight ID')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Fight ID from /score (scores.id)')
          .setRequired(true)
      ),
  ];

  return {
    commands,
    handlers: {
      updatescore: handleUpdatescore,
      deletescore: handleDeletescore,
      voidscore: handleVoidscore,
    },
  };
};
