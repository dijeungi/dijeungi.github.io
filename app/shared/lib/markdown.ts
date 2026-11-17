import MarkdownIt from "markdown-it";
import { Image } from "@tiptap/extension-image";
import { StarterKit } from "@tiptap/starter-kit";
import { getSchema, flattenExtensions } from "@tiptap/core";
import { MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown";

import type Token from "markdown-it/lib/token.mjs";
import type { RichNode, RichDocument } from "../types/content";

// 일반 HTML 없이 밑줄 표기만 처리하는 인라인 규칙 등록
function enableUnderline(markdown: MarkdownIt) {
  let nesting = 0;
  const maximumNesting = 20;
  markdown.inline.ruler.before("html_inline", "underline", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 3).toLowerCase() !== "<u>") return false;
    if (nesting >= maximumNesting) return false;
    let end = -1;
    let cursor = start + 3;
    try {
      while (cursor < state.posMax) {
        if (state.src.slice(cursor, cursor + 4).toLowerCase() === "</u>") {
          end = cursor;
          break;
        }
        state.pos = cursor;
        state.md.inline.skipToken(state);
        cursor = Math.max(cursor + 1, state.pos);
      }
    } finally {
      state.pos = start;
    }
    if (end === -1) return false;
    if (!silent) {
      const children: typeof state.tokens = [];
      nesting += 1;
      try {
        state.md.inline.parse(state.src.slice(start + 3, end), state.md, state.env, children);
      } finally {
        nesting -= 1;
      }
      state.push("underline_open", "u", 1);
      for (const child of children) {
        if (child.type === "underline_open" || child.type === "underline_close") continue;
        const token = state.push(child.type, child.tag, child.nesting);
        const level = token.level;
        Object.assign(token, child, { level });
      }
      state.push("underline_close", "u", -1);
    }
    state.pos = end + 4;
    return true;
  });
}

// 마크다운 서식 순서와 이미지 배치에 맞춘 문서 스키마 구성
function documentSchema(inlineImages: boolean) {
  const code = flattenExtensions([StarterKit]).find(extension => extension.type === "mark" && extension.name === "code");
  if (!code || code.type !== "mark") throw new Error("코드 서식 확장을 찾지 못했습니다.");
  return getSchema([
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false }),
    code.extend({ excludes: "", priority: 0 }),
    Image.configure({ inline: inlineImages, allowBase64: false }),
  ]);
}

// 이미지 설명의 문자와 이스케이프 및 코드 내용 평탄화
function imageAlt(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.children) return imageAlt(token.children);
    if (["text", "text_special", "code_inline"].includes(token.type)) return token.content;
    if (token.type === "softbreak" || token.type === "hardbreak") return "\n";
    return "";
  }).join("");
}

const schema = documentSchema(false);
const tokenizer = new MarkdownIt("commonmark", { html: false }).enable("strikethrough").use(enableUnderline);
const parser = new MarkdownParser(documentSchema(true), tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: { block: "listItem" },
  bullet_list: { block: "bulletList" },
  ordered_list: { block: "orderedList", getAttrs: token => ({ start: Number(token.attrGet("start")) || 1 }) },
  heading: { block: "heading", getAttrs: token => ({ level: Math.min(3, Number(token.tag.slice(1))) }) },
  code_block: { block: "codeBlock", noCloseToken: true },
  fence: { block: "codeBlock", getAttrs: token => ({ language: token.info.trim().split(/\s+/)[0] || null }), noCloseToken: true },
  hr: { node: "horizontalRule" },
  softbreak: { node: "hardBreak" },
  hardbreak: { node: "hardBreak" },
  em: { mark: "italic" },
  strong: { mark: "bold" },
  s: { mark: "strike" },
  underline: { mark: "underline" },
  image: {
    node: "image",
    getAttrs: token => ({
      src: token.attrGet("src"),
      title: token.attrGet("title"),
      alt: imageAlt(token.children || []),
    }),
  },
});

