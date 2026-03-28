const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();
app.use(express.json());

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

app.post("/scrim-result", async (req, res) => {
  console.log("Incoming request body:", JSON.stringify(req.body));

  const secret = req.headers["x-scrimbot-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const data = req.body;
    const channel = await client.channels.fetch(CHANNEL_ID);

    // ── Series end ──────────────────────────────────────────────────────────
    if (data.type === "series_end") {
      const winnerText = data.seriesWinner === "Tied"
        ? "Series ended in a **tie**!"
        : `**${data.seriesWinner}** wins the series!`;

      const color = data.seriesWinner === "Blue" ? 0x3498db
                  : data.seriesWinner === "Orange" ? 0xe67e22
                  : 0x95a5a6;

      const embed = new EmbedBuilder()
        .setTitle("🏆 Series Over")
        .setColor(color)
        .setDescription(
          `${winnerText}\n` +
          `**Final:** Blue ${data.blueSeriesWins} - ${data.orangeSeriesWins} Orange\n` +
          `**Games played:** ${data.gamesPlayed}`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log("Sent series-end embed");
      return res.json({ ok: true });
    }

    // ── Match end ────────────────────────────────────────────────────────────
    const winnerText = data.winnerSide === "Unknown"
      ? "Draw / Unknown"
      : `**${data.winnerSide}** wins!`;

    const color = data.winnerSide === "Blue" ? 0x3498db
                : data.winnerSide === "Orange" ? 0xe67e22
                : 0x95a5a6;

    const embed = new EmbedBuilder()
      .setTitle(`Game ${data.gameInSeries} — ${data.mapKey}`)
      .setColor(color)
      .setDescription(
        `${winnerText} **Score:** ${data.blueGoals} - ${data.orangeGoals}  ` +
        `**Series:** Blue ${data.blueSeriesWins} - ${data.orangeSeriesWins} Orange`
      )
      .addFields(
        { name: "Map",       value: data.mapKey || "Unknown",          inline: true },
        { name: "Team Size", value: `${data.teamSize}v${data.teamSize}`, inline: true },
        { name: "Best Of",   value: String(data.bestOf),               inline: true }
      )
      .setTimestamp();

    const bluePlayers   = (data.players || []).filter(p => p.teamNum === 0);
    const orangePlayers = (data.players || []).filter(p => p.teamNum === 1);

    // Score column added, sorted by matchScore descending within each team
    const formatTeam = (players) => {
      if (players.length === 0) return "No data";
      return [...players]
        .sort((a, b) => b.matchScore - a.matchScore)
        .map(p =>
          `**${p.playerName}** — ${p.matchScore}pts  ${p.goals}G ${p.assists}A ${p.saves}Sv ${p.shots}Sh`
        )
        .join("\n");
    };

    embed.addFields(
      { name: "🔵 Blue Team",   value: formatTeam(bluePlayers),   inline: false },
      { name: "🟠 Orange Team", value: formatTeam(orangePlayers), inline: false }
    );

    // Spreadsheet-ready block (paste directly into Sheets/Excel)
    if (data.spreadsheetText) {
      const spreadsheetBlock = data.spreadsheetText
        .trimEnd()
        .replace(/,/g, "\t"); // only do this if your incoming text is CSV-style
    
      embed.addFields({
        name: "📋 Copy → Paste into Sheets/Excel",
        value: "```txt\n" + spreadsheetBlock + "\n```",
        inline: false
      });
    }

    await channel.send({ embeds: [embed] });
    console.log("Sent match-end embed");
    res.json({ ok: true });

  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Webhook listening on port ${PORT}`));
client.login(TOKEN);
