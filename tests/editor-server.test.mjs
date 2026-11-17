import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import typescript from "typescript";
import MarkdownIt from "markdown-it";
import { strict } from "node:assert";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";

import { createEditorService, startEditorServer } from "../scripts/editor-server.mjs";
import { MAX_POST_BYTES, parseBlogDocument, toArticlePost } from "../app/shared/lib/content.ts";

const execFileAsync = promisify(execFile);
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHYoAAAAASUVORK5CYII=", "base64");

// 테스트 저장소에 한정한 Git 명령 실행
async function git(root, ...args) {
  const result = await execFileAsync("git", args, { cwd: root });
  return result.stdout.trim();
}

// 실제 원격과 분리한 단독 블로그 저장소 준비
async function fixture(context, options = {}) {
  const base = await mkdtemp(join(tmpdir(), "junho-editor-test-"));
  const root = join(base, "project");
  const appRoot = root;
  const remote = join(base, "pages.git");
  await mkdir(appRoot, { recursive: true });
  context.after(() => rm(base, { recursive: true, force: true }));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Editor Test");
  await git(root, "config", "user.email", "editor-test@example.invalid");
  await git(root, "config", "commit.gpgsign", "false");
  await git(root, "config", "core.hooksPath", "/dev/null");
  await writeFile(join(root, "README.md"), "Original blog README\n");
  await writeFile(join(root, ".gitignore"), "/.editor/\n");
  await mkdir(join(appRoot, "app/shared/data"), { recursive: true });
  await writeFile(join(appRoot, "app/shared/data/published-posts.ts"), "export const marker = true;\n");
  await git(root, "add", "README.md", ".gitignore", "app/shared/data/published-posts.ts");
  await git(root, "commit", "-m", "chore: fixture");
  await git(base, "init", "--bare", "--initial-branch=main", remote);
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "-u", "origin", "main");
  const service = createEditorService({ appRoot, reservedSlugs: ["reserved-example"], ...options });
  return { root, base, appRoot, service, remote };
}

// 검증 가능한 최소 글 문서 구성
function document(overrides = {}) {
  return {
    version: 1,
    id: randomUUID(),
    slug: "editor-test-post",
    title: "Editor test post",
    subtitle: "발행에 필요한 테스트 부제목입니다.",
    description: "발행 연결을 확인하는 격리된 테스트입니다.",
    category: "Engineering",
    date: "2026-11-14",
    readingMinutes: 0,
    updatedAt: "2026-11-14T00:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "직접 작성한 본문입니다." }] }] },
    ...overrides,
  };
}

// 본문 구조 제한 안에서 지정한 UTF-8 발행 크기의 다문단 문서 구성
function documentAtPublicationBytes(bytes) {
  const source = parseBlogDocument(document({
    readingMinutes: 1,
    content: { type: "doc", content: Array.from({ length: 4000 }, () => ({
      type: "paragraph", content: [{ type: "text", text: "가" }],
    })) },
  }), { publish: true });
  const paragraphs = source.content.content;
  const remaining = bytes - Buffer.byteLength(JSON.stringify(source, null, 2) + "\n");
  const characters = Math.floor(remaining / 3);
  const perParagraph = Math.floor(characters / paragraphs.length);
  for (const [index, paragraph] of paragraphs.entries()) {
    paragraph.content[0].text += "가".repeat(perParagraph + (index < characters % paragraphs.length ? 1 : 0));
  }
  paragraphs.at(-1).content[0].text += "a".repeat(remaining % 3);
  const normalized = parseBlogDocument(source, { publish: true });
  strict.equal(Buffer.byteLength(JSON.stringify(normalized, null, 2) + "\n"), bytes);
  return normalized;
}

// 현재 발행 로더를 테스트 저장소의 파일과 실제 파서로 실행
async function publishedPostLoader(appRoot) {
  const source = await readFile(new URL("../app/shared/data/published-posts.ts", import.meta.url), "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    Error,
    JSON,
    exports,
    process: { cwd: () => appRoot },
    require: (specifier) => {
      if (specifier === "node:path") return { join };
      if (specifier === "node:fs/promises") return { readdir, readFile, stat };
      if (specifier === "../lib/content") return { MAX_POST_BYTES, parseBlogDocument, toArticlePost };
      throw new Error("검증에서 허용하지 않은 발행 조회 의존성입니다: " + specifier);
    },
  }, { filename: "published-posts.ts" });
  return exports;
}

// 전송 계층에서 원래 Host와 중복 헤더를 보존한 응답 코드 확인
function requestStatus(url, headers, { method = "GET", body } = {}) {
  const requestHeaders = body === undefined ? headers : { ...headers, "Content-Length": Buffer.byteLength(body) };
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { headers: requestHeaders, method, signal: AbortSignal.timeout(5000) }, (response) => {
      response.once("end", () => resolve(response.statusCode));
      response.resume();
    });
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

test("임시 저장은 공개 파일을 만들지 않으며 이전 버전의 동시 덮어쓰기를 거부한다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const source = document({ title: "", subtitle: "", slug: "", category: "", date: "", content: { type: "doc", content: [] } });
  const saved = await service.saveDraft(source);
  strict.equal(saved.readingMinutes, 0);
  strict.equal((await service.readDraft(saved.id)).id, saved.id);
  strict.equal((await service.listDrafts()).length, 1);
  strict.equal((await service.saveDraft(source)).updatedAt, saved.updatedAt);
  await strict.rejects(service.saveDraft({ ...source, title: "충돌할 수정" }), { code: "DRAFT_CONFLICT" });
  await strict.rejects(readFile(join(appRoot, "content/posts/editor-test-post.json")), { code: "ENOENT" });
  await strict.rejects(service.readDraft("../../README"), { status: 400 });
});

