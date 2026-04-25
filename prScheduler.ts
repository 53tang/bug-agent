import {
  initializeLatestTimestamp,
  migratePrAnalysisFiles,
  saveLatestTimestamp,
  loadUpdateTimestamp,
  saveUpdateTimestamp,
} from './src/scheduler/analysis-state';
import { PrAnalysisQueue } from './src/scheduler/analysis-queue';
import {
  fetchTodaysPullRequests,
  fetchUpdatedPullRequests,
  isIgnoredRepo,
} from './src/scheduler/pr-fetch';
import { PR_FETCH_DEFAULT_INTERVAL_MS } from './src/config/constants';
import type { FetchJsonFn, AnalyzePRFn, Logger } from './src/scheduler/types';

export { getTodayAnalysisDir } from './src/scheduler/analysis-state';

function resolveIntervalMs(
  /** Env string, ms number, or unset — all normalized. */
  rawIntervalMs: string | number | undefined | null,
): number {
  const defaultMs = PR_FETCH_DEFAULT_INTERVAL_MS;
  if (rawIntervalMs === undefined || rawIntervalMs === null || String(rawIntervalMs).trim() === '') {
    return defaultMs;
  }
  const value = Number(rawIntervalMs);
  if (!Number.isFinite(value) || value <= 0) {
    return defaultMs;
  }
  return value;
}

/** e.g. `10 min 0 s`, `2 min 30 s`. */
function formatIntervalDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min} min ${sec} s`;
}

export function createPrFetchScheduler({
  getAuthHeader,
  fetchJson,
  workspace,
  rawIntervalMs,
  authorUuids,
  analyzePR,
  logger = console,
}: {
  getAuthHeader: () => string;
  fetchJson: FetchJsonFn;
  workspace: string | undefined;
  rawIntervalMs: string | number | undefined;
  authorUuids?: string;
  analyzePR: AnalyzePRFn;
  logger?: Logger;
}): { start: () => void; stop: () => void } {
  let inProgress = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  migratePrAnalysisFiles();

  let latestTimestamp = initializeLatestTimestamp();
  if (latestTimestamp) {
    logger.log(`[schedule] Initialized with latest PR timestamp: ${latestTimestamp}`);
  } else {
    logger.log(`[schedule] No previous PR analysis found, will fetch all PRs from today`);
  }

  let latestUpdateTimestamp = loadUpdateTimestamp();
  if (latestUpdateTimestamp) {
    logger.log(`[schedule] Initialized with latest update timestamp: ${latestUpdateTimestamp}`);
  }

  const resolvedIntervalMs = resolveIntervalMs(rawIntervalMs);

  const onAnalysisComplete = (prCreatedOn: string): void => {
    const prTimestamp = new Date(prCreatedOn).toISOString();
    if (!latestTimestamp || prTimestamp > latestTimestamp) {
      latestTimestamp = prTimestamp;
      saveLatestTimestamp(latestTimestamp);
      logger.log(`[schedule] Updated latest timestamp to: ${latestTimestamp}`);
    }
  };

  const analysisQueue = new PrAnalysisQueue({ analyzePR, onAnalysisComplete, logger });

  async function run(): Promise<void> {
    if (inProgress) {
      logger.log('[schedule] Previous PR fetch still running; skipping this tick');
      return;
    }
    inProgress = true;
    try {
      const {
        prs,
        workspace: resolvedWorkspace,
        startIso,
        endIso,
      } = await fetchTodaysPullRequests({
        getAuthHeader,
        fetchJson,
        workspace,
        authorUuids,
        latestTimestamp,
      });

      const ignoredPrs = prs.filter((pr) => isIgnoredRepo(pr.source?.repository?.full_name || ''));
      const filteredPrs = prs.filter(
        (pr) => !isIgnoredRepo(pr.source?.repository?.full_name || ''),
      );

      const timestampInfo = latestTimestamp ? ` (new PRs since ${latestTimestamp})` : '';

      logger.log(
        `[schedule] Fetched ${filteredPrs.length} PR(s) created today (UTC ${startIso} - ${endIso})${timestampInfo} from workspace ${resolvedWorkspace}`,
      );
      if (ignoredPrs.length > 0) {
        logger.log(`[schedule] Skipped ${ignoredPrs.length} PR(s) from ignored repos`);
      }

      for (const pr of filteredPrs) {
        analysisQueue.add(pr);
      }

      // Fetch updated PRs (new commits on previously analyzed PRs)
      try {
        const { prs: updatedPrs } = await fetchUpdatedPullRequests({
          getAuthHeader,
          fetchJson,
          workspace,
          authorUuids,
          lastUpdateTimestamp: latestUpdateTimestamp,
        });

        const filteredUpdatedPrs = updatedPrs.filter(
          (pr) => !isIgnoredRepo(pr.source?.repository?.full_name || ''),
        );

        if (filteredUpdatedPrs.length > 0) {
          logger.log(
            `[schedule] Fetched ${filteredUpdatedPrs.length} updated PR(s) since ${latestUpdateTimestamp}`,
          );
          for (const pr of filteredUpdatedPrs) {
            analysisQueue.add(pr);
          }
        }

        // Advance the update cursor to the latest updated_on we saw
        let maxUpdatedOn = latestUpdateTimestamp;
        for (const pr of updatedPrs) {
          if (pr.updated_on && (!maxUpdatedOn || pr.updated_on > maxUpdatedOn)) {
            maxUpdatedOn = pr.updated_on;
          }
        }
        if (maxUpdatedOn && maxUpdatedOn !== latestUpdateTimestamp) {
          latestUpdateTimestamp = new Date(maxUpdatedOn).toISOString();
          saveUpdateTimestamp(latestUpdateTimestamp);
          logger.log(`[schedule] Updated latest update timestamp to: ${latestUpdateTimestamp}`);
        }
      } catch (error) {
        logger.error('[schedule] Failed to fetch updated PRs:', (error as Error).message);
      }

      // Set the initial update cursor after the first successful new-PR fetch
      if (!latestUpdateTimestamp) {
        latestUpdateTimestamp = new Date().toISOString();
        saveUpdateTimestamp(latestUpdateTimestamp);
        logger.log(`[schedule] Initialized update timestamp to: ${latestUpdateTimestamp}`);
      }

      const status = analysisQueue.getStatus();
      if (status.queueSize > 0) {
        logger.log(
          `[schedule] Queue status: ${status.queueSize} pending, ${status.dailyCount}/${status.maxDaily} analyzed today`,
        );
        if (!status.isProcessing) {
          analysisQueue.processNext();
        }
      }
    } catch (error) {
      logger.error('[schedule] Failed to fetch PR list:', (error as Error).message);
    } finally {
      inProgress = false;
    }
  }

  function start(): void {
    logger.log(`[schedule] Starting PR fetch every ${formatIntervalDuration(resolvedIntervalMs)}`);
    analysisQueue.start();
    run();
    timer = setInterval(run, resolvedIntervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    analysisQueue.stop();
  }

  return { start, stop };
}
