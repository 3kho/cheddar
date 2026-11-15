import { Markdown, loadMarkdown } from "@/lib/markdown";

export const metadata = { title: "Credits · Cheddar" };

// Edit the text in apps/web/content/credits.md. No code changes needed.
export default function Page() {
  return (
    <article className="mx-auto max-w-2xl py-4">
      <Markdown source={loadMarkdown("credits.md")} />
    </article>
  );
}