test("목록은 발행 여부와 로컬 초안 유무를 구분하고 수정 초안을 삭제해도 발행 상태를 유지한다", async (context) => {
  const { service } = await fixture(context);
  const local = await service.saveDraft(document({ title: "발행 전 임시글", slug: "" }));
  const published = await service.publish(document({ title: "이미 발행한 글", slug: "" }));
  let summaries = await service.listDrafts();
  strict.equal(summaries.find((item) => item.id === local.id).isLocalDraft, true);
  strict.equal(summaries.find((item) => item.id === local.id).isPublished, false);
  strict.equal(summaries.find((item) => item.id === published.draft.id).isLocalDraft, true);
  strict.equal(summaries.find((item) => item.id === published.draft.id).isPublished, true);

  const edited = await service.saveDraft({ ...published.draft, title: "아직 발행하지 않은 수정 제목" });
  summaries = await service.listDrafts();
  strict.equal(summaries.find((item) => item.id === edited.id).title, edited.title);
  strict.equal(summaries.find((item) => item.id === edited.id).isPublished, true);
  await service.deleteDraft(edited.id, edited.updatedAt);
  summaries = await service.listDrafts();
  const fallback = summaries.find((item) => item.id === edited.id);
  strict.equal(fallback.isLocalDraft, false);
  strict.equal(fallback.isPublished, true);
  strict.equal(fallback.title, published.draft.title);
  strict.equal(summaries.find((item) => item.id === local.id).isPublished, false);
});

test("부제목 누락과 빈 값 및 공백은 임시 저장할 수 있지만 발행은 초안만 보존하고 거부한다", async (context) => {
  let pushes = 0;
  const { root, appRoot, service, remote } = await fixture(context, {
    push: async () => { pushes += 1; },
  });
  const before = await git(root, "rev-parse", "HEAD");
  const remoteBefore = await git(remote, "rev-parse", "main");
  for (const subtitle of [undefined, "", " \t\n "]) {
    const saved = await service.saveDraft(document({ subtitle }));
    const path = join(appRoot, ".editor/drafts", saved.id + ".json");
    const bytes = await readFile(path);
    strict.equal(saved.subtitle, subtitle?.trim());
    await strict.rejects(service.publish(saved), { message: "부제목을 입력해 주세요." });
    strict.deepEqual(await readFile(path), bytes);
    strict.deepEqual(await service.readDraft(saved.id), saved);
    await strict.rejects(readFile(join(appRoot, "content/posts", saved.slug + ".json")), { code: "ENOENT" });
  }
  strict.equal((await service.listDrafts()).length, 3);
  strict.equal(await git(root, "rev-parse", "HEAD"), before);
  strict.equal(await git(remote, "rev-parse", "main"), remoteBefore);
  strict.equal(await git(root, "status", "--porcelain"), "");
  strict.equal(pushes, 0);
});

test("부제목 없는 기존 발행 JSON은 계속 읽고 임시 저장하되 재발행에는 새 부제목이 필요하다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  await mkdir(join(appRoot, "content/posts"), { recursive: true });
  const before = await git(root, "rev-parse", "HEAD");
  const remoteBefore = await git(remote, "rev-parse", "main");
  for (const subtitle of [undefined, ""]) {
    const legacy = parseBlogDocument(document({
      subtitle,
      slug: subtitle === undefined ? "legacy-missing-subtitle" : "legacy-empty-subtitle",
      heroImage: subtitle === undefined ? { src: "/uploads/legacy.png", alt: "기존 독립 대표 이미지", width: 800, height: 450 } : undefined,
    }), { publish: true });
    const path = join(appRoot, "content/posts", legacy.slug + ".json");
    const bytes = JSON.stringify(legacy, null, 2) + "\n";
    await writeFile(path, bytes);
    strict.deepEqual(await service.readDraft(legacy.id), legacy);
    strict.equal((await service.listDrafts()).find((draft) => draft.id === legacy.id).isLocalDraft, false);
    const loader = await publishedPostLoader(appRoot);
    const post = await loader.getPostBySlug(legacy.slug);
    strict.equal(post.subtitle, subtitle);
    strict.deepEqual(post.heroImage, legacy.heroImage);
    const saved = await service.saveDraft({ ...legacy, title: "기존 글 임시 수정" });
    const status = await git(root, "status", "--porcelain");
    await strict.rejects(service.publish(saved), { message: "부제목을 입력해 주세요." });
    strict.deepEqual(await service.readDraft(legacy.id), saved);
    strict.equal(await readFile(path, "utf8"), bytes);
    strict.equal(await git(root, "status", "--porcelain"), status);
  }
  strict.equal(await git(root, "rev-parse", "HEAD"), before);
  strict.equal(await git(remote, "rev-parse", "main"), remoteBefore);
});

test("임시 글 삭제는 지정한 로컬 초안만 지우고 다른 초안과 이미지 및 Git을 보존한다", async (context) => {
  const { root, service, remote } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "보존할 이미지.png");
  const saved = await service.saveDraft(document({ heroImage: image, content: { type: "doc", content: [{ type: "image", attrs: image }] } }));
  const other = await service.saveDraft(document({ title: "남길 임시 글" }));
  const before = await git(root, "rev-parse", "HEAD");
  const remoteBefore = await git(remote, "rev-parse", "main");
  strict((await service.listDrafts()).every((draft) => draft.isLocalDraft === true));
  strict.deepEqual(await service.deleteDraft(saved.id, saved.updatedAt), { deleted: saved.id });
  await strict.rejects(service.readDraft(saved.id), { status: 404 });
  await strict.rejects(service.deleteDraft(saved.id, saved.updatedAt), { status: 404 });
  strict.deepEqual(await service.readDraft(other.id), other);
  strict.deepEqual((await service.listDrafts()).map((draft) => draft.id), [other.id]);
  strict.deepEqual(await readFile((await service.readMedia(image.src.split("/").at(-1))).path), tinyPng);
  strict.equal(await git(root, "rev-parse", "HEAD"), before);
  strict.equal(await git(remote, "rev-parse", "main"), remoteBefore);
  strict.equal(await git(root, "status", "--porcelain"), "");
});

