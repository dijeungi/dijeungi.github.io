import type { Post } from "../types/post";
import type { BlogDocument, ParseBlogDocumentOptions, RichDocument, RichMark, RichNode } from "../types/content";

export const MAX_SLUG_BYTES = 180;
export const MAX_SLUG_LENGTH = 96;
export const MAX_POST_BYTES = 2_000_000;
export const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCK_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "image"]);
const NODE_TYPES = new Set(["doc", "text", "listItem", "hardBreak", ...BLOCK_TYPES]);

// 객체 형태 확인
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 문자열 필드 길이 확인
function readString(value: unknown, name: string, limit: number, trim = true): string {
  if (typeof value !== "string" || value.length > limit) {
    throw new Error(name + " 형식이나 길이를 확인해 주세요.");
  }
  return trim ? value.trim() : value;
}

// 링크와 이미지 주소 안전성 확인
export function isSafeContentUrl(value: string): boolean {
  if (!value || value !== value.trim() || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

// 이미지 주소와 공개 경로 확인
function readImageUrl(value: unknown, publish: boolean): string {
  const src = readString(value, "이미지 주소", 2048);
  if (!isSafeContentUrl(src) || /^mailto:/i.test(src) || src.startsWith("#")) {
    throw new Error("올바른 이미지 주소를 사용해 주세요.");
  }
  if (publish && src.startsWith("/__editor/")) {
    throw new Error("임시 이미지를 공개 이미지로 저장한 뒤 발행해 주세요.");
  }
  if (publish && /^https?:/i.test(src)) {
    const hostname = new URL(src).hostname.replace(/\.+$/u, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/u.test(hostname) || ["0.0.0.0", "[::1]", "[::]"].includes(hostname)) {
      throw new Error("내 컴퓨터의 이미지 주소는 공개 이미지로 저장한 뒤 발행해 주세요.");
    }
  }
  return src;
}

// 이미지 크기 확인
function readDimension(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100000) {
    throw new Error(name + " 값을 확인해 주세요.");
  }
  return value;
}

// 본문 마크 정규화
function parseMarks(value: unknown): RichMark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new Error("본문 서식을 확인해 주세요.");
  const seen = new Set<string>();
  return value.map((mark) => {
    if (!isRecord(mark) || typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) {
      throw new Error("지원하지 않는 본문 서식입니다.");
    }
    if (seen.has(mark.type)) throw new Error("본문 서식이 중복되었습니다.");
    seen.add(mark.type);
    if (mark.type === "link") {
      if (!isRecord(mark.attrs)) throw new Error("링크 주소를 확인해 주세요.");
      const href = readString(mark.attrs.href, "링크 주소", 2048);
      if (!isSafeContentUrl(href)) throw new Error("안전한 링크 주소를 사용해 주세요.");
      return { type: "link", attrs: { href } };
    }
    return { type: mark.type as RichMark["type"] };
  });
}

