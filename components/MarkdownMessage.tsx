"use client";

// Safe markdown renderer for assistant messages.
// react-markdown renders to React elements (never dangerouslySetInnerHTML) and
// strips raw HTML by default, so there is no XSS risk from message content.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-xl font-bold mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold mt-2 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="font-semibold mt-2 mb-1">{children}</h3>,
  h4: ({ children }) => <h4 className="font-semibold mt-1 mb-0.5">{children}</h4>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-current/30 pl-3 my-2 italic opacity-80">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="bg-black/10 rounded-lg p-3 overflow-x-auto my-2 font-mono text-sm leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ children, className }) =>
    /^language-/.test(className ?? "") ? (
      // Block code – `pre` parent already provides background/padding
      <code className={className}>{children}</code>
    ) : (
      // Inline code
      <code className="bg-black/10 rounded px-1 py-0.5 font-mono text-[0.875em]">
        {children}
      </code>
    ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 opacity-80 hover:opacity-100"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="border-current/20 my-3" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="border-collapse text-sm w-full">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-current/20 px-2 py-1 font-semibold text-left bg-current/5">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-current/20 px-2 py-1">{children}</td>
  ),
};

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}
