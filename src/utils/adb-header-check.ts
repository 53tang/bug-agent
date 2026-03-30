import type { FileDiff } from '../diff';
import type { AdbHeaderCheckResult, AdbHeaderViolation } from '../analysis/types';

const USER_ID_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /x-user-id/i, label: 'x-user-id' },
  { re: /user[-_]id/i, label: 'user-id / user_id' },
  { re: /userId/, label: 'userId' },
];

const CUSTOMER_ID_PATTERNS: RegExp[] = [
  /x-customer-id/i,
  /customer[-_]id/i,
  /customerId/,
  /adb[-_]?customer/i,
];

const ADB_HEADER_IGNORE_REPO_SUBSTRINGS = [
  'web-eco-platform',
  'mcs-application',
  'web-mcs-application',
];

function isAdbHeaderIgnoredRepo(repoFullName: string): boolean {
  const normalizedRepo = String(repoFullName || '').toLowerCase();
  return ADB_HEADER_IGNORE_REPO_SUBSTRINGS.some((item) => normalizedRepo.includes(item));
}

function getAddedContent(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

function findUserIdPattern(content: string): string | null {
  for (const { re, label } of USER_ID_PATTERNS) {
    if (re.test(content)) return label;
  }
  return null;
}

function hasCustomerIdPattern(content: string): boolean {
  return CUSTOMER_ID_PATTERNS.some((re) => re.test(content));
}

export function checkAdbHeaders(fileDiffs: FileDiff[], repoFullName: string): AdbHeaderCheckResult {
  if (isAdbHeaderIgnoredRepo(repoFullName)) {
    return { violations: [] };
  }

  const violations: AdbHeaderViolation[] = [];

  for (const { filePath, diff } of fileDiffs) {
    const addedContent = getAddedContent(diff);
    const userIdPattern = findUserIdPattern(addedContent);
    if (!userIdPattern) continue;

    if (!hasCustomerIdPattern(addedContent)) {
      violations.push({ filePath, userIdPattern });
    }
  }

  return { violations };
}

export function renderAdbHeaderCheck(result: AdbHeaderCheckResult): string {
  if (!result || result.violations.length === 0) return '';

  const lines = ['- ### ADB Customer Header Check'];
  lines.push(
    '  The following files add a user ID header but are missing the required ADB customer ID header (`customer-id` / `x-customer-id`):',
  );
  for (const v of result.violations) {
    lines.push(`  - \`${v.filePath}\` (detected: \`${v.userIdPattern}\`)`);
  }
  return lines.join('\n');
}
