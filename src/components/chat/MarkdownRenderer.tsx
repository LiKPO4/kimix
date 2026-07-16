import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Lexer } from "marked";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import githubCssUrl from "highlight.js/styles/github.css?url";
import githubDarkCssUrl from "highlight.js/styles/github-dark.css?url";
import { normalizeIndentedFencedCodeBlocks, normalizeNestedMarkdownFencedCodeBlocks, restoreAssistantProgressParagraphs, restoreInlineMarkdownHeadings, restoreMarkdownTables } from "@/utils/assistantParagraphs";
import { splitCjkTrailingTextFromAutolink } from "@/utils/markdownLinks";
import { truncateMarkdownForPreview } from "@/utils/markdownTruncate";
import { StateIconSwap } from "@/components/common/StateIconSwap";

interface MarkdownRendererProps {
  content: string;
  wrapLongLines?: boolean;
  deferOffscreen?: boolean;
  collapsibleThreshold?: number;
  streaming?: boolean;
  normalizeAssistantProgress?: boolean;
}

// Module-level ref-counted theme link
let hljsLinkRefCount = 0;
let hljsLinkEl: HTMLLinkElement | null = null;

function updateHljsTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (!hljsLinkEl) {
    hljsLinkEl = document.createElement("link");
    hljsLinkEl.id = "hljs-theme";
    hljsLinkEl.rel = "stylesheet";
    document.head.appendChild(hljsLinkEl);
  }
  hljsLinkEl.href = isDark ? githubDarkCssUrl : githubCssUrl;
}

function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return "";
}

function estimateMarkdownHeight(content: string) {
  const lineCount = content.split(/\r?\n/).length;
  const textRows = Math.ceil(content.length / 88);
  return Math.max(72, Math.min(560, Math.max(lineCount, textRows) * 24));
}

const DEFAULT_COLLAPSIBLE_THRESHOLD = 50_000;

const DEFERRED_RENDER_MARGIN = 1800;

export function splitStreamingMarkdownBlocks(content: string): string[] {
  if (!content) return [];
  const blocks = Lexer.lex(content, { gfm: true })
    .map((token) => token.raw)
    .filter((block) => block.length > 0);
  return blocks.length > 0 ? blocks : [content];
}

/**
 * Normalize assistant markdown content before rendering.
 *
 * Design choice: streaming / active assistant messages use only
 * `restoreAssistantProgressParagraphs` so that each incoming delta does
 * not re-trigger expensive fixes (nested code blocks, indented fenced
 * blocks, table restoration, inline headings). Those heavier
 * normalizations are deferred to the completed message path, where the
 * full content is stable and the cost is paid once.
 */
export function normalizeMarkdownContent(content: string, normalizeAssistantProgress = false): string {
  if (normalizeAssistantProgress) return restoreAssistantProgressParagraphs(content);
  return restoreInlineMarkdownHeadings(restoreMarkdownTables(normalizeIndentedFencedCodeBlocks(normalizeNestedMarkdownFencedCodeBlocks(content))));
}

const StreamingMarkdownBlock = React.memo(function StreamingMarkdownBlock({
  content,
  components,
  remarkPlugins,
  rehypePlugins,
}: {
  content: string;
  components: Components;
  remarkPlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
  rehypePlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
}) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {content}
    </ReactMarkdown>
  );
});

function StreamingMarkdown({
  content,
  components,
  remarkPlugins,
  rehypePlugins,
}: {
  content: string;
  components: Components;
  remarkPlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
  rehypePlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
}) {
  const blocks = useMemo(() => splitStreamingMarkdownBlocks(content), [content]);
  return (
    <div className="kimix-streaming-markdown">
      {blocks.map((block, index) => (
        <StreamingMarkdownBlock
          key={index}
          content={block}
          components={components}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
        />
      ))}
    </div>
  );
}

function isNearViewport(node: HTMLElement, margin = DEFERRED_RENDER_MARGIN) {
  const rect = node.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  return rect.bottom >= -margin &&
    rect.top <= viewportHeight + margin &&
    rect.right >= -margin &&
    rect.left <= viewportWidth + margin;
}

function getScrollableAncestors(node: HTMLElement) {
  const parents: Array<HTMLElement | Window> = [window];
  let parent = node.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(`${style.overflowY}${style.overflow}`)) {
      parents.push(parent);
    }
    parent = parent.parentElement;
  }
  return parents;
}

