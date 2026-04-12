const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const MGR = PermissionFlagsBits.ManageRoles;
const RECENT_FIGHTS = 7;

module.exports = function profileCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn, resolveGuildMember, typeLetterToName, minecraftHeadUrl } =
    ctx;

  async function handleProfile(interaction) {
    await defer(interaction, true);
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      return interaction.editReply({
        content:
          '❌ Manager or higher only. If you have the role, enable **Server Members Intent** for the bot and restart it, then try again.',
      });
    }

    const ign = normalizeIgn(interaction.options.getString('ign'));

    const [
      tierNow,
      scoreAgg,
      scoreRecent,
      blActive,
      ablActive,
      timeoutLatest,
      altCount,
      denialRow,
    ] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (type) type, tier
         FROM tier_results
         WHERE LOWER(ign) = $1
         ORDER BY type, id DESC`,
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
        `SELECT COUNT(*)::int AS c FROM blacklists
         WHERE LOWER(ign) = $1
           AND (blacklist_expires IS NULL OR blacklist_expires > NOW())`,
        [ign]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM admin_blacklists
         WHERE LOWER(ign) = $1 AND is_pardoned = false`,
        [ign]
      ),
      pool.query(
        `SELECT timeout_duration, fight_type, created_at FROM timeouts
         WHERE LOWER(ign) = $1 ORDER BY created_at DESC LIMIT 1`,
        [ign]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM alts
         WHERE LOWER(original_ign) = $1 OR LOWER(alt_ign) = $1`,
        [ign]
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

    const byType = {};
    for (const row of tierNow.rows) byType[row.type] = row.tier;
    const ladderOrder = ['P', 'E', 'A'];
    const tierCompact = ladderOrder
      .map((L) => {
        const t = byType[L];
        const name = typeLetterToName(L);
        return `**${name}** ${t ? `\`${t}\`` : '`—`'}`;
      })
      .join(' · ');

    const blN = blActive.rows[0]?.c || 0;
    const ablN = ablActive.rows[0]?.c || 0;
    const altN = altCount.rows[0]?.c || 0;
    const noteParts = [];
    if (blN > 0) noteParts.push(`🚫 **Blacklist** (${blN} active)`);
    if (ablN > 0) noteParts.push(`🚫 **Admin blacklist** (${ablN})`);
    if (timeoutLatest.rows[0]) {
      const t = timeoutLatest.rows[0];
      noteParts.push(
        `⏱️ **Last timeout:** ${t.timeout_duration}${t.fight_type ? ` · ${t.fight_type}` : ''}`
      );
    }
    if (altN > 0) noteParts.push(`🔀 **Alts on file:** ${altN}`);
    if (denialRow.rows?.length > 0) {
      const d = denialRow.rows[0];
      const ts = Math.floor(new Date(d.cooldown_until).getTime() / 1000);
      const rk = d.rank_type ? typeLetterToName(d.rank_type) : '?';
      noteParts.push(`⏳ **Tryout cooldown** (${rk}) <t:${ts}:R>`);
    }
    if (!noteParts.length) noteParts.push('✅ **No** blacklist / admin BL / cooldown flags');

    const embed = new EmbedBuilder()
      .setTitle(`📋 Profile: ${ign}`)
      .setColor(0x9c27b0)
      .setDescription(fightBlock)
      .addFields(
        { name: 'Current tiers', value: tierCompact, inline: false },
        { name: 'Wins', value: String(wins), inline: true },
        { name: 'Losses', value: String(losses), inline: true },
        { name: 'Win rate', value: `${wr}%`, inline: true },
        { name: 'Total fights', value: String(total), inline: true },
        { name: 'At a glance', value: noteParts.join('\n').slice(0, 1024), inline: false }
      )
      .setFooter({ text: `Last ${RECENT_FIGHTS} fights · Manager+ · Ephemeral` });

    const headUrl = minecraftHeadUrl(ign);
    if (headUrl) embed.setThumbnail(headUrl);

    await interaction.editReply({ embeds: [embed] });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Manager+: compact player snapshot (ephemeral)')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
        .setDefaultMemberPermissions(MGR),
    ],
    handlers: { profile: handleProfile },
  };
};
