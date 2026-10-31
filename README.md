# Figstine — Discord Collectible Cards

This starter bot includes:
- `/drop` — moderators can spawn a random card
- `/claim` — claim an active card drop
- `/collection` — view card collection and duplicates
- `/daily` — claim daily coins
- `/profile` — view collector stats
- `/cardcreate` — create a card (bot owner only)
- `/customize` — edit a card (bot owner only)
- SQLite database for cards, collections, and user balances

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Set these secrets in your hosting provider, or create a local `.env` file:

   - `DISCORD_TOKEN` — bot token
   - `CLIENT_ID` — Discord application ID
   - `GUILD_ID` — optional test server ID (recommended while testing)

4. Invite your bot using the `bot` and `applications.commands` scopes.
5. Run `npm start`.

If `GUILD_ID` is set, commands register in that server for faster testing. Otherwise, they register globally and may take longer to appear.

## Owner-only customization

The `/cardcreate` and `/customize` commands check the caller's Discord user ID against `1488177833925808318` in the bot code. Other users cannot use these commands.

## Persistence and secrets

- Never commit `.env` or a bot token to GitHub.
- The SQLite database is stored in `data/figstine.sqlite`.
- Deploy on a host with a persistent disk/volume or an external database. Ephemeral hosting storage can be erased during restarts or redeployments.
- GitHub stores the source code; it does not keep a Discord bot running by itself.
