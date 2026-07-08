export type ReleaseFeedAsset = {
  name: string;
  downloadUrl: string;
  size?: number;
};

export type ReleaseFeedItem = {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: ReleaseFeedAsset[];
};

export function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function linkAttribute(link: string, name: string) {
  const match = link.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXmlText(match?.[1] ?? match?.[2] ?? "");
}

function safeTagName(htmlUrl: string, title: string) {
  const encodedTag = htmlUrl.split("/tag/")[1]?.split(/[?#]/, 1)[0];
  if (!encodedTag) return title;
  try {
    return decodeURIComponent(encodedTag);
  } catch {
    return encodedTag;
  }
}

function enclosureAssets(entry: string): ReleaseFeedAsset[] {
  return [...entry.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((link) => linkAttribute(link, "rel").toLowerCase() === "enclosure")
    .map((link) => {
      const downloadUrl = linkAttribute(link, "href");
      const urlName = downloadUrl.split(/[?#]/, 1)[0]?.split("/").pop() ?? "";
      const name = linkAttribute(link, "title") || urlName || "下载文件";
      const parsedSize = Number.parseInt(linkAttribute(link, "length"), 10);
      return {
        name,
        downloadUrl,
        size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : undefined,
      };
    })
    .filter((asset) => asset.downloadUrl.length > 0);
}

export function parseReleaseAtom(xml: string, limit: number, releasesUrl: string): ReleaseFeedItem[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .slice(0, limit)
    .map((match) => {
      const entry = match[1];
      const title = decodeXmlText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "");
      const publishedAt = entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim() ?? "";
      const alternateLink = [...entry.matchAll(/<link\b[^>]*>/gi)]
        .map((link) => link[0])
        .find((link) => linkAttribute(link, "rel").toLowerCase() === "alternate");
      const htmlUrl = alternateLink ? linkAttribute(alternateLink, "href") || releasesUrl : releasesUrl;
      const encodedBody = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "";
      const body = decodeXmlText(encodedBody)
        .replace(/<\/?(?:h\d|p|ul|ol)[^>]*>/gi, "\n")
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<\/li>/gi, "")
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        tagName: safeTagName(htmlUrl, title),
        name: title,
        body,
        publishedAt,
        htmlUrl,
        assets: enclosureAssets(entry),
      };
    })
    .filter((release) => release.tagName);
}
