import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleArgumentIndex = process.argv.indexOf("--bundle");
const bundleArgument = bundleArgumentIndex >= 0 ? process.argv[bundleArgumentIndex + 1] : undefined;
if (bundleArgumentIndex >= 0 && !bundleArgument) {
  throw new Error("--bundle requires a directory path");
}
const bundleRoot = bundleArgument ? path.resolve(process.cwd(), bundleArgument) : path.join(repoRoot, "knowledge");
const specOnly = process.argv.includes("--spec-only");
const auditMode = process.argv.includes("--audit");
const jsonOutput = process.argv.includes("--json");
const maxAgeArgumentIndex = process.argv.indexOf("--max-age-days");
const maxAgeDays = Number(maxAgeArgumentIndex >= 0 ? process.argv[maxAgeArgumentIndex + 1] : 180);
const nowArgumentIndex = process.argv.indexOf("--now");
const now = new Date(nowArgumentIndex >= 0 ? process.argv[nowArgumentIndex + 1] : Date.now());
if (auditMode && (!Number.isFinite(maxAgeDays) || maxAgeDays < 1)) {
  throw new Error("--max-age-days requires a positive number");
}
if (auditMode && Number.isNaN(now.getTime())) {
  throw new Error("--now requires a valid ISO 8601 datetime");
}
const reservedNames = new Set(["index.md", "log.md"]);
const errors = [];
const warnings = [];
const markdownFiles = [];
const directories = [];
let conceptCount = 0;
let linkCount = 0;
const concepts = [];
const indexedConcepts = new Set();

function relative(filePath) {
  return path.relative(bundleRoot, filePath).split(path.sep).join("/") || ".";
}

function report(target, message, severity = "error") {
  const item = `${relative(target)}: ${message}`;
  (severity === "warning" ? warnings : errors).push(item);
}

async function walk(directory) {
  directories.push(directory);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      report(fullPath, "symbolic links are not allowed in the Kimix knowledge bundle");
      continue;
    }
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      markdownFiles.push(fullPath);
    }
  }
}

function parseFrontmatter(text, filePath, { required }) {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    if (required) report(filePath, "missing YAML frontmatter at the start of the concept document");
    return { frontmatter: null, body: normalized };
  }

  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) {
    report(filePath, "unterminated YAML frontmatter block");
    return { frontmatter: null, body: normalized };
  }

  const source = normalized.slice(4, closing);
  let frontmatter;
  try {
    frontmatter = parseYaml(source, { json: false });
  } catch (problem) {
    report(filePath, `invalid YAML frontmatter: ${problem.message}`);
    return { frontmatter: null, body: normalized.slice(closing + 5) };
  }
  if (!frontmatter || Array.isArray(frontmatter) || typeof frontmatter !== "object") {
    report(filePath, "frontmatter must be a YAML mapping");
    return { frontmatter: null, body: normalized.slice(closing + 5) };
  }
  return { frontmatter, body: normalized.slice(closing + 5).replace(/^\n/, "") };
}

function validateConcept(filePath, frontmatter, body) {
  conceptCount += 1;
  if (!frontmatter) return;

  concepts.push({ filePath, frontmatter });

  if (typeof frontmatter.type !== "string" || frontmatter.type.trim() === "") {
    report(filePath, "OKF v0.1 requires a non-empty string 'type'");
  }

  if (!specOnly) {
    for (const key of ["title", "description", "timestamp"]) {
      if (typeof frontmatter[key] !== "string" || frontmatter[key].trim() === "") {
        report(filePath, `Kimix profile requires a non-empty string '${key}'`);
      }
    }
    if (typeof frontmatter.description === "string" && /[\r\n]/.test(frontmatter.description)) {
      report(filePath, "Kimix profile requires 'description' to stay on one line");
    }
    if (
      typeof frontmatter.timestamp === "string" &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(frontmatter.timestamp) ||
        Number.isNaN(Date.parse(frontmatter.timestamp)))
    ) {
      report(filePath, "Kimix profile requires 'timestamp' to be a valid ISO 8601 datetime with timezone");
    }
    if (
      !Array.isArray(frontmatter.tags) ||
      frontmatter.tags.length === 0 ||
      frontmatter.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")
    ) {
      report(filePath, "Kimix profile requires 'tags' to be a non-empty list of strings");
    } else if (new Set(frontmatter.tags).size !== frontmatter.tags.length) {
      report(filePath, "Kimix profile does not allow duplicate tags");
    }
    if (typeof frontmatter.title === "string" && !body.includes(`# ${frontmatter.title}`)) {
      report(filePath, "Kimix profile requires an H1 heading matching the frontmatter title");
    }
  }

  if (frontmatter.resource !== undefined && typeof frontmatter.resource !== "string") {
    report(filePath, "optional 'resource' must be a string URI when present");
  }
}

function validateIndex(filePath, frontmatter, body) {
  const isRoot = path.dirname(filePath) === bundleRoot;
  if (!isRoot && frontmatter) report(filePath, "only the bundle-root index.md may contain frontmatter");
  if (isRoot) {
    if (!frontmatter) {
      if (!specOnly) report(filePath, "Kimix profile requires root index.md to declare okf_version");
    } else if (String(frontmatter.okf_version) !== "0.1") {
      report(filePath, "root index.md must declare okf_version: \"0.1\"");
    }
  }

  let currentSection = false;
  for (const [index, line] of body.split("\n").entries()) {
    if (line.trim() === "") continue;
    if (/^# [^#].+/.test(line)) {
      currentSection = true;
      continue;
    }
    if (/^\* \[[^\]]+\]\([^)]+\)(?: - .+)?$/.test(line)) {
      if (!currentSection) report(filePath, `index entry before a section heading on line ${index + 1}`);
      continue;
    }
    report(filePath, `invalid index.md structure on line ${index + 1}`);
  }
}