test("발행한 글의 로컬 초안만 삭제하고 공개 글과 업로드 및 발행 전용 목록을 보존한다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "발행한 이미지.png");
  const published = await service.publish(document({ heroImage: image, content: { type: "doc", content: [{ type: "image", attrs: image }] } }));
  const path = join(appRoot, "content/posts", published.slug + ".json");
  const bytes = await readFile(path);
  const publication = JSON.parse(bytes.toString("utf8"));
  const uploadPath = join(appRoot, "public", publication.heroImage.src.slice(1));
  const before = await git(root, "rev-parse", "HEAD");
  const remoteBefore = await git(remote, "rev-parse", "main");
  await writeFile(join(root, "unrelated.txt"), "Keep staged during deletion\n");
  await git(root, "add", "unrelated.txt");
  const status = await git(root, "status", "--porcelain");
  strict.equal((await service.listDrafts())[0].isLocalDraft, true);
  await service.deleteDraft(published.draft.id, published.draft.updatedAt);
  strict.deepEqual(await readFile(path), bytes);
  strict.deepEqual(await readFile(uploadPath), tinyPng);
  strict.deepEqual(await readFile((await service.readMedia(image.src.split("/").at(-1))).path), tinyPng);
  strict.equal((await service.readDraft(published.draft.id)).id, published.draft.id);
  strict.deepEqual(await service.listDrafts(), [{
    id: publication.id, title: publication.title, slug: publication.slug,
    updatedAt: publication.updatedAt, isLocalDraft: false, isPublished: true,
  }]);
  await strict.rejects(service.deleteDraft(published.draft.id, publication.updatedAt), { status: 404 });
  strict.equal(await git(root, "rev-parse", "HEAD"), before);
  strict.equal(await git(remote, "rev-parse", "main"), remoteBefore);
  strict.equal(await git(root, "status", "--porcelain"), status);
});

test("초안 저장과 삭제를 직렬화하고 오래된 삭제 요청과 중복 삭제를 거부한다", async (context) => {
  const { service } = await fixture(context);
  const saved = await service.saveDraft(document());
  const [updated, deletion] = await Promise.allSettled([
    service.saveDraft({ ...saved, title: "다른 창에서 저장한 최신 글" }),
    service.deleteDraft(saved.id, saved.updatedAt),
  ]);
  strict.equal(updated.status, "fulfilled");
  strict.equal(deletion.status, "rejected");
  strict.equal(deletion.reason.status, 409);
  strict.equal(deletion.reason.code, "DRAFT_CONFLICT");
  strict.deepEqual(await service.readDraft(saved.id), updated.value);
  const results = await Promise.allSettled([
    service.deleteDraft(saved.id, updated.value.updatedAt),
    service.deleteDraft(saved.id, updated.value.updatedAt),
  ]);
  strict.equal(results[0].status, "fulfilled");
  strict.equal(results[1].status, "rejected");
  strict.equal(results[1].reason.status, 404);
});

test("임시 글 삭제는 잘못된 식별자와 저장 버전을 거부하고 없는 저장 폴더를 만들지 않는다", async (context) => {
  const { appRoot, service } = await fixture(context);
  for (const id of [null, "", "../../README", "0".repeat(36)]) {
    await strict.rejects(service.deleteDraft(id, "2026-11-14T00:00:00.000Z"), { status: 400 });
  }
  await strict.rejects(service.deleteDraft(randomUUID(), "2026-11-14T00:00:00.000Z"), { status: 404 });
  await strict.rejects(lstat(join(appRoot, ".editor")), { code: "ENOENT" });
  const saved = await service.saveDraft(document());
  for (const version of [undefined, null, "", "not-a-date"]) {
    await strict.rejects(service.deleteDraft(saved.id, version), { status: 400 });
  }
  strict.deepEqual(await service.readDraft(saved.id), saved);
  const wrongId = randomUUID();
  const wrongPath = join(appRoot, ".editor/drafts", wrongId + ".json");
  const bytes = JSON.stringify(saved);
  await writeFile(wrongPath, bytes);
  await strict.rejects(service.deleteDraft(wrongId, saved.updatedAt), { status: 409, code: "DRAFT_PATH_INVALID" });
  strict.equal(await readFile(wrongPath, "utf8"), bytes);
});

test("임시 글 삭제는 파일과 두 상위 저장 폴더의 심볼릭 링크를 따라가지 않는다", async (context) => {
  for (const location of ["file", "drafts", "state"]) {
    await context.test(location, async (child) => {
      const { base, appRoot, service } = await fixture(child);
      const saved = await service.saveDraft(document());
      const outside = join(base, "outside");
      const outsideDirectory = location === "state" ? join(outside, "drafts") : outside;
      const outsidePath = join(outsideDirectory, saved.id + ".json");
      const path = location === "file" ? join(appRoot, ".editor/drafts", saved.id + ".json")
        : location === "drafts" ? join(appRoot, ".editor/drafts") : join(appRoot, ".editor");
      const bytes = JSON.stringify(saved);
      await mkdir(outsideDirectory, { recursive: true });
      await writeFile(outsidePath, bytes);
      await rm(path, { recursive: true });
      await symlink(location === "file" ? outsidePath : outside, path);
      await strict.rejects(service.deleteDraft(saved.id, saved.updatedAt), { status: 409, code: "DRAFT_PATH_INVALID" });
      strict.equal(await readFile(outsidePath, "utf8"), bytes);
      strict.equal((await lstat(path)).isSymbolicLink(), true);
      if (location === "file") {
        await rm(path);
        await mkdir(path);
        await strict.rejects(service.deleteDraft(saved.id, saved.updatedAt), { status: 409, code: "DRAFT_PATH_INVALID" });
        strict.equal((await lstat(path)).isDirectory(), true);
      }
    });
  }
});

