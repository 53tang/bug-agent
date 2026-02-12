'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WORKSPACE = 'smart_eco-platform';
const DEFAULT_FETCH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_AUTHOR_UUIDS = [
  '{aff0f074-2041-4f5b-adde-ff8031c030bc}',
  '{151633df-1e30-482a-a61b-eb6fe589abe1}',
  '{17791846-d1f1-47f7-ac76-55f6101d4f82}',
  '{3c865dd0-c5bf-46a0-836c-ce32fb773b70}',
  '{5e1bd749-f9a6-49a1-a580-afadbe72fc5b}',
  '{32c4ef6f-3c67-431b-8fa6-0a4b1c4a77a9}',
  '{8ad2417d-9d07-4e7d-830b-b88fef044fb7}',
];
const PR_ANALYSIS_QUEUE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_DAILY_ANALYSIS_COUNT = 20;
const RETRY_DELAY_MS = 60 * 1000; // 1 minute
const MAX_RETRY_ATTEMPTS = 2; // 1 initial + 1 retry
const TIMESTAMP_FILE = path.join(__dirname, 'pr-analysis', '.latest-timestamp');

function getTodayDateString() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getTodayAnalysisDir(hasBugs = null) {
  const today = getTodayDateString();
  if (hasBugs === null) {
    // For backward compatibility when checking existing files
    return path.join(__dirname, 'pr-analysis', today);
  }
  const bugStatus = hasBugs ? 'with-bugs' : 'without-bugs';
  return path.join(__dirname, 'pr-analysis', bugStatus, today);
}

