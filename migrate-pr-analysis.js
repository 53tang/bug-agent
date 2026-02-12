'use strict';

/**
 * Migration script to reorganize PR analysis files into with-bugs and without-bugs directories
 * Usage: node migrate-pr-analysis.js
 */

const fs = require('fs');
const path = require('path');

const PR_ANALYSIS_DIR = path.join(__dirname, 'pr-analysis');

// Statistics
const stats = {
  totalProcessed: 0,
  withBugs: 0,
  withoutBugs: 0,
  errors: [],
  skipped: 0,
};

/**
 * Check if a PR analysis has bugs
 * @param {object} data - Parsed JSON data
 * @returns {boolean}
 */
function hasBugs(data) {
  // Handle missing or invalid analysis object
  if (!data || !data.analysis) {
    return false;
  }

  // Check for bugs array in analysis.bugs (older format)
  if (Array.isArray(data.analysis.bugs)) {
    return data.analysis.bugs.length > 0;
  }

  // Check for bugs array in analysis.structured.bugs (current format)
  if (data.analysis.structured && Array.isArray(data.analysis.structured.bugs)) {
    return data.analysis.structured.bugs.length > 0;
  }

  // Default: treat as no bugs
  return false;
}

/**
 * Process a single PR analysis file
 * @param {string} sourcePath - Full path to the source file
 * @param {string} dateFolder - Date folder name (e.g., '2026-02-05')
 * @param {string} filename - File name
 */
function processFile(sourcePath, dateFolder, filename) {
  try {
    // Read and parse the file
    const content = fs.readFileSync(sourcePath, 'utf8');
    
    // Handle empty files
    if (!content.trim()) {
      console.warn(`⚠️  Empty file: ${filename}`);
      stats.errors.push({ file: filename, error: 'Empty file' });
      stats.skipped++;
      return;
    }

    const data = JSON.parse(content);
    
    // Determine if PR has bugs
    const prHasBugs = hasBugs(data);
    const bugStatus = prHasBugs ? 'with-bugs' : 'without-bugs';
    
    // Create target directory
    const targetDir = path.join(PR_ANALYSIS_DIR, bugStatus, dateFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Target file path
    const targetPath = path.join(targetDir, filename);
    
    // Check if target already exists
    if (fs.existsSync(targetPath)) {
      console.log(`⏭️  Already exists: ${bugStatus}/${dateFolder}/${filename}`);
      // Remove source file since target exists
      fs.unlinkSync(sourcePath);
      stats.skipped++;
      return;
    }
    
    // Move the file
    fs.renameSync(sourcePath, targetPath);
    
    // Update stats
    stats.totalProcessed++;
    if (prHasBugs) {
      stats.withBugs++;
      console.log(`✅ [WITH BUGS] Moved: ${dateFolder}/${filename}`);
    } else {
      stats.withoutBugs++;
      console.log(`✅ [NO BUGS] Moved: ${dateFolder}/${filename}`);
    }
    
  } catch (error) {
    console.error(`❌ Error processing ${filename}:`, error.message);
    stats.errors.push({ file: filename, error: error.message });
  }
}

/**
 * Process all files in a date folder
 * @param {string} dateFolder - Date folder name (e.g., '2026-02-05')
 */
function processDateFolder(dateFolder) {
  const dateFolderPath = path.join(PR_ANALYSIS_DIR, dateFolder);
  
  // Check if it's a directory
  const stat = fs.statSync(dateFolderPath);
  if (!stat.isDirectory()) {
    return;
  }
  
  // Skip if it's already a categorized folder
  if (dateFolder === 'with-bugs' || dateFolder === 'without-bugs') {
    return;
  }
  
  console.log(`\n📁 Processing folder: ${dateFolder}`);
  
  // Read all files in the date folder
  const files = fs.readdirSync(dateFolderPath);
  const prFiles = files.filter(f => f.startsWith('pr-') && f.endsWith('.json'));
  
  console.log(`   Found ${prFiles.length} PR analysis file(s)`);
  
  // Process each file
  for (const filename of prFiles) {
    const sourcePath = path.join(dateFolderPath, filename);
    processFile(sourcePath, dateFolder, filename);
  }
  
  // Check if date folder is now empty and remove it
  const remainingFiles = fs.readdirSync(dateFolderPath);
  if (remainingFiles.length === 0) {
    fs.rmdirSync(dateFolderPath);
    console.log(`   🗑️  Removed empty folder: ${dateFolder}`);
  }
}

/**
 * Main migration function
 */
function migrate() {
  console.log('🚀 Starting PR Analysis Migration');
  console.log('================================\n');
  
  // Check if pr-analysis directory exists
  if (!fs.existsSync(PR_ANALYSIS_DIR)) {
    console.error('❌ pr-analysis directory not found!');
    process.exit(1);
  }
  
  // Get all date folders
  const entries = fs.readdirSync(PR_ANALYSIS_DIR);
  const dateFolders = entries.filter(entry => {
    const entryPath = path.join(PR_ANALYSIS_DIR, entry);
    const stat = fs.statSync(entryPath);
    // Only process directories that match date format (YYYY-MM-DD) or are old date folders
    return stat.isDirectory() && entry !== 'with-bugs' && entry !== 'without-bugs' && entry !== '.git';
  });
  
  console.log(`Found ${dateFolders.length} date folder(s) to process\n`);
  
  if (dateFolders.length === 0) {
    console.log('✅ No files to migrate. All files are already organized.');
    return;
  }
  
  // Process each date folder
  for (const dateFolder of dateFolders) {
    processDateFolder(dateFolder);
  }
  
  // Print summary
  console.log('\n================================');
  console.log('📊 Migration Summary');
  console.log('================================');
  console.log(`Total files processed: ${stats.totalProcessed}`);
  console.log(`  - With bugs: ${stats.withBugs}`);
  console.log(`  - Without bugs: ${stats.withoutBugs}`);
  console.log(`Files skipped (already exist): ${stats.skipped}`);
  console.log(`Errors encountered: ${stats.errors.length}`);
  
  if (stats.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    stats.errors.forEach(({ file, error }) => {
      console.log(`  - ${file}: ${error}`);
    });
  }
  
  console.log('\n✅ Migration complete!');
}

// Run migration
if (require.main === module) {
  try {
    migrate();
  } catch (error) {
    console.error('❌ Fatal error during migration:', error);
    process.exit(1);
  }
}

module.exports = { migrate };

