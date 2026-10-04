import TurndownService from "turndown";

/**
 * The repo's one HTML-to-markdown configuration.
 *
 * Extracted from `lib/shared-docs/docx.ts` when a second caller appeared (the
 * derived markdown copy of a designed HTML document). Two turndown setups would
 * drift, and the table rules below are the part that took work to get right, so
 * they live in one place.
 */

/** Collapse a cell to one line: a newline or a bare pipe breaks the markdown row. */
function cellText(content: string): string {
  return content.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * Turndown, with table rules written here: `turndown-plugin-gfm` emits raw HTML
 * for any table without a `<th>` row, and Word tables have none. The first row
 * is treated as the header.
 */
export function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  service.addRule("tableCell", {
    filter: ["th", "td"],
    replacement: (content) => `| ${cellText(content)} `,
  });
  service.addRule("tableRow", {
    filter: "tr",
    replacement: (content) => `${content}|\n`,
  });
  service.addRule("tableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement: (content) => content,
  });
  service.addRule("table", {
    filter: "table",
    replacement: (content, node) => {
      const rows = content.split("\n").filter((line) => line.trim() !== "");
      const columns = (node as unknown as HTMLTableElement).rows?.[0]?.childNodes.length ?? 0;
      if (rows.length === 0 || columns === 0) return "";
      const separator = `|${" --- |".repeat(columns)}`;
      return `\n\n${[rows[0], separator, ...rows.slice(1)].join("\n")}\n\n`;
    },
  });
  service.addRule("strikethrough", {
    filter: ["s", "del"],
    replacement: (content) => `~~${content}~~`,
  });
  // Turndown's image rule renders nothing when `src` is empty, losing the alt text.
  service.addRule("droppedImage", {
    filter: "img",
    replacement: (_content, node) => (node as unknown as HTMLImageElement).getAttribute("alt")?.trim() ?? "",
  });

  return service;
}
