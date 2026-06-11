import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import githubCssUrl from "highlight.js/styles/github.css?url";
import githubDarkCssUrl from "highlight.js/styles/github-dark.css?url";
import { restoreMarkdownTables } from "@/utils/assistantParagraphs";

interface MarkdownRendererProps {
  content: string;
  wrapLongLines?: boolean;
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

function CodeBlock({ className, children, wrapLongLines }: { className?: string; children?: React.ReactNode; wrapLongLines: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    <div className="relative my-3 overflow-hidden rounded-lg border border-border-subtle bg-surface-base">
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
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre
        className={`${wrapLongLines ? "overflow-x-hidden" : "overflow-x-auto"} bg-surface-base`}
        style={{
          paddingLeft: 18,
          paddingRight: 18,
          paddingTop: 14,
          paddingBottom: 14,
          whiteSpace: wrapLongLines ? "pre-wrap" : undefined,
          overflowWrap: wrapLongLines ? "anywhere" : undefined,
          wordBreak: wrapLongLines ? "break-word" : undefined,
        }}
      >
        <code
          className={`${className ?? ""} block font-mono text-sm leading-6`}
          style={{
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

export function MarkdownRenderer({ content, wrapLongLines = false }: MarkdownRendererProps) {
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
                overflowWrap: wrapLongLines ? "anywhere" : undefined,
                wordBreak: wrapLongLines ? "break-word" : undefined,
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

  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);
  const normalizedContent = useMemo(() => restoreMarkdownTables(content), [content]);

  return (
    <div className={`markdown-body ${wrapLongLines ? "kimix-markdown-wrap-long-lines" : ""}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
