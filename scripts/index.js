require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
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

client.once('ready', async () => {
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
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  const body = commands.map((c) => c.toJSON());
  const guildId = process.env.GUILD_ID;
  try {
    // When developing with GUILD_ID, old global commands still show in Discord (duplicate /check, etc.).
    // Clear globals unless CLEAR_GLOBAL_COMMANDS=false (e.g. you need the same bot in multiple servers).
    if (guildId && process.env.CLEAR_GLOBAL_COMMANDS !== 'false') {
      await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
      console.log('✅ Cleared global slash commands (set CLEAR_GLOBAL_COMMANDS=false to skip)');
    }
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
      console.log(`✅ Slash commands registered to guild ${guildId} (instant)`);
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body });
      console.log('✅ Slash commands registered globally');
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
