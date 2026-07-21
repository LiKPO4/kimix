export type ReleaseFeedAsset = {
  name: string;
  downloadUrl: string;
  size?: number;
  sha256?: string;
  sha512?: string;
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

export function normalizeReleaseTag(tagName: string) {
  return tagName.trim().replace(/^v/i, "").toLowerCase();
}

export function electronBuilderLatestYmlName(platform: string = process.platform) {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "linux") return "latest-linux.yml";
  return "latest.yml";
}

export function buildGithubReleaseAssetUrl(repo: string, tagName: string, fileName: string) {
  const tag = tagName.trim() || "latest";
  const encodedTag = encodeURIComponent(tag).replace(/%2F/gi, "/");
  const encodedName = encodeURIComponent(fileName).replace(/%2F/gi, "/");
  return `https://github.com/${repo}/releases/download/${encodedTag}/${encodedName}`;
}

function stripYamlScalar(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse electron-builder publish metadata (latest.yml / latest-mac.yml / latest-linux.yml).
 * Avoids a runtime YAML dependency; only the fields Kimix needs are supported.
 */
export function parseElectronBuilderLatestYml(
  yml: string,
  repo: string,
): {
  version: string;
  tagName: string;
  publishedAt?: string;
  assets: ReleaseFeedAsset[];
} | null {
  const version = yml.match(/^\s*version:\s*(.+)\s*$/m)?.[1];
  if (!version) return null;
  const normalizedVersion = stripYamlScalar(version);
  if (!normalizedVersion) return null;
  const tagName = normalizedVersion.startsWith("v") || normalizedVersion.startsWith("V")
    ? normalizedVersion
    : `v${normalizedVersion}`;
  const releaseDateRaw = yml.match(/^\s*releaseDate:\s*(.+)\s*$/m)?.[1];
  const publishedAt = releaseDateRaw ? stripYamlScalar(releaseDateRaw) : undefined;

  const assets: ReleaseFeedAsset[] = [];
  const lines = yml.split(/\r?\n/);
  let inFiles = false;
  let current: { url?: string; sha512?: string; size?: number } | null = null;

  const flush = () => {
    if (!current?.url) {
      current = null;
      return;
    }
    const urlOrName = current.url;
    const name = urlOrName.split(/[?#]/, 1)[0]?.split("/").pop() || urlOrName;
    const downloadUrl = /^https?:\/\//i.test(urlOrName)
      ? urlOrName
      : buildGithubReleaseAssetUrl(repo, tagName, name);
    assets.push({
      name,
      downloadUrl,
      size: current.size,
      sha512: current.sha512,
    });
    current = null;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;

    if (/^\s*files:\s*$/.test(raw)) {
      flush();
      inFiles = true;
      continue;
    }

    if (inFiles && raw.length > 0 && !/^\s/.test(raw)) {
      flush();
      inFiles = false;
    }

    if (!inFiles) continue;

    const urlMatch = raw.match(/^\s*-\s*url:\s*(.+)\s*$/);
    if (urlMatch) {
      flush();
      current = { url: stripYamlScalar(urlMatch[1]) };
      continue;
    }

    if (!current) continue;

    const shaMatch = raw.match(/^\s*sha512:\s*(.+)\s*$/);
    if (shaMatch) {
      current.sha512 = stripYamlScalar(shaMatch[1]);
      continue;
    }

    const sizeMatch = raw.match(/^\s*size:\s*(\d+)\s*$/);
    if (sizeMatch) {
      const size = Number.parseInt(sizeMatch[1], 10);
      if (Number.isFinite(size) && size > 0) current.size = size;
    }
  }
  flush();

  if (assets.length === 0) return null;
  return { version: normalizedVersion, tagName, publishedAt, assets };
}

export function mergeReleaseAssets<T extends ReleaseFeedAsset>(
  base: T[],
  extra: T[],
): T[] {
  const byName = new Map<string, T>();
  for (const asset of base) {
    byName.set(asset.name, asset);
  }
  for (const asset of extra) {
    const existing = byName.get(asset.name);
    if (!existing) {
      byName.set(asset.name, asset);
      continue;
    }
    byName.set(asset.name, {
      ...existing,
      ...asset,
      downloadUrl: existing.downloadUrl || asset.downloadUrl,
      size: existing.size ?? asset.size,
      sha256: existing.sha256 ?? asset.sha256,
      sha512: existing.sha512 ?? asset.sha512,
    });
  }
  return [...byName.values()];
}

export function releaseHasInstallerAsset(assets: { name: string }[]) {
  return assets.some((asset) => /\.(exe|dmg|zip|appimage|deb)$/i.test(asset.name));
}
