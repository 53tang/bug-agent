# PR Analysis Migration Summary

## Overview
Successfully reorganized PR analysis files to separate PRs with bugs from those without bugs.

## Changes Made

### 1. Updated Save Logic
**Files Modified:**
- `bug-agent.js` - Lines 560-640
- `prScheduler.js` - Lines 27-30, 117-133, 400-430

**Key Changes:**
- Modified `getTodayAnalysisDir()` function to accept an optional `hasBugs` parameter
- Updated save logic to automatically determine if a PR has bugs based on `analysis.structured.bugs` array
- PRs with bugs are saved to: `pr-analysis/with-bugs/YYYY-MM-DD/`
- PRs without bugs are saved to: `pr-analysis/without-bugs/YYYY-MM-DD/`

### 2. Migration Script
**Created:** `migrate-pr-analysis.js`

**Features:**
- Reads all existing PR analysis files from date-based folders
- Determines bug status by checking `analysis.bugs` or `analysis.structured.bugs` arrays
- Moves files to appropriate categorized directories
- Preserves date folder structure within each category
- Provides detailed logging and summary statistics

### 3. Migration Results

**Total Files Migrated:** 48 files across 4 date folders

**Breakdown:**
- **With Bugs:** 35 files (73%)
  - 2026-02-02: 11 files
  - 2026-02-03: 9 files
  - 2026-02-04: 5 files
  - 2026-02-05: 10 files

- **Without Bugs:** 13 files (27%)
  - 2026-02-02: 3 files
  - 2026-02-03: 4 files
  - 2026-02-04: 4 files
  - 2026-02-05: 2 files

**Status:** ✅ All files successfully migrated with 0 errors

### 4. New Directory Structure

```
pr-analysis/
├── with-bugs/
│   ├── 2026-02-02/
│   │   └── pr-*.json (11 files)
│   ├── 2026-02-03/
│   │   └── pr-*.json (9 files)
│   ├── 2026-02-04/
│   │   └── pr-*.json (5 files)
│   └── 2026-02-05/
│       └── pr-*.json (10 files)
└── without-bugs/
    ├── 2026-02-02/
    │   └── pr-*.json (3 files)
    ├── 2026-02-03/
    │   └── pr-*.json (4 files)
    ├── 2026-02-04/
    │   └── pr-*.json (4 files)
    └── 2026-02-05/
        └── pr-*.json (2 files)
```

## Edge Cases Handled

1. **Quota Exceeded:** PRs that failed due to API quota limits are saved to `without-bugs` (since no analysis was performed)
2. **Parse Errors:** PRs with JSON parse errors are saved to `without-bugs` (empty bugs array)
3. **Missing Analysis:** PRs with missing or invalid analysis objects are saved to `without-bugs`
4. **Empty Files:** Skipped with a warning during migration

## Testing

All tests passed successfully:
- ✅ PR with bugs → correctly saved to `with-bugs/`
- ✅ PR without bugs → correctly saved to `without-bugs/`
- ✅ PR with parse error → correctly saved to `without-bugs/`

## Usage

### Running the Migration (if needed again)
```bash
node migrate-pr-analysis.js
```

### New PR Analysis
New PRs will automatically be saved to the correct categorized directory based on whether bugs are found.

### Querying Results
```bash
# Find all PRs with bugs
ls pr-analysis/with-bugs/*/

# Find all PRs without bugs
ls pr-analysis/without-bugs/*/

# Count total PRs with bugs
find pr-analysis/with-bugs -name "pr-*.json" | wc -l

# Count total PRs without bugs
find pr-analysis/without-bugs -name "pr-*.json" | wc -l
```

## Notes

- Old date-based folders have been removed after successful migration
- The `.latest-timestamp` file remains in the `pr-analysis/` root directory
- The `isPrAnalyzedToday()` function now checks both `with-bugs` and `without-bugs` directories to prevent duplicate analyses

