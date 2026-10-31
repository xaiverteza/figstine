require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null;
const OWNER_ID = "1488177833925808318";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID. Set them in your hosting secrets or local .env file.");
  process.exit(1);
}

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "figstine.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    character TEXT NOT NULL,
    rarity TEXT NOT NULL DEFAULT 'Common',
    image_url TEXT,
    description TEXT NOT NULL DEFAULT '',
    variant TEXT NOT NULL DEFAULT 'Standard',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS inventory (
    user_id TEXT NOT NULL,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    first_obtained TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    coins INTEGER NOT NULL DEFAULT 0,
    last_daily TEXT,
    claimed_drops INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS active_drops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    claimed_by TEXT,
    expires_at INTEGER NOT NULL
  );
`);

const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Shiny"];
const RARITY_COLORS = {
  Common: 0xC8C8D0,
  Uncommon: 0x91D7B0,
  Rare: 0x91C7FF,
  Epic: 0xC9A0FF,
  Legendary: 0xFFD36E,
  Mythic: 0xFF9DCB,
  Shiny: 0x8DEBDF
};
const rarityChoices = RARITIES.map(rarity => ({ name: rarity, value: rarity }));

function ensureUser(userId) {
  db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").run(userId);
}

function getCard(cardId) {
  return db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId);
}

function cardEmbed(card, footerText = "Figstine • Collect them all!") {
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLORS[card.rarity] || 0xF4B8D4)
    .setTitle(card.name)
    .setDescription([
      `**Character:** ${card.character}`,
      `**Rarity:** ${card.rarity}`,
      `**Variant:** ${card.variant || "Standard"}`,
      card.description || ""
    ].filter(Boolean).join("\n"))
    .setFooter({ text: footerText });

  if (card.image_url) embed.setImage(card.image_url);
  return embed;
}

function weightedCard() {
  const cards = db.prepare("SELECT * FROM cards").all();
  if (!cards.length) return null;

  const weights = {
    Common: 50,
    Uncommon: 25,
    Rare: 14,
    Epic: 7,
    Legendary: 3,
    Mythic: 1,
    Shiny: 1
  };

  const pool = [];
  for (const card of cards) {
    const count = Math.max(1, weights[card.rarity] || 1);
    for (let i = 0; i < count; i++) pool.push(card);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show Figstine commands"),

  new SlashCommandBuilder()
    .setName("drop")
    .setDescription("Drop a collectible card (server moderators only)"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim the latest active card drop"),

  new SlashCommandBuilder()
    .setName("collection")
    .setDescription("View your collection or another member's")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Whose collection to view")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Collect your daily Figstine coins"),

  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a collector profile")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Whose profile to view")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("cardcreate")
    .setDescription("Create a card (bot owner only)")
    .addStringOption(option =>
      option.setName("name").setDescription("Card display name").setRequired(true).setMaxLength(80)
    )
    .addStringOption(option =>
      option.setName("character").setDescription("Character or figurine name").setRequired(true).setMaxLength(80)
    )
    .addStringOption(option =>
      option.setName("rarity").setDescription("Card rarity").setRequired(true).addChoices(...rarityChoices)
    )
    .addStringOption(option =>
      option.setName("image_url").setDescription("Direct image URL (optional)").setRequired(false).setMaxLength(500)
    )
    .addStringOption(option =>
      option.setName("description").setDescription("Card description (optional)").setRequired(false).setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("customize")
    .setDescription("Customize a card (bot owner only)")
    .addIntegerOption(option =>
      option.setName("card_id").setDescription("Card ID to edit").setRequired(true).setMinValue(1)
    )
    .addStringOption(option =>
      option.setName("name").setDescription("New card name").setRequired(false).setMaxLength(80)
    )
    .addStringOption(option =>
      option.setName("rarity").setDescription("New rarity").setRequired(false).addChoices(...rarityChoices)
    )
    .addStringOption(option =>
      option.setName("image_url").setDescription("New direct image URL").setRequired(false).setMaxLength(500)
    )
    .addStringOption(option =>
      option.setName("description").setDescription("New description").setRequired(false).setMaxLength(500)
    )
    .addStringOption(option =>
      option.setName("variant").setDescription("Variant label, e.g. Holographic").setRequired(false).setMaxLength(60)
    )
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash commands.`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Figstine is online as ${client.user.tag}`);
  client.user.setActivity("collectible cards • /help");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;

  try {
    if (commandName === "help") {
      const embed = new EmbedBuilder()
        .setColor(0xF4B8D4)
        .setTitle("🎀 Figstine — Collector Guide")
        .setDescription("Collect cute character cards and figurines!")
        .addFields(
          { name: "🎴 Drops", value: "`/drop` starts a drop (moderators). Use `/claim` to collect it." },
          { name: "📚 Collection", value: "`/collection` shows your cards and duplicates." },
          { name: "🪙 Rewards", value: "`/daily` claims coins; `/profile` shows collector stats." },
          { name: "🛠️ Owner tools", value: "`/cardcreate` and `/customize` are restricted to the bot owner." }
        )
        .setFooter({ text: "More collecting features can be added in later stages." });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === "cardcreate" || commandName === "customize") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          content: "🔒 Only the Figstine bot owner can use card customization tools.",
          ephemeral: true
        });
      }

      if (commandName === "cardcreate") {
        const name = interaction.options.getString("name", true);
        const character = interaction.options.getString("character", true);
        const rarity = interaction.options.getString("rarity", true);
        const imageUrl = interaction.options.getString("image_url");
        const description = interaction.options.getString("description") || "";

        if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
          return interaction.reply({ content: "Please provide a valid HTTP or HTTPS image URL.", ephemeral: true });
        }

        const result = db.prepare(`
          INSERT INTO cards (name, character, rarity, image_url, description, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, character, rarity, imageUrl, description, interaction.user.id);

        const card = getCard(Number(result.lastInsertRowid));
        return interaction.reply({
          content: `Created card #${card.id} — **${card.name}**`,
          embeds: [cardEmbed(card)]
        });
      }

      const cardId = interaction.options.getInteger("card_id", true);
      const oldCard = getCard(cardId);

      if (!oldCard) {
        return interaction.reply({ content: "That card ID does not exist.", ephemeral: true });
      }

      const imageUrl = interaction.options.getString("image_url");
      if (imageUrl && !/^https?:\\/\\//i.test(imageUrl)) {
        return interaction.reply({ content: "Please provide a valid HTTP or HTTPS image URL.", ephemeral: true });
      }

      const updated = {
        ...oldCard,
        name: interaction.options.getString("name") ?? oldCard.name,
        rarity: interaction.options.getString("rarity") ?? oldCard.rarity,
        image_url: imageUrl ?? oldCard.image_url,
        description: interaction.options.getString("description") ?? oldCard.description,
        variant: interaction.options.getString("variant") ?? oldCard.variant
      };

      db.prepare(`
        UPDATE cards
        SET name = ?, rarity = ?, image_url = ?, description = ?, variant = ?
        WHERE id = ?
      `).run(updated.name, updated.rarity, updated.image_url, updated.description, updated.variant, cardId);

      return interaction.reply({
        content: `Updated card #${cardId}.`,
        embeds: [cardEmbed(updated)]
      });
    }

    if (commandName === "drop") {
      if (!interaction.inGuild() ||
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: "You need the **Manage Server** permission to start a drop.",
          ephemeral: true
        });
      }

      const card = weightedCard();
      if (!card) {
        return interaction.reply({
          content: "No cards exist yet. Ask the bot owner to create cards first.",
          ephemeral: true
        });
      }

      const expiresAt = Math.floor(Date.now() / 1000) + 120;
      const insert = db.prepare(`
        INSERT INTO active_drops (card_id, channel_id, expires_at)
        VALUES (?, ?, ?)
      `).run(card.id, interaction.channelId, expiresAt);

      const embed = cardEmbed(card, "Use /claim within 2 minutes to collect this card!");
      embed.setTitle(`🎴 A card appeared! • #${card.id}`);

      await interaction.reply({ content: "A wild Figstine appeared!", embeds: [embed] });
      const message = await interaction.fetchReply();

      db.prepare("UPDATE active_drops SET message_id = ? WHERE id = ?")
        .run(message.id, Number(insert.lastInsertRowid));
      return;
    }

    if (commandName === "claim") {
      const now = Math.floor(Date.now() / 1000);
      const drop = db.prepare(`
        SELECT * FROM active_drops
        WHERE claimed_by IS NULL AND expires_at > ?
        ORDER BY id DESC LIMIT 1
      `).get(now);

      if (!drop) {
        return interaction.reply({
          content: "There isn't an active card drop right now. Keep an eye out!",
          ephemeral: true
        });
      }

      const claimResult = db.prepare(`
        UPDATE active_drops SET claimed_by = ?
        WHERE id = ? AND claimed_by IS NULL
      `).run(interaction.user.id, drop.id);

      if (!claimResult.changes) {
        return interaction.reply({
          content: "Someone just claimed that drop. Try the next one!",
          ephemeral: true
        });
      }

      const card = getCard(drop.card_id);
      const previous = db.prepare(
        "SELECT quantity FROM inventory WHERE user_id = ? AND card_id = ?"
      ).get(interaction.user.id, card.id);

      db.prepare(`
        INSERT INTO inventory (user_id, card_id, quantity)
        VALUES (?, ?, 1)
        ON CONFLICT(user_id, card_id)
        DO UPDATE SET quantity = quantity + 1
      `).run(interaction.user.id, card.id);

      ensureUser(interaction.user.id);
      db.prepare("UPDATE users SET claimed_drops = claimed_drops + 1 WHERE user_id = ?")
        .run(interaction.user.id);

      return interaction.reply({
        content: `🎉 ${interaction.user} claimed **${card.name}**!${previous ? " It's a duplicate — keep collecting!" : ""}`,
        embeds: [cardEmbed(card)]
      });
    }

    if (commandName === "collection") {
      const target = interaction.options.getUser("member") || interaction.user;
      const cards = db.prepare(`
        SELECT c.id, c.name, c.character, c.rarity, c.variant, i.quantity
        FROM inventory i
        JOIN cards c ON c.id = i.card_id
        WHERE i.user_id = ?
        ORDER BY c.id DESC
        LIMIT 25
      `).all(target.id);

      const total = db.prepare(
        "SELECT COALESCE(SUM(quantity), 0) AS count FROM inventory WHERE user_id = ?"
      ).get(target.id).count;

      const embed = new EmbedBuilder()
        .setColor(0xF4B8D4)
        .setTitle(`📚 ${target.username}'s Collection`)
        .setDescription(cards.length
          ? cards.map(card =>
              `**#${card.id} ${card.name}** · ${card.rarity} · ×${card.quantity}`
            ).join("\n")
          : "No cards yet. Watch for a drop and use `/claim`!")
        .setFooter({ text: `${total} total cards • showing up to 25 unique cards` });

      return interaction.reply({
        embeds: [embed],
        ephemeral: target.id === interaction.user.id
      });
    }

    if (commandName === "daily") {
      ensureUser(interaction.user.id);
      const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(interaction.user.id);
      const today = new Date().toISOString().slice(0, 10);

      if (user.last_daily === today) {
        return interaction.reply({
          content: "🌙 You've already claimed daily coins. Come back after the next UTC day!",
          ephemeral: true
        });
      }

      db.prepare("UPDATE users SET coins = coins + 100, last_daily = ? WHERE user_id = ?")
        .run(today, interaction.user.id);

      return interaction.reply({
        content: "🪙 You received **100 coins**! Come back tomorrow for another daily reward."
      });
    }

    if (commandName === "profile") {
      const target = interaction.options.getUser("member") || interaction.user;
      ensureUser(target.id);

      const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(target.id);
      const stats = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS total, COUNT(*) AS unique_count
        FROM inventory WHERE user_id = ?
      `).get(target.id);

      const embed = new EmbedBuilder()
        .setColor(0xF4B8D4)
        .setTitle(`✨ ${target.username}'s Collector Profile`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "🪙 Coins", value: String(user.coins), inline: true },
          { name: "🎴 Total cards", value: String(stats.total), inline: true },
          { name: "💗 Unique cards", value: String(stats.unique_count), inline: true },
          { name: "🎁 Drops claimed", value: String(user.claimed_drops), inline: true }
        );

      return interaction.reply({
        embeds: [embed],
        ephemeral: target.id === interaction.user.id
      });
    }
  } catch (error) {
    console.error(`Command ${commandName} failed:`, error);
    const reply = {
      content: "Something went wrong while running that command. Please try again.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

(async () => {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error("Figstine failed to start:", error);
    process.exit(1);
  }
})();
