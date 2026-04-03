import fs from 'node:fs';
import path from 'node:path';
import {
  getTodayAnalysisDir,
  isPrAnalyzedToday,
  getAnalyzedCommitHash,
  saveAnalyzedCommit,
} from './analysis-state';
import type { PrData, AnalyzePRFn, Logger } from './types';

const PR_ANALYSIS_QUEUE_INTERVAL_MS = 2 * 60 * 1000;
const MAX_DAILY_ANALYSIS_COUNT = 20;
const RETRY_DELAY_MS = 60 * 1000;
const MAX_RETRY_ATTEMPTS = 2;

/** e.g. `10 min 0 s`, `2 min 30 s`. */
function formatIntervalDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min} min ${sec} s`;
}

async function analyzeWithRetry(
  prUrl: string,
  analyzePR: AnalyzePRFn,
  logger: Logger,
  prData: PrData,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const attemptStartMs = Date.now();
    try {
      logger.log(`[retry] Analyzing PR (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
      await analyzePR(prUrl);
      return;
    } catch (error) {
      lastError = error as Error;
      logger.error(`[retry] Attempt ${attempt} failed:`, (error as Error).message);

      if (
        (error as Error).message &&
        (error as Error).message.includes('GenerateContentInputTokensPerModelPerMinute-FreeTier')
      ) {
        logger.warn(`[retry] Rate limit detected. Saving partial analysis without retry.`);

        try {
          const todayDir = getTodayAnalysisDir(false);
          if (!fs.existsSync(todayDir)) {
            fs.mkdirSync(todayDir, { recursive: true });
          }

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `pr-${prData.id}-${timestamp}.json`;
          const filepath = path.join(todayDir, filename);

          const dataToSave = {
            prId: prData.id,
            repoFullName: prData.source?.repository?.full_name || 'unknown',
            prTitle: prData.title || 'unknown',
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - attemptStartMs,
            error: 'Rate limit reached',
            errorMessage: (error as Error).message,
            analysis: {
              summary: 'Analysis failed due to rate limit',
              bugs: [],
              notBugs: [],
            },
          };

          fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
          logger.log(`[retry] Saved partial analysis to: ${filepath}`);
        } catch (saveError) {
          logger.error(`[retry] Failed to save partial analysis:`, (saveError as Error).message);
        }

        return;
      }

      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.log(`[retry] Waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw lastError;
}

export class PrAnalysisQueue {
  private queue: PrData[] = [];
  private analyzePR: AnalyzePRFn;
  private onAnalysisComplete?: (createdOn: string) => void;
  private logger: Logger;
  private isProcessing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dailyCount = 0;
  private lastResetDate: string;

  constructor({
    analyzePR,
    onAnalysisComplete,
    logger = console,
  }: {
    analyzePR: AnalyzePRFn;
    onAnalysisComplete?: (createdOn: string) => void;
    logger?: Logger;
  }) {
    this.analyzePR = analyzePR;
    this.onAnalysisComplete = onAnalysisComplete;
    this.logger = logger;
    this.lastResetDate = new Date().toISOString().split('T')[0];
  }

  add(pr: PrData): void {
    if (isPrAnalyzedToday(pr.id)) {
      const currentHash = pr.source?.commit?.hash;
      const analyzedHash = getAnalyzedCommitHash(pr.id);
      if (!currentHash || !analyzedHash || currentHash === analyzedHash) {
        this.logger.log(`[queue] PR #${pr.id} already analyzed today, skipping`);
        return;
      }
      this.logger.log(
        `[queue] PR #${pr.id} has new commits (${analyzedHash.slice(0, 8)} -> ${currentHash.slice(0, 8)}), queuing re-analysis`,
      );
      this.queue = this.queue.filter((queuedPr) => queuedPr.id !== pr.id);
      this.queue.push(pr);
      return;
    }

    const exists = this.queue.some((queuedPr) => queuedPr.id === pr.id);
    if (!exists) {
      this.queue.push(pr);
      this.logger.log(
        `[queue] Added PR #${pr.id} to analysis queue. Queue size: ${this.queue.length}`,
      );
    }
  }

  private resetDailyCountIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyCount = 0;
      this.lastResetDate = today;
      this.logger.log(`[queue] Daily analysis count reset for ${today}`);
    }
  }

  async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.resetDailyCountIfNeeded();

    if (this.dailyCount >= MAX_DAILY_ANALYSIS_COUNT) {
      this.logger.log(
        `[queue] Daily limit reached (${MAX_DAILY_ANALYSIS_COUNT}). Skipping analysis.`,
      );
      return;
    }

    this.isProcessing = true;
    const pr = this.queue.shift()!;

    try {
      this.logger.log(
        `[queue] Processing PR #${pr.id} (${this.dailyCount + 1}/${MAX_DAILY_ANALYSIS_COUNT} today)`,
      );

      let prUrl = pr.links?.html?.href;
      if (!prUrl && pr.links?.self?.href) {
        prUrl = pr.links.self.href
          .replace('https://api.bitbucket.org/2.0/repositories/', 'https://bitbucket.org/')
          .replace('/pullrequests/', '/pull-requests/');
      }

      if (!prUrl) {
        this.logger.error(`[queue] Could not construct PR URL for PR #${pr.id}`);
        return;
      }

      await analyzeWithRetry(prUrl, this.analyzePR, this.logger, pr);
      this.dailyCount++;

      const commitHash = pr.source?.commit?.hash;
      if (commitHash) {
        saveAnalyzedCommit(pr.id, commitHash);
      }

      if (this.onAnalysisComplete && pr.created_on) {
        this.onAnalysisComplete(pr.created_on);
      }

      this.logger.log(
        `[queue] Successfully analyzed PR #${pr.id}. Queue remaining: ${this.queue.length}`,
      );
    } catch (error) {
      this.logger.error(`[queue] Failed to analyze PR #${pr.id}:`, (error as Error).message);
    } finally {
      this.isProcessing = false;
    }
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.logger.log(
      `[queue] Starting PR analysis queue (processing every ${formatIntervalDuration(PR_ANALYSIS_QUEUE_INTERVAL_MS)})`,
    );
    this.timer = setInterval(() => this.processNext(), PR_ANALYSIS_QUEUE_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    if (this.queue.length > 0) {
      this.processNext();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log(`[queue] Stopped PR analysis queue`);
    }
  }

  getStatus(): {
    queueSize: number;
    dailyCount: number;
    maxDaily: number;
    isProcessing: boolean;
  } {
    return {
      queueSize: this.queue.length,
      dailyCount: this.dailyCount,
      maxDaily: MAX_DAILY_ANALYSIS_COUNT,
      isProcessing: this.isProcessing,
    };
  }
}