// 본문 문서 구조와 허용 속성 확인
function parseRichDocument(value: unknown, publish: boolean): RichDocument {
  let nodeCount = 0;
  let textLength = 0;

  // 본문 노드 재귀 정규화
  function parseNode(input: unknown, parent: string | null, depth: number): RichNode {
    nodeCount += 1;
    if (depth > 20 || nodeCount > 10000) throw new Error("본문 구조가 너무 깊거나 큽니다.");
    if (!isRecord(input) || typeof input.type !== "string" || !NODE_TYPES.has(input.type)) {
      throw new Error("지원하지 않는 본문 요소입니다.");
    }
    const type = input.type as RichNode["type"];
    if (parent === null && type !== "doc") throw new Error("본문 문서 형식을 확인해 주세요.");
    if (parent !== null && type === "doc") throw new Error("본문 문서는 중첩할 수 없습니다.");
    if (["doc", "blockquote"].includes(parent || "") && !BLOCK_TYPES.has(type)) {
      throw new Error("본문 요소의 배치를 확인해 주세요.");
    }
    if (["paragraph", "heading"].includes(parent || "") && !["text", "hardBreak"].includes(type)) {
      throw new Error("문단 안에 넣을 수 없는 요소입니다.");
    }
    if (["bulletList", "orderedList"].includes(parent || "") && type !== "listItem") {
      throw new Error("목록 항목 형식을 확인해 주세요.");
    }
    if (parent === "listItem" && !BLOCK_TYPES.has(type)) throw new Error("목록 본문을 확인해 주세요.");
    if (parent === "codeBlock" && type !== "text") throw new Error("코드 본문 형식을 확인해 주세요.");
    if (type === "text") {
      const text = readString(input.text, "본문 텍스트", 100000, false);
      textLength += text.length;
      if (textLength > 500000) throw new Error("본문이 너무 깁니다.");
      if (!text) throw new Error("빈 텍스트 요소는 저장할 수 없습니다.");
      if (input.content !== undefined) throw new Error("텍스트 요소는 중첩할 수 없습니다.");
      return { type, text, ...(parent === "codeBlock" ? {} : { marks: parseMarks(input.marks) }) };
    }
    const node: RichNode = { type };
    const attrs = isRecord(input.attrs) ? input.attrs : {};
    if (type === "heading") {
      if (attrs.level !== 1 && attrs.level !== 2 && attrs.level !== 3) throw new Error("제목은 1단계부터 3단계까지 사용해 주세요.");
      node.attrs = { level: attrs.level };
    }
    if (type === "orderedList") {
      const start = attrs.start ?? 1;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 1 || start > 100000) {
        throw new Error("목록 시작 번호를 확인해 주세요.");
      }
      node.attrs = { start };
    }
    if (type === "codeBlock") {
      const language = attrs.language == null ? null : readString(attrs.language, "코드 언어", 50);
      node.attrs = { language };
    }
    if (type === "image") {
      const alt = readString(attrs.alt ?? "", "이미지 설명", 500);
      if (publish && !alt) throw new Error("이미지 설명을 입력해 주세요.");
      node.attrs = { src: readImageUrl(attrs.src, publish), alt };
      if (attrs.title != null) node.attrs.title = readString(attrs.title, "이미지 제목", 500);
      if (attrs.width != null) node.attrs.width = readDimension(attrs.width, "이미지 너비");
      if (attrs.height != null) node.attrs.height = readDimension(attrs.height, "이미지 높이");
    }
    if (["image", "hardBreak", "horizontalRule"].includes(type)) {
      if (input.content !== undefined) throw new Error("비어 있어야 하는 본문 요소입니다.");
      return node;
    }
    if (input.content !== undefined && !Array.isArray(input.content)) throw new Error("본문 항목을 확인해 주세요.");
    node.content = (Array.isArray(input.content) ? input.content : []).map((child) => parseNode(child, type, depth + 1));
    if (type === "listItem" && node.content[0]?.type !== "paragraph") throw new Error("목록은 문단으로 시작해야 합니다.");
    return node;
  }

  const document = parseNode(value, null, 0);
  return { type: "doc", content: document.content || [] };
}

// 빈 편집 문서 생성
export function createEmptyDocument(): RichDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// 제목 기반 글 주소 생성
export function slugifyTitle(title: string): string {
  const slug = title.normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/[\s-]+/gu, "-").replace(/^-|-$/g, "");
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of Array.from(slug).slice(0, MAX_SLUG_LENGTH)) {
    const length = encoder.encode(character).length;
    if (bytes + length > MAX_SLUG_BYTES) break;
    bytes += length;
    result += character;
  }
  return result.replace(/-$/g, "");
}

// 본문 텍스트와 이미지 유무 수집
function collectContent(nodes: RichNode[]): { text: string; hasImage: boolean } {
  let text = "";
  let hasImage = false;
  for (const node of nodes) {
    text += node.text || "";
    hasImage ||= node.type === "image";
    if (node.content) {
      const nested = collectContent(node.content);
      text += nested.text;
      hasImage ||= nested.hasImage;
    }
    if (["paragraph", "heading", "codeBlock", "hardBreak", "image", "horizontalRule"].includes(node.type)) text += " ";
  }
  return { text, hasImage };
}

// 본문 순서대로 첫 이미지의 실제 속성 수집
export function getFirstContentImage(content: RichDocument): BlogDocument["heroImage"] {
  for (const node of content.content) {
    if (node.type === "image" && node.attrs?.src) {
      const { src, alt, width, height } = node.attrs;
      return { src, alt: alt || "", ...(width == null ? {} : { width }), ...(height == null ? {} : { height }) };
    }
    if (node.content) {
      const image = getFirstContentImage({ type: "doc", content: node.content });
      if (image) return image;
    }
  }
  return undefined;
}

// 선택 부제목과 본문에서 편집 글의 소개 및 썸네일 갱신
export function normalizeDraftMetadata(document: BlogDocument): BlogDocument {
  if (document.subtitle === undefined) return document;
  const text = collectContent(document.content.content).text.replace(/\s+/gu, " ").trim();
  const description = document.subtitle.trim() || Array.from(text).slice(0, 200).join("");
  const heroImage = getFirstContentImage(document.content);
  return { ...document, description, heroImage };
}

