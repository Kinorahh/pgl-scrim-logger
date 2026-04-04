const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const express = require("express");
const crypto  = require("crypto");

// ---------------------------------------------------------------------------
// Config from Railway environment variables
// ---------------------------------------------------------------------------
const TOKEN          = process.env.DISCORD_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const PORT           = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!TOKEN || !CHANNEL_ID) {
  console.error("Missing DISCORD_TOKEN or CHANNEL_ID environment variables.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Discord bot ready as ${client.user.tag}`);
});

async function getChannel() {
  const ch = await client.channels.fetch(CHANNEL_ID);
  if (!ch) throw new Error(`Channel ${CHANNEL_ID} not found`);
  return ch;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Verify HMAC-SHA256 signature sent by tray.py (optional but recommended). */
function verifySignature(rawBody, sigHeader) {
  if (!WEBHOOK_SECRET) return true; // skip if not configured
  try {
    const expected = "sha256=" + crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

const BLUE_COLOR   = 0x3b82f6; // Tailwind blue-500
const ORANGE_COLOR = 0xf97316; // Tailwind orange-500
const GOLD_COLOR   = 0xfbbf24; // Tailwind amber-400
const GREY_COLOR   = 0x6b7280;

function teamColor(winnerColor) {
  if (winnerColor === "blue")   return BLUE_COLOR;
  if (winnerColor === "orange") return ORANGE_COLOR;
  return GREY_COLOR;
}

/** Build a padded monospace leaderboard string for a set of players. */
function buildLeaderboardBlock(players, blueTeamName, orangeTeamName, blueGoals, orangeGoals) {
  const lines = [];

  const teamGoals = {};
  if (blueTeamName  !== undefined) teamGoals[blueTeamName]   = blueGoals;
  if (orangeTeamName !== undefined) teamGoals[orangeTeamName] = orangeGoals;

  let currentTeam = null;
  for (const p of players) {
    if (p.team_name !== currentTeam) {
      currentTeam = p.team_name;
      const score = teamGoals[currentTeam] !== undefined ? ` (${teamGoals[currentTeam]})` : "";
      lines.push(`── ${currentTeam}${score}`);
    }
    const mvp    = p.mvp        ? " ⭐" : "";
    const mvpC   = p.mvp_count  ? ` ⭐×${p.mvp_count}` : "";
    const mvpTag = mvp || mvpC;
    const name   = p.name.padEnd(18).slice(0, 18);
    const score  = String(p.score).padStart(5);
    const goals  = String(p.goals).padStart(2);
    const asst   = String(p.assists).padStart(2);
    const saves  = String(p.saves).padStart(2);
    const shots  = String(p.shots).padStart(2);
    lines.push(`${name} ${score}  ${goals}G ${asst}A ${saves}Sv ${shots}Sh${mvpTag}`);
  }
  return lines.join("\n");
}

/** Build a CSV string for the series summary. */
function buildSeriesCSV(series, players, matches) {
  const rows = [
    ["Series Summary"],
    ["Blue Team", series.blue_name],
    ["Orange Team", series.orange_name],
    ["Blue Wins", series.blue_wins],
    ["Orange Wins", series.orange_wins],
    ["Total Games", series.total_games],
    ["Series Winner", series.series_winner],
    [],
    ["Player Totals"],
    ["Team", "Player", "Score", "Goals", "Assists", "Saves", "Shots", "MVPs"],
  ];

  for (const p of players) {
    rows.push([
      p.team_name,
      p.name,
      p.score,
      p.goals,
      p.assists,
      p.saves,
      p.shots,
      p.mvp_count ?? 0,
    ]);
  }

  rows.push([], ["Per-Game Results"], ["Game #", "Blue", "Orange", "Blue Goals", "Orange Goals", "Winner"]);
  for (const m of matches) {
    rows.push([
      m.game_number ?? "",
      m.blue_name,
      m.orange_name,
      m.blue_goals,
      m.orange_goals,
      m.winner,
    ]);
  }

  return rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

// ---------------------------------------------------------------------------
// POST /game  — called by tray.py after each completed game
// ---------------------------------------------------------------------------
//
// Expected JSON body (mirrors save_match_json output):
// {
//   "match": { game_number, blue_name, orange_name, blue_goals, orange_goals, winner },
//   "players": [ { team_key, team_name, name, score, goals, assists, saves, shots, mvp } ],
//   "replay_id": "abc123"   <-- ballchasing replay ID (tray.py sends this)
// }
// ---------------------------------------------------------------------------

async function handleGame(body) {
  const { match, players, replay_id } = body;

  const replayUrl = replay_id
    ? `https://ballchasing.com/replay/${replay_id}`
    : null;

  const winnerColor = match.blue_goals > match.orange_goals ? "blue"
    : match.orange_goals > match.blue_goals ? "orange"
    : null;

  // Series score so far is not tracked server-side; tray sends it optionally
  const seriesLine = body.series_score
    ? `Series: **${body.series_score}**\n`
    : "";

  const lbText = buildLeaderboardBlock(players, match.blue_name, match.orange_name, match.blue_goals, match.orange_goals);

  const embed = new EmbedBuilder()
    .setColor(teamColor(winnerColor))
    .setTitle(`🎮  Game ${match.game_number}  —  ${match.blue_name}  vs  ${match.orange_name}`)
    .setDescription(
      `**Winner: ${match.winner}**\n` +
      `Score: **${match.blue_name} ${match.blue_goals} — ${match.orange_goals} ${match.orange_name}**\n` +
      seriesLine
    )
    .addFields({
      name: "📊  Leaderboard",
      value: "```\n" +
             "Player             Score  G  A  Sv  Sh\n" +
             "─────────────────────────────────────────\n" +
             lbText + "\n```",
    });

  if (replayUrl) {
    embed.addFields({ name: "🔗  Replay", value: `[View on Ballchasing](${replayUrl})` });
    embed.setURL(replayUrl);
  }

  embed.setTimestamp();

  const ch = await getChannel();
  await ch.send({ embeds: [embed] });
  console.log(`[game] Sent game ${match.game_number} to Discord.`);
}

// ---------------------------------------------------------------------------
// POST /series  — called by tray.py when the user clicks Stop Tracking
// ---------------------------------------------------------------------------
//
// Expected JSON body (mirrors save_series_json output):
// {
//   "series":  { blue_name, orange_name, blue_wins, orange_wins, total_games, series_winner },
//   "players": [ { team_key, team_name, name, score, goals, assists, saves, shots, mvp_count } ],
//   "matches": [ { game_number?, blue_name, orange_name, blue_goals, orange_goals, winner }, ... ]
// }
// ---------------------------------------------------------------------------

async function handleSeries(body) {
  const { series, players, matches } = body;

  const lbText = buildLeaderboardBlock(players, series.blue_name, series.orange_name);

  const embed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle(`🏆  Series Complete  —  ${series.blue_name}  vs  ${series.orange_name}`)
    .setDescription(
      `**Series Winner: ${series.series_winner}**\n` +
      `Final Series Score: **${series.blue_name} ${series.blue_wins} — ${series.orange_wins} ${series.orange_name}**\n` +
      `Games played: ${series.total_games}`
    )
    .addFields({
      name: "📊  Combined Leaderboard",
      value: "```\n" +
             "Player             Score  G  A  Sv  Sh  MVPs\n" +
             "──────────────────────────────────────────────\n" +
             lbText + "\n```",
    })
    .setTimestamp();

  // Per-game summary
  if (Array.isArray(matches) && matches.length > 0) {
    const gameLines = matches.map((m, i) => {
      const gn = m.game_number ?? i + 1;
      return `Game ${gn}: **${m.winner}** wins  (${m.blue_goals}–${m.orange_goals})`;
    });
    embed.addFields({ name: "🗒️  Game-by-Game", value: gameLines.join("\n") });
  }

  // Build CSV attachment
  const csvContent = buildSeriesCSV(series, players, matches ?? []);
  const safeBlue   = series.blue_name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeOrange = series.orange_name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const csvFile    = new AttachmentBuilder(Buffer.from(csvContent, "utf-8"), {
    name: `series_${safeBlue}_vs_${safeOrange}.csv`,
    description: "Full series stats CSV",
  });

  const ch = await getChannel();
  await ch.send({ embeds: [embed], files: [csvFile] });
  console.log(`[series] Sent series summary to Discord.`);
}

// ---------------------------------------------------------------------------
// Express webhook server
// ---------------------------------------------------------------------------
const app = express();

// We need raw body for signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

app.post("/game", async (req, res) => {
  const sig = req.headers["x-webhook-signature"] || "";
  if (!verifySignature(req.rawBody, sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  try {
    await handleGame(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error("[/game] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/series", async (req, res) => {
  const sig = req.headers["x-webhook-signature"] || "";
  if (!verifySignature(req.rawBody, sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  try {
    await handleSeries(req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error("[/series] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, "0.0.0.0", () => console.log(`Webhook listening on port ${PORT}`));
client.login(TOKEN);