test("저장소 경로를 생략하면 단독 앱 루트의 글만 발행하고 임시 글은 제외한다", async (context) => {
  const { root, service, remote } = await fixture(context);
  const result = await service.publish(document());
  strict.deepEqual((await git(root, "diff", "HEAD~1", "HEAD", "--name-only")).split("\n"), ["content/posts/editor-test-post.json"]);
  strict.equal(await git(root, "remote", "get-url", "--push", "--all", "origin"), remote);
  strict.equal(await git(remote, "rev-parse", "main"), result.commit);
  strict.equal(await git(root, "status", "--porcelain"), "");
  strict.equal(await git(root, "ls-files", ".editor"), "");
  strict.equal((await service.readDraft(result.draft.id)).id, result.draft.id);
});

test("발행 JSON이 2,000,001바이트이면 초안을 보존하고 공개 파일과 Git 및 푸시를 바꾸지 않는다", async (context) => {
  let pushes = 0;
  const { root, appRoot, service, remote } = await fixture(context, {
    push: async () => { pushes += 1; },
  });
  const source = documentAtPublicationBytes(MAX_POST_BYTES + 1);
  const before = await git(root, "rev-parse", "HEAD");
  const remoteBefore = await git(remote, "rev-parse", "main");
  strict.equal(MAX_POST_BYTES, 2_000_000);
  strict(Buffer.byteLength(JSON.stringify(source, null, 2) + "\n") <= 2 * 1024 * 1024);
  await strict.rejects(service.publish(source), { status: 413 });
  const saved = await service.readDraft(source.id);
  strict.deepEqual(saved, { ...source, updatedAt: saved.updatedAt });
  await strict.rejects(readFile(join(appRoot, "content/posts", source.slug + ".json")), { code: "ENOENT" });
  strict.equal(await git(root, "rev-parse", "HEAD"), before);
  strict.equal(await git(remote, "rev-parse", "main"), remoteBefore);
  strict.equal(await git(root, "status", "--porcelain"), "");
  strict.equal(pushes, 0);
});

test("발행 JSON이 정확히 2,000,000바이트인 글은 정상 발행하고 실제 파서와 사이트 로더로 읽는다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  const source = documentAtPublicationBytes(MAX_POST_BYTES);
  const result = await service.publish(source);
  const bytes = await readFile(join(appRoot, "content/posts", result.slug + ".json"));
  strict.equal(bytes.length, 2_000_000);
  const published = parseBlogDocument(JSON.parse(bytes.toString("utf8")), { publish: true });
  strict.deepEqual(published.content, source.content);
  strict.equal(result.pushed, true);
  strict.equal(await git(root, "rev-parse", "HEAD"), result.commit);
  strict.equal(await git(remote, "rev-parse", "main"), result.commit);
  strict.deepEqual((await git(root, "diff", "HEAD~1", "HEAD", "--name-only")).split("\n"), ["content/posts/" + result.slug + ".json"]);
  const loader = await publishedPostLoader(appRoot);
  const post = await loader.getPostBySlug(result.slug);
  strict.equal(post.slug, result.slug);
  strict.deepEqual(post.document, source.content);
});

test("이미지를 재작성한 글만 커밋하며 다른 스테이징과 README를 보존하고 블로그 원격에 푸시한다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "작은 이미지.png");
  const source = document({ heroImage: image, content: { type: "doc", content: [{ type: "image", attrs: { ...image, src: "http://localhost:3000" + image.src + "/?cache=1#preview" } }] } });
  await writeFile(join(root, "unrelated.txt"), "Do not commit this file\n");
  await git(root, "add", "unrelated.txt");
  const result = await service.publish(source);
  strict.equal(result.pushed, true);
  strict.equal(result.draft.readingMinutes, 0);
  strict.equal(await readFile(join(root, "README.md"), "utf8"), "Original blog README\n");
  strict.equal(await git(root, "diff", "--cached", "--name-only"), "unrelated.txt");
  const changed = (await git(root, "diff", "HEAD~1", "HEAD", "--name-only")).split("\n");
  strict.equal(changed.length, 2);
  strict(changed.every((path) => path.startsWith("content/posts/") || path.startsWith("public/uploads/")));
  const published = JSON.parse(await readFile(join(appRoot, "content/posts/editor-test-post.json"), "utf8"));
  strict(published.readingMinutes >= 1);
  strict(published.heroImage.src.startsWith("/uploads/"));
  strict.equal(published.content.content[0].attrs.src, published.heroImage.src);
  strict(!JSON.stringify(published).includes("/__editor/"));
  strict.deepEqual(await readFile(join(appRoot, "public", published.heroImage.src.slice(1))), tinyPng);
  strict.equal(await git(remote, "rev-parse", "main"), result.commit);
});

