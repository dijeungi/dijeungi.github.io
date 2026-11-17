import { constants } from "node:fs";
import MarkdownIt from "markdown-it";
import { promisify } from "node:util";
import { imageSize } from "image-size";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import imageRule from "markdown-it/lib/rules_inline/image.mjs";
import referenceRule from "markdown-it/lib/rules_block/reference.mjs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";

import { readCleanupFile, removeCleanupFile, restoreCleanupFile, prepareMediaCleanup, finishMediaCleanup } from "./editor-media-cleanup.mjs";
import {
  SLUG_PATTERN,
  MAX_POST_BYTES,
  MAX_SLUG_BYTES,
  MAX_SLUG_LENGTH,
  slugifyTitle,
  parseBlogDocument,
  validatePostSubtitle,
} from "../app/shared/lib/content.ts";

const execFileAsync = promisify(execFile);
const defaultAppRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mediaPattern = /^\/__editor\/api\/media\/([0-9a-f-]{36})$/i;
const maximumImageBytes = 10 * 1024 * 1024;
const maximumJsonBytes = 2 * 1024 * 1024;
const mimeTypes = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// 상태 코드와 공개 가능한 오류 정보 구성
function editorError(status, message, code, commit) {
  return Object.assign(new Error(message), { status, code, commit });
}

