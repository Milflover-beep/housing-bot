const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const MGR = PermissionFlagsBits.ManageRoles;

function sliceField(text, max = 1020) {
  const s = String(text || '').trim();
  if (!s) return '_None_';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 24)}\n… _(truncated)_`;
}

function placementSuffix(createdAt) {
  if (createdAt == null) return '';
  const ms = new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return '';
  return ` · <t:${Math.floor(ms / 1000)}:D>`;
}

module.exports = function infoCommands(ctx) {
  const { pool, requireLevel, defer, normalizeIgn, resolveGuildMember, typeLetterToName } = ctx;

  async function handleInfo(interaction) {
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
      tierHist,
      scoreAgg,
      scoreRecent,
      blRows,
      ablRows,
      timeoutRows,
      altRows,
      denialRow,
      uuidRow,
    ] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (type) type, tier, created_at, tester, id
         FROM tier_results
         WHERE LOWER(ign) = $1
         ORDER BY type, id DESC`,
        [ign]
      ),
      pool.query(
        `SELECT type, tier, rated_at, tester
         FROM tier_history
         WHERE LOWER(ign) = $1
         ORDER BY rated_at DESC NULLS LAST, id DESC
         LIMIT 35`,
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
         LIMIT 18`,
        [ign]
      ),
      pool.query(
        `SELECT reason, blacklist_expires, created_at FROM blacklists
         WHERE LOWER(ign) = $1 ORDER BY id DESC LIMIT 8`,
        [ign]
      ),
      pool.query(
        `SELECT reason, created_at FROM admin_blacklists
         WHERE LOWER(ign) = $1 AND is_pardoned = false ORDER BY id DESC LIMIT 5`,
        [ign]
      ),
      pool.query(
        `SELECT timeout_duration, fight_type, created_at FROM timeouts
         WHERE LOWER(ign) = $1 ORDER BY created_at DESC LIMIT 6`,
        [ign]
      ),
      pool.query(
        `SELECT id, original_ign, alt_ign, is_whitelisted, created_at FROM alts
         WHERE LOWER(original_ign) = $1 OR LOWER(alt_ign) = $1 ORDER BY id DESC LIMIT 20`,
        [ign]
      ),
      pool.query(
        `SELECT rank_type, cooldown_until, created_at FROM application_denials
         WHERE LOWER(ign) = $1 AND cooldown_until > NOW() LIMIT 1`,
        [ign]
      ).catch(() => ({ rows: [] })),
      pool.query(`SELECT uuid, created_at FROM uuid_registry WHERE LOWER(ign) = $1 ORDER BY id DESC LIMIT 1`, [
        ign,
      ]),
    ]);

    const nowLines =
      tierNow.rows.length > 0
        ? tierNow.rows
            .map((row) => {
              const ladder = typeLetterToName(row.type);
              return `**${ladder}** — ${row.tier}${placementSuffix(row.created_at)}`;
            })
            .join('\n')
        : '_No current tier_results._';

    const histLines =
      tierHist.rows.length > 0
        ? tierHist.rows
            .map((row) => {
              const when = placementSuffix(row.rated_at);
              const tst = row.tester ? ` (${row.tester})` : '';
              return `• **${typeLetterToName(row.type)}** ${row.tier}${when}${tst}`;
            })
            .join('\n')
        : '_No tier_history._';

    const s = scoreAgg.rows[0] || {};
    const total = s.total || 0;
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const fightSummary = `**Recorded fights:** ${total} · **W/L:** ${wins}/${losses} · **Win rate:** ${wr}%`;
    const recentFights =
      scoreRecent.rows.length > 0
        ? scoreRecent.rows
            .map((r) => {
              const w = String(r.winner_ign || '').toLowerCase() === ign ? 'W' : 'L';
              const ft = r.fight_type ? String(r.fight_type) : '—';
              return `\`${w}\` ${r.final_score || '—'} vs ${w === 'W' ? r.loser_ign : r.winner_ign} (${ft})`;
            })
            .join('\n')
        : '_No fights._';

    const blText =
      blRows.rows.length > 0
        ? blRows.rows
            .map((b) => {
              const exp = b.blacklist_expires
                ? new Date(b.blacklist_expires) > new Date()
                  ? `expires ${new Date(b.blacklist_expires).toLocaleDateString()}`
                  : `expired ${new Date(b.blacklist_expires).toLocaleDateString()}`
                : 'permanent';
              return `• ${b.reason} (${exp})`;
            })
            .join('\n')
        : '_None._';

    const ablText =
      ablRows.rows.length > 0
        ? ablRows.rows.map((b) => `• ${b.reason}`).join('\n')
        : '_None._';

    const toText =
      timeoutRows.rows.length > 0
        ? timeoutRows.rows
            .map((t) => `• ${t.timeout_duration} — ${t.fight_type || '—'} (${new Date(t.created_at).toLocaleDateString()})`)
            .join('\n')
        : '_None._';

    const altText =
      altRows.rows.length > 0
        ? altRows.rows
            .map((a) => `• #${a.id} \`${a.original_ign}\` ↔ \`${a.alt_ign}\` (wl: ${a.is_whitelisted})`)
            .join('\n')
        : '_None._';

    let denialText = '_None._';
    if (denialRow.rows?.length > 0) {
      const d = denialRow.rows[0];
      const ts = Math.floor(new Date(d.cooldown_until).getTime() / 1000);
      denialText = `**${typeLetterToName(d.rank_type) || '—'}** cooldown until <t:${ts}:F> (<t:${ts}:R>)`;
    }

    let uuidText = '_None._';
    if (uuidRow.rows?.length > 0) {
      const u = uuidRow.rows[0];
      uuidText = `\`${u.uuid}\`` + placementSuffix(u.created_at);
    }

    const e1 = new EmbedBuilder()
      .setTitle(`Player info: ${ign}`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'Current tiers', value: sliceField(nowLines), inline: false },
        { name: 'Tier history', value: sliceField(histLines), inline: false }
      );

    const e2 = new EmbedBuilder()
      .setTitle('Fights')
      .setColor(0x3498db)
      .addFields(
        { name: 'Summary', value: fightSummary, inline: false },
        { name: 'Recent (newest first)', value: sliceField(recentFights), inline: false }
      );

    const e3 = new EmbedBuilder()
      .setTitle('Records & links')
      .setColor(0xe67e22)
      .addFields(
        { name: 'Blacklists', value: sliceField(blText), inline: false },
        { name: 'Admin blacklist (active)', value: sliceField(ablText), inline: false },
        { name: 'Timeouts', value: sliceField(toText), inline: false },
        { name: 'Alts', value: sliceField(altText), inline: false },
        { name: 'Application cooldown', value: sliceField(denialText), inline: false },
        { name: 'UUID registry', value: sliceField(uuidText), inline: false }
      );

    await interaction.editReply({ embeds: [e1, e2, e3] });
  }

  return {
    commands: [
      new SlashCommandBuilder()
        .setName('info')
        .setDescription('Manager+: full player summary (ephemeral)')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
        .setDefaultMemberPermissions(MGR),
    ],
    handlers: { info: handleInfo },
  };
};
