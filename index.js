const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // optional basic auth

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();
app.use(express.json());

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

app.post("/scrim-result", async (req, res) => {
  // Optional: simple secret check
  const secret = req.headers["x-scrimbot-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const data = req.body;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    const winnerText = data.winnerSide === "Unknown"
      ? "Draw / Unknown"
      : `**${data.winnerSide}** wins!`;

    const embed = new EmbedBuilder()
      .setTitle(`Game ${data.gameInSeries} — ${data.mapKey}`)
      .setColor(data.winnerSide === "Blue" ? 0x3498db : data.winnerSide === "Orange" ? 0xe67e22 : 0x95a5a6)
      .setDescription(`${winnerText}\n**Score:** ${data.blueGoals} - ${data.orangeGoals}\n**Series:** Blue ${data.blueSeriesWins} - ${data.orangeSeriesWins} Orange`)
      .addFields(
        { name: "Map", value: data.mapKey, inline: true },
        { name: "Team Size", value: `${data.teamSize}v${data.teamSize}`, inline: true },
        { name: "Best Of", value: `${data.bestOf}`, inline: true }
      )
      .setTimestamp();

    // Add player stats table per team
    const bluePlayers = data.players.filter(p => p.teamNum === 0);
    const orangePlayers = data.players.filter(p => p.teamNum === 1);

    const formatTeam = (players) =>
      players.length === 0
        ? "No data"
        : players.map(p =>
            `**${p.playerName}** — ${p.goals}G ${p.assists}A ${p.saves}Sv ${p.shots}Sh`
          ).join("\n");

    embed.addFields(
      { name: "🔵 Blue Team", value: formatTeam(bluePlayers), inline: false },
      { name: "🟠 Orange Team", value: formatTeam(orangePlayers), inline: false }
    );

    await channel.send({ embeds: [embed] });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to send message:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Webhook listening on port ${PORT}`));
client.login(TOKEN);
