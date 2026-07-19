function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function setTomlSectionValuePreservingLayout(
  raw: string,
  sectionName: string,
  key: string,
  valueLiteral: string,
) {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const line = `${key} = ${valueLiteral}`;
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const matchIndex = matches.findIndex((match) => match[1].trim() === sectionName);

  if (matchIndex < 0) {
    const base = raw.trimEnd();
    return `${base}${base ? `${newline}${newline}` : ""}[${sectionName}]${newline}${line}${newline}`;
  }

  const match = matches[matchIndex];
  const bodyStart = (match.index ?? 0) + match[0].length;
  const bodyEnd = matches[matchIndex + 1]?.index ?? raw.length;
  const body = raw.slice(bodyStart, bodyEnd);
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=.*$`, "m");

  if (keyPattern.test(body)) {
    return `${raw.slice(0, bodyStart)}${body.replace(keyPattern, line)}${raw.slice(bodyEnd)}`;
  }

  const trailingWhitespaceIndex = body.search(/\s*$/);
  const content = trailingWhitespaceIndex >= 0 ? body.slice(0, trailingWhitespaceIndex) : body;
  const trailingWhitespace = trailingWhitespaceIndex >= 0 ? body.slice(trailingWhitespaceIndex) : "";
  const separator = content.endsWith("\n") || content.endsWith("\r") ? "" : newline;
  const suffix = trailingWhitespace.startsWith("\n") || trailingWhitespace.startsWith("\r")
    ? trailingWhitespace
    : `${newline}${trailingWhitespace}`;
  const nextBody = `${content}${separator}${line}${suffix}`;
  return `${raw.slice(0, bodyStart)}${nextBody}${raw.slice(bodyEnd)}`;
}