test("발행 이미지의 마크다운 목적지도 같은 공개 주소로 바꾸고 코드와 유사한 주소는 보존한다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const first = await service.uploadMedia(tinyPng, "첫 이미지.png");
  const second = await service.uploadMedia(tinyPng, "둘째 이미지.png");
  const firstSource = "http://localhost:3000" + first.src + "/?cache=1#preview";
  const markdown = [
    "# 이미지 원문",
    "![직접](" + firstSource + " \"제목\")",
    "![꺾쇠](<" + firstSource + ">)",
    "![참조][second]",
    "",
    "[second]: <" + second.src + "> \"참조 제목\"",
    "원문 주소: " + firstSource,
    "`![인라인 코드](" + firstSource + ")`",
    "```markdown",
    "![코드 블록](" + second.src + ")",
    "```",
    "~~~markdown",
    "[코드 참조]: " + second.src,
    "~~~",
    "[다른 주소](" + second.src + "?different=1)",
    "[접미사](" + second.src + "-suffix)",
    "![외부](https://example.invalid/?image=" + second.src + ")",
  ].join("\n");
  const result = await service.publish(document({
    subtitle: "이미지 원문과 발행 주소를 확인합니다.", markdown,
    content: { type: "doc", content: [
      { type: "image", attrs: { ...first, src: firstSource } },
      { type: "image", attrs: second },
    ] },
  }));
  const publication = JSON.parse(await readFile(join(appRoot, "content/posts", result.slug + ".json"), "utf8"));
  const firstPublic = publication.content.content[0].attrs.src;
  const secondPublic = publication.content.content[1].attrs.src;
  const expected = markdown
    .replace("![직접](" + firstSource + " \"제목\")", "![직접](" + firstPublic + " \"제목\")")
    .replace("![꺾쇠](<" + firstSource + ">)", "![꺾쇠](<" + firstPublic + ">)")
    .replace("[second]: <" + second.src + ">", "[second]: <" + secondPublic + ">");
  strict(firstPublic.startsWith("/uploads/"));
  strict(secondPublic.startsWith("/uploads/"));
  strict.equal(publication.markdown, expected);
  strict.equal((await service.readDraft(result.draft.id)).markdown, markdown);
  await rm(join(appRoot, ".editor"), { recursive: true, force: true });
  const reopened = await createEditorService({ appRoot }).readDraft(result.draft.id);
  strict.equal(reopened.markdown, expected);
  strict.deepEqual(await readFile(join(appRoot, "public", firstPublic.slice(1))), tinyPng);
  strict.deepEqual(await readFile(join(appRoot, "public", secondPublic.slice(1))), tinyPng);
});

test("마크다운 구문 위치만 치환해 괄호와 escape 및 entity 이미지를 보존하고 코드와 잘못된 참조는 바꾸지 않는다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "구문 위치.png");
  const source = image.src + "?cache=(1)&kind=2";
  const escaped = source.replace("(1)", "\\(1\\)").replace("&", "&amp;");
  const markdown = [
    "#   원문 서식  ",
    "![괄호](" + source + " \"제목\")  ",
    "> ![인용](<" + escaped + ">)",
    "  - ![목록](" + escaped + ")",
    "> [actual-ref]: <" + escaped + "> '참조 제목'",
    "> ![참조][actual-ref]",
    "",
    "    ![들여쓴 코드](" + source + ")",
    "",
    "> ~~~markdown",
    "> ![인용 코드](" + source + ")",
    "> ~~~",
    "",
    "~~~markdown",
    "![코드](" + source + ")",
    "~~~",
    "`![인라인 코드](" + source + ")`",
    "",
    "[invalid-ref]: " + source + " invalid trailing text",
    "![잘못된 인라인](" + source + " invalid trailing text)",
  ].join("\r\n");
  const result = await service.publish(document({
    subtitle: "마크다운 구문별 이미지 주소를 확인합니다.", markdown,
    content: { type: "doc", content: Array.from({ length: 4 }, () => ({ type: "image", attrs: { ...image, src: source } })) },
  }));
  const publication = JSON.parse(await readFile(join(appRoot, "content/posts", result.slug + ".json"), "utf8"));
  const publicSource = publication.content.content[0].attrs.src;
  const expected = markdown
    .replace("![괄호](" + source + " \"제목\")", "![괄호](" + publicSource + " \"제목\")")
    .replace("> ![인용](<" + escaped + ">)", "> ![인용](<" + publicSource + ">)")
    .replace("- ![목록](" + escaped + ")", "- ![목록](" + publicSource + ")")
    .replace("[actual-ref]: <" + escaped + ">", "[actual-ref]: <" + publicSource + ">");
  strict.equal(publication.markdown, expected);
  await rm(join(appRoot, ".editor"), { recursive: true, force: true });
  const reopened = await createEditorService({ appRoot }).readDraft(result.draft.id);
  strict.equal(reopened.markdown, expected);
  const images = new MarkdownIt("commonmark", { html: false }).parse(reopened.markdown, {})
    .flatMap((token) => token.children || []).filter((token) => token.type === "image");
  strict.equal(images.length, 4);
  strict(images.every((token) => token.attrGet("src") === publicSource));
});

test("메타데이터와 일치하지 않는 실제 임시 마크다운 이미지는 초안을 남기고 발행을 거부한다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "일치 검사.png");
  const before = await git(root, "rev-parse", "HEAD");
  const remoteBefore = await git(remote, "rev-parse", "main");
  for (const includeImage of [false, true]) {
    const markdown = "![불일치](" + image.src + "?different=1)";
    const source = document({ markdown, content: { type: "doc", content: includeImage
      ? [{ type: "image", attrs: image }]
      : [{ type: "paragraph", content: [{ type: "text", text: "본문에는 다른 내용이 있습니다." }] }] } });
    await strict.rejects(service.publish(source), { status: 400, code: "MARKDOWN_IMAGE_MISMATCH" });
    strict.equal((await service.readDraft(source.id)).markdown, markdown);
    await strict.rejects(readFile(join(appRoot, "content/posts", source.slug + ".json")), { code: "ENOENT" });
  }
  strict.equal(await git(root, "rev-parse", "HEAD"), before);
  strict.equal(await git(remote, "rev-parse", "main"), remoteBefore);
  strict.equal(await git(root, "status", "--porcelain"), "");
});

