import dotenv from 'dotenv';
dotenv.config();
import express, { type Request, type Response } from 'express';
import { createPrFetchScheduler } from './prScheduler';
import { analyzePR } from './src/analysis';
import { DEFAULT_HTTP_PORT, getAuthHeader } from './src/config';
import { fetchJson } from './src/bitbucket';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'bug-agent' });
});

app.post('/analyze', async (req: Request, res: Response) => {
  console.log('\n=== PR Analysis Requested ===');

  try {
    const { prUrl } = req.body;

    if (!prUrl) {
      res.status(400).json({
        success: false,
        error: 'Missing prUrl in request body',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'PR analysis started',
    });

    try {
      const result = await analyzePR(prUrl);
      console.log('\n=== Analysis Complete ===');
      console.log(`PR #${result.prId}: ${result.prTitle}`);
      console.log(`Duration: ${result.durationMs}ms`);
    } catch (error) {
      console.error('\n=== Analysis Failed ===');
      console.error('Error:', (error as Error).message);
      if ((error as Error).stack) {
        console.error('Stack:', (error as Error).stack);
      }
    }
  } catch (error) {
    console.error('Error in /analyze endpoint:', (error as Error).message);
  }
});

const PORT = Number(process.env.PORT) || DEFAULT_HTTP_PORT;
const prFetchScheduler = createPrFetchScheduler({
  getAuthHeader,
  fetchJson,
  workspace: process.env.BITBUCKET_WORKSPACE,
  rawIntervalMs: process.env.PR_FETCH_INTERVAL_MS,
  authorUuids: process.env.PR_AUTHOR_UUIDS,
  analyzePR,
  logger: console,
});
const server = app.listen(PORT, () => {
  console.log(`\nBug Agent Server Started`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /analyze - Manual PR analysis`);
  console.log(`  GET  /health  - Health check`);
  console.log(`\nReady to analyze PRs!\n`);
});

prFetchScheduler.start();

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  prFetchScheduler.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  prFetchScheduler.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export { app, analyzePR };