// 파일이 없는 경우에만 null 반환
async function readOptional(path) {
  try { return await readFile(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// 앱 내부 디렉터리와 심볼릭 링크 경계 확인
async function ensureDirectory(appRoot, path) {
  const parts = relative(appRoot, path).split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) throw editorError(500, "저장 경로를 확인해 주세요.");
  let current = appRoot;
  for (const part of parts) {
    current = join(current, part);
    await mkdir(current, { recursive: true });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw editorError(500, "저장 폴더에 심볼릭 링크를 사용할 수 없습니다.");
  }
}

// 임시 파일을 교체하는 원자적 JSON 저장
async function writeJson(path, value) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

// 이미지 파일의 허용 형식 확인
function identifyImage(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  throw editorError(415, "PNG, JPEG, GIF, WebP 이미지만 업로드할 수 있습니다.");
}

// 사용자 편집 비교에서 서버가 정한 주소와 저장 시각 제외
function sameDraft(first, second) {
  const firstBody = { ...first };
  const secondBody = { ...second };
  delete firstBody.updatedAt;
  delete secondBody.updatedAt;
  delete firstBody.slug;
  delete secondBody.slug;
  return JSON.stringify(firstBody) === JSON.stringify(secondBody);
}

// 실제 마크다운 구문 위치에서 발행 이미지 주소만 갱신
function rewriteMarkdownImageSources(markdown, sources) {
  const offsets = [];
  const lines = [0];
  let normalized = "";
  for (let index = 0; index < markdown.length; index++) {
    offsets.push(index);
    const character = markdown[index];
    normalized += character === "\r" ? "\n" : character === "\0" ? "\uFFFD" : character;
    if (character === "\r" && markdown[index + 1] === "\n") index++;
    if (character === "\r" || character === "\n") lines.push(normalized.length);
  }
  offsets.push(markdown.length);
  const parser = new MarkdownIt("commonmark", { html: false }).enable("strikethrough");
  const parseDestination = parser.helpers.parseLinkDestination;
  const spans = new Map();
  let inlineRanges = [];
  let inlineContent;
  let active;

  // 파서가 해석한 목적지의 원문 범위 수집
  function captureDestination(value, start, maximum) {
    const result = parseDestination(value, start, maximum);
    if (result.ok && active && value === active.state.src) active.destinations.push({ value, start, end: result.pos, href: parser.normalizeLink(result.str) });
    return result;
  }

  // 성공한 이미지와 참조 정의에서만 원문 치환 위치 확정
  function captureRule(rule, kind) {
    return (state, ...args) => {
      const previous = active;
      const current = { state, destinations: [] };
      active = current;
      try {
        const accepted = rule(state, ...args);
        if (accepted && args.at(-1) !== true && (kind === "reference" || state.src === inlineContent)) {
          for (const destination of current.destinations) {
            const replacement = sources.get(destination.href);
            if (!replacement) continue;
            const range = kind === "reference" ? { inlineStart: 0, sourceStart: 0, length: normalized.length }
              : inlineRanges.find((item) => destination.start >= item.inlineStart && destination.end <= item.inlineStart + item.length);
            if (!range) continue;
            let start = range.sourceStart + destination.start - range.inlineStart;
            let end = range.sourceStart + destination.end - range.inlineStart;
            if (normalized.slice(start, end) !== destination.value.slice(destination.start, destination.end)) continue;
            if (normalized[start] === "<") { start++; end--; }
            spans.set(start, { start: offsets[start], end: offsets[end], replacement });
          }
        }
        return accepted;
      } finally { active = previous; }
    };
  }

  parser.helpers = { ...parser.helpers, parseLinkDestination: captureDestination };
  parser.block.ruler.at("reference", captureRule(referenceRule, "reference"));
  parser.inline.ruler.at("image", captureRule(imageRule, "image"));
  parser.core.ruler.at("inline", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline") continue;
      inlineContent = token.content;
      inlineRanges = [];
      let inlineStart = 0;
      for (const [index, line] of token.content.split("\n").entries()) {
        const sourceStart = lines[token.map[0] + index];
        const sourceEnd = lines[token.map[0] + index + 1] ?? normalized.length;
        if (sourceStart === undefined) break;
        const prefix = line.match(/^[ \t]*/)[0].length;
        const content = line.slice(prefix);
        const position = normalized.slice(sourceStart, sourceEnd).indexOf(content);
        if (position >= 0) inlineRanges.push({ inlineStart: inlineStart + prefix, sourceStart: sourceStart + position, length: content.length });
        inlineStart += line.length + 1;
      }
      parser.inline.parse(token.content, parser, state.env, token.children);
    }
  });
  const parsed = parser.parse(normalized, {});
  let result = markdown;
  for (const span of [...spans.values()].sort((first, second) => second.start - first.start)) {
    result = result.slice(0, span.start) + span.replacement + result.slice(span.end);
  }
  const verified = spans.size ? new MarkdownIt("commonmark", { html: false }).enable("strikethrough").parse(result, {}) : parsed;
  for (const block of verified) {
    for (const token of block.children || []) {
      if (token.type !== "image") continue;
      const source = token.attrGet("src") || "";
      let path = source;
      if (/^https?:\/\//i.test(source)) {
        try {
          const url = new URL(source);
          if (isLoopbackOrigin(url.origin)) path = url.pathname;
        } catch { continue; }
      }
      if (path.startsWith("/__editor/")) throw editorError(400, "마크다운 이미지와 본문 이미지가 다릅니다. 본문을 다시 확인해 주세요.", "MARKDOWN_IMAGE_MISMATCH");
    }
  }
  return result;
}

