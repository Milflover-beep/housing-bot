const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = function pmCommands(ctx) {
  const {
    pool,
    requireLevel,
    isAdminOrOwner,
    defer,
    normalizeIgn,
    resolveGuildMember,
    minecraftHeadUrl,
    clampSideScoreForStats,
  } = ctx;

  const PM_MANAGER_CHOICES = [
    { name: 'Prime Manager', value: 'P' },
    { name: 'Elite Manager', value: 'E' },
    { name: 'Apex Manager', value: 'A' },
    { name: 'N/A', value: 'NA' },
  ];

  function parseManagerType(optionValue) {
    if (optionValue === null || optionValue === undefined || optionValue === 'NA') return null;
    return optionValue;
  }

  function formatPmRow(r) {
    return `\`${r.ign}\` — ping ${r.ping ?? '—'}`;
  }

  function truncateEmbedField(text, max = 1020) {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 20)}… _(truncated)_`;
  }

  /** `final_score` is winner–loser (e.g. `10-8`). */
  function parseFinalScore(str) {
    const m = String(str ?? '')
      .trim()
      .match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (!m) return null;
    const winnerPts = parseInt(m[1], 10);
    const loserPts = parseInt(m[2], 10);
    if (!Number.isFinite(winnerPts) || !Number.isFinite(loserPts)) return null;
    return { winnerPts, loserPts };
  }

  function mean(nums) {
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function fmtNum(n, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  /**
   * @param {string} ignLower
   * @param {Array<{ winner_ign: string, loser_ign: string, final_score: string, fight_type: string, fight_number: number, created_at: Date }>} rows oldest-first
   */
  function buildPmDebugEmbed(ignLower, rows) {
    const typeKey = (ft) => {
      const s = String(ft || '').toLowerCase();
      if (s === 'prime' || s === 'p') return 'Prime';
      if (s === 'elite' || s === 'e') return 'Elite';
      if (s === 'apex' || s === 'a') return 'Apex';
      return ft ? String(ft) : 'Other';
    };

    const marginsWin = [];
    const marginsLoss = [];
    const pmPtsWins = [];
    const oppPtsWins = [];
    const pmPtsLoss = [];
    const oppPtsLoss = [];
    const totalPtsPerFight = [];
    const byType = {};

    let unparseable = 0;
    const chronological = [];

    for (const r of rows) {
      const wIn = String(r.winner_ign || '').trim().toLowerCase();
      const won = wIn === ignLower;
      const tk = typeKey(r.fight_type);
      if (!byType[tk]) byType[tk] = { w: 0, l: 0 };
      if (won) byType[tk].w += 1;
      else byType[tk].l += 1;

      const parsed = parseFinalScore(r.final_score);
      if (!parsed) {
        unparseable += 1;
        chronological.push({ won, margin: null, typeKey: tk });
        continue;
      }
      const { winnerPts, loserPts } = parsed;
      const wC = clampSideScoreForStats(winnerPts);
      const lC = clampSideScoreForStats(loserPts);
      const pmPts = won ? wC : lC;
      const oppPts = won ? lC : wC;
      const margin = pmPts - oppPts;
      totalPtsPerFight.push(wC + lC);
      if (won) {
        marginsWin.push(margin);
        pmPtsWins.push(pmPts);
        oppPtsWins.push(oppPts);
      } else {
        marginsLoss.push(margin);
        pmPtsLoss.push(pmPts);
        oppPtsLoss.push(oppPts);
      }
      chronological.push({ won, margin, typeKey: tk });
    }

    const total = rows.length;
    const wins = chronological.filter((c) => c.won).length;
    const losses = chronological.filter((c) => !c.won).length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    let bestWinStreak = 0;
    let bestLossStreak = 0;
    let curW = 0;
    let curL = 0;
    for (const c of chronological) {
      if (c.won) {
        curW += 1;
        curL = 0;
        bestWinStreak = Math.max(bestWinStreak, curW);
      } else {
        curL += 1;
        curW = 0;
        bestLossStreak = Math.max(bestLossStreak, curL);
      }
    }
    let currentStreak = 0;
    let currentLabel = '—';
    for (let i = chronological.length - 1; i >= 0; i--) {
      const c = chronological[i];
      if (currentStreak === 0) {
        currentStreak = 1;
        currentLabel = c.won ? 'W' : 'L';
      } else if ((c.won ? 'W' : 'L') === currentLabel) {
        currentStreak += 1;
      } else break;
    }
    if (chronological.length === 0) {
      currentStreak = 0;
      currentLabel = '—';
    }

    const firstAt = rows[0]?.created_at;
    const lastAt = rows[rows.length - 1]?.created_at;
    const dateSpan =
      firstAt && lastAt
        ? `First: <t:${Math.floor(new Date(firstAt).getTime() / 1000)}:d>\nLast: <t:${Math.floor(new Date(lastAt).getTime() / 1000)}:d>`
        : '—';

    const ladderLines = Object.keys(byType)
      .sort()
      .map((k) => {
        const { w, l } = byType[k];
        const t = w + l;
        const pct = t ? ((w / t) * 100).toFixed(1) : '0.0';
        return `**${k}** — ${w}W / ${l}L (${pct}% in-type)`;
      });
    const ladderBlock = ladderLines.length ? ladderLines.join('\n') : '_No fights_';

    const overview = [
      `**Fights:** ${total} (${wins}W / ${losses}L) · **Win rate:** ${winRate}%`,
      unparseable
        ? `⚠️ **Unparseable \`final_score\`:** ${unparseable} (W/L still counted; margins omit those)`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const avgMarginW = mean(marginsWin);
    const avgMarginL = mean(marginsLoss);
    const medMarginW = median(marginsWin);
    const medMarginL = median(marginsLoss);
    const scoring = [
      `**Margin (PM − opp)** — wins: avg **${fmtNum(avgMarginW)}** · median **${fmtNum(medMarginW)}**`,
      `**Margin** — losses: avg **${fmtNum(avgMarginL)}** · median **${fmtNum(medMarginL)}**`,
      `**PM score** — in wins: avg **${fmtNum(mean(pmPtsWins))}** · in losses: avg **${fmtNum(mean(pmPtsLoss))}**`,
      `**Opp score** — in wins: avg **${fmtNum(mean(oppPtsWins))}** · in losses: avg **${fmtNum(mean(oppPtsLoss))}**`,
      `**Total points / fight** (both players): avg **${fmtNum(mean(totalPtsPerFight))}**`,
    ].join('\n');

    const streakBlock = [
      `**Current streak:** ${currentStreak}${currentLabel} _(newest first)_`,
      `**Best win streak:** ${bestWinStreak} · **Best loss streak:** ${bestLossStreak}`,
    ].join('\n');

    return new EmbedBuilder()
      .setTitle(`PM stats (debug): ${ignLower}`)
      .setColor(0x9b59b6)
      .setDescription('Staff-only detailed breakdown from `scores`.')
      .addFields(
        { name: 'Overview', value: truncateEmbedField(overview, 1024), inline: false },
        { name: 'Margins & scoring', value: truncateEmbedField(scoring, 1024), inline: false },
        { name: 'By fight type', value: truncateEmbedField(ladderBlock, 1024), inline: false },
        { name: 'Streaks', value: streakBlock, inline: false },
        { name: 'Date span', value: dateSpan, inline: false }
      )
      .setTimestamp();
  }

  async function handlePmlist(interaction) {
    await defer(interaction, false);
    const rows = await pool.query('SELECT * FROM pm_list ORDER BY id ASC LIMIT 100');
    if (rows.rows.length === 0) {
      return interaction.editReply({ content: 'PM list is empty.' });
    }
    const buckets = { P: [], E: [], A: [], NA: [] };
    for (const r of rows.rows) {
      const t = r.manager_type;
      if (t === 'P') buckets.P.push(r);
      else if (t === 'E') buckets.E.push(r);
      else if (t === 'A') buckets.A.push(r);
      else buckets.NA.push(r);
    }
    const section = (list) => truncateEmbedField(list.length ? list.map(formatPmRow).join('\n') : '_None_');
    const fields = [
      { name: 'Apex Manager', value: section(buckets.A), inline: false },
      { name: 'Elite Manager', value: section(buckets.E), inline: false },
      { name: 'Prime Manager', value: section(buckets.P), inline: false },
    ];
    if (buckets.NA.length > 0) {
      fields.push({ name: 'N/A', value: section(buckets.NA), inline: false });
    }
    const embed = new EmbedBuilder()
      .setTitle('📋 PM list')
      .setColor(0x1abc9c)
      .addFields(...fields);
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleAddpm(interaction) {
    await defer(interaction, false);
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      return interaction.editReply({
        content:
          '❌ Managers or higher only. If you have the role, enable **Server Members Intent** for the bot (Developer Portal) and restart it, then try again.',
      });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const ping = interaction.options.getInteger('ping');
    const uuid = interaction.options.getString('uuid');
    const mgrType = parseManagerType(interaction.options.getString('manager-type'));
    const pingVal = ping === null ? null : ping;
    const uuidVal = uuid && uuid.trim() ? uuid.trim() : null;
    try {
      await pool.query(
        `INSERT INTO pm_list (ign, ping, uuid, manager_type, created_at) VALUES ($1, $2, $3, $4, NOW())`,
        [ign, pingVal, uuidVal, mgrType]
      );
    } catch (e) {
      if (e.code === '23505' && /pm_list/i.test(String(e.message))) {
        await pool.query(
          `SELECT setval(
            pg_get_serial_sequence('pm_list', 'id'),
            (SELECT MAX(id) FROM pm_list)
          )`
        );
        await pool.query(
          `INSERT INTO pm_list (ign, ping, uuid, manager_type, created_at) VALUES ($1, $2, $3, $4, NOW())`,
          [ign, pingVal, uuidVal, mgrType]
        );
      } else {
        throw e;
      }
    }
    await interaction.editReply({ content: `✅ Added **${ign}** to PM list.` });
  }

  async function handleDeletepm(interaction) {
    await defer(interaction, false);
    const member = await resolveGuildMember(interaction);
    if (!isAdminOrOwner(member, interaction.user.id)) {
      return interaction.editReply({
        content:
          '❌ Admin or owner only. If you have the role, enable **Server Members Intent** for the bot and restart it.',
      });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const q = await pool.query(
      'DELETE FROM pm_list WHERE LOWER(TRIM(ign)) = $1 RETURNING ign',
      [ign]
    );
    if (q.rows.length === 0) {
      return interaction.editReply({ content: `❌ No PM list entry for **${ign}**.` });
    }
    const names = q.rows.map((r) => r.ign).join(', ');
    await interaction.editReply({
      content:
        q.rows.length === 1
          ? `✅ Removed **${q.rows[0].ign}** from the PM list.`
          : `✅ Removed **${q.rows.length}** PM list rows matching **${ign}**: ${names}`,
    });
  }

  async function handleEditpm(interaction) {
    await defer(interaction, false);
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      return interaction.editReply({
        content:
          '❌ Managers or higher only. If you have the role, enable **Server Members Intent** for the bot (Developer Portal) and restart it, then try again.',
      });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const ping = interaction.options.getInteger('ping');
    const mgrOpt = interaction.options.getString('manager-type');
    if (ping === null && mgrOpt === null) {
      return interaction.editReply({
        content: '❌ Provide at least **ping** or **manager-type** to update.',
      });
    }
    const parts = [];
    const vals = [];
    let n = 1;
    if (ping !== null) {
      parts.push(`ping = $${n++}`);
      vals.push(ping);
    }
    if (mgrOpt !== null) {
      parts.push(`manager_type = $${n++}`);
      vals.push(parseManagerType(mgrOpt));
    }
    vals.push(ign);
    const q = await pool.query(
      `UPDATE pm_list SET ${parts.join(', ')} WHERE LOWER(TRIM(ign)) = $${n} RETURNING ign`,
      vals
    );
    if (q.rows.length === 0) {
      return interaction.editReply({ content: `❌ No PM list entry for **${ign}**.` });
    }
    const msg =
      q.rows.length === 1
        ? `✅ Updated **${q.rows[0].ign}**.`
        : `✅ Updated **${q.rows.length}** PM list rows matching **${ign}**.`;
    const embed = new EmbedBuilder().setColor(0x1abc9c).setDescription(msg);
    const headUrl = minecraftHeadUrl(q.rows[0]?.ign || ign);
    if (headUrl) embed.setThumbnail(headUrl);
    await interaction.editReply({ embeds: [embed] });
  }

  async function handlePmstats(interaction) {
    const debug = interaction.options.getBoolean('debug') === true;
    await defer(interaction, debug);
    const member = await resolveGuildMember(interaction);
    if (debug && !requireLevel(member, 2)) {
      return interaction.editReply({
        content: '❌ **Debug** mode is Staff+ only.',
      });
    }
    if (!debug && !requireLevel(member, 1)) {
      return interaction.editReply({
        content:
          '❌ PM or higher only. If you have the role, enable **Server Members Intent** for the bot and restart it, then try again.',
      });
    }
    const ign = normalizeIgn(interaction.options.getString('ign'));
    const start = interaction.options.getString('start-date');
    const end = interaction.options.getString('end-date');

    if (debug) {
      let q = `
        SELECT winner_ign, loser_ign, final_score, fight_type, fight_number, created_at
        FROM scores s
        WHERE (LOWER(s.winner_ign) = $1 OR LOWER(s.loser_ign) = $1)
        AND s.is_voided = false`;
      const params = [ign];
      if (start && end) {
        q += ' AND s.created_at BETWEEN $2 AND $3';
        params.push(new Date(start), new Date(end));
      }
      q += ' ORDER BY s.created_at ASC, s.id ASC LIMIT 3000';
      const detail = await pool.query(q, params);
      const embed = buildPmDebugEmbed(ign, detail.rows);
      const footerParts = [];
      if (detail.rows.length >= 3000) footerParts.push('First 3000 fights in range');
      footerParts.push(start && end ? `Range: ${start} – ${end}` : 'All recorded fights');
      embed.setFooter({ text: footerParts.join(' · ') });
      return interaction.editReply({ embeds: [embed] });
    }

    let sql = `
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN LOWER(s.winner_ign) = $1 THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN LOWER(s.loser_ign) = $1 THEN 1 ELSE 0 END)::int AS losses
      FROM scores s
      WHERE (LOWER(s.winner_ign) = $1 OR LOWER(s.loser_ign) = $1)
      AND s.is_voided = false`;
    const params = [ign];
    if (start && end) {
      sql += ' AND s.created_at BETWEEN $2 AND $3';
      params.push(new Date(start), new Date(end));
    }
    const stats = await pool.query(sql, params);

    const row = stats.rows[0];
    const total = row.total || 0;
    const wins = row.wins || 0;
    const losses = row.losses || 0;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    const embed = new EmbedBuilder()
      .setTitle(`PM stats: ${ign}`)
      .setColor(0x1abc9c)
      .addFields(
        { name: 'Total fights', value: String(total), inline: true },
        { name: 'Wins', value: String(wins), inline: true },
        { name: 'Losses', value: String(losses), inline: true },
        { name: 'Win rate', value: `${winRate}%`, inline: true }
      )
      .setFooter({
        text: start && end ? `Range: ${start} – ${end}` : 'All recorded fights',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('pmlist')
      .setDescription('View the PM list'),
    new SlashCommandBuilder()
      .setName('addpm')
      .setDescription('Add a PM to the list')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('manager-type')
          .setDescription('Prime / Elite / Apex manager (default N/A)')
          .setRequired(false)
          .addChoices(...PM_MANAGER_CHOICES)
      )
      .addIntegerOption((o) =>
        o.setName('ping').setDescription('Ping ms (optional)').setRequired(false)
      )
      .addStringOption((o) => o.setName('uuid').setDescription('UUID (optional)').setRequired(false)),
    new SlashCommandBuilder()
      .setName('deletepm')
      .setDescription('Delete a PM from the list by Minecraft IGN (Admin Only)')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Minecraft IGN to remove').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('editpm')
      .setDescription("Edit a PM's ping and/or manager type (Prime / Elite / Apex)")
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true))
      .addIntegerOption((o) =>
        o.setName('ping').setDescription('New ping (optional if updating manager type)').setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('manager-type')
          .setDescription('Prime / Elite / Apex / N/A (optional if updating ping)')
          .setRequired(false)
          .addChoices(...PM_MANAGER_CHOICES)
      ),
    new SlashCommandBuilder()
      .setName('pmstats')
      .setDescription('Fight stats for one PM (wins, losses, win rate)')
      .addStringOption((o) =>
        o.setName('ign').setDescription('Minecraft IGN (PM)').setRequired(true)
      )
      .addStringOption((o) =>
        o.setName('start-date').setDescription('ISO date start (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('end-date').setDescription('ISO date end (optional)').setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName('debug')
          .setDescription('Staff+: margins, streaks, per-ladder W/L, score averages (ephemeral)')
          .setRequired(false)
      ),
  ];

  return {
    commands,
    handlers: {
      pmlist: handlePmlist,
      addpm: handleAddpm,
      deletepm: handleDeletepm,
      editpm: handleEditpm,
      pmstats: handlePmstats,
    },
  };
};
