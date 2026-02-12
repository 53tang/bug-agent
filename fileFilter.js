const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { minimatch } = require("minimatch");

let filterConfig = null;

function loadFilterConfig() {
  if (filterConfig) {
    return filterConfig;
  }

  const configPath = path.join(__dirname, "file-filter.yaml");

  if (!fs.existsSync(configPath)) {
    console.warn(`File filter config not found at ${configPath}, using defaults`);
    filterConfig = {
      exclude_paths: [],
      exclude_exts: [],
      exclude_files: [],
      size_rules: {
        hard_exclude_bytes: 2097152,
        soft_exclude_bytes: 307200,
        always_include_exts_even_if_large: [],
      },
    };
    return filterConfig;
  }

  try {
    const fileContent = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(fileContent);
    filterConfig = parsed.bug_agent_file_filter || parsed;
    console.log("Loaded file filter configuration");
    return filterConfig;
  } catch (error) {
    console.error("Error loading file filter config:", error.message);
    filterConfig = {
      exclude_paths: [],
      exclude_exts: [],
      exclude_files: [],
      size_rules: {
        hard_exclude_bytes: 2097152,
        soft_exclude_bytes: 307200,
        always_include_exts_even_if_large: [],
      },
    };
    return filterConfig;
  }
}

function getFileExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext || "";
}

function matchesGlob(filePath, patterns) {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => minimatch(filePath, pattern));
}

function estimateFileSizeFromDiff(diffContent) {
  const lines = diffContent.split("\n");
  let lineCount = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineCount++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      lineCount++;
    }
  }

  return lineCount * 50;
}

function shouldIncludeFile(filePath, diffContent = null) {
  const config = loadFilterConfig();
  const normalizedPath = filePath.replace(/\\/g, "/");

  if (config.exclude_paths && matchesGlob(normalizedPath, config.exclude_paths)) {
    return false;
  }

  const ext = getFileExtension(filePath);
  if (config.exclude_exts && config.exclude_exts.includes(ext)) {
    return false;
  }

  if (config.exclude_files && matchesGlob(normalizedPath, config.exclude_files)) {
    return false;
  }

  if (diffContent && config.size_rules) {
    const fileSize = estimateFileSizeFromDiff(diffContent);
    const hardLimit = config.size_rules.hard_exclude_bytes || 2097152;
    const softLimit = config.size_rules.soft_exclude_bytes || 307200;
    const alwaysIncludeExts =
      config.size_rules.always_include_exts_even_if_large || [];

    if (alwaysIncludeExts.includes(ext)) {
      return true;
    }

    if (fileSize > hardLimit) {
      return false;
    }

    if (fileSize > softLimit) {
      // Include but could log a warning here
    }
  }

  return true;
}

module.exports = {
  loadFilterConfig,
  shouldIncludeFile,
};
