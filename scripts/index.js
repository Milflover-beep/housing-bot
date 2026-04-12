const path = require('path');
// Load repo-root .env regardless of cwd (e.g. `node scripts/index.js` from any folder).
// Note: .env is not committed — on Railway/render/etc. set variables in the host UI; they still apply.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  Events,
} = require('discord.js');
const pool = require('./lib/pool');
const { ensureDatabaseSchema } = require('./lib/ensureSchema');
const {
  startPunishmentExpiryPoller,
  getPunishmentPingsChannelId,
} = require('./lib/punishmentExpiryPoller');
const { build } = require('./commands');

// GuildMembers is privileged — only add after enabling "Server Members Intent" in the
// Discord Developer Portal (Bot tab). Set ENABLE_GUILD_MEMBERS_INTENT=true in .env when ready.
const intents = [GatewayIntentBits.Guilds];
if (process.env.ENABLE_GUILD_MEMBERS_INTENT === 'true') {
  intents.push(GatewayIntentBits.GuildMembers);
}

const client = new Client({ intents });

const { commands, handlers, buttonHandlers } = build();

client.once(Events.ClientReady, async () => {
  try {
    await ensureDatabaseSchema(pool);
  } catch (err) {
    console.error('❌ Database schema ensure failed:', err?.message || err);
  }
  startPunishmentExpiryPoller(client, pool);
  if (!getPunishmentPingsChannelId()) {
    console.warn(
      '⚠️ Punishment cooldown pings are OFF: set PUNISHMENT_PINGS_CHANNEL_ID, PINGS_CHANNEL_ID, or PUNISHMENT_ACCEPT_NOTIFY_CHANNEL_ID in .env'
    );
  }
  console.log(`✅ Logged in as ${client.user.tag}`);
  const applicantId = process.env.BOT_ROLE_APPLICANT_ID?.trim();
  const applicantName = process.env.BOT_ROLE_APPLICANT_NAME?.trim();
  if (!applicantId && !applicantName) {
    const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
    const railwayHint = onRailway
      ? ' On Railway: open the **Node/bot service** (not the Postgres database service) → **Variables** → add `BOT_ROLE_APPLICANT_ID` (role snowflake) and/or `BOT_ROLE_APPLICANT_NAME` → **Redeploy**. Your local `.env` is never uploaded from Git.'
      : ' Add them to .env locally or to your host’s environment variables.';
    console.warn(
      '⚠️ BOT_ROLE_APPLICANT_ID and BOT_ROLE_APPLICANT_NAME are unset in process.env. ' +
        `/check will look for a role named [APPLICANT].${railwayHint}`
    );
  } else if (!applicantId && applicantName) {
    console.log(`✅ Applicant role: name="${applicantName}" (BOT_ROLE_APPLICANT_ID unset)`);
  } else if (applicantId) {
    console.log(`✅ Applicant role: id(s) configured (${applicantId.split(',').length} segment(s))`);
  }
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  const body = commands.map((c) => c.toJSON());
  const guildId = process.env.GUILD_ID?.trim();
  const cmdNames = body.map((c) => c.name);
  const hasAccept = cmdNames.includes('accept');
  console.log(
    `📋 Slash command payload: ${body.length} commands, /accept in list: ${hasAccept}`
  );
  try {
    // When developing with GUILD_ID, old global commands still show in Discord (duplicate /check, etc.).
    // Clear globals unless CLEAR_GLOBAL_COMMANDS=false (e.g. you need the same bot in multiple servers).
    if (guildId && process.env.CLEAR_GLOBAL_COMMANDS !== 'false') {
      await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
      console.log('✅ Cleared global slash commands (set CLEAR_GLOBAL_COMMANDS=false to skip)');
    }
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
      console.log(`✅ Slash commands registered to guild ${guildId} (should appear in ~1 minute)`);
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body });
      console.log('✅ Slash commands registered globally');
      console.warn(
        '⚠️ GUILD_ID is unset — new/changed commands (e.g. /accept) can take **up to ~1 hour** to show in servers. ' +
          'Set GUILD_ID in Railway to your server ID for **instant** guild registration.'
      );
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    for (const h of buttonHandlers) {
      try {
        if (await h(interaction)) return;
      } catch (err) {
        console.error('Button handler error:', err);
        if (err?.stack) console.error(err.stack);
      }
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const run = handlers[interaction.commandName];
  if (!run) return;
  try {
    await run(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    if (err?.stack) console.error(err.stack);
    const hint =
      process.env.BOT_SHOW_ERRORS === 'true'
        ? `\n\`${String(err?.message || err).slice(0, 450)}\``
        : '';
    const msg = {
      content: `❌ Something went wrong. Please try again.${hint}`,
      flags: MessageFlags.Ephemeral,
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply(msg);
    } catch (_) {
      /* ignore */
    }
  }
});

client.login(process.env.BOT_TOKEN);