test("필수 입력은 발행 전에 확인하고 예약 주소와 다른 글의 주소 충돌은 자동 해소한다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "그림.png");
  await strict.rejects(service.publish(document({ title: "", heroImage: image })));
  await strict.rejects(readFile(join(appRoot, "public", image.src.slice(1))), { code: "ENOENT" });
  const reserved = await service.publish(document({ title: "Reserved example", slug: "" }));
  strict.equal(reserved.slug, "reserved-example-2");
  const source = document();
  const result = await service.publish(source);
  const duplicate = await service.publish(document());
  strict.equal(duplicate.slug, "editor-test-post-2");
  const edited = await service.publish({ ...result.draft, title: "다른 제목", slug: "changed-address" });
  strict.equal(edited.slug, "editor-test-post");
  strict.equal((await service.readDraft(result.draft.id)).slug, "editor-test-post");
});

test("푸시 실패 후 같은 글을 다시 발행하면 추가 커밋 없이 배포를 재시도한다", async (context) => {
  let attempts = 0;
  const { root, service, remote } = await fixture(context, {
    push: async ({ git: runGit }) => {
      attempts++;
      if (attempts === 1) throw new Error("Simulated network outage");
      await runGit(["push", "origin", "main"]);
    },
  });
  const source = document();
  let failedCommit;
  await strict.rejects(service.publish(source), (error) => {
    strict.equal(error.code, "PUSH_FAILED");
    failedCommit = error.commit;
    return true;
  });
  const result = await service.publish(source);
  strict.equal(result.commit, failedCommit);
  strict.equal(await git(root, "rev-parse", "HEAD"), failedCommit);
  strict.equal(await git(remote, "rev-parse", "main"), failedCommit);
  strict.equal(attempts, 2);
});

test("글쓰기 기능이 커밋되지 않은 초기 환경에서는 글만 원격으로 보내지 않는다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  await git(root, "rm", "app/shared/data/published-posts.ts");
  await git(root, "commit", "-m", "chore: simulate previous website");
  await mkdir(join(appRoot, "app/shared/data"), { recursive: true });
  await writeFile(join(appRoot, "app/shared/data/published-posts.ts"), "export const marker = true;\n");
  const before = await git(remote, "rev-parse", "main");
  const source = document();
  await strict.rejects(service.publish(source), { code: "EDITOR_SETUP_REQUIRED", status: 409 });
  strict.equal((await service.readDraft(source.id)).id, source.id);
  await strict.rejects(readFile(join(appRoot, "content/posts/editor-test-post.json")), { code: "ENOENT" });
  strict.equal(await git(remote, "rev-parse", "main"), before);
});

test("로컬 임시 폴더가 없는 새 환경에서도 발행 글을 불러와 편집할 수 있다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const result = await service.publish(document());
  await rm(join(appRoot, ".editor"), { recursive: true, force: true });
  strict.equal((await service.listDrafts())[0].id, result.draft.id);
  const published = await service.readDraft(result.draft.id);
  strict.equal(published.title, result.draft.title);
  const saved = await service.saveDraft({ ...published, title: "수정한 제목" });
  strict.equal((await service.listDrafts()).length, 1);
  strict.equal((await service.readDraft(saved.id)).title, "수정한 제목");
});

test("커밋 실패 시 공개 글 파일과 다른 스테이징을 보존하고 임시 글을 남긴다", async (context) => {
  const { root, appRoot, service, remote } = await fixture(context);
  await writeFile(join(root, "unrelated.txt"), "Keep staged\n");
  await git(root, "add", "unrelated.txt");
  await git(root, "config", "user.name", "");
  const before = await git(remote, "rev-parse", "main");
  const image = await service.uploadMedia(tinyPng, "미발행.png");
  const source = document({ heroImage: image, content: { type: "doc", content: [{ type: "image", attrs: image }] } });
  await strict.rejects(service.publish(source), { code: "COMMIT_FAILED" });
  strict.equal(await git(root, "diff", "--cached", "--name-only"), "unrelated.txt");
  strict.equal((await service.readDraft(source.id)).id, source.id);
  await strict.rejects(readFile(join(appRoot, "content/posts/editor-test-post.json")), { code: "ENOENT" });
  await strict.rejects(readFile(join(appRoot, "public/uploads", image.src.split("/").at(-1) + ".png")), { code: "ENOENT" });
  strict.deepEqual(await readFile((await service.readMedia(image.src.split("/").at(-1))).path), tinyPng);
  strict.equal(await git(remote, "rev-parse", "main"), before);
});

test("이미지 복사가 중단되면 새 복사본만 정리하고 기존 파일과 임시 원본을 보존한다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const first = await service.uploadMedia(tinyPng, "첫 이미지.png");
  const second = await service.uploadMedia(tinyPng, "두 번째 이미지.png");
  const uploads = join(appRoot, "public/uploads");
  const firstPath = join(uploads, first.src.split("/").at(-1) + ".png");
  const secondPath = join(uploads, second.src.split("/").at(-1) + ".png");
  await mkdir(uploads, { recursive: true });
  await writeFile(secondPath, "Existing image must stay\n");
  const source = document({ heroImage: first, content: { type: "doc", content: [{ type: "image", attrs: first }, { type: "image", attrs: second }] } });
  await strict.rejects(service.publish(source), { status: 409 });
  await strict.rejects(readFile(firstPath), { code: "ENOENT" });
  strict.equal(await readFile(secondPath, "utf8"), "Existing image must stay\n");
  strict.deepEqual(await readFile((await service.readMedia(first.src.split("/").at(-1))).path), tinyPng);
  await strict.rejects(readFile(join(appRoot, "content/posts/editor-test-post.json")), { code: "ENOENT" });
});