function buildTodayUtcRange() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function saveLatestTimestamp(timestamp) {
  try {
    const analysisDir = path.join(__dirname, 'pr-analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    fs.writeFileSync(TIMESTAMP_FILE, timestamp, 'utf8');
  } catch (error) {
    console.error('[timestamp] Failed to save latest timestamp:', error.message);
  }
}

function loadLatestTimestamp() {
  try {
    if (fs.existsSync(TIMESTAMP_FILE)) {
      return fs.readFileSync(TIMESTAMP_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('[timestamp] Failed to load latest timestamp:', error.message);
  }
  return null;
}

function migratePrAnalysisFiles() {
  const rootDir = path.join(__dirname, 'pr-analysis');
  if (!fs.existsSync(rootDir)) {
    return;
  }
  
  const files = fs.readdirSync(rootDir);
  const prFiles = files.filter(f => f.startsWith('pr-') && f.endsWith('.json') && f !== '.latest-timestamp');
  
  if (prFiles.length === 0) {
    return;
  }
  
  let movedCount = 0;
  for (const filename of prFiles) {
    const match = filename.match(/^pr-\d+-(.+)\.json$/);
    if (match) {
      // Format: 2026-02-03T08-59-09-379Z -> 2026-02-03T08:59:09.379Z
      const timestampStr = match[1]
        .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
        .replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3.000Z');
      
      const timestamp = new Date(timestampStr);
      if (!isNaN(timestamp.getTime())) {
        const fileDate = timestamp.toISOString().split('T')[0];
        const targetDir = path.join(rootDir, fileDate);
        
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        const sourcePath = path.join(rootDir, filename);
        const targetPath = path.join(targetDir, filename);
        
        // Only move if target doesn't exist
        if (!fs.existsSync(targetPath)) {
          fs.renameSync(sourcePath, targetPath);
          movedCount++;
        } else {
          // If target exists, remove source (duplicate)
          fs.unlinkSync(sourcePath);
        }
      }
    }
  }
  
  if (movedCount > 0) {
    console.log(`[migration] Moved ${movedCount} PR analysis file(s) to date subfolders`);
  }
}

function isPrAnalyzedToday(prId) {
  // Check both with-bugs and without-bugs directories
  const withBugsDir = getTodayAnalysisDir(true);
  const withoutBugsDir = getTodayAnalysisDir(false);
  
  const checkDir = (dir) => {
    if (!fs.existsSync(dir)) {
      return false;
    }
    const files = fs.readdirSync(dir);
    return files.some(f => f.startsWith(`pr-${prId}-`) && f.endsWith('.json'));
  };
  
  return checkDir(withBugsDir) || checkDir(withoutBugsDir);
}

function initializeLatestTimestamp() {
  // First try to load from saved file
  const saved = loadLatestTimestamp();
  if (saved) {
    return saved;
  }
  
  // Fallback: scan all date folders for latest timestamp
  const analysisDir = path.join(__dirname, 'pr-analysis');
  if (!fs.existsSync(analysisDir)) {
    return null;
  }
  
  let latestTimestamp = null;
  const entries = fs.readdirSync(analysisDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const dateFolder = path.join(analysisDir, entry.name);
    const files = fs.readdirSync(dateFolder);
    const prFiles = files.filter(f => f.startsWith('pr-') && f.endsWith('.json'));
    
    for (const filename of prFiles) {
      const match = filename.match(/^pr-\d+-(.+)\.json$/);
      if (match) {
        // Format: 2026-02-03T08-59-09-379Z -> 2026-02-03T08:59:09.379Z
        const timestampStr = match[1]
          .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
          .replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3.000Z');
        
        const timestamp = new Date(timestampStr);
        if (!isNaN(timestamp.getTime())) {
          if (!latestTimestamp || timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
          }
        }
      }
    }
  }
  
  return latestTimestamp ? latestTimestamp.toISOString() : null;
}

function resolveWorkspace(rawWorkspace) {
  if (rawWorkspace && String(rawWorkspace).trim()) {
    return String(rawWorkspace).trim();
  }
  return DEFAULT_WORKSPACE;
}

function resolveIntervalMs(rawIntervalMs) {
  if (rawIntervalMs === undefined || rawIntervalMs === null || rawIntervalMs === '') {
    return DEFAULT_FETCH_INTERVAL_MS;
  }
  const value = Number(rawIntervalMs);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_FETCH_INTERVAL_MS;
  }
  return value;
}

function normalizeUuid(raw) {
  const cleaned = String(raw).trim().replace(/^"|"$/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return cleaned;
  }
  return `{${cleaned}}`;
}

function resolveAuthorUuids(rawAuthorUuids) {
  if (rawAuthorUuids && String(rawAuthorUuids).trim()) {
    const list = String(rawAuthorUuids)
      .split(',')
      .map((item) => normalizeUuid(item))
      .filter(Boolean);
    if (list.length > 0) {
      return list;
    }
  }
  return DEFAULT_AUTHOR_UUIDS;
}

async function fetchAllPages(url, authHeader, fetchJson) {
  const values = [];
  let next = url;
  while (next) {
    const data = await fetchJson(next, authHeader);
    if (Array.isArray(data.values)) {
      values.push(...data.values);
    }
    next = data.next || null;
  }
  return values;
}

async function fetchTodaysPullRequests({
  getAuthHeader,
  fetchJson,
  workspace,
  authorUuids,
  latestTimestamp,
}) {
  const authHeader = getAuthHeader();
  const resolvedWorkspace = resolveWorkspace(workspace);
  const { startIso, endIso } = buildTodayUtcRange();
  const resolvedAuthorUuids = resolveAuthorUuids(authorUuids);
  
  // Build query with date and optional timestamp filter
  let query = `created_on >= "${startIso}" AND created_on < "${endIso}"`;
  if (latestTimestamp) {
    query += ` AND created_on > "${latestTimestamp}"`;
  }
  
  // Fetch PRs for each author in parallel using Promise.allSettled
  // Using endpoint: /workspaces/{workspace}/pullrequests/{author_uuid}
  const fetchPromises = resolvedAuthorUuids.map(async (uuid) => {
    const url = `https://api.bitbucket.org/2.0/workspaces/${resolvedWorkspace}/pullrequests/${uuid}?pagelen=50&q=${encodeURIComponent(query)}`;
    return fetchAllPages(url, authHeader, fetchJson);
  });
  
  const results = await Promise.allSettled(fetchPromises);
  
  // Aggregate successful results
  const prs = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      prs.push(...result.value);
    }
  }
  
  // Filter out PRs that might have been analyzed already
  const filteredPrs = latestTimestamp 
    ? prs.filter(pr => new Date(pr.created_on) > new Date(latestTimestamp))
    : prs;
  
  return { prs: filteredPrs, workspace: resolvedWorkspace, startIso, endIso };
}

