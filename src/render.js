"use strict";

function hasSpeculativeNotBugs(notBugs) {
  if (!Array.isArray(notBugs)) return false;
  return notBugs.some((item) =>
    String(item?.reason || "")
      .toLowerCase()
      .includes("speculative")
  );
}

function formatSpeculativeNotBugs(notBugs) {
  if (!Array.isArray(notBugs)) return "";
  const items = notBugs.filter((item) =>
    String(item?.reason || "")
      .toLowerCase()
      .includes("speculative")
  );
  if (items.length === 0) return "";
  const lines = items.slice(0, 3).map((item) => {
    const topic = String(item?.topic || "Speculative");
    const reason = String(item?.reason || "speculative");
    return `- ${topic}: ${reason}`;
  });
  return ["Speculative issues (not confirmed):", ...lines].join("\n");
}

function shouldDemoteVocCdcMulesoftBug(bug) {
  const title = String(bug?.title || "").toLowerCase();
  const description = String(bug?.description || "").toLowerCase();
  const filePath = String(bug?.filePath || bug?.file || "").toLowerCase();
  const mentionsVoc = title.includes("voc") || description.includes("voc");
  const mentionsMulesoft =
    title.includes("mulesoft") || description.includes("mulesoft");
  const mentionsConsent =
    title.includes("consent") || description.includes("consent");
  const isConsentFile =
    filePath.includes("consents") || filePath.includes("consent");
  return mentionsVoc && mentionsMulesoft && mentionsConsent && isConsentFile;
}

function demoteVocCdcMulesoftBugs(structured) {
  if (!structured || !Array.isArray(structured.bugs)) return structured;
  const retained = [];
  const demoted = [];
  for (const bug of structured.bugs) {
    if (shouldDemoteVocCdcMulesoftBug(bug)) {
      demoted.push({
        topic: bug.title || "VOC consent mapping",
        reason:
          "CDC vs Mulesoft path mapping differences; not a bug unless the same path is internally inconsistent or the diff explicitly removes required VOC handling.",
      });
    } else {
      retained.push(bug);
    }
  }
  if (demoted.length === 0) return structured;
  const notBugs = Array.isArray(structured.notBugs)
    ? structured.notBugs
    : [];
  return {
    ...structured,
    bugs: retained,
    notBugs: notBugs.concat(demoted),
  };
}

function renderMarkdownFromStructured(structured) {
  if (!structured) return "";

  const renderBugsSection = () => {
    if (!Array.isArray(structured.bugs) || structured.bugs.length === 0) {
      return "";
    }
    const filteredBugs = structured.bugs.filter((bug) => {
      const title = String(bug.title || bug.issue || "").toLowerCase();
      const desc = String(bug.description || "").toLowerCase();
      return !(
        title.includes("react hook") ||
        title.includes("rules of hooks") ||
        title.includes("hook rule") ||
        title.includes("hook violation") ||
        title.includes("conditional hook") ||
        desc.includes("react hook") ||
        desc.includes("rules of hooks") ||
        desc.includes("hook rule") ||
        desc.includes("hook violation") ||
        desc.includes("conditional hook")
      );
    });
    if (filteredBugs.length === 0) {
      return "";
    }
    return filteredBugs
      .slice(0, 3)
      .map((bug, index) => {
        const file = bug.filePath || bug.file || "unknown file";
        const line = bug.lineHint ? ` (${bug.lineHint})` : "";
        const title = bug.title || bug.issue || `Issue ${index + 1}`;
        const description = bug.description ? `- Desc: ${bug.description}` : "";
        // const risk = bug.risk ? `- Risk: ${bug.risk}` : '';

        // Add code snippet with diff formatting if available
        const codeSnippet = bug.codeSnippet
          ? `\n\`\`\`diff\n${bug.codeSnippet}\n\`\`\``
          : "";

        return [
          `### 🔴 HIGH SEVERITY ISSUE: ${title}`,
          `- File: \`${file}\`${line}`,
          codeSnippet,
          description,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  };

  const renderSuggestionsSection = () => {
    if (!Array.isArray(structured.suggestions)) return "";
    const normalized = structured.suggestions
      .map((item) => {
        const topic = String(item?.topic || "Suggestion").trim();
        const suggestion = String(
          item?.suggestion || item?.recommendation || item?.text || ""
        ).trim();
        const rationale = String(item?.rationale || "").trim();
        if (!suggestion) return null;
        const topicLabel = topic ? `${topic}: ` : "";
        const rationaleText = rationale ? ` (Reason: ${rationale})` : "";
        return `- ${topicLabel}${suggestion}${rationaleText}`;
      })
      .filter(Boolean);
    if (normalized.length === 0) return "";
    return [`### 🟡 Suggestions`, ...normalized].join("\n");
  };

  const bugsSection = renderBugsSection();
  const suggestionsSection = renderSuggestionsSection();

  if (!bugsSection && !suggestionsSection) return "";
  if (bugsSection && suggestionsSection) {
    return `${bugsSection}\n\n${suggestionsSection}`;
  }
  return bugsSection || suggestionsSection;
}

module.exports = {
  hasSpeculativeNotBugs,
  formatSpeculativeNotBugs,
  demoteVocCdcMulesoftBugs,
  renderMarkdownFromStructured,
};