// 발행할 글의 필수 부제목 확인
export function validatePostSubtitle(document: Pick<BlogDocument, "subtitle">): void {
  if (!document.subtitle?.trim()) throw new Error("부제목을 입력해 주세요.");
}

// 본문 길이 기반 읽는 시간 추정
export function estimateReadingMinutes(content: RichDocument): number {
  return Math.max(1, Math.ceil(collectContent(content.content).text.replace(/\s/gu, "").length / 500));
}

// 임시 글과 발행 글 데이터 정규화
export function parseBlogDocument(value: unknown, options: ParseBlogDocumentOptions = {}): BlogDocument {
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== "string" || !UUID_PATTERN.test(value.id)) {
    throw new Error("글 식별자와 데이터 버전을 확인해 주세요.");
  }
  const publish = options.publish === true;
  const title = readString(value.title, "제목", 200);
  const slug = readString(value.slug, "글 주소", 384).normalize("NFKC").toLowerCase();
  const category = readString(value.category, "카테고리", 60);
  const subtitle = value.subtitle === undefined ? undefined : readString(value.subtitle, "부제목", 500);
  const description = subtitle === undefined ? readString(value.description, "글 소개", 500) : "";
  const date = readString(value.date, "게시일", 10);
  const updatedAt = readString(value.updatedAt, "저장 시각", 40);
  const content = parseRichDocument(value.content, publish);
  const markdown = value.markdown === undefined ? undefined : readString(value.markdown, "마크다운 본문", 500000, false);
  if (Array.from(slug).length > MAX_SLUG_LENGTH || new TextEncoder().encode(slug).length > MAX_SLUG_BYTES) {
    throw new Error("글 주소는 96자와 UTF-8 180바이트 이내로 입력해 주세요.");
  }
  if (slug && !SLUG_PATTERN.test(slug)) throw new Error("글 주소에는 문자, 숫자와 하이픈만 사용할 수 있습니다.");
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)) {
    throw new Error("올바른 게시일을 입력해 주세요.");
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("올바른 저장 시각이 필요합니다.");
  }
  const minutes = value.readingMinutes ?? 0;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > 10000) {
    throw new Error("읽는 시간은 0 이상의 정수로 입력해 주세요.");
  }
  const document: BlogDocument = {
    version: 1, id: value.id.toLowerCase(), slug, title, category, description, date, content,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(markdown === undefined ? {} : { markdown }),
    readingMinutes: publish && minutes === 0 ? estimateReadingMinutes(content) : minutes,
    updatedAt: new Date(updatedAt).toISOString(),
  };
  if (subtitle === undefined && value.heroImage != null) {
    if (!isRecord(value.heroImage)) throw new Error("대표 이미지 정보를 확인해 주세요.");
    const alt = readString(value.heroImage.alt ?? "", "대표 이미지 설명", 500);
    if (publish && !alt) throw new Error("대표 이미지 설명을 입력해 주세요.");
    document.heroImage = {
      src: readImageUrl(value.heroImage.src, publish), alt,
      width: readDimension(value.heroImage.width, "대표 이미지 너비"),
      height: readDimension(value.heroImage.height, "대표 이미지 높이"),
    };
  }
  if (publish) {
    if (!title || !category) throw new Error("제목과 카테고리를 입력해 주세요.");
    if (!slug || !date) throw new Error("자동 설정을 완료하지 못했습니다. 다시 저장한 뒤 발행해 주세요.");
    const body = collectContent(content.content);
    if (!body.text.trim() && !body.hasImage) throw new Error("본문을 작성한 뒤 발행해 주세요.");
  }
  return normalizeDraftMetadata(document);
}

// 편집 문서의 글 상세 표시 데이터 변환
export function toArticlePost(document: BlogDocument): Post {
  const normalized = normalizeDraftMetadata(document);
  return {
    slug: normalized.slug || "draft-" + normalized.id,
    title: normalized.title || "제목 없는 글",
    subtitle: normalized.subtitle,
    description: normalized.description,
    category: normalized.category || "개발 기록",
    date: normalized.date || normalized.updatedAt.slice(0, 10),
    readingMinutes: normalized.readingMinutes || estimateReadingMinutes(normalized.content),
    heroImage: normalized.heroImage,
    document: normalized.content,
  };
}