// 로컬 임시 저장과 제한된 Git 발행 서비스 구성
export function createEditorService(options = {}) {
  const appRoot = resolve(options.appRoot || defaultAppRoot);
  const repoRoot = resolve(options.repoRoot || appRoot);
  const stateRoot = join(appRoot, ".editor");
  const draftsRoot = join(stateRoot, "drafts");
  const mediaRoot = join(stateRoot, "media");
  const cleanupRoot = join(stateRoot, "image-cleanup");
  const postsRoot = join(appRoot, "content", "posts");
  const uploadsRoot = join(appRoot, "public", "uploads");
  const reservedSlugs = new Set(options.reservedSlugs || []);
  let pending = Promise.resolve();

  // 앱과 저장소에 한정한 Git 명령 실행
  async function git(args) {
    const result = await execFileAsync("git", args, {
      cwd: repoRoot,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false" },
    });
    return result.stdout.trim();
  }

  // 파일 수정과 발행 요청 직렬화
  function mutate(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }

  // 새 작업 환경에서도 불러올 수 있는 발행 글 조회
  async function readPublishedDocuments() {
    let names;
    try { names = await readdir(postsRoot); } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => parseBlogDocument(JSON.parse(await readFile(join(postsRoot, name), "utf8")), { publish: true })));
  }

  // 발행 주소는 고정하고 새 글의 제목 주소 충돌은 자동 해소
  async function assignDocumentSlug(document) {
    const published = await readPublishedDocuments();
    const previous = published.find((item) => item.id === document.id);
    if (previous) {
      document.slug = previous.slug;
      return document;
    }
    if (!document.title) {
      document.slug = "";
      return document;
    }
    const base = slugifyTitle(document.title) || "post-" + document.id;
    const used = new Set([...reservedSlugs, ...published.map((item) => item.slug)]);
    let slug = base;
    let index = 1;
    while (used.has(slug)) {
      index += 1;
      const suffix = "-" + index;
      let stem = base;
      while (Array.from(stem + suffix).length > MAX_SLUG_LENGTH || Buffer.byteLength(stem + suffix) > MAX_SLUG_BYTES) {
        stem = Array.from(stem).slice(0, -1).join("").replace(/-$/g, "");
      }
      slug = stem + suffix;
    }
    document.slug = slug;
    return document;
  }

  // UUID에 한정한 임시 글 읽기
  async function readDraft(id) {
    if (!uuidPattern.test(id)) throw editorError(400, "글 식별자를 확인해 주세요.");
    const bytes = await readOptional(join(draftsRoot, id + ".json"));
    if (!bytes) {
      const published = (await readPublishedDocuments()).find((document) => document.id === id);
      if (published) return published;
      throw editorError(404, "저장된 글을 찾을 수 없습니다.");
    }
    return parseBlogDocument(JSON.parse(bytes.toString("utf8")));
  }

  // 저장 시각과 변경 충돌을 확인한 임시 글 저장
  async function saveDraftRecord(value) {
    const document = await assignDocumentSlug(parseBlogDocument(value));
    await ensureDirectory(appRoot, draftsRoot);
    const path = join(draftsRoot, document.id + ".json");
    const existingBytes = await readOptional(path);
    const existing = existingBytes ? parseBlogDocument(JSON.parse(existingBytes.toString("utf8"))) : null;
    const unchanged = existing !== null && sameDraft(document, existing);
    if (unchanged && existing.slug === document.slug) return existing;
    if (existing && !unchanged && existing.updatedAt !== document.updatedAt) throw editorError(409, "다른 창에서 수정된 글입니다. 저장된 글을 다시 열어 주세요.", "DRAFT_CONFLICT");
    document.updatedAt = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
    await writeJson(path, document);
    return document;
  }

  // 저장 버전을 확인한 로컬 임시 글 한 개 삭제
  async function deleteDraftRecord(id, expectedUpdatedAt) {
    if (typeof id !== "string" || !uuidPattern.test(id)) throw editorError(400, "글 식별자를 확인해 주세요.");
    if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw editorError(400, "삭제할 임시 글의 저장 시각을 확인해 주세요.");
    const normalizedId = id.toLowerCase();
    const path = join(draftsRoot, normalizedId + ".json");
    let handle;
    try {
      for (const directory of [stateRoot, draftsRoot]) {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw editorError(409, "임시 글 저장 경로를 확인해 주세요.", "DRAFT_PATH_INVALID");
      }
      const previous = await lstat(path);
      if (!previous.isFile() || previous.isSymbolicLink()) throw editorError(409, "임시 글 저장 경로를 확인해 주세요.", "DRAFT_PATH_INVALID");
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== previous.dev || opened.ino !== previous.ino) throw editorError(409, "임시 글이 변경됐습니다. 목록을 새로 불러와 주세요.", "DRAFT_CONFLICT");
      const document = parseBlogDocument(JSON.parse(await handle.readFile("utf8")));
      if (document.id !== normalizedId) throw editorError(409, "임시 글 식별자와 저장 경로가 다릅니다.", "DRAFT_PATH_INVALID");
      if (document.updatedAt !== expectedUpdatedAt) throw editorError(409, "다른 창에서 수정된 임시 글입니다. 목록을 새로 불러와 주세요.", "DRAFT_CONFLICT");
      const current = await lstat(path);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino || current.mtimeMs !== opened.mtimeMs || current.size !== opened.size) throw editorError(409, "임시 글이 변경됐습니다. 목록을 새로 불러와 주세요.", "DRAFT_CONFLICT");
      await unlink(path);
      return { deleted: normalizedId };
    } catch (error) {
      if (error.code === "ENOENT") throw editorError(404, "이 컴퓨터에 저장된 임시 글을 찾을 수 없습니다.");
      if (error.code === "ELOOP" || error.code === "ENOTDIR") throw editorError(409, "임시 글 저장 경로를 확인해 주세요.", "DRAFT_PATH_INVALID");
      throw error;
    } finally { await handle?.close(); }
  }

  // 저장된 임시 글 목록 조회
  async function listDrafts() {
    await ensureDirectory(appRoot, draftsRoot);
    const names = (await readdir(draftsRoot)).filter((name) => name.endsWith(".json") && uuidPattern.test(name.slice(0, -5)));
    const documents = await Promise.all(names.map((name) => readDraft(name.slice(0, -5))));
    const ids = new Set(documents.map((document) => document.id));
    const published = await readPublishedDocuments();
    const publishedIds = new Set(published.map((document) => document.id));
    documents.push(...published.filter((document) => !ids.has(document.id)));
    return documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, slug, updatedAt }) => ({ id, title, slug, updatedAt, isLocalDraft: ids.has(id), isPublished: publishedIds.has(id) }));
  }

  // 이미지 메타데이터와 내부 파일 경로 검증
  async function readMedia(id) {
    if (!uuidPattern.test(id)) throw editorError(400, "이미지 식별자를 확인해 주세요.");
    const bytes = await readOptional(join(mediaRoot, id + ".json"));
    if (!bytes) throw editorError(404, "업로드한 이미지를 찾을 수 없습니다.");
    const metadata = JSON.parse(bytes.toString("utf8"));
    if (metadata.id !== id || !mimeTypes[metadata.extension]) throw editorError(500, "이미지 저장 정보를 확인해 주세요.");
    const path = join(mediaRoot, id + "." + metadata.extension);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw editorError(500, "이미지 저장 경로를 확인해 주세요.");
    return { ...metadata, path };
  }

  // 원본 이미지의 형식과 크기를 확인한 로컬 업로드
  async function uploadMedia(bytes, fileName = "이미지") {
    if (!bytes.length || bytes.length > maximumImageBytes) throw editorError(413, "이미지는 10MB 이하로 업로드해 주세요.");
    const extension = identifyImage(bytes);
    let dimensions;
    try { dimensions = imageSize(bytes); } catch { throw editorError(415, "이미지 파일을 읽을 수 없습니다."); }
    if (!dimensions.width || !dimensions.height) throw editorError(415, "이미지 크기를 확인할 수 없습니다.");
    const id = randomUUID();
    const alt = basename(fileName).replace(/[\x00-\x1f]/g, "").slice(0, 500) || "이미지";
    await ensureDirectory(appRoot, mediaRoot);
    await writeFile(join(mediaRoot, id + "." + extension), bytes, { flag: "wx", mode: 0o600 });
    await writeJson(join(mediaRoot, id + ".json"), { id, extension, width: dimensions.width, height: dimensions.height });
    return { src: "/__editor/api/media/" + id, alt, width: dimensions.width, height: dimensions.height };
  }

  // 임시 이미지 주소의 발행 주소 변환
  async function preparePublication(document) {
    const publication = structuredClone(document);
    const media = new Map();
    const imageSources = new Map();
    // 문서에 포함된 이미지 주소의 로컬 업로드 확인
    async function convertImage(image) {
      if (!image?.src) return;
      let source = image.src;
      if (/^https?:\/\//i.test(source)) {
        const url = new URL(source);
        if (isLoopbackOrigin(url.origin)) source = url.pathname;
      }
      if (!source.startsWith("/__editor/")) return;
      const match = new URL(source, "http://localhost").pathname.replace(/\/+$/, "").match(mediaPattern);
      if (!match || !uuidPattern.test(match[1])) throw editorError(400, "임시 이미지 주소를 확인해 주세요.");
      const item = await readMedia(match[1]);
      const originalSource = image.src;
      image.src = "/uploads/" + item.id + "." + item.extension;
      image.width = item.width;
      image.height = item.height;
      media.set(item.id, item);
      imageSources.set(originalSource, image.src);
    }
    // 본문 이미지 노드 순회
    async function visit(node) {
      if (node.type === "image") await convertImage(node.attrs);
      for (const child of node.content || []) await visit(child);
    }
    if (publication.subtitle === undefined) await convertImage(publication.heroImage);
    await visit(publication.content);
    if (publication.markdown !== undefined) publication.markdown = rewriteMarkdownImageSources(publication.markdown, imageSources);
    return { publication: parseBlogDocument(publication, { publish: true }), media: [...media.values()] };
  }

  // 발행 시 기존 주소와 다른 글의 덮어쓰기 방지
  async function validatePublication(document) {
    if (!SLUG_PATTERN.test(document.slug) || reservedSlugs.has(document.slug)) throw editorError(409, "이미 사용 중이거나 올바르지 않은 글 주소입니다.", "SLUG_CONFLICT");
    await ensureDirectory(appRoot, postsRoot);
    for (const previous of await readPublishedDocuments()) {
      if (previous.id === document.id && previous.slug !== document.slug) throw editorError(409, "발행한 글의 주소는 변경할 수 없습니다.", "SLUG_IMMUTABLE");
      if (previous.slug === document.slug && previous.id !== document.id) throw editorError(409, "다른 글이 사용 중인 주소입니다.", "SLUG_CONFLICT");
    }
    const targetPath = join(postsRoot, document.slug + ".json");
    const target = await readOptional(targetPath);
    if (target) {
      const stat = await lstat(targetPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw editorError(409, "발행할 글의 저장 경로를 확인해 주세요.");
      const previous = parseBlogDocument(JSON.parse(target.toString("utf8")), { publish: true });
      if (previous.id !== document.id) throw editorError(409, "다른 글이 사용 중인 주소입니다.", "SLUG_CONFLICT");
    }
  }

  // 진행 중인 Git 작업과 브랜치 확인
  async function validateGitState() {
    if (await git(["branch", "--show-current"]) !== "main") throw editorError(409, "main 브랜치에서 발행해 주세요.");
    for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
      const path = resolve(repoRoot, await git(["rev-parse", "--git-path", name]));
      try { await lstat(path); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      throw editorError(409, "진행 중인 Git 작업을 마친 뒤 발행해 주세요.");
    }
    const marker = relative(repoRoot, join(appRoot, "app/shared/data/published-posts.ts"));
    try { await git(["cat-file", "-e", "HEAD:" + marker]); } catch {
      throw editorError(409, "글쓰기 기능 변경을 먼저 커밋한 뒤 발행해 주세요.", "EDITOR_SETUP_REQUIRED");
    }
  }

  // 이전 버전에서 빠진 이미지와 실패 후 정리 대기 목록 준비
  async function preparePublicationCleanup(publication, previous) {
    const path = join(cleanupRoot, publication.id + ".json");
    try {
      const stored = await readCleanupFile(appRoot, path);
      const record = stored ? JSON.parse(stored.bytes.toString("utf8")) : { postId: publication.id, assets: [] };
      if (record.postId !== publication.id || !Array.isArray(record.assets)) throw editorError(409, "이미지 정리 기록을 확인해 주세요.");
      if (!previous && !record.assets.length) return { assets: [], pending: [] };
      const plan = await prepareMediaCleanup({ appRoot, repoRoot, publication, previous, candidates: record.assets, git });
      if (!plan.pending.length) return { assets: [], pending: [] };
      await ensureDirectory(appRoot, cleanupRoot);
      await writeJson(path, { postId: publication.id, assets: plan.pending });
      return { ...plan, journal: await readCleanupFile(appRoot, path) };
    } catch (error) {
      console.warn("편집기 이미지 정리를 보류했습니다:", error.code || error.name);
      return { assets: [], pending: [], skipped: true };
    }
  }

  // 푸시 성공 후 참조를 재확인한 로컬 원본과 정리 기록 갱신
  async function completePublicationCleanup(publication, plan) {
    if (!plan.journal) return { removed: 0, pending: 0, skipped: Boolean(plan.skipped) };
    try {
      const current = await readCleanupFile(appRoot, plan.journal.path);
      if (!current || current.dev !== plan.journal.dev || current.ino !== plan.journal.ino || !current.bytes.equals(plan.journal.bytes)) throw editorError(409, "이미지 정리 기록이 변경됐습니다.");
      const completed = new Set(await finishMediaCleanup({ appRoot, repoRoot, publication, assets: plan.assets, git }));
      const pending = plan.pending.filter((asset) => !completed.has(asset.name));
      if (pending.length) await writeJson(plan.journal.path, { postId: publication.id, assets: pending });
      else await removeCleanupFile(appRoot, current);
      return { removed: completed.size, pending: pending.length, skipped: false };
    } catch (error) {
      console.warn("편집기 로컬 이미지 정리를 보류했습니다:", error.code || error.name);
      return { removed: 0, pending: plan.pending.length, skipped: true };
    }
  }

  // 게시글과 참조 이미지 및 미사용 이미지 삭제를 같은 커밋으로 발행
  async function publishRecord(value) {
    const draft = await saveDraftRecord(value);
    validatePostSubtitle(draft);
    const { publication, media } = await preparePublication(draft);
    if (Buffer.byteLength(JSON.stringify(publication, null, 2) + "\n") > MAX_POST_BYTES) throw editorError(413, "발행할 본문이 너무 깁니다. 글을 나누거나 일부 내용을 줄여 주세요.");
    await validatePublication(publication);
    await validateGitState();
    const postPath = join(postsRoot, publication.slug + ".json");
    const previous = await readOptional(postPath);
    const cleanup = await preparePublicationCleanup(publication, previous ? parseBlogDocument(JSON.parse(previous.toString("utf8")), { publish: true }) : null);
    const mediaPaths = media.map((item) => join(uploadsRoot, item.id + "." + item.extension));
    const retiredMedia = cleanup.assets.map((asset) => asset.publicFile).filter(Boolean);
    const paths = [postPath, ...mediaPaths, ...retiredMedia.map((item) => item.path)].map((path) => relative(repoRoot, path));
    if (await git(["diff", "--cached", "--name-only", "--", ...paths])) throw editorError(409, "이 글의 파일이 이미 스테이징되어 있습니다. Git 작업을 마친 뒤 다시 발행해 주세요.");
    if (await git(["diff", "--name-only", "--", relative(repoRoot, postPath)])) throw editorError(409, "발행 파일이 다른 곳에서 수정됐습니다. 변경사항을 먼저 확인해 주세요.");
    const publishedBytes = Buffer.from(JSON.stringify(publication, null, 2) + "\n");
    const createdMedia = [];
    const removedMedia = [];
    let committing = false;
    try {
      await ensureDirectory(appRoot, uploadsRoot);
      for (let index = 0; index < media.length; index++) {
        const existing = await readOptional(mediaPaths[index]);
        const source = await readFile(media[index].path);
        if (existing && (await lstat(mediaPaths[index])).isSymbolicLink()) throw editorError(409, "발행 이미지에 심볼릭 링크를 사용할 수 없습니다.");
        if (existing && !existing.equals(source)) throw editorError(409, "같은 이름의 다른 이미지가 있습니다.");
        if (!existing) {
          await copyFile(media[index].path, mediaPaths[index], constants.COPYFILE_EXCL);
          createdMedia.push({ path: mediaPaths[index], bytes: source });
        }
      }
      for (const item of retiredMedia) {
        await removeCleanupFile(appRoot, item);
        removedMedia.push(item);
      }
      await writeJson(postPath, publication);
      committing = true;
      await git(["add", "--", ...paths]);
      if (await git(["diff", "--cached", "--name-only", "--", ...paths])) {
        await git(["commit", "--only", "-m", "docs: " + publication.title.replace(/[\r\n]/g, " ") + " 발행", "--", ...paths]);
      }
    } catch (error) {
      if (committing) await git(["restore", "--staged", "--", ...paths]).catch(() => {});
      const current = await readOptional(postPath);
      if (current?.equals(publishedBytes)) {
        if (previous) await writeFile(postPath, previous); else await rm(postPath, { force: true });
      }
      for (const item of createdMedia) {
        const currentImage = await readOptional(item.path);
        if (currentImage?.equals(item.bytes)) await rm(item.path, { force: true });
      }
      for (const item of removedMedia) {
        await restoreCleanupFile(appRoot, item).catch((failure) => console.warn("편집기 이미지 복원을 보류했습니다:", failure.code || failure.name));
      }
      if (error.status) throw error;
      throw editorError(500, committing ? "글은 임시 저장됐지만 커밋에 실패했습니다. Git 이름과 이메일 및 저장소 상태를 확인해 주세요." : "발행할 파일을 저장하지 못했습니다. 저장 폴더 상태를 확인해 주세요.", committing ? "COMMIT_FAILED" : "PUBLISH_FAILED");
    }
    const commit = await git(["rev-parse", "HEAD"]);
    try {
      if (options.push) await options.push({ git, commit }); else await git(["push", "origin", "main"]);
    } catch {
      throw editorError(502, "글은 커밋됐지만 푸시에 실패했습니다. Git 연결을 확인한 뒤 다시 발행해 주세요.", "PUSH_FAILED", commit);
    }
    const cleanupResult = await completePublicationCleanup(publication, cleanup);
    return { draft, slug: publication.slug, url: "/posts/" + publication.slug + "/", commit, pushed: true, cleanup: cleanupResult };
  }

  return {
    listDrafts,
    readDraft,
    readMedia,
    deleteDraft: (id, expectedUpdatedAt) => mutate(() => deleteDraftRecord(id, expectedUpdatedAt)),
    saveDraft: (value) => mutate(() => saveDraftRecord(value)),
    uploadMedia: (bytes, name) => mutate(() => uploadMedia(bytes, name)),
    publish: (value) => mutate(() => publishRecord(value)),
  };
}

