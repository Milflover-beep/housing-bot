const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const RANGE_CHOICES = [
  { name: '7 days', value: '7d' },
  { name: '14 days', value: '14d' },
  { name: '30 days', value: '30d' },
];

function rangeToStartDate(range) {
  const now = Date.now();
  if (range === '14d') return new Date(now - 14 * 24 * 60 * 60 * 1000);
  if (range === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return new Date(now - 7 * 24 * 60 * 60 * 1000);
}

module.exports = function staffActivityCommands(ctx) {
  const { pool, defer, requireLevel } = ctx;

  async function handleStaffactivity(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }

    const staffUser = interaction.options.getUser('discord', true);
    const range = interaction.options.getString('range') || '7d';
    const startAt = rangeToStartDate(range);
    const ticketCategoryIds = String(process.env.CHECK_RENAME_CATEGORY_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const summary = await pool.query(
      `SELECT
         COUNT(*)::int AS total_commands,
         MAX(created_at) AS last_active_at,
         SUM(CASE WHEN category_id = ANY($3::text[]) THEN 1 ELSE 0 END)::int AS ticket_commands
       FROM staff_activity_logs
       WHERE staff_discord_id = $1
         AND created_at >= $2`,
      [staffUser.id, startAt, ticketCategoryIds]
    );

    const topCommands = await pool.query(
      `SELECT command_name, COUNT(*)::int AS uses
       FROM staff_activity_logs
       WHERE staff_discord_id = $1
         AND created_at >= $2
       GROUP BY command_name
       ORDER BY uses DESC, command_name ASC
       LIMIT 12`,
      [staffUser.id, startAt]
    );

    const row = summary.rows[0] || {};
    const total = row.total_commands || 0;
    const ticketCount = row.ticket_commands || 0;
    const lastTs = row.last_active_at
      ? Math.floor(new Date(row.last_active_at).getTime() / 1000)
      : null;

    const cmdLines = topCommands.rows.length
      ? topCommands.rows.map((r) => `\`/${r.command_name}\` — ${r.uses}`).join('\n')
      : '_No command activity in this range._';

    const embed = new EmbedBuilder()
      .setTitle(`📈 Staff activity: ${staffUser.username}`)
      .setColor(0x3498db)
      .setDescription(`Range: **${range}**`)
      .addFields(
        { name: 'Staff member', value: `<@${staffUser.id}>`, inline: true },
        { name: 'Total commands', value: String(total), inline: true },
        { name: 'Ticket commands', value: String(ticketCount), inline: true },
        {
          name: 'Last active',
          value: lastTs ? `<t:${lastTs}:F> (<t:${lastTs}:R>)` : 'No activity in range',
          inline: false,
        },
        { name: 'Top commands', value: cmdLines.slice(0, 1024), inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('staffactivity')
        .setDescription('View command activity stats for a staff member (Manager+)')
        .addUserOption((o) =>
          o.setName('discord').setDescription('Staff Discord user').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('range')
            .setDescription('Time window')
            .setRequired(false)
            .addChoices(...RANGE_CHOICES)
        ),
    ],
    handlers: {
      staffactivity: handleStaffactivity,
    },
  };
};
