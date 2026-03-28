const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require("discord.js");
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

function buildSpreadsheetText(data) {
  const players = Array.isArray(data.players) ? [...data.players] : [];

  players.sort((a, b) => {
    if ((a.teamNum ?? 99) !== (b.teamNum ?? 99)) {
      return (a.teamNum ?? 99) - (b.teamNum ?? 99);
    }
    return (b.matchScore ?? 0) - (a.matchScore ?? 0);
  });

  const rows = [];

  rows.push([
    "Game",
    "Winner",
    "SeriesScore",
    "Player",
    "Team",
    "Score",
    "Goals",
    "Assists",
    "Saves",
    "Shots",
    "BlueGoals",
    "OrangeGoals"
  ].join("\t"));

  for (const p of players) {
    const teamLabel =
      p.teamNum === 0 ? "Blue" :
      p.teamNum === 1 ? "Orange" :
      "Unknown";

    rows.push([
      data.gameInSeries ?? "",
      data.winnerSide ?? "",
      data.seriesScore ?? "",
      p.playerName ?? "",
      teamLabel,
      p.matchScore ?? "",
      p.goals ?? "",
      p.assists ?? "",
      p.saves ?? "",
      p.shots ?? "",
      data.blueGoals ?? "",
      data.orangeGoals ?? ""
    ].join("\t"));
  }

  return rows.join("\n");
}

app.post("/scrim-result", async (req, res) => {
  console.log("Incoming request body:", JSON.stringify(req.body));

  const secret = req.headers["x-scrimbot-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const data = req.body;
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      throw new Error("Invalid or non-text channel");
    }

    // ── Series end ──────────────────────────────────────────────────────────
    if (data.type === "series_end") {
      const blueName   = data.blueTeamName   || "Blue";
      const orangeName = data.orangeTeamName || "Orange";
      const winnerText = data.seriesWinner === "Tied"
        ? "Series ended in a **tie**!"
        : `**${data.seriesWinner}** wins the series!`;

      const color = data.seriesWinner === blueName   ? 0x3498db
                  : data.seriesWinner === orangeName ? 0xe67e22
                  : 0x95a5a6;

      const embed = new EmbedBuilder()
        .setTitle("🏆 Series Over")
        .setColor(color)
        .setDescription(
          `${winnerText}\n` +
          `**Final Series Score:** ${blueName} ${data.blueSeriesWins} - ${data.orangeSeriesWins} ${orangeName}\n` +
          `**Games Played:** ${data.gamesPlayed}`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      // Attach combined TSV for the whole series if data was provided.
      if (data.combinedTsv) {
        const attachment = new AttachmentBuilder(
          Buffer.from(data.combinedTsv, "utf8"),
          { name: `scrim-series-all-games.tsv` }
        );
        await channel.send({
          content: "📋 Combined spreadsheet for all games in this series",
          files: [attachment]
        });
      }

      console.log("Sent series-end embed and combined TSV attachment");
      return res.json({ ok: true });
    }

    // ── Match end ────────────────────────────────────────────────────────────
    const blueName   = data.blueTeamName   || "Blue";
    const orangeName = data.orangeTeamName || "Orange";
    
    const winnerText = data.winnerSide === "Unknown"
      ? "Draw / Unknown Result"
      : `**${data.winnerSide}** wins`;   // winnerSide now already holds the custom name
    
    const color = data.winnerSide === blueName   ? 0x3498db
                : data.winnerSide === orangeName ? 0xe67e22
                : 0x95a5a6;

    const embed = new EmbedBuilder()
      .setTitle(`Game ${data.gameInSeries ?? "?"} Result`)
      .setColor(color)
      .setDescription(
        `${winnerText}\n` +
        `**Score:** ${blueName} ${data.blueGoals ?? 0} - ${data.orangeGoals ?? 0} ${orangeName}\n` +
        `**Series:** ${blueName} ${data.blueSeriesWins ?? 0} - ${data.orangeSeriesWins ?? 0} ${orangeName}`
      )
      .setTimestamp();

    const bluePlayers = (data.players || []).filter(p => p.teamNum === 0);
    const orangePlayers = (data.players || []).filter(p => p.teamNum === 1);

    const formatTeam = (players) => {
      if (players.length === 0) return "No data";

      return [...players]
        .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
        .map(p =>
          `**${p.playerName ?? "Unknown"}** — ${p.matchScore ?? 0} pts | ${p.goals ?? 0}G ${p.assists ?? 0}A ${p.saves ?? 0}Sv ${p.shots ?? 0}Sh`
        )
        .join("\n");
    };

    embed.addFields(
      { name: `🔵 ${blueName}`, value: formatTeam(bluePlayers), inline: false },
      { name: `🟠 ${orangeName}`, value: formatTeam(orangePlayers), inline: false }
    );

    await channel.send({ embeds: [embed] });

    const spreadsheetText = buildSpreadsheetText(data);
    const attachment = new AttachmentBuilder(
      Buffer.from(spreadsheetText, "utf8"),
      { name: `scrim-game-${data.gameInSeries || "unknown"}.tsv` }
    );

    await channel.send({
      content: "📋 Spreadsheet file for Excel",
      files: [attachment]
    });

    console.log("Sent match-end embed and spreadsheet attachment");
    res.json({ ok: true });

  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Webhook listening on port ${PORT}`));
client.login(TOKEN);
