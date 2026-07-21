import fs from "node:fs";

/** @type {{ categories: Array<{ id: string, label: string, problems: Array<{ id: string, label: string, answer: string }> }> } | null} */
let cache = null;
let cacheMtime = 0;

/**
 * @param {string} kbPath
 */
export function loadKnowledgeBase(kbPath) {
  const stat = fs.statSync(kbPath);
  if (!cache || stat.mtimeMs !== cacheMtime) {
    const raw = fs.readFileSync(kbPath, "utf8");
    cache = JSON.parse(raw);
    cacheMtime = stat.mtimeMs;
  }
  return cache;
}

/**
 * @param {string} kbPath
 * @param {string} problemId
 */
export function getProblemById(kbPath, problemId) {
  const kb = loadKnowledgeBase(kbPath);
  for (const category of kb.categories) {
    const problem = category.problems.find((p) => p.id === problemId);
    if (problem) {
      return {
        id: problem.id,
        label: problem.label,
        answer: problem.answer,
        requireReport: Boolean(problem.requireReport),
        categoryId: category.id,
        categoryLabel: category.label,
      };
    }
  }
  return null;
}