// 직접 요청과 프록시 원본 호스트의 루프백 경계 확인
function isLoopbackHost(host) {
  return typeof host === "string" && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

// 브라우저 요청의 루프백 출처 확인
function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && isLoopbackHost(url.host) && url.origin === origin;
  } catch { return false; }
}

// 요청 본문 크기를 제한한 버퍼 읽기
async function readBody(request, limit) {
  if (Number(request.headers["content-length"]) > limit) { request.resume(); throw editorError(413, "요청한 파일이나 본문이 너무 큽니다."); }
  const buffers = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total <= limit) buffers.push(chunk);
  }
  if (total > limit) throw editorError(413, "요청한 파일이나 본문이 너무 큽니다.");
  return Buffer.concat(buffers);
}

// 로컬 글쓰기 API의 JSON 응답
function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

// 루프백 전용 글쓰기 HTTP 서버 시작
export async function startEditorServer(options = {}) {
  const token = randomBytes(32).toString("hex");
  const service = options.service || createEditorService(options);
  const port = options.port ?? Number(process.env.EDITOR_API_PORT || 4319);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("EDITOR_API_PORT 설정을 확인해 주세요.");
  const server = createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      const host = request.headers.host || "";
      const forwardedHost = request.headers["x-forwarded-host"];
      if (!isLoopbackHost(host) || (forwardedHost !== undefined && !isLoopbackHost(forwardedHost)) || (origin && !isLoopbackOrigin(origin)) || request.headers["sec-fetch-site"] === "cross-site") throw editorError(403, "내 컴퓨터의 편집기에서만 접근할 수 있습니다.");
      const path = new URL(request.url || "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
      const method = request.method || "GET";
      if (method === "GET" && path === "/session") { sendJson(response, 200, { token }); return; }
      const imageMatch = path.match(/^\/media\/([0-9a-f-]{36})$/i);
      if (method === "GET" && imageMatch) {
        const media = await service.readMedia(imageMatch[1]);
        const bytes = await readFile(media.path);
        response.writeHead(200, { "Content-Type": mimeTypes[media.extension], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        response.end(bytes);
        return;
      }
      const supplied = Buffer.from(String(request.headers["x-editor-token"] || ""));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw editorError(403, "편집기 연결이 만료됐습니다. 화면을 새로고침해 주세요.");
      if (method === "GET" && path === "/drafts") { sendJson(response, 200, { drafts: await service.listDrafts() }); return; }
      const draftMatch = path.match(/^\/drafts\/([0-9a-f-]{36})$/i);
      if (method === "GET" && draftMatch) { sendJson(response, 200, { draft: await service.readDraft(draftMatch[1]) }); return; }
      if (method !== "POST" && !(method === "DELETE" && draftMatch)) throw editorError(404, "요청한 편집기 기능을 찾을 수 없습니다.");
      if (!origin) throw editorError(403, "내 컴퓨터의 편집기에서만 저장할 수 있습니다.");
      if (path === "/media") {
        let name = "이미지";
        try { name = decodeURIComponent(String(request.headers["x-file-name"] || name)); } catch {}
        const image = await service.uploadMedia(await readBody(request, maximumImageBytes), name);
        sendJson(response, 201, { image });
        return;
      }
      if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw editorError(415, "JSON 형식으로 요청해 주세요.");
      let body;
      try { body = JSON.parse((await readBody(request, maximumJsonBytes)).toString("utf8")); } catch (error) {
        if (error.status) throw error;
        throw editorError(400, "요청 본문을 읽을 수 없습니다.");
      }
      if (method === "DELETE" && draftMatch) { sendJson(response, 200, await service.deleteDraft(draftMatch[1], body?.expectedUpdatedAt)); return; }
      if (path === "/drafts") { sendJson(response, 200, { draft: await service.saveDraft(body) }); return; }
      if (path === "/publish") { sendJson(response, 200, await service.publish(body.draft)); return; }
      throw editorError(404, "요청한 편집기 기능을 찾을 수 없습니다.");
    } catch (error) {
      const unexpected = !error.status && (error.code || error instanceof SyntaxError);
      if (unexpected) console.error("편집기 저장 오류:", error.code || error.name);
      sendJson(response, error.status || (unexpected ? 500 : 400), {
        error: unexpected ? "저장 중 오류가 발생했습니다. 터미널과 저장 폴더 상태를 확인해 주세요." : error.message,
        code: unexpected ? "STORAGE_ERROR" : error.code,
        commit: error.commit,
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, service, port: server.address().port, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const running = await startEditorServer();
  console.log("글쓰기 API가 127.0.0.1:" + running.port + "에서 실행 중입니다.");
}
