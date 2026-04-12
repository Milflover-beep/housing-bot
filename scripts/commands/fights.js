const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildFightScoreLogEmbed, sendFightScoreLogEmbed } = require('../lib/fightScoreLogEmbed');

module.exports = function fightsCommands(ctx) {
  const { pool, isAdminOrOwner, requireLevel, defer, normalizeIgn } = ctx;
  const mgr = PermissionFlagsBits.ManageRoles;

  async function handleUpdatescore(interaction) {
    await defer(interaction, false);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const id = interaction.options.getInteger('id');
    const winner = interaction.options.getString('winner-ign');
    const loser = interaction.options.getString('loser-ign');
    const score = interaction.options.getString('final-score');
    const sets = [];
    const vals = [];
    let n = 1;
    if (winner) {
      sets.push(`winner_ign = $${n++}`);
      vals.push(normalizeIgn(winner));
    }
    if (loser) {
      sets.push(`loser_ign = $${n++}`);
      vals.push(normalizeIgn(loser));
    }
    if (score) {
      sets.push(`final_score = $${n++}`);
      vals.push(score);
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
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
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
  }

  async function handleDeletescore(interaction) {
    await defer(interaction, false);
    if (!isAdminOrOwner(interaction.member, interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin or owner only.' });
    }
    const id = interaction.options.getInteger('id');
    const q = await pool.query('DELETE FROM scores WHERE id = $1 RETURNING id, winner_ign, loser_ign', [id]);
    if (!q.rows.length) {
      return interaction.editReply({ content: '❌ No score with that id.' });
    }
    const r = q.rows[0];
    await interaction.editReply({
      content: `✅ Permanently deleted fight **#${id}** (\`${r.winner_ign}\` vs \`${r.loser_ign}\`).`,
    });
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
      )
      .setDefaultMemberPermissions(mgr),
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
