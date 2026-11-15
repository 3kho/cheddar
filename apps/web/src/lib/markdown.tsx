import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";

/**
 * Tiny markdown renderer for the legal/credits pages (content/*.md). Supports: # ## ### headings,
 * paragraphs, - / 1. lists, > quotes, --- rules, **bold**, *italic*, `code`, [links](url).
 * Raw HTML is never rendered. <!-- comment --> blocks are skipped.
 */

export function loadMarkdown(file: string): string {
  return readFileSync(path.join(process.cwd(), "content", file), "utf8");
}

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if ((m.index ?? 0) > last) out.push(text.slice(last, m.index ?? 0));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label = "", href = ""] = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(t) ?? [];
      const safe = /^(https?:|mailto:|\/|#)/.test(href);
      const external = /^https?:/.test(href);
      out.push(
        <a
          key={k}
          href={safe ? href : "#"}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="font-medium text-primary underline underline-offset-2"
        >
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = (m.index ?? 0) + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const L = (j: number) => lines[j] ?? "";
  const isBlockStart = (l: string) => /^(#{1,3} |- |\* |\d+\. |> |---+$|<!--)/.test(l);
  while (i < lines.length) {
    const line = L(i);
    const key = `b${n++}`;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("<!--")) {
      while (i < lines.length && !L(i).includes("-->")) i++;
      i++;
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      const level = (h[1] ?? "").length;
      const cls = ["text-3xl font-bold tracking-tight", "mt-10 text-xl font-semibold", "mt-6 text-base font-semibold"][level - 1] ?? "";
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(<Tag key={key} className={cls}>{inline(h[2] ?? "", key)}</Tag>);
      i++;
    } else if (/^---+$/.test(line)) {
      blocks.push(<hr key={key} className="my-8 border-line" />);
      i++;
    } else if (/^(- |\* )/.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(L(i)) : /^(- |\* )/.test(L(i)))) {
        items.push(<li key={i}>{inline(L(i).replace(/^(\d+\.|-|\*) /, ""), `${key}-${i}`)}</li>);
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={key} className={`ml-5 space-y-1.5 ${ordered ? "list-decimal" : "list-disc"}`}>{items}</Tag>);
    } else if (line.startsWith("> ")) {
      const parts: string[] = [];
      while (i < lines.length && L(i).startsWith("> ")) parts.push(L(i++).slice(2));
      blocks.push(
        <blockquote key={key} className="rounded-lg border-l-4 border-accent bg-accent-soft px-4 py-3 text-sm">
          {inline(parts.join(" "), key)}
        </blockquote>,
      );
    } else {
      const parts: string[] = [];
      while (i < lines.length && L(i).trim() && !isBlockStart(L(i))) parts.push(L(i++));
      blocks.push(<p key={key}>{inline(parts.join(" "), key)}</p>);
    }
  }
  return <div className="space-y-4 text-[15px] leading-relaxed">{blocks}</div>;
}
