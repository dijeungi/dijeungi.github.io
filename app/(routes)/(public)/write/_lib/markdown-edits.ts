import type { MarkdownEdit, MarkdownFormat } from "../_types/writer";

// 선택한 글자와 줄에 마크다운 서식 적용
export function getMarkdownEdit(value: string, from: number, to: number, format: MarkdownFormat, href = ""): MarkdownEdit {
  const start = Math.max(0, Math.min(from, value.length));
  const end = Math.max(start, Math.min(to, value.length));
  const selected = value.slice(start, end);
  if (format === "bold" || format === "italic" || format === "strike") {
    const marker = format === "bold" ? "**" : format === "italic" ? "*" : "~~";
    if (start >= marker.length && value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker) {
      return { value: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length), start: start - marker.length, end: end - marker.length };
    }
    const text = selected || "텍스트";
    return { value: value.slice(0, start) + marker + text + marker + value.slice(end), start: start + marker.length, end: start + marker.length + text.length };
  }
  if (format === "link") {
    const text = (selected || "링크").replace(/[[\]\\]/g, "\\$&");
    const destination = href.replace(/[()\\]/g, "\\$&");
    return { value: value.slice(0, start) + "[" + text + "](" + destination + ")" + value.slice(end), start: start + 1, end: start + 1 + text.length };
  }
  if (format === "code") {
    const codeCharacter = String.fromCharCode(96);
    const runs = selected.match(new RegExp(codeCharacter + "+", "g")) || [];
    const fence = codeCharacter.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    const prefix = start && !value.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
    const suffix = end < value.length && !value.slice(end).startsWith("\n\n") ? "\n\n" : "";
    const text = selected || "const count = 0;";
    const opening = prefix + fence + "tsx\n";
    return { value: value.slice(0, start) + opening + text + "\n" + fence + suffix + value.slice(end), start: start + opening.length, end: start + opening.length + text.length };
  }
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end > start ? end - 1 : end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const pattern = format === "heading1" ? /^# / : format === "heading2" ? /^## / : format === "heading3" ? /^### / : format === "quote" ? /^> / : format === "numbers" ? /^\d+\. / : /^- /;
  const removing = lines.every((line) => pattern.test(line));
  const replacement = lines.map((line, index) => {
    if (removing) return line.replace(pattern, "");
    const marker = format === "heading1" ? "# " : format === "heading2" ? "## " : format === "heading3" ? "### " : format === "quote" ? "> " : format === "numbers" ? String(index + 1) + ". " : "- ";
    return marker + line.replace(/^(?:#{1,6} |> |\d+\. |[-+*] )/, "");
  }).join("\n");
  return { value: value.slice(0, lineStart) + replacement + value.slice(lineEnd), start: lineStart, end: lineStart + replacement.length };
}

// 본문 선택 위치에 업로드 이미지 문법 삽입
export function getMarkdownImageEdit(value: string, start: number, end: number, src: string, alt: string): MarkdownEdit {
  const label = alt.replace(/[\r\n]+/g, " ").replace(/[\\[\]*_\x60<>!&]/g, "\\$&");
  const destination = src.replace(/[()\\]/g, "\\$&");
  const prefix = start && !value.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
  const suffix = end < value.length ? "\n\n" : "\n";
  const image = prefix + "![" + label + "](" + destination + ")" + suffix;
  const position = start + image.length;
  return { value: value.slice(0, start) + image + value.slice(end), start: position, end: position };
}

// 선택 내용을 유지한 줄 들여쓰기와 내어쓰기
export function getMarkdownIndentEdit(value: string, start: number, end: number, outdent = false): MarkdownEdit {
  if (start === end && !outdent) {
    return { value: value.slice(0, start) + "  " + value.slice(end), start: start + 2, end: start + 2 };
  }
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end > start ? end - 1 : end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const updated = lines.map((line) => outdent ? line.replace(/^(?: {1,2}|\t)/, "") : "  " + line);
  const replacement = updated.join("\n");
  const firstDelta = updated[0].length - lines[0].length;
  const totalDelta = replacement.length - (lineEnd - lineStart);
  const nextStart = Math.max(lineStart, start + firstDelta);
  return { value: value.slice(0, lineStart) + replacement + value.slice(lineEnd), start: nextStart, end: Math.max(nextStart, end + totalDelta) };
}
