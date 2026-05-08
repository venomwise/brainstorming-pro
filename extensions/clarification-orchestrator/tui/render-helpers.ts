/**
 * Derived from nicobailon/pi-subagents src/tui/render-helpers.ts.
 * Upstream notice token: pi-subagents@0.24.0.
 * Licensed under the MIT License; see vendor/pi-subagents/LICENSE and NOTICE.md.
 * Adapted for Brainstorming Pro read-only workflow TUI rendering semantics.
 */

export type WorkflowTheme = {
  fg(scope: "border" | "accent" | "dim", text: string): string;
};

const ansiPattern = /\u001B\[[0-?]*[ -/]*[@-~]/gu;

export function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

export function visibleWorkflowWidth(value: string): number {
  let width = 0;
  const plain = stripAnsi(value);
  for (const symbol of [...plain]) {
    width += symbolWidth(symbol);
  }
  return width;
}

export function truncateWorkflowToWidth(value: string, width: number): string {
  if (width <= 0) return "";
  let used = 0;
  let output = "";
  const chars = [...value];
  for (let index = 0; index < chars.length; index++) {
    const symbol = chars[index];
    if (symbol === "\u001B") {
      const remaining = chars.slice(index).join("");
      const match = remaining.match(/^\u001B\[[0-?]*[ -/]*[@-~]/u);
      if (match) {
        output += match[0];
        index += [...match[0]].length - 1;
        continue;
      }
    }
    const nextWidth = symbolWidth(symbol);
    if (used + nextWidth > width) break;
    output += symbol;
    used += nextWidth;
  }
  return output;
}

export function fuzzyFilterWorkflowItems<T extends { name: string; description: string; model?: string }>(items: T[], query: string): T[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return items;
  return items
    .map((item) => ({
      item,
      score: Math.max(
        fuzzyScore(normalizedQuery, item.name),
        fuzzyScore(normalizedQuery, item.description) * 0.8,
        fuzzyScore(normalizedQuery, item.model ?? "") * 0.6,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item);
}

export function padWorkflowText(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleWorkflowWidth(value)));
}

export function renderWorkflowRow(content: string, width: number, theme: WorkflowTheme): string {
  const innerWidth = Math.max(0, width - 2);
  const singleLine = content.replace(/[\r\n]+/g, " ").replace(/\t/g, "  ");
  const clipped = truncateWorkflowToWidth(singleLine, innerWidth);
  return theme.fg("border", "│") + padWorkflowText(clipped, innerWidth) + theme.fg("border", "│");
}

export function renderWorkflowHeader(text: string, width: number, theme: WorkflowTheme): string {
  const innerWidth = Math.max(0, width - 2);
  const padLength = Math.max(0, innerWidth - visibleWorkflowWidth(text));
  const padLeft = Math.floor(padLength / 2);
  const padRight = padLength - padLeft;
  return theme.fg("border", `╭${"─".repeat(padLeft)}`) + theme.fg("accent", text) + theme.fg("border", `${"─".repeat(padRight)}╮`);
}

export function formatWorkflowScrollInfo(above: number, below: number): string {
  let info = "";
  if (above > 0) info += `↑ ${above} more`;
  if (below > 0) info += `${info ? "  " : ""}↓ ${below} more`;
  return info;
}

export function renderWorkflowFooter(text: string, width: number, theme: WorkflowTheme): string {
  const innerWidth = Math.max(0, width - 2);
  const padLength = Math.max(0, innerWidth - visibleWorkflowWidth(text));
  const padLeft = Math.floor(padLength / 2);
  const padRight = padLength - padLeft;
  return theme.fg("border", `╰${"─".repeat(padLeft)}`) + theme.fg("dim", text) + theme.fg("border", `${"─".repeat(padRight)}╯`);
}

function fuzzyScore(query: string, text: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  if (!lowerQuery) return 0;
  if (lowerText.includes(lowerQuery)) return 100 + (lowerQuery.length / Math.max(1, lowerText.length)) * 50;

  let score = 0;
  let queryIndex = 0;
  let consecutive = 0;
  for (let textIndex = 0; textIndex < lowerText.length && queryIndex < lowerQuery.length; textIndex++) {
    if (lowerText[textIndex] === lowerQuery[queryIndex]) {
      score += 10 + consecutive;
      consecutive += 5;
      queryIndex++;
    } else {
      consecutive = 0;
    }
  }
  return queryIndex === lowerQuery.length ? score : 0;
}

function symbolWidth(symbol: string): number {
  if (/^[\u0300-\u036f\uFE00-\uFE0F]$/u.test(symbol)) return 0;
  const codePoint = symbol.codePointAt(0) ?? 0;
  if (codePoint === 0) return 0;
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff))
  ) {
    return 2;
  }
  return 1;
}
