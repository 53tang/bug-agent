"use strict";

require("dotenv").config({ path: ".envrc" }); // Load .envrc
const express = require("express");
const { createPrFetchScheduler } = require("./prScheduler");
const { analyzePR } = require("./src/analysis");
const { getAuthHeader } = require("./src/config");
const { fetchJson } = require("./src/bitbucket");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "bug-agent" });
});

app.post("/analyze", async (req, res) => {
  console.log("\n=== PR Analysis Requested ===");

  try {
    const { prUrl } = req.body;

    if (!prUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing prUrl in request body",
      });
    }

    // Send immediate response
    res.status(200).json({
      success: true,
      message: "PR analysis started",
    });

    // Process analysis asynchronously
    try {
      const result = await analyzePR(prUrl);
      console.log("\n=== Analysis Complete ===");
      console.log(`PR #${result.prId}: ${result.prTitle}`);
      console.log("Analysis completed");
    } catch (error) {
      console.error("\n=== Analysis Failed ===");
      console.error("Error:", error.message);
      if (error.stack) {
        console.error("Stack:", error.stack);
      }
    }
  } catch (error) {
    console.error("Error in /analyze endpoint:", error.message);
    // Response already sent, so just log
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const prFetchScheduler = createPrFetchScheduler({
  getAuthHeader,
  fetchJson,
  workspace: process.env.BITBUCKET_WORKSPACE,
  intervalMs: process.env.PR_FETCH_INTERVAL_MS,
  authorUuids: process.env.PR_AUTHOR_UUIDS,
  analyzePR,
  logger: console,
});
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Bug Agent Server Started`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /analyze - Manual PR analysis`);
  console.log(`  GET  /health  - Health check`);
  console.log(`\n✨ Ready to analyze PRs!\n`);
});

prFetchScheduler.start();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down gracefully...");
  prFetchScheduler.stop();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down gracefully...");
  prFetchScheduler.stop();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

module.exports = { app, analyzePR };