function validateLog(filePath, frontmatter, body) {
  if (frontmatter) report(filePath, "log.md must not contain frontmatter");
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  if (!/^# [^#].+/.test(lines[0] ?? "")) report(filePath, "log.md must start with an H1 heading");

  const dates = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const date = /^## (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (date) {
      if (Number.isNaN(Date.parse(`${date[1]}T00:00:00Z`))) report(filePath, `invalid log date '${date[1]}'`);
      dates.push(date[1]);
    } else if (!/^\* (?:\*\*[^*]+\*\*: )?.+/.test(line)) {
      report(filePath, `invalid log.md structure on line ${index + 2}`);
    }
  }
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index] > dates[index - 1]) report(filePath, "log dates must be ordered newest first");
  }
}

function isExternalLink(target) {
  return /^(?:[a-z][a-z\d+.-]*:|#)/i.test(target);
}

async function validateLinks(filePath, body) {
  const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(linkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    if (isExternalLink(rawTarget)) continue;
    linkCount += 1;
    let cleanTarget;
    try {
      cleanTarget = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]);
    } catch {
      report(filePath, `invalid percent-encoding in link: ${rawTarget}`);
      continue;
    }
    let resolved = cleanTarget.startsWith("/")
      ? path.resolve(bundleRoot, `.${cleanTarget}`)
      : path.resolve(path.dirname(filePath), cleanTarget);
    if (cleanTarget.endsWith("/")) resolved = path.join(resolved, "index.md");
    if (path.extname(resolved) === "") resolved += ".md";

    const relativeTarget = path.relative(bundleRoot, resolved);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      report(filePath, `link escapes the bundle: ${rawTarget}`, specOnly ? "warning" : "error");
      continue;
    }
    try {
      const targetStat = await lstat(resolved);
      if (!targetStat.isFile()) throw new Error("not a file");
      if (path.basename(filePath) === "index.md" && !reservedNames.has(path.basename(resolved))) {
        indexedConcepts.add(path.resolve(resolved));
      }
    } catch {
      report(filePath, `broken internal link: ${rawTarget}`, specOnly ? "warning" : "error");
    }
  }
}

function auditConcepts() {
  const titles = new Map();
  const maxAgeMilliseconds = maxAgeDays * 24 * 60 * 60 * 1000;

  for (const { filePath, frontmatter } of concepts) {
    const title = typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
    if (title) {
      const normalizedTitle = title.toLocaleLowerCase("en-US");
      const previous = titles.get(normalizedTitle);
      if (previous) report(filePath, `audit found duplicate title '${title}' also used by ${relative(previous)}`);
      else titles.set(normalizedTitle, filePath);
    }

    const timestamp = typeof frontmatter.timestamp === "string" ? Date.parse(frontmatter.timestamp) : Number.NaN;
    if (!Number.isNaN(timestamp)) {
      if (timestamp > now.getTime() + 24 * 60 * 60 * 1000) {
        report(filePath, "audit found a timestamp more than one day in the future");
      } else if (now.getTime() - timestamp > maxAgeMilliseconds) {
        report(filePath, `audit requires review because timestamp is older than ${maxAgeDays} days`);
      }
    }

    if (!indexedConcepts.has(path.resolve(filePath))) {
      report(filePath, "audit found an orphan concept that is not linked from any index.md");
    }
  }
}

try {
  const rootStat = await lstat(bundleRoot);
  if (!rootStat.isDirectory()) throw new Error("knowledge is not a directory");
  await walk(bundleRoot);
} catch (error) {
  errors.push(`knowledge: OKF bundle is unavailable (${error.message})`);
}

for (const directory of directories) {
  const indexPath = path.join(directory, "index.md");
  if (!markdownFiles.includes(indexPath)) {
    report(indexPath, "missing directory index.md", specOnly ? "warning" : "error");
  }
}
if (!specOnly && !markdownFiles.includes(path.join(bundleRoot, "log.md"))) {
  report(path.join(bundleRoot, "log.md"), "Kimix profile requires a root update log");
}

for (const filePath of markdownFiles.sort()) {
  const text = await readFile(filePath, "utf8");
  const name = path.basename(filePath);
  const isRootIndex = name === "index.md" && path.dirname(filePath) === bundleRoot;
  const { frontmatter, body } = parseFrontmatter(text, filePath, {
    required: !reservedNames.has(name) || isRootIndex,
  });

  if (name === "index.md") validateIndex(filePath, frontmatter, body);
  else if (name === "log.md") validateLog(filePath, frontmatter, body);
  else validateConcept(filePath, frontmatter, body);
  await validateLinks(filePath, body);
}

if (auditMode) auditConcepts();

const result = {
  profile: auditMode
    ? `OKF v0.1 + Kimix maintenance audit (${maxAgeDays} days)`
    : specOnly
      ? "OKF v0.1 conformance"
      : "OKF v0.1 + Kimix strict profile",
  bundle: path.relative(repoRoot, bundleRoot).split(path.sep).join("/") || ".",
  concepts: conceptCount,
  markdownFiles: markdownFiles.length,
  internalLinks: linkCount,
  errors,
  warnings,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.profile}: ${errors.length === 0 ? "PASS" : "FAIL"}`);
  console.log(`Bundle: ${result.bundle} | Concepts: ${conceptCount} | Markdown: ${markdownFiles.length} | Links: ${linkCount}`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
  for (const error of errors) console.error(`ERROR ${error}`);
}

if (errors.length > 0) process.exitCode = 1;
