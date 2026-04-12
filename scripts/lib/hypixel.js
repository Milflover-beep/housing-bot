/**
 * Hypixel Public API (v2 player) — network level from `player.networkExp`.
 * Auth: header `API-Key` (set `HYPIXEL_API_KEY` in env).
 */

const HYPIXEL_PLAYER_URL = 'https://api.hypixel.net/v2/player';

function networkLevelFromExp(networkExp) {
  const exp = Math.max(0, Number(networkExp) || 0);
  return Math.sqrt(exp * 2 + 30625) / 50 - 2.5;
}

/**
 * @param {string|undefined} apiKey
 * @param {string} ignOrUuidNormalized trimmed, lowercase IGN or UUID (length > 16 ⇒ uuid query param)
 * @returns {Promise<
 *   | { ok: true; level: number; hasPlayer: boolean }
 *   | { ok: false; message: string }
 * >}
 */
async function fetchNetworkLevelForCheck(apiKey, ignOrUuidNormalized) {
  const key = String(apiKey || '').trim();
  const id = String(ignOrUuidNormalized || '').trim();
  if (!key) {
    return {
      ok: false,
      message:
        'Hypixel verification is not configured (**HYPIXEL_API_KEY** missing). Set it in `.env` or your host variables.',
    };
  }
  if (!id) {
    return { ok: false, message: 'Missing IGN or UUID for Hypixel lookup.' };
  }

  const query = id.length > 16 ? `uuid=${encodeURIComponent(id)}` : `name=${encodeURIComponent(id)}`;
  const url = `${HYPIXEL_PLAYER_URL}?${query}`;

  try {
    const res = await fetch(url, { headers: { 'API-Key': key } });
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, message: 'Hypixel API returned invalid JSON.' };
    }

    if (!res.ok) {
      const cause = data && typeof data.cause === 'string' ? data.cause : '';
      return {
        ok: false,
        message: `Hypixel API HTTP ${res.status}${cause ? ` (${cause})` : ''}.`,
      };
    }

    if (data.success !== true) {
      const cause = data && typeof data.cause === 'string' ? data.cause : 'Unknown error';
      return { ok: false, message: `Hypixel API: ${cause}` };
    }

    const player = data.player;
    let exp = 0;
    if (player && player.networkExp != null && player.networkExp !== '') {
      const n = Number(player.networkExp);
      if (!Number.isNaN(n)) exp = n;
    }

    const level = networkLevelFromExp(exp);
    return { ok: true, level, hasPlayer: Boolean(player) };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { ok: false, message: `Could not reach Hypixel API (${msg}).` };
  }
}

module.exports = { networkLevelFromExp, fetchNetworkLevelForCheck };
