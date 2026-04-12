# Deploying the bot (24/7)

The bot runs on **your host’s servers** (e.g. **Railway**), not on your PC. Once deployed, you can close your computer; the process keeps running until you stop or delete the service.

## Railway

1. **Push this repo to GitHub** (including `package.json`, `scripts/index.js`, `railway.toml`, and root `index.js` if present).
2. **Create a Railway project** → Deploy from repo → pick the repo.
3. **Start command** (important):
   - Prefer leaving it empty so Railway uses **`npm start`** from `package.json`, **or**
   - Set explicitly to: `npm start`  
   - Do **not** use `node index.js` unless the root `index.js` file is committed.
4. **Variables**: add at least `BOT_TOKEN`, `DATABASE_URL`, and any other vars from your local `.env` (Railway does not read `.env` from the repo).
5. Redeploy after changing env or start command.

`railway.toml` in this repo sets `startCommand = "npm start"` so the app always runs `node scripts/index.js`.

## Troubleshooting `Cannot find module '/app/index.js'`

That means the platform ran `node index.js` but there was no `index.js` in the deployed files. Fix by:

- Using **`npm start`** as the start command, **or**
- Committing the root **`index.js`** that `require()`s `./scripts/index.js`, **or**
- Setting start command to **`node scripts/index.js`**.

## Local vs production

- **Local**: `npm start` or `node scripts/index.js` from the project folder (optionally with `.env`).
- **Production**: same command on Railway; secrets only in Railway **Variables**, not in git.