test("로컬 API는 출처와 세션을 확인하고 끝 슬래시 및 원본 이미지 요청을 처리한다", async (context) => {
  const { service } = await fixture(context);
  const running = await startEditorServer({ service, port: 0 });
  context.after(() => running.close());
  const base = "http://127.0.0.1:" + running.port;
  const origin = "http://localhost:3000";
  const session = await fetch(base + "/session/");
  const { token } = await session.json();
  const headers = { Origin: origin, "X-Editor-Token": token, "Content-Type": "application/json" };
  strict.equal((await fetch(base + "/session", { headers: { Origin: "https://attacker.invalid" } })).status, 403);
  strict.equal((await fetch(base + "/drafts/", { headers: { Origin: origin } })).status, 403);
  strict.equal((await fetch(base + "/drafts/", { headers: { "X-Editor-Token": token } })).status, 200);
  strict.equal((await fetch(base + "/drafts/", { method: "POST", headers: { "X-Editor-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(document()) })).status, 403);
  const save = await fetch(base + "/drafts/", { method: "POST", headers, body: JSON.stringify(document()) });
  strict.equal(save.status, 200);
  const uploaded = await fetch(base + "/media/", { method: "POST", headers: { Origin: origin, "X-Editor-Token": token, "Content-Type": "image/png", "X-File-Name": encodeURIComponent("미리보기.png") }, body: tinyPng });
  strict.equal(uploaded.status, 201);
  const { image } = await uploaded.json();
  const response = await fetch(base + image.src.replace("/__editor/api", "") + "/");
  strict.equal(response.status, 200);
  strict.equal(response.headers.get("content-type"), "image/png");
  strict.deepEqual(Buffer.from(await response.arrayBuffer()), tinyPng);
  const badImage = await fetch(base + "/media/", { method: "POST", headers: { Origin: origin, "X-Editor-Token": token }, body: "<svg></svg>" });
  strict.equal(badImage.status, 415);
  const tooLarge = await fetch(base + "/drafts", { method: "POST", headers, body: "x".repeat(2 * 1024 * 1024 + 1) });
  strict.equal(tooLarge.status, 413);
});

test("임시 글 DELETE API는 출처와 토큰 및 호스트 검사를 통과한 최신 버전만 삭제한다", async (context) => {
  const { service } = await fixture(context);
  const saved = await service.saveDraft(document());
  const running = await startEditorServer({ service, port: 0 });
  context.after(() => running.close());
  const base = "http://127.0.0.1:" + running.port;
  const { token } = await (await fetch(base + "/session")).json();
  const origin = "http://localhost:3000";
  const target = base + "/drafts/" + saved.id + "/";
  const body = JSON.stringify({ expectedUpdatedAt: saved.updatedAt });
  const headers = { Origin: origin, "X-Editor-Token": token, "Content-Type": "application/json" };
  for (const denied of [
    { Origin: origin, "Content-Type": "application/json" },
    { "X-Editor-Token": token, "Content-Type": "application/json" },
    { ...headers, "X-Editor-Token": "x".repeat(token.length) },
    { ...headers, Origin: "https://attacker.invalid" },
    { ...headers, "Sec-Fetch-Site": "cross-site" },
    { ...headers, "X-Forwarded-Host": "attacker.invalid" },
  ]) {
    strict.equal((await fetch(target, { method: "DELETE", headers: denied, body })).status, 403);
  }
  strict.equal(await requestStatus(target, { ...headers, Host: "attacker.invalid" }, { method: "DELETE", body }), 403);
  strict.equal(await requestStatus(target, { ...headers, "X-Forwarded-Host": ["localhost:3000", "attacker.invalid"] }, { method: "DELETE", body }), 403);
  strict.equal((await fetch(target, { method: "DELETE", headers: { ...headers, "Content-Type": "text/plain" }, body })).status, 415);
  strict.equal((await fetch(target, { method: "DELETE", headers, body: "{" })).status, 400);
  strict.equal((await fetch(target, { method: "DELETE", headers, body: "{}" })).status, 400);
  strict.equal((await fetch(target, { method: "DELETE", headers, body: "null" })).status, 400);
  const stale = await fetch(target, { method: "DELETE", headers, body: JSON.stringify({ expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }) });
  strict.equal(stale.status, 409);
  strict.equal((await stale.json()).code, "DRAFT_CONFLICT");
  strict.deepEqual(await service.readDraft(saved.id), saved);
  strict.equal((await (await fetch(base + "/drafts", { headers })).json()).drafts[0].isLocalDraft, true);
  const response = await fetch(target, { method: "DELETE", headers, body });
  strict.equal(response.status, 200);
  strict.deepEqual(await response.json(), { deleted: saved.id });
  strict.equal((await fetch(target, { method: "DELETE", headers, body })).status, 404);
  strict.deepEqual((await (await fetch(base + "/drafts", { headers })).json()).drafts, []);
});

test("초안 주소는 제목 변경을 따라 자동 갱신하고 잘못된 수동 경로는 거부한다", async (context) => {
  const { service } = await fixture(context);
  const saved = await service.saveDraft(document({ title: "첫 번째 제목!", slug: "", subtitle: "" }));
  strict.equal(saved.slug, "첫-번째-제목");
  const renamed = await service.saveDraft({ ...saved, title: "다음 제목" });
  strict.equal(renamed.slug, "다음-제목");
  strict.equal((await service.readDraft(saved.id)).slug, "다음-제목");
  await strict.rejects(service.saveDraft({ ...saved, title: "이전 창의 수정" }), { code: "DRAFT_CONFLICT" });
  await strict.rejects(service.saveDraft(document({ slug: "../../README" })));
});

test("긴 한글 제목의 중복 주소도 UTF-8 파일 이름 제한 안에서 자동 생성한다", async (context) => {
  const { service } = await fixture(context);
  const title = "가".repeat(60);
  const first = await service.publish(document({ title, slug: "" }));
  const second = await service.publish(document({ title, slug: "" }));
  strict.equal(Buffer.byteLength(first.slug), 180);
  strict(second.slug.endsWith("-2"));
  strict(Buffer.byteLength(second.slug) <= 180);
  strict(Array.from(second.slug).length <= 96);
  strict.notEqual(first.slug, second.slug);
});

test("문자와 숫자가 없는 제목도 문서 식별자 기반 주소로 발행한다", async (context) => {
  const { service } = await fixture(context);
  const source = document({ title: "😀 !!!", slug: "" });
  const result = await service.publish(source);
  strict.equal(result.slug, "post-" + source.id);
  const renamed = await service.publish({ ...result.draft, title: "새로운 제목" });
  strict.equal(renamed.slug, result.slug);
});

test("첫 본문 이미지를 실제 업로드 크기로 발행하고 독립 대표 이미지에는 의존하지 않는다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "본문 첫 이미지.png");
  const source = document({
    subtitle: "첫 본문 이미지의 자동 썸네일을 확인합니다.",
    description: "남아 있으면 안 되는 과거 소개",
    heroImage: { src: "/__editor/api/media/00000000-0000-4000-8000-000000000000", alt: "남은 독립 대표 이미지" },
    content: { type: "doc", content: [{ type: "blockquote", content: [
      { type: "paragraph", content: [{ type: "text", text: "본문에서 가져올 소개입니다." }] },
      { type: "image", attrs: { src: image.src, alt: image.alt } },
    ] }] },
  });
  const result = await service.publish(source);
  const published = JSON.parse(await readFile(join(appRoot, "content/posts", result.slug + ".json"), "utf8"));
  strict.equal(published.description, source.subtitle);
  strict.equal(published.subtitle, source.subtitle);
  strict.equal(published.heroImage.src, published.content.content[0].content[1].attrs.src);
  strict.equal(published.heroImage.width, 1);
  strict.equal(published.heroImage.height, 1);
  strict(published.heroImage.src.startsWith("/uploads/"));
  strict(!JSON.stringify(published).includes("/__editor/"));
});

test("자동 충돌 주소로 커밋된 글은 푸시 재시도에서도 주소와 커밋을 유지한다", async (context) => {
  let attempts = 0;
  const { root, service, remote } = await fixture(context, {
    push: async ({ git: runGit }) => {
      attempts += 1;
      if (attempts === 2) throw new Error("Simulated duplicate-title push outage");
      await runGit(["push", "origin", "main"]);
    },
  });
  await service.publish(document());
  const duplicate = document();
  let failedCommit;
  await strict.rejects(service.publish(duplicate), (error) => {
    strict.equal(error.code, "PUSH_FAILED");
    failedCommit = error.commit;
    return true;
  });
  strict.equal((await service.readDraft(duplicate.id)).slug, "editor-test-post-2");
  const retried = await service.publish(duplicate);
  strict.equal(retried.slug, "editor-test-post-2");
  strict.equal(retried.commit, failedCommit);
  strict.equal(await git(root, "rev-parse", "HEAD"), failedCommit);
  strict.equal(await git(remote, "rev-parse", "main"), failedCommit);
});

test("저장 응답 재시도는 그사이 발생한 자동 주소 충돌을 사용자 편집 충돌로 보지 않는다", async (context) => {
  const { service } = await fixture(context);
  const source = document();
  const saved = await service.saveDraft(source);
  await service.publish(document());
  const retried = await service.saveDraft(source);
  strict.equal(saved.slug, "editor-test-post");
  strict.equal(retried.id, saved.id);
  strict.equal(retried.slug, "editor-test-post-2");
  strict.equal((await service.readDraft(source.id)).slug, retried.slug);
  await strict.rejects(service.saveDraft({ ...source, title: "오래된 창의 편집" }), { code: "DRAFT_CONFLICT" });
});

test("프록시의 원본 호스트도 루프백 한 개만 허용하고 세션 및 초안 우회를 차단한다", async (context) => {
  const { service } = await fixture(context);
  const running = await startEditorServer({ service, port: 0 });
  context.after(() => running.close());
  const base = "http://127.0.0.1:" + running.port;
  const { token } = await (await fetch(base + "/session")).json();
  for (const forwardedHost of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    const headers = { "X-Forwarded-Host": forwardedHost, "Sec-Fetch-Site": "same-origin" };
    strict.equal((await fetch(base + "/session", { headers })).status, 200);
    strict.equal((await fetch(base + "/drafts", { headers: { ...headers, "X-Editor-Token": token } })).status, 200);
  }
  for (const forwardedHost of ["", "attacker.invalid", "localhost.evil.invalid:3000", "localhost:3000, attacker.invalid", "attacker.invalid, localhost:3000", "localhost:3000, 127.0.0.1:3000", "localhost:3000@attacker.invalid", "localhost:3000/path"]) {
    const headers = { "X-Forwarded-Host": forwardedHost, "Sec-Fetch-Site": "same-origin" };
    strict.equal((await fetch(base + "/session", { headers })).status, 403, forwardedHost);
    strict.equal((await fetch(base + "/drafts", { headers: { ...headers, "X-Editor-Token": token } })).status, 403, forwardedHost);
  }
  strict.equal(await requestStatus(base + "/session", { Host: "attacker.invalid", "X-Forwarded-Host": "localhost:3000" }), 403);
  strict.equal(await requestStatus(base + "/session", { "X-Forwarded-Host": ["localhost:3000", "attacker.invalid"] }), 403);
  strict.equal((await fetch(base + "/session", { headers: { Origin: "https://attacker.invalid", "X-Forwarded-Host": "localhost:3000" } })).status, 403);
});

test("기본 글 목록은 비어 있고 삭제한 예시 글 주소도 예약하지 않는다", async (context) => {
  const { appRoot } = await fixture(context);
  const service = createEditorService({ appRoot });
  strict.deepEqual(await service.listDrafts(), []);
  const result = await service.publish(document({ title: "Understanding React Rendering", slug: "" }));
  strict.equal(result.slug, "understanding-react-rendering");
  const drafts = await service.listDrafts();
  strict.equal(drafts.length, 1);
  strict.equal(drafts[0].id, result.draft.id);
});
