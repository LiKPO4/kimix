const SENSITIVE_DIAGNOSTIC_KEY = /(?:^|_)(?:content|body|result|output|snapshot|stack|arguments|rawArguments|path|filePath|dataUrl|base64)(?:$|_)/i;
const DATA_URL_PATTERN = /data:[^;,\s]+(?:;[^,\s]+)*;base64,[a-z0-9+/=]+/gi;
const WINDOWS_PATH_PATTERN = /(?:[a-z]:[\\/]|\\\\)[^\s"'<>|]+/gi;

function isSensitiveDiagnosticKey(key: string): boolean {
  if (/(?:length|count|types?)$/i.test(key)) return false;
  const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return SENSITIVE_DIAGNOSTIC_KEY.test(normalized);
}

function redactString(value: string): string {
  return value
    .replace(DATA_URL_PATTERN, "[redacted-data-url]")
    .replace(WINDOWS_PATH_PATTERN, "[redacted-path]");
}

export function redactDiagnosticData(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (isSensitiveDiagnosticKey(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticData(item, "", seen));
  }
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => (
    [entryKey, redactDiagnosticData(entryValue, entryKey, seen)]
  )));
}
