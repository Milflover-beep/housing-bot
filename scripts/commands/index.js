const pool = require('../lib/pool');
const helpers = require('../lib/helpers');
const permissions = require('../lib/permissions');

const modules = [
  require('./core'),
  require('./applications'),
  require('./tier'),
  require('./blacklist'),
  require('./watchlist'),
  require('./alts'),
  require('./pm'),
  require('./punishment'),
  require('./reports'),
  require('./fights'),
  require('./proxies'),
  require('./uuid'),
  require('./role'),
  require('./utility'),
  require('./discordExtras'),
];

function build() {
  const ctx = { pool, ...helpers, ...permissions };
  const commands = [];
  const handlers = {};
  const buttonHandlers = [];
  for (const load of modules) {
    const mod = load(ctx);
    commands.push(...mod.commands);
    Object.assign(handlers, mod.handlers);
    if (mod.buttonHandlers?.length) buttonHandlers.push(...mod.buttonHandlers);
  }
  return { commands, handlers, buttonHandlers };
}

module.exports = { build };