function CodeBlock({ className, children, wrapLongLines }: { className?: string; children?: React.ReactNode; wrapLongLines: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const codeText = nodeText(children).replace(/\n$/, "");

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const copyCode = async () => {
    await navigator.clipboard.writeText(codeText);
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      className="kimix-markdown-code-block relative my-3 overflow-hidden rounded-lg border border-border-subtle bg-surface-base"
      style={{ boxSizing: "border-box" }}
    >
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface-hover" style={{ gap: 12, paddingLeft: 18, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
        <span className="min-w-0 truncate font-mono text-xs text-text-muted">
          {className?.replace("language-", "") || "code"}
        </span>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="kimix-icon-text-button is-compact shrink-0 text-text-muted hover:bg-surface-active hover:text-text-secondary"
          style={{ minHeight: 30, paddingLeft: 11, paddingRight: 12 }}
          title="复制代码"
          aria-label="复制代码"
        >
          <StateIconSwap
            active={copied}
            activeIcon={<Check size={13} />}
            inactiveIcon={<Copy size={13} />}
          />
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre
        className={`${wrapLongLines ? "overflow-x-hidden" : "overflow-x-auto"} bg-surface-base`}
        style={{
          margin: 0,
          display: "block",
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          paddingLeft: 18,
          paddingRight: 18,
          paddingTop: 16,
          paddingBottom: 16,
          whiteSpace: wrapLongLines ? "pre-wrap" : undefined,
          overflowWrap: wrapLongLines ? "anywhere" : undefined,
          wordBreak: wrapLongLines ? "break-word" : undefined,
        }}
      >
        <code
          className={`${className ?? ""} block font-mono text-sm leading-6`}
          style={{
            display: "block",
            margin: 0,
            padding: 0,
            width: "max-content",
            minWidth: "100%",
            background: "transparent",
            lineHeight: "24px",
            whiteSpace: wrapLongLines ? "pre-wrap" : undefined,
            overflowWrap: wrapLongLines ? "anywhere" : undefined,
            wordBreak: wrapLongLines ? "break-word" : undefined,
          }}
        >
          {children}
        </code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, wrapLongLines = false, deferOffscreen = false, collapsibleThreshold = DEFAULT_COLLAPSIBLE_THRESHOLD, streaming = false, normalizeAssistantProgress = false }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(!deferOffscreen);
  const [isExpanded, setIsExpanded] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const normalizedContent = useMemo(
    () => normalizeMarkdownContent(content, normalizeAssistantProgress),
    [content, normalizeAssistantProgress],
  );
  const isCollapsible = collapsibleThreshold > 0 && normalizedContent.length > collapsibleThreshold;
  const displayContent = useMemo(() => {
    if (!isCollapsible || isExpanded) return normalizedContent;
    return truncateMarkdownForPreview(normalizedContent, collapsibleThreshold);
  }, [isCollapsible, isExpanded, normalizedContent, collapsibleThreshold]);

  // 只在内容首次超过阈值、从可折叠变为不可折叠时重置折叠状态；
  // 避免流式输出每次更新都重新折叠已展开内容。
  useEffect(() => {
    if (isCollapsible) {
      setIsExpanded(false);
    }
  }, [isCollapsible]);

  useLayoutEffect(() => {
    if (!deferOffscreen) {
      setShouldRender(true);
      return;
    }
    const node = containerRef.current;
    if (node && isNearViewport(node)) {
      setShouldRender(true);
      return;
    }
    setShouldRender(false);
  }, [normalizedContent, deferOffscreen]);

  useEffect(() => {
    if (!deferOffscreen || shouldRender) return;
    const node = containerRef.current;
    if (!node) return;
    let frame = 0;
    const revealIfNear = () => {
      frame = 0;
      if (!containerRef.current || !isNearViewport(containerRef.current)) return false;
      setShouldRender(true);
      return true;
    };
    const scheduleReveal = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        void revealIfNear();
      });
    };
    if (revealIfNear()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "1600px 0px", threshold: 0.01 },
    );
    observer.observe(node);
    const scrollableParents = getScrollableAncestors(node);
    scrollableParents.forEach((parent) => parent.addEventListener("scroll", scheduleReveal, { passive: true }));
    window.addEventListener("resize", scheduleReveal);
    return () => {
      observer.disconnect();
      scrollableParents.forEach((parent) => parent.removeEventListener("scroll", scheduleReveal));
      window.removeEventListener("resize", scheduleReveal);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [deferOffscreen, shouldRender]);

  useEffect(() => {
    hljsLinkRefCount++;
    updateHljsTheme();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "data-theme") updateHljsTheme();
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => {
      observer.disconnect();
      hljsLinkRefCount--;
      if (hljsLinkRefCount === 0 && hljsLinkEl) {
        document.head.removeChild(hljsLinkEl);
        hljsLinkEl = null;
      }
    };
  }, []);

  const components = useMemo(
    () => ({
      h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 className="text-xl font-bold mt-4 mb-3 text-text-primary leading-tight">{children}</h1>
      ),
      h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 className="text-lg font-semibold mt-3 mb-2 text-text-primary leading-tight">{children}</h2>
      ),
      h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 className="text-base font-semibold mt-3 mb-2 text-text-primary leading-tight">{children}</h3>
      ),
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="mb-3 leading-relaxed text-text-primary">{children}</p>
      ),
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="list-disc pl-5 mb-3 space-y-1 text-text-primary">{children}</ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="list-decimal pl-5 mb-3 space-y-1 text-text-primary">{children}</ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
      code: ({ className: codeClassName, children }: { className?: string; children?: React.ReactNode }) => {
        const content = nodeText(children);
        const isBlock = Boolean(codeClassName) || content.includes("\n");
        if (!isBlock) {
          return (
            <code
              className="rounded-md bg-surface-hover font-mono text-[0.9em] text-text-primary"
              style={{
                marginLeft: 2,
                marginRight: 2,
                padding: "2px 6px",
                lineHeight: 1.55,
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {children}
            </code>
          );
        }
        return <CodeBlock className={codeClassName} wrapLongLines={wrapLongLines}>{children}</CodeBlock>;
      },
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="border-l-4 border-accent-blue pl-4 py-1 my-3 text-text-secondary italic bg-bg-secondary/50 rounded-r-lg">
          {children}
        </blockquote>
      ),
      a: ({ children, href }: { children?: React.ReactNode; href?: string }) => {
        const safe = href?.startsWith("http://") || href?.startsWith("https://") || href?.startsWith("mailto:");
        if (!safe) {
          return <span className="text-text-secondary">{children}</span>;
        }
        const split = splitCjkTrailingTextFromAutolink(nodeText(children));
        if (split) {
          return (
            <>
              <a
                href={split.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-blue hover:underline"
              >
                {split.linkText}
              </a>
              {split.trailingText}
            </>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue hover:underline"
          >
            {children}
          </a>
        );
      },
      table: ({ children }: { children?: React.ReactNode }) => (
        <div
          className={`rounded-lg ${wrapLongLines ? "overflow-x-hidden" : "overflow-x-auto"}`}
          style={{ border: "1px solid #ded8ce", marginTop: 8, marginBottom: 14 }}
        >
          <table
            className="w-full text-sm text-text-primary"
            style={{
              borderColor: "#e5e1d8",
              margin: 0,
              minWidth: "100%",
              width: "100%",
              tableLayout: "fixed",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-bg-tertiary text-text-secondary font-medium">{children}</thead>,
      th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2 text-left" style={{ border: "1px solid #e5e1d8", overflowWrap: "anywhere", wordBreak: "break-word", verticalAlign: "top" }}>{children}</th>,
      td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2" style={{ border: "1px solid #eee9e1", overflowWrap: "anywhere", wordBreak: "break-word", verticalAlign: "top" }}>{children}</td>,
      hr: () => <hr className="my-4 border-border-default" />,
      del: ({ children }: { children?: React.ReactNode }) => <span>~{children}~</span>,
    }),
    [wrapLongLines]
  );

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex, rehypeHighlight], []);
  const placeholderHeight = measuredHeight ?? estimateMarkdownHeight(displayContent);

  useLayoutEffect(() => {
    if (!shouldRender) return;
    const node = containerRef.current;
    if (!node) return;
    const height = node.getBoundingClientRect().height;
    if (height > 0) setMeasuredHeight(height);
  }, [shouldRender, displayContent]);

  if (!shouldRender) {
    return (
      <div
        ref={containerRef}
        className={`markdown-body ${wrapLongLines ? "kimix-markdown-wrap-long-lines" : ""}`}
        style={{ minHeight: placeholderHeight, contentVisibility: "auto", containIntrinsicSize: `${Math.round(placeholderHeight)}px` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`markdown-body ${wrapLongLines ? "kimix-markdown-wrap-long-lines" : ""}`}
    >
      {streaming ? (
        <StreamingMarkdown
          content={displayContent}
          components={components}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
        />
      ) : (
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
          {displayContent}
        </ReactMarkdown>
      )}
      {isCollapsible && !isExpanded && (
        <div className="flex justify-center" style={{ paddingTop: 12, paddingBottom: 8 }}>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="kimix-icon-text-button kimix-muted-action"
            style={{ minHeight: 34, paddingLeft: 16, paddingRight: 16 }}
          >
            <ChevronDown size={15} />
            <span>内容较长，点击展开剩余 {normalizedContent.length - displayContent.length} 字符</span>
          </button>
        </div>
      )}
    </div>
  );
}
