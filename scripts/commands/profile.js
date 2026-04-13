const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const RECENT_FIGHTS = 8;
const AVG_SCORE_FIGHT_CAP = 5000;

/** `final_score` is winner–loser (e.g. `10-8`). */
function parseFinalScore(str) {
  const m = String(str ?? '')
    .trim()
    .match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { winnerPts: a, loserPts: b };
}

module.exports = function profileCommands(ctx) {
  const { pool, defer, normalizeIgn, typeLetterToName, minecraftHeadUrl, clampSideScoreForStats } = ctx;

  async function handleProfile(interaction) {
    await defer(interaction, false);

    const ign = normalizeIgn(interaction.options.getString('ign'));

    const [tierNow, scoreAgg, scoreRecent, scoreRowsAvg, denialRow] = await Promise.all([
      pool.query(
        `SELECT type, tier FROM tier_results
         WHERE LOWER(TRIM(ign)) = LOWER(TRIM($1::text)) AND COALESCE(TRIM(tier), '') <> ''
         ORDER BY id DESC
         LIMIT 1`,
        [ign]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           SUM(CASE WHEN LOWER(winner_ign) = $1 THEN 1 ELSE 0 END)::int AS wins,
           SUM(CASE WHEN LOWER(loser_ign) = $1 THEN 1 ELSE 0 END)::int AS losses
         FROM scores s
         WHERE (LOWER(s.winner_ign) = $1 OR LOWER(s.loser_ign) = $1) AND s.is_voided = false`,
        [ign]
      ),
      pool.query(
        `SELECT winner_ign, loser_ign, final_score, fight_type, created_at, fight_number
         FROM scores s
         WHERE (LOWER(s.winner_ign) = $1 OR LOWER(s.loser_ign) = $1) AND s.is_voided = false
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT $2`,
        [ign, RECENT_FIGHTS]
      ),
      pool.query(
        `SELECT final_score, winner_ign, loser_ign FROM scores s
         WHERE (LOWER(s.winner_ign) = $1 OR LOWER(s.loser_ign) = $1) AND s.is_voided = false
         ORDER BY s.id DESC
         LIMIT $2`,
        [ign, AVG_SCORE_FIGHT_CAP]
      ),
      pool
        .query(
          `SELECT rank_type, cooldown_until FROM application_denials
           WHERE LOWER(ign) = $1 AND cooldown_until > NOW() LIMIT 1`,
          [ign]
        )
        .catch(() => ({ rows: [] })),
    ]);

    const s = scoreAgg.rows[0] || {};
    const total = s.total || 0;
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    const ptsList = [];
    for (const row of scoreRowsAvg.rows) {
      const parsed = parseFinalScore(row.final_score);
      if (!parsed) continue;
      const won = String(row.winner_ign || '').trim().toLowerCase() === ign;
      ptsList.push(
        clampSideScoreForStats(won ? parsed.winnerPts : parsed.loserPts)
      );
    }
    const avgScore =
      ptsList.length > 0
        ? (ptsList.reduce((a, b) => a + b, 0) / ptsList.length).toFixed(2)
        : null;

    const fightLines =
      total > 0 && scoreRecent.rows.length > 0
        ? scoreRecent.rows
            .map((r) => {
              const won = String(r.winner_ign || '').toLowerCase() === ign;
              const opponent = won ? r.loser_ign : r.winner_ign;
              const date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '—';
              const ft = r.fight_type ? String(r.fight_type) : '—';
              return `${won ? '✅' : '❌'} **${won ? 'W' : 'L'}** vs \`${opponent}\` — ${r.final_score || '—'} (#${r.fight_number ?? '?'}) — ${ft} — ${date}`;
            })
            .join('\n')
        : '_No recorded fights._';
    const fightBlock =
      fightLines.length > 3800 ? `${fightLines.slice(0, 3780)}\n… _(truncated)_` : fightLines;

    const tr = tierNow.rows[0];
    const tierLabel = tr && String(tr.tier || '').trim();
    const tierDisplay = tierLabel
      ? `**${typeLetterToName(tr.type)}** \`${tierLabel}\``
      : 'Not placed in a tier.';

    let cooldownLine = '⏳ **Tryout cooldown:** None';
    if (denialRow.rows?.length > 0) {
      const d = denialRow.rows[0];
      const ts = Math.floor(new Date(d.cooldown_until).getTime() / 1000);
      cooldownLine = `⏳ **Tryout cooldown:** <t:${ts}:R> (<t:${ts}:F>)`;
    }
    const noteParts = [cooldownLine];

    const embed = new EmbedBuilder()
      .setTitle(`📋 Profile: ${ign}`)
      .setColor(0x9c27b0)
      .setDescription(fightBlock)
      .addFields(
        { name: 'Tier', value: tierDisplay, inline: false },
        { name: 'Wins', value: String(wins), inline: true },
        { name: 'Losses', value: String(losses), inline: true },
        {
          name: 'Win rate',
          value: `${wr}%${avgScore != null ? ` · Avg **${avgScore}** pts/fight` : ''}`,
          inline: true,
        },
        { name: 'Total fights', value: String(total), inline: true },
        { name: 'At a glance', value: noteParts.join('\n').slice(0, 1024), inline: false }
      )
      .setFooter({ text: `Last ${RECENT_FIGHTS} fights` });

    const headUrl = minecraftHeadUrl(ign);
    if (headUrl) embed.setThumbnail(headUrl);

    await interaction.editReply({ embeds: [embed] });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Public snapshot: tiers, recent fights, stats (no bans or alts)')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    ],
    handlers: { profile: handleProfile },
  };
};
