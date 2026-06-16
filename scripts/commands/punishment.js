const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { getPunishmentPingsChannelId } = require('../lib/punishmentExpiryPoller');

const DEFAULT_STAFF_PING_ROLE_ID = '1299685590119223327';

module.exports = function punishmentCommands(ctx) {
  const {
    pool,
    requireLevel,
    defer,
    normalizeIgn,
    resolveIgnIdentity,
    resolveGuildMember,
    parseCooldownToMs,
    formatEvidencePlainUrls,
    getMemberLevel,
    hasRoleId,
    parseRoleIdList,
    normalizeUuidCompact,
    fetchMojangProfileByIgn,
    fetchMojangNameByUuid,
  } = ctx;

  const HEAD_ADMIN_ROLE_IDS = parseRoleIdList('BOT_ROLE_HEAD_ADMIN_ID');

  function formatRemaining(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'expired';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push('<1m');
    return parts.join(' ');
  }

  function punishmentActionLabel(kind) {
    const t = String(kind || '').trim().toLowerCase();
    if (t === 'mute') return 'unmute';
    if (t === 'ranked_ban') return 'unranked ban';
    return 'unban';
  }

  function punishmentTypeLabel(kind) {
    const t = String(kind || '').trim().toLowerCase();
    if (t === 'mute') return 'Mute';
    if (t === 'ranked_ban') return 'Ranked Ban';
    return 'Ban';
  }

  function resolvePunishmentEndAt(row) {
    if (row?.reversal_remind_at) return new Date(row.reversal_remind_at);
    const raw = String(row?.cooldown_raw || '').trim();
    if (!raw || raw === '-1') return null;
    const ms = parseCooldownToMs(raw);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const base = row?.created_at || row?.date;
    if (!base) return null;
    const baseMs = new Date(base).getTime();
    if (!Number.isFinite(baseMs)) return null;
    return new Date(baseMs + ms);
  }

  function shouldSendExpiryReminder(kind) {
    return String(kind || '').trim().toLowerCase() !== 'ranked_ban';
  }

  const mojangNameCache = new Map();

  async function resolveCurrentIgnFromUuid(uuidInput, fallbackIgn) {
    const uuid = normalizeUuidCompact(uuidInput);
    if (!uuid) return String(fallbackIgn || '—');
    const cached = mojangNameCache.get(uuid);
    if (cached && cached.expiresAt > Date.now()) return cached.name;
    const name = await fetchMojangNameByUuid(uuid);
    if (!name) return String(fallbackIgn || '—');
    mojangNameCache.set(uuid, { name, expiresAt: Date.now() + 10 * 60 * 1000 });
    return name;
  }

  async function resolveLookupUuidForIgn(ign, ignAliases = []) {
    const fromMojang = await fetchMojangProfileByIgn(ign).catch(() => null);
    const mojangUuid = normalizeUuidCompact(fromMojang?.uuid || null);
    if (mojangUuid) return mojangUuid;
    try {
      const fallback = await pool.query(
        `SELECT user_uuid
         FROM punishment_logs
         WHERE LOWER(TRIM(user_ign)) = ANY($1::text[])
           AND COALESCE(TRIM(user_uuid), '') <> ''
         ORDER BY created_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [ignAliases?.length ? ignAliases : [ign]]
      );
      return normalizeUuidCompact(fallback.rows[0]?.user_uuid || null);
    } catch (e) {
      if (e?.code === '42703') return null;
      throw e;
    }
  }

  function buildExpiryActionEmbed(logRow, displayIgn) {
    const issued = logRow.date || logRow.created_at;
    const exp = logRow.reversal_remind_at;
    const action = punishmentActionLabel(logRow.punishment);
    return new EmbedBuilder()
      .setTitle(`⏰ ${action.toUpperCase()} reminder`)
      .setColor(0xe74c3c)
      .addFields(
        { name: '👤 Player IGN', value: String(displayIgn || logRow.user_ign || '—'), inline: true },
        { name: '👮 Staff Member', value: String(logRow.staff_ign || '—'), inline: true },
        { name: '📅 Date Issued', value: issued ? new Date(issued).toLocaleDateString() : '—', inline: true },
        { name: '⏰ Punishment ended', value: exp ? new Date(exp).toLocaleString() : '—', inline: true },
        { name: '🔧 Action needed', value: action, inline: true },
        { name: '📄 Details', value: String(logRow.punishment_details || '—').slice(0, 1024) }
      )
      .setFooter({ text: 'Evidence not shown.' })
      .setTimestamp();
  }

  async function sendImmediateUnbanPing(client, logRow) {
    const channelId = getPunishmentPingsChannelId();
    if (!channelId) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    const roleId =
      process.env.PUNISHMENT_STAFF_ROLE_ID || process.env.STAFF_PING_ROLE_ID || DEFAULT_STAFF_PING_ROLE_ID;
    const displayIgn = await resolveCurrentIgnFromUuid(logRow.user_uuid, logRow.user_ign);
    await ch.send({
      content: `<@&${roleId}>`,
      embeds: [buildExpiryActionEmbed(logRow, displayIgn)],
    });
  }

  async function nextProgressiveCooldownRaw(userIgn, punishmentType = 'ban', userUuid = null) {
    const kind = String(punishmentType || 'ban').trim().toLowerCase();
    const normalizedType = kind === 'mute' ? 'mute' : 'ban';
    const normalizedUuid = normalizeUuidCompact(userUuid);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM punishment_logs
       WHERE (
         (COALESCE($3::text, '') <> '' AND LOWER(TRIM(COALESCE(user_uuid, ''))) = $3)
         OR LOWER(TRIM(user_ign)) = LOWER(TRIM($1::text))
       )
         AND LOWER(COALESCE(TRIM(punishment), 'ban')) = $2
         AND COALESCE(progressive_ban, true) = true
         AND status = 'active'
         AND punishment_status = 'active'`,
      [userIgn, normalizedType, normalizedUuid || null]
    );
    const acceptedCount = r.rows[0]?.c || 0;
    const multiplier = normalizedType === 'ban' ? 4 : 2;
    const days = 3 * Math.pow(multiplier, acceptedCount);
    return `${days}d`;
  }

  async function getQueueRow(queueId) {
    const q = await pool.query('SELECT * FROM punishment_queue WHERE id = $1', [queueId]);
    return q.rows[0] || null;
  }

  async function getLogForQueue(row) {
    if (!row?.punishment_log_id) return null;
    const l = await pool.query('SELECT * FROM punishment_logs WHERE id = $1', [row.punishment_log_id]);
    return l.rows[0] || null;
  }

  function isHeadAdmin(member) {
    return HEAD_ADMIN_ROLE_IDS.length > 0 && HEAD_ADMIN_ROLE_IDS.some((id) => hasRoleId(member, id));
  }

  function canReviewerHandleSubmitter(reviewer, submitter) {
    if (reviewer.isHeadAdmin) return true;
    if (reviewer.level >= 4) {
      // Admins can handle admins/managers/staff, but not head-admin logs.
      return !submitter.isHeadAdmin && submitter.level >= 2 && submitter.level <= 4;
    }
    if (reviewer.level >= 3) {
      // Managers can handle staff only.
      return !submitter.isHeadAdmin && submitter.level === 2;
    }
    return false;
  }

  async function resolveQueueSubmitterHierarchy(guild, queueRow) {
    const hasSnapshotLevel =
      queueRow.submitter_level !== null &&
      queueRow.submitter_level !== undefined &&
      Number.isFinite(Number(queueRow.submitter_level));
    const hasSnapshotHeadAdmin =
      queueRow.submitter_is_head_admin !== null &&
      queueRow.submitter_is_head_admin !== undefined;
    if (hasSnapshotLevel || hasSnapshotHeadAdmin) {
      return {
        level: hasSnapshotLevel ? Number(queueRow.submitter_level) : 2,
        isHeadAdmin: Boolean(queueRow.submitter_is_head_admin),
      };
    }
    if (!guild || !queueRow.staff_discord_id) {
      return { level: 2, isHeadAdmin: false };
    }
    try {
      const submitterMember = await guild.members.fetch(queueRow.staff_discord_id);
      return {
        level: getMemberLevel(submitterMember),
        isHeadAdmin: isHeadAdmin(submitterMember),
      };
    } catch {
      return { level: 2, isHeadAdmin: false };
    }
  }

  async function canReviewQueueRow(guild, reviewerMember, queueRow) {
    const reviewer = { level: getMemberLevel(reviewerMember), isHeadAdmin: isHeadAdmin(reviewerMember) };
    const submitter = await resolveQueueSubmitterHierarchy(guild, queueRow);
    return canReviewerHandleSubmitter(reviewer, submitter);
  }

  async function getPendingQueueItems(guild, reviewerMember) {
    const q = await pool.query(
      "SELECT * FROM punishment_queue WHERE status = 'pending' ORDER BY id ASC"
    );
    const reviewer = {
      level: getMemberLevel(reviewerMember),
      isHeadAdmin: isHeadAdmin(reviewerMember),
    };
    const items = [];
    for (const row of q.rows) {
      const log = await getLogForQueue(row);
      if (!log) continue;
      const submitter = await resolveQueueSubmitterHierarchy(guild, row);
      if (!canReviewerHandleSubmitter(reviewer, submitter)) continue;
      items.push({ queue: row, log });
    }
    return items;
  }

  function buildQueueReviewEmbed(queue, log, pageNum, totalPages) {
    const evidenceText = formatEvidencePlainUrls(log.evidence);
    const description =
      `**Player:** \`${log.user_ign}\`\n` +
      `**Type:** ${punishmentTypeLabel(log.punishment)}\n` +
      `**Staff:** ${log.staff_ign || '—'}\n\n` +
      `**📎 Evidence**\n${evidenceText}`;
    return new EmbedBuilder()
      .setTitle(`Review queue — ${pageNum}/${totalPages} (queue #${queue.id} · log #${log.id})`)
      .setColor(0x5865f2)
      .setDescription(description.slice(0, 4096))
      .addFields(
        { name: '📄 Details', value: (log.punishment_details || '—').slice(0, 1024) },
        {
          name: '⏱️ Ban duration',
          value: log.cooldown_raw
            ? `\`${log.cooldown_raw}\` (**d**=days **h**=hours **m**=minutes)`
            : 'None (no timed unban ping)',
          inline: false,
        }
      )
      .setFooter({ text: 'Accept approves; Deny voids + pings staff; Deny (No Ping) voids silently.' })
      .setTimestamp();
  }

  async function renderQueuePage(interaction, items, index) {
    if (!items.length) {
      return interaction.editReply({
        content: 'Queue is empty (no pending items).',
        embeds: [],
        components: [],
      });
    }
    const safeIdx = Math.min(Math.max(0, index), items.length - 1);
    const { queue, log } = items[safeIdx];
    const embed = buildQueueReviewEmbed(queue, log, safeIdx + 1, items.length);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pq|nav|${queue.id}|prev`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeIdx === 0),
      new ButtonBuilder()
        .setCustomId(`pq|nav|${queue.id}|next`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeIdx >= items.length - 1),
      new ButtonBuilder()
        .setCustomId(`pq|acc|${queue.id}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`pq|den|${queue.id}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`pq|dennp|${queue.id}`)
        .setLabel('Deny (No Ping)')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  async function applyAccept(queueId) {
    const row = await getQueueRow(queueId);
    if (!row || row.status !== 'pending') return { ok: false, reason: 'no_pending' };
    const log = await getLogForQueue(row);
    if (!log) return { ok: false, reason: 'no_log' };

    await pool.query(
      `UPDATE punishment_logs SET status = 'active', punishment_status = 'active',
         reversal_reminded = COALESCE(reversal_reminded, false) WHERE id = $1`,
      [log.id]
    );
    await pool.query(`UPDATE punishment_queue SET status = 'accepted' WHERE id = $1`, [queueId]);
    return { ok: true, logId: log.id, queueId };
  }

  async function applyDeny(queueId) {
    const row = await getQueueRow(queueId);
    if (!row || row.status !== 'pending') return { ok: false, reason: 'no_pending' };
    const log = await getLogForQueue(row);
    if (!log) return { ok: false, reason: 'no_log' };

    await pool.query(
      `UPDATE punishment_logs
       SET status = 'void', punishment_status = 'denied', reversal_reminded = true
       WHERE id = $1`,
      [log.id]
    );
    await pool.query(`UPDATE punishment_queue SET status = 'denied' WHERE id = $1`, [queueId]);
    return { ok: true, logId: log.id, queueId, log };
  }

  async function handleCheckqueue(interaction) {
    await defer(interaction, true);
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      return interaction.editReply({
        content:
          '❌ Managers or higher only. If you have the manager role, enable **Server Members Intent** for the bot or try again.',
      });
    }
    const items = await getPendingQueueItems(interaction.guild, member);
    if (items.length === 0) {
      return interaction.editReply({
        content: 'Queue is empty (no pending items you can approve at your hierarchy level).',
      });
    }
    return renderQueuePage(interaction, items, 0);
  }

  async function handlePunishmentQueueButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('pq|')) return false;
    if (!interaction.guild) {
      await interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });
      return true;
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 3)) {
      await interaction.reply({ content: '❌ Managers only.', ephemeral: true });
      return true;
    }
    const parts = interaction.customId.split('|');
    if (parts.length < 3) return false;

    await interaction.deferUpdate();

    if (parts[1] === 'nav') {
      const queueId = parseInt(parts[2], 10);
      const dir = parts[3];
      const items = await getPendingQueueItems(interaction.guild, member);
      if (!items.length) {
        return interaction.editReply({
          content: 'Queue is empty (or no visible items at your hierarchy level).',
          embeds: [],
          components: [],
        });
      }
      const idx = items.findIndex((x) => x.queue.id === queueId);
      const base = idx >= 0 ? idx : 0;
      let newIdx = base;
      if (dir === 'prev') newIdx = Math.max(0, base - 1);
      else if (dir === 'next') newIdx = Math.min(items.length - 1, base + 1);
      return renderQueuePage(interaction, items, newIdx);
    }

    if (parts[1] === 'acc') {
      const queueId = parseInt(parts[2], 10);
      const row = await getQueueRow(queueId);
      if (!row || !(await canReviewQueueRow(interaction.guild, member, row))) {
        const visible = await getPendingQueueItems(interaction.guild, member);
        if (!visible.length) {
          return interaction.editReply({
            content: '❌ You cannot approve that item at your hierarchy level. No visible queue items remain.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, visible, 0);
      }
      const itemsBefore = await getPendingQueueItems(interaction.guild, member);
      const idxBefore = Math.max(0, itemsBefore.findIndex((x) => x.queue.id === queueId));
      const res = await applyAccept(queueId);
      if (!res.ok) {
        const items = await getPendingQueueItems(interaction.guild, member);
        if (!items.length) {
          return interaction.editReply({
            content: '❌ That item is no longer pending (or was already processed). Queue is empty.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, items, Math.min(idxBefore, items.length - 1));
      }
      const items = await getPendingQueueItems(interaction.guild, member);
      if (!items.length) {
        return interaction.editReply({
          content: `✅ Accepted punishment **log #${res.logId}** (queue **#${res.queueId}**). Queue is now empty.`,
          embeds: [],
          components: [],
        });
      }
      return renderQueuePage(interaction, items, Math.min(idxBefore, items.length - 1));
    }

    if (parts[1] === 'den') {
      const queueId = parseInt(parts[2], 10);
      const row = await getQueueRow(queueId);
      if (!row || !(await canReviewQueueRow(interaction.guild, member, row))) {
        const visible = await getPendingQueueItems(interaction.guild, member);
        if (!visible.length) {
          return interaction.editReply({
            content: '❌ You cannot deny that item at your hierarchy level. No visible queue items remain.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, visible, 0);
      }
      const itemsBefore = await getPendingQueueItems(interaction.guild, member);
      const idxBefore = Math.max(0, itemsBefore.findIndex((x) => x.queue.id === queueId));
      const res = await applyDeny(queueId);
      if (!res.ok) {
        const items = await getPendingQueueItems(interaction.guild, member);
        if (!items.length) {
          return interaction.editReply({
            content: '❌ That item is no longer pending. Queue is empty.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, items, Math.min(idxBefore, items.length - 1));
      }
      if (!res.log?.reversal_reminded) {
        await sendImmediateUnbanPing(interaction.client, res.log).catch(() => {});
      }
      const items = await getPendingQueueItems(interaction.guild, member);
      if (!items.length) {
        return interaction.editReply({
          content: `✅ Denied punishment **log #${res.logId}** (queue **#${res.queueId}**). Queue is now empty.`,
          embeds: [],
          components: [],
        });
      }
      return renderQueuePage(interaction, items, Math.min(idxBefore, items.length - 1));
    }

    if (parts[1] === 'dennp') {
      const queueId = parseInt(parts[2], 10);
      const row = await getQueueRow(queueId);
      if (!row || !(await canReviewQueueRow(interaction.guild, member, row))) {
        const visible = await getPendingQueueItems(interaction.guild, member);
        if (!visible.length) {
          return interaction.editReply({
            content: '❌ You cannot deny that item at your hierarchy level. No visible queue items remain.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, visible, 0);
      }
      const itemsBefore = await getPendingQueueItems(interaction.guild, member);
      const idxBefore = Math.max(0, itemsBefore.findIndex((x) => x.queue.id === queueId));
      const res = await applyDeny(queueId);
      if (!res.ok) {
        const items = await getPendingQueueItems(interaction.guild, member);
        if (!items.length) {
          return interaction.editReply({
            content: '❌ That item is no longer pending. Queue is empty.',
            embeds: [],
            components: [],
          });
        }
        return renderQueuePage(interaction, items, Math.min(idxBefore, items.length - 1));
      }
      const items = await getPendingQueueItems(interaction.guild, member);
      if (!items.length) {
        return interaction.editReply({
          content:
            `✅ Denied punishment **log #${res.logId}** (queue **#${res.queueId}**) without pinging staff. ` +
            'Queue is now empty.',
          embeds: [],
          components: [],
        });
      }
      return renderQueuePage(interaction, items, Math.min(idxBefore, items.length - 1));
    }

    return false;
  }

  async function handleLog(interaction) {
    await defer(interaction, true);
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 2)) {
      return interaction.editReply({
        content:
          '❌ Staff or higher only. If you have the staff role, try again or ask an admin to enable **Server Members Intent** so the bot can see your roles.',
      });
    }
    const userIdentity = await resolveIgnIdentity(pool, interaction.options.getString('user-ign'));
    const userIgn = userIdentity.canonicalIgn || userIdentity.ign;
    const mojangProfile = await fetchMojangProfileByIgn(userIgn).catch(() => null);
    const userUuid = normalizeUuidCompact(mojangProfile?.uuid || null);
    const details = interaction.options.getString('details');
    const evidence = interaction.options.getString('evidence', true) || '';
    const evidenceTrim = evidence.trim();
    if (!evidenceTrim) {
      return interaction.editReply({ content: '❌ **Evidence** is required.' });
    }
    const punishmentType = interaction.options.getString('punishment-type') || 'ban';
    const cooldownRaw =
      String(punishmentType).toLowerCase() === 'ranked_ban'
        ? '7d'
        : await nextProgressiveCooldownRaw(userIgn, punishmentType, userUuid);
    const cooldownMs = parseCooldownToMs(cooldownRaw);
    const reversalAt = cooldownMs ? new Date(Date.now() + cooldownMs) : null;
    const staffIgn = interaction.user.username;
    const staffDiscordId = String(interaction.user.id);
    const submitterLevel = getMemberLevel(member);
    const submitterIsHeadAdmin = isHeadAdmin(member);

    try {
      const ins = await pool.query(
        `INSERT INTO punishment_logs (user_ign, user_uuid, staff_ign, evidence, punishment_details, date, discord_user, punishment, created_at, status, punishment_status, cooldown_raw, reversal_remind_at, reversal_reminded, progressive_ban)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW(), 'queued', 'pending_review', $8, $9, false, true)
         RETURNING id`,
        [
          userIgn,
          userUuid || null,
          staffIgn,
          evidenceTrim,
          details,
          staffDiscordId,
          punishmentType,
          cooldownRaw || null,
          reversalAt,
        ]
      );
      const logId = ins.rows[0].id;

      const summary = (details || '').slice(0, 200);
      try {
        await pool.query(
          `INSERT INTO punishment_queue
             (ign, staff_discord_id, details, status, punishment_log_id, submitter_level, submitter_is_head_admin, created_at)
           VALUES ($1, $2, $3, 'pending', $4, $5, $6, NOW())`,
          [userIgn, staffDiscordId, summary, logId, submitterLevel, submitterIsHeadAdmin]
        );
      } catch (e) {
        const code = e && e.code;
        const msg = String(e && e.message);
        const missingQueueCols =
          code === '42703' ||
          /punishment_log_id/i.test(msg) ||
          /submitter_level/i.test(msg) ||
          /submitter_is_head_admin/i.test(msg);
        if (missingQueueCols) {
          await pool.query(
            `INSERT INTO punishment_queue (ign, staff_discord_id, details, status, created_at)
             VALUES ($1, $2, $3, 'pending', NOW())`,
            [userIgn, staffDiscordId, summary]
          );
        } else {
          throw e;
        }
      }

      await interaction.editReply({
        content:
          `✅ Logged ${punishmentTypeLabel(punishmentType).toLowerCase()} punishment **#${logId}** for **${userIgn}** and added it to the **review queue**.\n` +
          `${
            String(punishmentType || '').toLowerCase() === 'ranked_ban'
              ? 'Duration set to **7d** by default.'
              : `Duration set to **${cooldownRaw}** (${
                  String(punishmentType || '').toLowerCase() === 'ban'
                    ? 'progressive 3d -> 12d -> 48d...'
                    : 'progressive 3d -> 6d -> 12d...'
                }). Use **/checkqueue** (pages + Accept/Deny).`
          }`,
      });
    } catch (e) {
      console.error('handleLog:', e);
      const hint =
        process.env.BOT_SHOW_ERRORS === 'true'
          ? `\n\`${String(e.message || e).slice(0, 400)}\``
          : '';
      return interaction.editReply({
        content:
          `❌ Database error while logging punishment.${hint}\n` +
          `Confirm \`punishment_logs\` and \`punishment_queue\` match \`schema.sql\`.`,
      });
    }
  }

  async function handleAdminlog(interaction) {
    await defer(interaction, true);
    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ Use this command in a server.' });
    }
    const member = await resolveGuildMember(interaction);
    if (!requireLevel(member, 4)) {
      return interaction.editReply({ content: '❌ Admin or higher only.' });
    }
    const userIdentity = await resolveIgnIdentity(pool, interaction.options.getString('user-ign'));
    const userIgn = userIdentity.canonicalIgn || userIdentity.ign;
    const mojangProfile = await fetchMojangProfileByIgn(userIgn).catch(() => null);
    const userUuid = normalizeUuidCompact(mojangProfile?.uuid || null);
    const details = interaction.options.getString('details');
    const evidence = interaction.options.getString('evidence') || '';
    const evidenceTrim = evidence.trim();
    const punishmentType = interaction.options.getString('punishment-type') || 'ban';
    const banDurationOpt = interaction.options.getString('ban-duration');
    let cooldownRaw =
      banDurationOpt && String(banDurationOpt).trim() ? String(banDurationOpt).trim() : '';
    let progressiveBan = false;
    if (!cooldownRaw) {
      if (String(punishmentType || '').toLowerCase() === 'ranked_ban') {
        cooldownRaw = '7d';
      } else {
        cooldownRaw = await nextProgressiveCooldownRaw(userIgn, punishmentType, userUuid);
        progressiveBan = true;
      }
    }
    const isPermanentBan = cooldownRaw === '-1';
    const cooldownMs = isPermanentBan ? null : parseCooldownToMs(cooldownRaw);
    if (!isPermanentBan && (cooldownMs === undefined || cooldownMs === null || cooldownMs <= 0)) {
      return interaction.editReply({
        content:
          '❌ Invalid **ban duration**. Use one number and one unit: **`d`** days, **`h`** hours, **`m`** minutes (e.g. `1d`, `12h`, `1m`), or `-1` for permanent. Leave blank to use normal progressive duration.',
      });
    }
    const reversalAt = isPermanentBan ? null : new Date(Date.now() + cooldownMs);
    const staffIgn = interaction.user.username;
    const staffDiscordId = String(interaction.user.id);
    const submitterLevel = getMemberLevel(member);
    const submitterIsHeadAdmin = isHeadAdmin(member);

    const ins = await pool.query(
      `INSERT INTO punishment_logs (user_ign, user_uuid, staff_ign, evidence, punishment_details, date, discord_user, punishment, created_at, status, punishment_status, cooldown_raw, reversal_remind_at, reversal_reminded, progressive_ban)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW(), 'queued', 'pending_review', $8, $9, false, false)
       RETURNING id`,
      [
        userIgn,
        userUuid || null,
        staffIgn,
        evidenceTrim || null,
        details,
        staffDiscordId,
        punishmentType,
        cooldownRaw,
        reversalAt,
      ]
    );
    const logId = ins.rows[0].id;
    const summary = (details || '').slice(0, 200);
    try {
      await pool.query(
        `INSERT INTO punishment_queue
           (ign, staff_discord_id, details, status, punishment_log_id, submitter_level, submitter_is_head_admin, created_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, NOW())`,
        [userIgn, staffDiscordId, summary, logId, submitterLevel, submitterIsHeadAdmin]
      );
    } catch (e) {
      const code = e && e.code;
      const msg = String(e && e.message);
      const missingQueueCols =
        code === '42703' ||
        /punishment_log_id/i.test(msg) ||
        /submitter_level/i.test(msg) ||
        /submitter_is_head_admin/i.test(msg);
      if (!missingQueueCols) throw e;
      await pool.query(
        `INSERT INTO punishment_queue (ign, staff_discord_id, details, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())`,
        [userIgn, staffDiscordId, summary]
      );
    }
    if (progressiveBan) {
      await pool.query(`UPDATE punishment_logs SET progressive_ban = true WHERE id = $1`, [logId]);
    }

    await interaction.editReply({
      content:
        `✅ Admin logged ${punishmentTypeLabel(punishmentType).toLowerCase()} punishment **#${logId}** for **${userIgn}** and added it to review queue.\n` +
        `${
          progressiveBan
            ? 'Auto progressive ban duration'
            : String(punishmentType || '').toLowerCase() === 'ranked_ban'
              ? 'Ranked ban duration'
            : isPermanentBan
              ? 'Custom ban duration (permanent)'
              : 'Custom ban duration'
        }: **${isPermanentBan ? 'permanent' : cooldownRaw}**.`,
    });
  }

  async function handleStaffstats(interaction) {
    await defer(interaction, false);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const staffUser = interaction.options.getUser('discord', true);
    const staffId = String(staffUser.id);
    const start = interaction.options.getString('start-date');
    const end = interaction.options.getString('end-date');
    const params = [staffId];
    let where = `discord_user = $1`;
    if (start && end) {
      where += ' AND created_at BETWEEN $2 AND $3';
      params.push(new Date(start), new Date(end));
    }
    const activityParams = [staffId];
    let activityWhere = `staff_discord_id = $1`;
    if (start && end) {
      activityWhere += ' AND created_at BETWEEN $2 AND $3';
      activityParams.push(new Date(start), new Date(end));
    }

    const ticketCategoryIds = String(process.env.CHECK_RENAME_CATEGORY_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const [r, activitySummary, topCommands] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'active' AND punishment_status = 'active' THEN 1 ELSE 0 END)::int AS accepted,
           SUM(CASE WHEN punishment_status = 'denied' THEN 1 ELSE 0 END)::int AS denied
         FROM punishment_logs
         WHERE ${where}`,
        params
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_commands,
           MAX(created_at) AS last_active_at,
           SUM(CASE WHEN category_id = ANY($${activityParams.length + 1}::text[]) THEN 1 ELSE 0 END)::int AS ticket_commands
         FROM staff_activity_logs
         WHERE ${activityWhere}`,
        [...activityParams, ticketCategoryIds]
      ),
      pool.query(
        `SELECT command_name, COUNT(*)::int AS uses
         FROM staff_activity_logs
         WHERE ${activityWhere}
         GROUP BY command_name
         ORDER BY uses DESC, command_name ASC
         LIMIT 8`,
        activityParams
      ),
    ]);

    const row = r.rows[0] || {};
    const total = row.total || 0;
    const accepted = row.accepted || 0;
    const denied = row.denied || 0;
    const decided = accepted + denied;
    const accuracy = decided > 0 ? ((accepted / decided) * 100).toFixed(1) : '0.0';
    const ar = activitySummary.rows[0] || {};
    const totalCommands = ar.total_commands || 0;
    const ticketCommands = ar.ticket_commands || 0;
    const lastActiveTs = ar.last_active_at
      ? Math.floor(new Date(ar.last_active_at).getTime() / 1000)
      : null;
    const topCommandsText = topCommands.rows.length
      ? topCommands.rows.map((x) => `\`/${x.command_name}\` — ${x.uses}`).join('\n')
      : '_No command activity in range._';
    const embed = new EmbedBuilder()
      .setTitle(`Staff stats: ${staffUser.username}`)
      .setColor(0x3498db)
      .addFields(
        { name: 'Staff', value: `<@${staffId}>`, inline: true },
        { name: 'Logs made', value: String(total), inline: true },
        { name: 'Accepted', value: String(accepted), inline: true },
        { name: 'Denied', value: String(denied), inline: true },
        { name: 'Accuracy', value: `${accuracy}%`, inline: true },
        { name: 'Commands run', value: String(totalCommands), inline: true },
        { name: 'Ticket commands', value: String(ticketCommands), inline: true },
        {
          name: 'Last command activity',
          value: lastActiveTs ? `<t:${lastActiveTs}:F> (<t:${lastActiveTs}:R>)` : 'No activity in range',
          inline: false,
        },
        { name: 'Top commands', value: topCommandsText.slice(0, 1024), inline: false }
      )
      .setFooter({ text: start && end ? `Range: ${start} - ${end}` : 'All time' })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleHistory(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const lookupUuid = await resolveLookupUuidForIgn(ign, ignAliases);
    const [pun, bl] = await Promise.all([
      (async () => {
        try {
          return await pool.query(
            `SELECT id, punishment, punishment_details, status, punishment_status, cooldown_raw, reversal_remind_at, created_at
             FROM punishment_logs
             WHERE (COALESCE($2::text, '') <> '' AND LOWER(TRIM(COALESCE(user_uuid, ''))) = $2)
                OR LOWER(user_ign) = ANY($1::text[])
             ORDER BY created_at DESC
             LIMIT 25`,
            [ignAliases, lookupUuid || '']
          );
        } catch (e) {
          if (e?.code !== '42703') throw e;
          return pool.query(
            `SELECT id, punishment, punishment_details, status, punishment_status, cooldown_raw, reversal_remind_at, created_at
             FROM punishment_logs
             WHERE LOWER(user_ign) = ANY($1::text[])
             ORDER BY created_at DESC
             LIMIT 25`,
            [ignAliases]
          );
        }
      })(),
      pool.query(
        `SELECT id, reason, time_length, blacklist_expires, created_at
         FROM blacklists WHERE LOWER(ign) = ANY($1::text[]) ORDER BY created_at DESC LIMIT 25`,
        [ignAliases]
      ),
    ]);
    const merged = [
      ...pun.rows.map((row) => ({
        t: new Date(row.created_at).getTime(),
        line: (() => {
          let remaining = 'n/a';
          if (String(row.cooldown_raw || '').trim() === '-1') {
            remaining = 'permanent (never)';
          } else if (row.reversal_remind_at) {
            const endAt = new Date(row.reversal_remind_at);
            if (endAt.getTime() <= Date.now()) {
              remaining = `expired ${endAt.toLocaleString()}`;
            } else {
              remaining = `expires ${endAt.toLocaleString()} (${formatRemaining(endAt.getTime() - Date.now())} remaining)`;
            }
          } else if (row.status === 'active' && row.punishment_status === 'active') {
            remaining = 'unknown';
          }
          return `**${punishmentTypeLabel(row.punishment)} Punishment** #${row.id} — ${(row.punishment_details || '—').slice(0, 120)} (${row.status}/${row.punishment_status}) — Remaining: **${remaining}**`;
        })(),
      })),
      ...bl.rows.map((row) => ({
        t: new Date(row.created_at).getTime(),
        line: (() => {
          if (!row.blacklist_expires) {
            return `**Blacklist** #${row.id} — ${row.reason || '?'} (${row.time_length || '?'})`;
          }
          const endAt = new Date(row.blacklist_expires);
          const label = endAt.getTime() <= Date.now() ? 'expired' : 'expires';
          return `**Blacklist** #${row.id} — ${row.reason || '?'} (${row.time_length || '?'}) — ${label} ${endAt.toLocaleString()}`;
        })(),
      })),
    ]
      .sort((a, b) => b.t - a.t)
      .slice(0, 30)
      .map((x) => x.line);
    if (merged.length === 0) {
      return interaction.editReply({
        content: `No punishment or blacklist history for **${ign}**.`,
      });
    }
    const embed = new EmbedBuilder()
      .setTitle(`History: ${ign}`)
      .setColor(0x95a5a6)
      .setDescription(merged.join('\n').slice(0, 3900));
    await interaction.editReply({ embeds: [embed] });
  }

  async function handleGetproof(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const identity = await resolveIgnIdentity(pool, interaction.options.getString('ign'));
    const ign = identity.canonicalIgn || identity.ign;
    const ignAliases = identity.aliases.length ? identity.aliases : [ign];
    const lookupUuid = await resolveLookupUuidForIgn(ign, ignAliases);
    let r;
    try {
      r = await pool.query(
        `SELECT *
         FROM punishment_logs
         WHERE (COALESCE($2::text, '') <> '' AND LOWER(TRIM(COALESCE(user_uuid, ''))) = $2)
            OR LOWER(user_ign) = ANY($1::text[])
         ORDER BY created_at DESC
         LIMIT 30`,
        [ignAliases, lookupUuid || '']
      );
    } catch (e) {
      if (e?.code !== '42703') throw e;
      r = await pool.query(
        `SELECT *
         FROM punishment_logs
         WHERE LOWER(user_ign) = ANY($1::text[])
         ORDER BY created_at DESC
         LIMIT 30`,
        [ignAliases]
      );
    }
    if (r.rows.length === 0) {
      return interaction.editReply({ content: `No punishment logs found for **${ign}**.` });
    }
    const now = Date.now();
    const currentPunishment = r.rows.find((row) => {
      const status = String(row.status || '')
        .trim()
        .toLowerCase();
      const punishmentStatus = String(row.punishment_status || '')
        .trim()
        .toLowerCase();

      // Queue state counts as currently punished (pending review).
      if (punishmentStatus === 'pending_review' || status === 'queued' || status === 'pending') {
        return true;
      }

      // Denied/voided rows are not currently punished.
      if (punishmentStatus === 'denied' || status === 'denied' || status === 'void') {
        return false;
      }

      // Accepted/active punishment still counts until expiry.
      const acceptedStatus = ['active', 'approved', 'accepted'].includes(status);
      const activeState = punishmentStatus === 'active';
      if (!acceptedStatus || !activeState) return false;
      if (String(row.cooldown_raw || '').trim() === '-1') return true;
      if (!row.reversal_remind_at) return true;
      return new Date(row.reversal_remind_at).getTime() > now;
    });
    const head = currentPunishment
      ? (() => {
          let expiresText = 'unknown';
          if (String(currentPunishment.cooldown_raw || '').trim() === '-1') {
            expiresText = 'permanent';
          } else {
            const endAt = resolvePunishmentEndAt(currentPunishment);
            if (endAt) {
              expiresText = `${endAt.toLocaleString()} (${formatRemaining(endAt.getTime() - now)} remaining)`;
            } else if (
              String(currentPunishment.punishment_status || '')
                .trim()
                .toLowerCase() === 'pending_review'
            ) {
              expiresText = 'pending review';
            }
          }
          return (
            `🚫 **Currently punished:** YES (${punishmentTypeLabel(currentPunishment.punishment)} #${currentPunishment.id})\n` +
            `Reason: ${currentPunishment.punishment_details || '—'}\n` +
            `Evidence: ${currentPunishment.evidence || '—'}\n` +
            `Logged by: ${currentPunishment.staff_ign || '—'}\n` +
            `Expires: ${expiresText}`
          );
        })()
      : '✅ **Currently punished:** NO';
    const recent = r.rows
      .slice(0, 12)
      .map(
        (row) => {
          let expiresText = 'unknown';
          if (String(row.cooldown_raw || '').trim() === '-1') {
            expiresText = 'permanent';
          } else {
            const endAt = resolvePunishmentEndAt(row);
            if (endAt) {
              expiresText = `${endAt.toLocaleString()} (${formatRemaining(endAt.getTime() - now)} remaining)`;
            } else if (
              String(row.punishment_status || '')
                .trim()
                .toLowerCase() === 'pending_review'
            ) {
              expiresText = 'pending review';
            }
          }
          return (
            `**#${row.id}** (${punishmentTypeLabel(row.punishment)}) — ${row.created_at ? new Date(row.created_at).toLocaleString() : '—'}\n` +
            `Reason: ${row.punishment_details || '—'}\n` +
            `Evidence: ${row.evidence || '—'}\n` +
            `Logged by: ${row.staff_ign || '—'}\n` +
            `Status: ${row.status || '—'} / ${row.punishment_status || '—'}\n` +
            `Expires: ${expiresText}`
          );
        }
      )
      .join('\n\n');
    await interaction.editReply({
      content: `**Punishment check: ${ign}**\n${head}\n\n**Recent punishment logs**\n${recent}`.slice(0, 3900),
    });
  }

  async function handleTotalhistory(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    try {
      let rows = [];
      const attempts = [
        `SELECT id, user_ign, punishment_details, created_at
         FROM punishment_logs
         WHERE LOWER(COALESCE(TRIM(punishment), 'ban')) = 'ban'
         ORDER BY created_at DESC, id DESC
         LIMIT 5000`,
        `SELECT id, user_ign, punishment_details, created_at
         FROM punishment_logs
         ORDER BY created_at DESC, id DESC
         LIMIT 5000`,
        `SELECT id, user_ign, punishment_details, created_at
         FROM punishment_logs
         ORDER BY id DESC
         LIMIT 5000`,
      ];
      let lastErr = null;
      for (const sql of attempts) {
        try {
          const q = await pool.query(sql);
          rows = q.rows;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;

      if (!rows.length) {
        return interaction.editReply({ content: 'No ban logs found.' });
      }

      const lines = rows.map(
        (row) =>
          `**#${row.id}** — **${row.user_ign || 'unknown'}** — ${
            row.created_at ? new Date(row.created_at).toLocaleString() : '—'
          } — ${(row.punishment_details || 'no reason').slice(0, 120)}`
      );
      const PAGE_BODY_MAX = 1750;
      const pages = [];
      let current = '';
      for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > PAGE_BODY_MAX && current) {
          pages.push(current);
          current = line;
        } else if (next.length > PAGE_BODY_MAX) {
          pages.push(line.slice(0, PAGE_BODY_MAX));
          current = '';
        } else {
          current = next;
        }
      }
      if (current) pages.push(current);
      if (!pages.length) pages.push('_No rows._');

      const totalPages = pages.length;
      const formatPage = (body, idx) => `**Ban logs** (page ${idx + 1}/${totalPages})\n${body}`.slice(0, 2000);

      await interaction.editReply({
        content: formatPage(pages[0], 0),
      });
      for (let i = 1; i < totalPages; i += 1) {
        await interaction.followUp({
          content: formatPage(pages[i], i),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (e) {
      console.error('totalhistory:', e);
      const detail = String(e?.message || e).slice(0, 220);
      await interaction.editReply({
        content: `❌ Could not load total history: ${detail}`,
      });
    }
  }

  async function handleRemovepunishment(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 3)) {
      return interaction.editReply({ content: '❌ Managers or higher only.' });
    }
    const id = interaction.options.getInteger('id', true);
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query('DELETE FROM punishment_queue WHERE punishment_log_id = $1', [id]);
      const del = await conn.query('DELETE FROM punishment_logs WHERE id = $1 RETURNING user_ign', [id]);
      await conn.query('COMMIT');
      if (del.rowCount === 0) {
        return interaction.editReply({
          content: `❌ No punishment log with id **${id}**. Use the number from **/history** (e.g. **Punishment #42** → \`42\`).`,
        });
      }
      return interaction.editReply({
        content: `✅ Removed punishment log **#${id}** for **${del.rows[0].user_ign}** (and any linked queue row).`,
      });
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => {});
      console.error('removepunishment:', e);
      return interaction.editReply({
        content: `❌ Could not remove punishment: ${String(e.message || e).slice(0, 200)}`,
      });
    } finally {
      conn.release();
    }
  }

  async function handleActivepunishments(interaction) {
    await defer(interaction, true);
    if (!requireLevel(interaction.member, 2)) {
      return interaction.editReply({ content: '❌ Staff or higher only.' });
    }
    const includePermanent = interaction.options.getBoolean('permanent') === true;
    const ABSURD_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year+
    const isPermanentLike = (row) => {
      const raw = String(row?.cooldown_raw || '')
        .trim()
        .toLowerCase();
      if (!raw) return true; // no time stored => treat as permanent-like
      if (raw === '-1') return true;
      if (!row?.reversal_remind_at) return true; // no known end time => permanent-like
      const m = raw.match(/^(\d+)\s*([dhm])$/i);
      if (!m) return true; // unknown duration format => permanent-like
      const n = Number(m[1]);
      const u = m[2].toLowerCase();
      if (!Number.isFinite(n) || n <= 0) return true;
      const ms = u === 'd' ? n * 86400000 : u === 'h' ? n * 3600000 : n * 60000;
      return ms >= ABSURD_DURATION_MS;
    };
    try {
      let r;
      try {
        r = await pool.query(
          `SELECT id, user_ign, user_uuid, punishment, punishment_details, cooldown_raw, reversal_remind_at, created_at
           FROM punishment_logs
           WHERE LOWER(COALESCE(TRIM(punishment_status), '')) = 'active'
             AND LOWER(COALESCE(TRIM(status), '')) IN ('active', 'approved', 'accepted')
             AND (
               COALESCE(TRIM(cooldown_raw), '') = '-1'
               OR reversal_remind_at IS NULL
               OR reversal_remind_at > NOW()
             )
           ORDER BY created_at DESC
           LIMIT 200`
        );
      } catch (e) {
        const maybeMissingColumn = e && e.code === '42703';
        if (!maybeMissingColumn) throw e;
        try {
          // Backward-compatible fallback for schemas missing newer punishment columns.
          r = await pool.query(
            `SELECT
               id,
               user_ign,
               NULL::text AS user_uuid,
               NULL::text AS punishment,
               punishment_details,
               NULL::text AS cooldown_raw,
               NULL::timestamptz AS reversal_remind_at,
               created_at
             FROM punishment_logs
             WHERE LOWER(COALESCE(TRIM(punishment_status), '')) = 'active'
               AND LOWER(COALESCE(TRIM(status), '')) IN ('active', 'approved', 'accepted')
             ORDER BY created_at DESC
             LIMIT 200`
          );
        } catch (e2) {
          const maybeMissingStatusColumns = e2 && e2.code === '42703';
          if (!maybeMissingStatusColumns) throw e2;
          // Ultra-legacy fallback: no status fields available.
          r = await pool.query(
            `SELECT
               id,
               user_ign,
               NULL::text AS user_uuid,
               NULL::text AS punishment,
               punishment_details,
               NULL::text AS cooldown_raw,
               NULL::timestamptz AS reversal_remind_at,
               created_at
             FROM punishment_logs
             ORDER BY created_at DESC
             LIMIT 200`
          );
        }
      }
      if (r.rows.length === 0) {
        return interaction.editReply({ content: 'No active punishments right now.' });
      }
      const filteredRows = includePermanent
        ? r.rows
        : r.rows.filter((row) => !isPermanentLike(row));
      if (filteredRows.length === 0) {
        return interaction.editReply({
          content:
            'No active non-permanent punishments right now.\n\n**This only shows non-permanent punishments. Use `/activepunishments permanent:true` to see all punishments.**',
        });
      }
      const lines = await Promise.all(
        filteredRows.map(async (row) => {
          let remaining = 'unknown';
          if (String(row.cooldown_raw || '').trim() === '-1') {
            remaining = 'permanent';
          } else if (row.reversal_remind_at) {
            const endAt = new Date(row.reversal_remind_at);
            remaining = `${formatRemaining(endAt.getTime() - Date.now())} (until ${endAt.toLocaleString()})`;
          }
          const displayIgn = await resolveCurrentIgnFromUuid(row.user_uuid, row.user_ign || 'unknown');
          return `**#${row.id}** — **${displayIgn}** — ${punishmentTypeLabel(row.punishment)} — ${(
            row.punishment_details || 'no details'
          ).slice(0, 60)} — remaining: ${remaining}`;
        })
      );
      const PAGE_BODY_MAX = 1800;
      const pages = [];
      let current = '';
      for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > PAGE_BODY_MAX && current) {
          pages.push(current);
          current = line;
        } else if (next.length > PAGE_BODY_MAX) {
          pages.push(line.slice(0, PAGE_BODY_MAX));
          current = '';
        } else {
          current = next;
        }
      }
      if (current) pages.push(current);
      if (!pages.length) pages.push('_No rows._');

      const filterNote = includePermanent
        ? ''
        : '\n\n**This only shows non-permanent punishments. Use `/activepunishments permanent:true` to see all punishments.**';
      const formatPage = (body, idx, total) => {
        const note = !includePermanent && idx === total - 1 ? filterNote : '';
        return `**Active punishments** (page ${idx + 1}/${total})\n${body}${note}`.slice(0, 2000);
      };

      await interaction.editReply({
        content: formatPage(pages[0], 0, pages.length),
      });

      for (let i = 1; i < pages.length; i += 1) {
        await interaction.followUp({
          content: formatPage(pages[i], i, pages.length),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (e) {
      console.error('activepunishments:', e);
      const detail = String(e?.message || e).slice(0, 220);
      await interaction.editReply({
        content: `❌ Could not fetch active punishments: ${detail}`,
      });
    }
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('log')
      .setDescription('Log a punishment and send it to the review queue')
      .addStringOption((o) => o.setName('user-ign').setDescription('Player IGN').setRequired(true))
      .addStringOption((o) => o.setName('details').setDescription('Details').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('evidence')
          .setDescription('Evidence / proof (text or links; shown in /checkqueue)')
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName('punishment-type')
          .setDescription('ban, mute, or ranked ban (default: ban)')
          .setRequired(false)
          .addChoices(
            { name: 'Ban', value: 'ban' },
            { name: 'Mute', value: 'mute' },
            { name: 'Ranked Ban', value: 'ranked_ban' }
          )
      ),
    new SlashCommandBuilder()
      .setName('adminlog')
      .setDescription('Admin: log punishment to the review queue (optional custom duration)')
      .addStringOption((o) => o.setName('user-ign').setDescription('Player IGN').setRequired(true))
      .addStringOption((o) => o.setName('details').setDescription('Details').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('punishment-type')
          .setDescription('ban, mute, or ranked ban (default: ban)')
          .setRequired(false)
          .addChoices(
            { name: 'Ban', value: 'ban' },
            { name: 'Mute', value: 'mute' },
            { name: 'Ranked Ban', value: 'ranked_ban' }
          )
      )
      .addStringOption((o) =>
        o
          .setName('ban-duration')
          .setDescription(
            'Optional custom ban duration: d=days h=hours m=minutes (e.g. 1d, 12h, 1m), or -1 for permanent'
          )
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName('evidence')
          .setDescription('Optional evidence / proof (text or links)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('staffstats')
      .setDescription('View punishment log count and accuracy for a staff member')
      .addUserOption((o) => o.setName('discord').setDescription('Staff Discord user').setRequired(true))
      .addStringOption((o) =>
        o.setName('start-date').setDescription('ISO date start (optional)').setRequired(false)
      )
      .addStringOption((o) =>
        o.setName('end-date').setDescription('ISO date end (optional)').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('history')
      .setDescription('View punishment and blacklist history for a player')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('punishmentcheck')
      .setDescription('Check whether a player is currently punished and view proof/details')
      .addStringOption((o) => o.setName('ign').setDescription('Minecraft IGN').setRequired(true)),
    new SlashCommandBuilder()
      .setName('totalhistory')
      .setDescription('List ban logs with ID, IGN, date, and reason (Manager+ only)'),
    new SlashCommandBuilder()
      .setName('activepunishments')
      .setDescription('List active punishments with IDs')
      .addBooleanOption((o) =>
        o
          .setName('permanent')
          .setDescription('Include permanent punishments too (default: false)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('checkqueue')
      .setDescription('Review punishment queue from /log — paged proof, Accept / Deny (Manager+)'),
    new SlashCommandBuilder()
      .setName('removepunishment')
      .setDescription('Delete a punishment log row (removes it from /history)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Punishment log id from /history (e.g. Punishment #42 → 42)')
          .setRequired(true)
          .setMinValue(1)
      ),
  ];

  return {
    commands,
    handlers: {
      log: handleLog,
      adminlog: handleAdminlog,
      staffstats: handleStaffstats,
      history: handleHistory,
      punishmentcheck: handleGetproof,
      totalhistory: handleTotalhistory,
      activepunishments: handleActivepunishments,
      checkqueue: handleCheckqueue,
      removepunishment: handleRemovepunishment,
    },
    buttonHandlers: [handlePunishmentQueueButton],
  };
};
