import { env } from "@/lib/env";
import { marketEmbedState } from "@/lib/market-embed";
import { getWheel } from "@/lib/queries";

export const dynamic = "force-dynamic";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * A frameless card for iframes. Social unfurls use the wheel page's Open Graph image;
 * this route is the embed you can drop on another page:
 * <iframe src="{APP_URL}/embed/{slug}" title="…" width="380" height="280"></iframe>
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const data = await getWheel(slug);
  if (!data) return new Response("Market not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  const { wheel } = data;
  const pending = data.settlement?.status === "pending";
  const state = marketEmbedState(wheel, pending);
  const href = `${env.appUrl}/wheel/${encodeURIComponent(wheel.slug)}`;
  const rows =
    wheel.wedges.length > 1
      ? state.outcomes
          .map(
            (o) =>
              `<div class="row"><span>${esc(o.label)}</span><b>${esc(o.chance)}</b></div>`,
          )
          .join("")
      : "";
  const banner = pending
    ? `<p class="banner">An outcome has been proposed. Trading stays open while it is reviewed.</p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(wheel.title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font: 14px/1.35 ui-sans-serif, system-ui, sans-serif;
    background: #0c0e13;
    color: #f4f5f7;
  }
  a.card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 100%;
    padding: 16px 16px 14px;
    color: inherit;
    text-decoration: none;
  }
  a.card:hover { background: #12151c; }
  .status {
    align-self: flex-start;
    border-radius: 999px;
    background: ${pending ? "#3a2e14" : "#1c212b"};
    color: ${pending ? "#f5b83d" : "#c8cdd4"};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 3px 8px;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
    letter-spacing: -0.02em;
  }
  .chance {
    margin: 0;
    color: #8eb4ff;
    font-size: 40px;
    font-weight: 750;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }
  .chance span { margin-left: 6px; color: #fda444; font-size: 16px; font-weight: 650; letter-spacing: 0; }
  .vol { margin: 0; color: #9aa1ab; font-variant-numeric: tabular-nums; }
  .banner {
    margin: 0;
    border-radius: 8px;
    background: #3a2e14;
    color: #f5b83d;
    padding: 8px 10px;
    font-size: 12px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-top: 6px;
    border-top: 1px solid #232833;
    font-variant-numeric: tabular-nums;
  }
  .row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row b { color: #8eb4ff; }
  .go { margin-top: auto; color: #9aa1ab; font-size: 12px; font-weight: 650; }
  a.card:hover .go { color: #f4f5f7; }
</style>
<a class="card" href="${esc(href)}" target="_blank" rel="noopener">
  <span class="status">${esc(state.statusLabel)}</span>
  <h1>${esc(wheel.title)}</h1>
  <p class="chance">${esc(state.chanceLabel)}${state.chanceCaption ? `<span>${esc(state.chanceCaption)}</span>` : ""}</p>
  <p class="vol">${esc(state.volumeLabel)}</p>
  ${banner}
  ${rows}
  <div class="go">Trade on Cheddar</div>
</a>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=15",
    },
  });
}
