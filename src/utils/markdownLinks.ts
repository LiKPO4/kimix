const HTTP_LINK_RE = /^https?:\/\/[^\s]+$/i;
const MAILTO_LINK_RE = /^mailto:[^\s]+$/i;
const CJK_SENTENCE_BOUNDARY_RE = /[，。！？；：、）】》」』”’]/u;

export type AutolinkSplit = {
  href: string;
  linkText: string;
  trailingText: string;
};

export function splitCjkTrailingTextFromAutolink(text: string): AutolinkSplit | null {
  if (!/^(https?:\/\/|mailto:)/i.test(text)) return null;

  const boundaryIndex = text.search(CJK_SENTENCE_BOUNDARY_RE);
  if (boundaryIndex <= 0) return null;

  const linkText = text.slice(0, boundaryIndex);
  if (!HTTP_LINK_RE.test(linkText) && !MAILTO_LINK_RE.test(linkText)) return null;

  return {
    href: linkText,
    linkText,
    trailingText: text.slice(boundaryIndex),
  };
}
