const seenExpiredBlacklistIds = new Set();

function getBlacklistRoleId() {
  return String(process.env.BLACKLIST_ROLE_ID || '').trim();
}

function getTargetGuild(client) {
  const configured = String(process.env.GUILD_ID || '').trim();
  if (configured) return client.guilds.cache.get(configured) || null;
  return client.guilds.cache.first() || null;
}

async function removeBlacklistRoleFromMember(guild, userId, roleId) {
  if (!guild || !userId || !roleId) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(roleId, 'Blacklist expired').catch(() => {});
  }
}

function startBlacklistExpiryPoller(client, pool) {
  const intervalMs = 30_000;

  async function tick() {
    const roleId = getBlacklistRoleId();
    if (!roleId) return;
    const guild = getTargetGuild(client);
    if (!guild) return;

    let rows;
    try {
      const q = await pool.query(
        `SELECT DISTINCT ON (discord_user_id) id, discord_user_id
         FROM blacklists b
         WHERE b.discord_user_id IS NOT NULL
           AND COALESCE(TRIM(b.discord_user_id), '') <> ''
           AND EXISTS (
             SELECT 1
             FROM blacklists e
             WHERE e.discord_user_id = b.discord_user_id
               AND e.blacklist_expires IS NOT NULL
               AND e.blacklist_expires <= NOW()
           )
           AND NOT EXISTS (
             SELECT 1
             FROM blacklists a
             WHERE a.discord_user_id = b.discord_user_id
               AND (a.blacklist_expires IS NULL OR a.blacklist_expires > NOW())
           )
         ORDER BY discord_user_id, id DESC
         LIMIT 500`
      );
      rows = q.rows;
    } catch (e) {
      console.warn('blacklistExpiryPoller query:', e?.message || e);
      return;
    }

    for (const row of rows) {
      const id = Number(row.id);
      if (Number.isFinite(id) && seenExpiredBlacklistIds.has(id)) continue;
      await removeBlacklistRoleFromMember(guild, String(row.discord_user_id), roleId);
      if (Number.isFinite(id)) seenExpiredBlacklistIds.add(id);
    }
  }

  setInterval(tick, intervalMs);
  tick();
}

module.exports = { startBlacklistExpiryPoller, getBlacklistRoleId };
