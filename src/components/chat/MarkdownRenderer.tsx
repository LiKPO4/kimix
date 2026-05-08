import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useEffect, useMemo } from "react";
import githubCssUrl from "highlight.js/styles/github.css?url";
import githubDarkCssUrl from "highlight.js/styles/github-dark.css?url";

interface MarkdownRendererProps {
  content: string;
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

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
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
      code: ({ inline, className: codeClassName, children }: { inline?: boolean; className?: string; children?: React.ReactNode }) => {
        if (inline) {
          return (
            <code className="px-1.5 py-0.5 rounded-md bg-bg-tertiary text-accent-purple text-sm font-mono">
              {children}
            </code>
          );
        }
        return (
          <div className="relative my-3 rounded-xl overflow-hidden border border-border-default">
            <div className="flex items-center justify-between px-3 py-2 bg-bg-tertiary border-b border-border-default">
              <span className="text-xs text-text-muted font-mono">
                {codeClassName?.replace("language-", "") || "code"}
              </span>
            </div>
            <pre className="p-3 overflow-x-auto bg-bg-secondary">
              <code className={`${codeClassName} text-sm font-mono`}>{children}</code>
            </pre>
          </div>
        );
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
        <div className="overflow-x-auto my-3 rounded-lg border border-border-default">
          <table className="w-full text-sm text-text-primary">{children}</table>
        </div>
      ),
      thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-bg-tertiary text-text-secondary font-medium">{children}</thead>,
      th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2 text-left border-b border-border-default">{children}</th>,
      td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 border-b border-border-subtle">{children}</td>,
      hr: () => <hr className="my-4 border-border-default" />,
    }),
    []
  );

  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
