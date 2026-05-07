import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-bold mt-4 mb-3 text-text-primary leading-tight">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-3 mb-2 text-text-primary leading-tight">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-3 mb-2 text-text-primary leading-tight">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed text-text-primary">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3 space-y-1 text-text-primary">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3 space-y-1 text-text-primary">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ children, className: codeClassName }) => {
            const isInline = !codeClassName;
            if (isInline) {
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
          pre: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-accent-blue pl-4 py-1 my-3 text-text-secondary italic bg-bg-secondary/50 rounded-r-lg">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => {
            const safeHref = href?.startsWith("http://") || href?.startsWith("https://") || href?.startsWith("mailto:") ? href : "#";
            return (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-blue hover:underline"
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-border-default">
              <table className="w-full text-sm text-text-primary">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-bg-tertiary text-text-secondary font-medium">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 text-left border-b border-border-default">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 border-b border-border-subtle">{children}</td>,
          hr: () => <hr className="my-4 border-border-default" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