class PrAnalysisQueue {
  constructor({ analyzePR, onAnalysisComplete, logger = console }) {
    this.queue = [];
    this.analyzePR = analyzePR;
    this.onAnalysisComplete = onAnalysisComplete;
    this.logger = logger;
    this.isProcessing = false;
    this.timer = null;
    this.dailyCount = 0;
    this.lastResetDate = new Date().toISOString().split('T')[0];
  }

  add(pr) {
    // Check if PR was already analyzed today
    if (isPrAnalyzedToday(pr.id)) {
      this.logger.log(`[queue] PR #${pr.id} already analyzed today, skipping`);
      return;
    }
    
    // Check if PR already in queue
    const exists = this.queue.some(queuedPr => queuedPr.id === pr.id);
    if (!exists) {
      this.queue.push(pr);
      this.logger.log(`[queue] Added PR #${pr.id} to analysis queue. Queue size: ${this.queue.length}`);
    }
  }

  resetDailyCountIfNeeded() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.dailyCount = 0;
      this.lastResetDate = today;
      this.logger.log(`[queue] Daily analysis count reset for ${today}`);
    }
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.resetDailyCountIfNeeded();

    if (this.dailyCount >= MAX_DAILY_ANALYSIS_COUNT) {
      this.logger.log(`[queue] Daily limit reached (${MAX_DAILY_ANALYSIS_COUNT}). Skipping analysis.`);
      return;
    }

    this.isProcessing = true;
    const pr = this.queue.shift();

    try {
      this.logger.log(`[queue] Processing PR #${pr.id} (${this.dailyCount + 1}/${MAX_DAILY_ANALYSIS_COUNT} today)`);
      
      // Use the HTML link from the API response (preferred)
      // Fallback to constructing from self link if html link not available
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
      
      // Update latest timestamp after successful analysis
      if (this.onAnalysisComplete && pr.created_on) {
        this.onAnalysisComplete(pr.created_on);
      }
      
      this.logger.log(`[queue] Successfully analyzed PR #${pr.id}. Queue remaining: ${this.queue.length}`);
    } catch (error) {
      this.logger.error(`[queue] Failed to analyze PR #${pr.id}:`, error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  start() {
    if (this.timer) {
      return;
    }
    this.logger.log(`[queue] Starting PR analysis queue (processing every 2 minutes)`);
    this.timer = setInterval(() => this.processNext(), PR_ANALYSIS_QUEUE_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    // Process immediately if queue has items
    if (this.queue.length > 0) {
      this.processNext();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log(`[queue] Stopped PR analysis queue`);
    }
  }

  getStatus() {
    return {
      queueSize: this.queue.length,
      dailyCount: this.dailyCount,
      maxDaily: MAX_DAILY_ANALYSIS_COUNT,
      isProcessing: this.isProcessing,
    };
  }
}

async function analyzeWithRetry(prUrl, analyzePR, logger, prData) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      logger.log(`[retry] Analyzing PR (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
      await analyzePR(prUrl);
      return; // Success
    } catch (error) {
      lastError = error;
      logger.error(`[retry] Attempt ${attempt} failed:`, error.message);
      
      // Check for rate limit error
      if (error.message && error.message.includes('GenerateContentInputTokensPerModelPerMinute-FreeTier')) {
        logger.warn(`[retry] Rate limit detected. Saving partial analysis without retry.`);
        
        // Save partial analysis (rate limit = no bugs found)
        try {
          const todayDir = getTodayAnalysisDir(false); // Rate limit means no bugs analyzed
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
            error: 'Rate limit reached',
            errorMessage: error.message,
            analysis: {
              summary: 'Analysis failed due to rate limit',
              bugs: [],
              notBugs: [],
            },
          };
          
          fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
          logger.log(`[retry] Saved partial analysis to: ${filepath}`);
        } catch (saveError) {
          logger.error(`[retry] Failed to save partial analysis:`, saveError.message);
        }
        
        return; // Don't retry on rate limit
      }
      
      // If not the last attempt and not rate limit error, wait before retry
      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.log(`[retry] Waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  
  // All attempts failed
  throw lastError;
}

function createPrFetchScheduler({
  getAuthHeader,
  fetchJson,
  workspace,
  intervalMs,
  analyzePR,
  logger = console,
}) {
  let inProgress = false;
  let timer = null;
  
  // Migrate existing PR analysis files to date subfolders
  migratePrAnalysisFiles();
  
  // Initialize latest timestamp from existing pr-analysis files
  let latestTimestamp = initializeLatestTimestamp();
  if (latestTimestamp) {
    logger.log(`[schedule] Initialized with latest PR timestamp: ${latestTimestamp}`);
  } else {
    logger.log(`[schedule] No previous PR analysis found, will fetch all PRs from today`);
  }

  const resolvedIntervalMs = resolveIntervalMs(intervalMs);
  
  // Callback to update latest timestamp after successful analysis
  const onAnalysisComplete = (prCreatedOn) => {
    const prTimestamp = new Date(prCreatedOn).toISOString();
    if (!latestTimestamp || prTimestamp > latestTimestamp) {
      latestTimestamp = prTimestamp;
      saveLatestTimestamp(latestTimestamp);
      logger.log(`[schedule] Updated latest timestamp to: ${latestTimestamp}`);
    }
  };
  
  const analysisQueue = new PrAnalysisQueue({ analyzePR, onAnalysisComplete, logger });

  async function run() {
    if (inProgress) {
      logger.log('[schedule] Previous PR fetch still running; skipping this tick');
      return;
    }
    inProgress = true;
    try {
      const { prs, workspace: resolvedWorkspace, startIso, endIso } =
        await fetchTodaysPullRequests({
          getAuthHeader,
          fetchJson,
          workspace,
          latestTimestamp,
        });
      
      const timestampInfo = latestTimestamp 
        ? ` (new PRs since ${latestTimestamp})`
        : '';
      
      logger.log(
        `[schedule] Fetched ${prs.length} PR(s) created today (UTC ${startIso} - ${endIso})${timestampInfo} from workspace ${resolvedWorkspace}`
      );
      
      // Add new PRs to analysis queue
      if (prs.length > 0) {
        for (const pr of prs) {
          analysisQueue.add(pr);
        }
        const status = analysisQueue.getStatus();
        logger.log(`[schedule] Queue status: ${status.queueSize} pending, ${status.dailyCount}/${status.maxDaily} analyzed today`);
        
        // Trigger immediate processing if queue was idle
        if (!status.isProcessing) {
          analysisQueue.processNext();
        }
      }
    } catch (error) {
      logger.error('[schedule] Failed to fetch PR list:', error.message);
    } finally {
      inProgress = false;
    }
  }

  function start() {
    const intervalMinutes = Math.round(resolvedIntervalMs / 60000);
    logger.log(`[schedule] Starting PR fetch every ${intervalMinutes} min(s)`);
    analysisQueue.start();
    run();
    timer = setInterval(run, resolvedIntervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    analysisQueue.stop();
  }

  return { start, stop };
}

module.exports = {
  createPrFetchScheduler,
  getTodayAnalysisDir,
};
