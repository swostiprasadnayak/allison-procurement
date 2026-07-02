"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a Mercer answer (markdown + GFM tables) inside the narrow copilot
 * panel. Headings/lists/code use DS tokens; tables are wrapped in their own
 * horizontally-scrollable container so a wide table never makes the ~420px
 * panel overflow sideways.
 */

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1.5 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2.5 mb-1 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="my-1.5 text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium underline"
      style={{ color: "#59349C" }}
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
      {children}
    </strong>
  ),
  code: ({ children, className }) => {
    // Block code carries a language-* class; inline code does not.
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code
          className="block overflow-x-auto rounded-md p-2.5 font-mono text-[12px] leading-relaxed"
          style={{ background: "var(--muted)", color: "var(--text-primary)" }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded px-1 py-0.5 font-mono text-[12px]"
        style={{ background: "var(--muted)", color: "var(--text-primary)" }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote
      className="my-2 border-l-2 pl-3 text-[13px] italic"
      style={{ borderColor: "#E3D2FF", color: "var(--text-secondary)" }}
    >
      {children}
    </blockquote>
  ),
  // GFM tables — kept inside their own scroll container so the panel body never
  // scrolls horizontally.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border-light)" }}>
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: "var(--surface-raised)" }}>{children}</thead>
  ),
  th: ({ children }) => (
    <th
      className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold"
      style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border-light)" }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      className="px-2.5 py-1.5 align-top"
      style={{ color: "var(--text-primary)", borderTop: "1px solid var(--border-light)", fontVariantNumeric: "tabular-nums" }}
    >
      {children}
    </td>
  ),
  hr: () => <hr className="my-3" style={{ border: "none", borderTop: "1px solid var(--border-light)" }} />,
};

export function MercerMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