const serializer = new MarkdownSerializer({
  text: defaultMarkdownSerializer.nodes.text,
  heading: defaultMarkdownSerializer.nodes.heading,
  paragraph: defaultMarkdownSerializer.nodes.paragraph,
  blockquote: defaultMarkdownSerializer.nodes.blockquote,
  listItem: defaultMarkdownSerializer.nodes.list_item,
  bulletList: defaultMarkdownSerializer.nodes.bullet_list,
  hardBreak: defaultMarkdownSerializer.nodes.hard_break,
  horizontalRule: defaultMarkdownSerializer.nodes.horizontal_rule,
  // 코드 언어와 내부 백틱을 보존하는 블록 직렬화
  codeBlock(state, node) {
    const runs = node.textContent.match(/`{3,}/g) || [];
    const fence = "`".repeat(Math.max(2, ...runs.map(run => run.length)) + 1);
    state.write(fence + (node.attrs.language || "") + "\n");
    state.text(node.textContent, false);
    state.write("\n" + fence);
    state.closeBlock(node);
  },
  // 기존 시작 번호에 맞춘 순서 목록 직렬화
  orderedList(state, node) {
    const start = Number(node.attrs.start) || 1;
    const width = String(start + node.childCount - 1).length;
    state.renderList(node, " ".repeat(width + 2), index => {
      const number = String(start + index);
      return " ".repeat(width - number.length) + number + ". ";
    });
  },
  // 독립 블록으로 배치된 이미지 직렬화
  image(state, node, parent, index) {
    defaultMarkdownSerializer.nodes.image(state, node, parent, index);
    state.closeBlock(node);
  },
}, {
  code: defaultMarkdownSerializer.marks.code,
  link: defaultMarkdownSerializer.marks.link,
  bold: defaultMarkdownSerializer.marks.strong,
  italic: defaultMarkdownSerializer.marks.em,
  strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
  underline: { open: "<u>", close: "</u>", mixable: true },
}, { hardBreakNodeName: "hardBreak", escapeExtraCharacters: /</g });

// 기존 이미지의 출처별 실제 크기를 문서 순서로 수집
function imageMetadata(document?: RichDocument) {
  const images = new Map<string, NonNullable<RichNode["attrs"]>[]>();
  // 중첩된 문서에서 이미지 속성 수집
  function visit(node: RichNode) {
    if (node.type === "image" && node.attrs?.src) {
      const entries = images.get(node.attrs.src) || [];
      entries.push(node.attrs);
      images.set(node.attrs.src, entries);
    }
    node.content?.forEach(visit);
  }
  document?.content.forEach(visit);
  return images;
}

// 인라인 이미지를 기존 블록 본문 모델로 변환
function normalizeBlocks(node: RichNode, images: ReturnType<typeof imageMetadata>): RichNode[] {
  if (node.type === "image") {
    const src = node.attrs?.src || "";
    const previous = images.get(src)?.shift();
    return [{
      type: "image",
      attrs: {
        src,
        alt: node.attrs?.alt || "",
        ...(typeof node.attrs?.title === "string" ? { title: node.attrs.title } : {}),
        ...(typeof previous?.width === "number" ? { width: previous.width } : {}),
        ...(typeof previous?.height === "number" ? { height: previous.height } : {}),
      },
    }];
  }
  if ((node.type === "paragraph" || node.type === "heading") && node.content?.some(child => child.type === "image")) {
    const blocks: RichNode[] = [];
    let inline: RichNode[] = [];
    // 이미지 양쪽에 남은 실제 문단 내용 반영
    function flush() {
      let start = 0;
      let end = inline.length;
      while (inline[start]?.type === "hardBreak") start += 1;
      while (end > start && inline[end - 1]?.type === "hardBreak") end -= 1;
      const content = inline.slice(start, end);
      if (content.some(child => child.type !== "text" || child.text?.trim())) blocks.push({ ...node, content });
      inline = [];
    }
    for (const child of node.content) {
      if (child.type === "image") {
        flush();
        blocks.push(...normalizeBlocks(child, images));
      } else {
        inline.push(child);
      }
    }
    flush();
    return blocks;
  }
  const content = node.content?.flatMap(child => normalizeBlocks(child, images));
  if (node.type === "listItem" && content?.[0]?.type !== "paragraph") content?.unshift({ type: "paragraph", content: [] });
  return [{ ...node, ...(content ? { content } : {}) }];
}

// 마크다운 원문을 기존 글 본문과 호환되는 문서로 변환
export function parseMarkdown(source: string, previous?: RichDocument): RichDocument {
  const parsed: RichDocument = parser.parse(source).toJSON();
  const images = imageMetadata(previous);
  return { type: "doc", content: parsed.content.flatMap(node => normalizeBlocks(node, images)) };
}

// 기존 글의 본문을 편집 가능한 마크다운으로 변환
export function serializeMarkdown(content: RichDocument): string {
  return serializer.serialize(schema.nodeFromJSON(content));
}
