import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import typescript from "typescript";
import { strict } from "node:assert";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

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
function requestStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { headers, signal: AbortSignal.timeout(5000) }, (response) => {
      response.once("end", () => resolve(response.statusCode));
      response.resume();
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

test("임시 저장은 공개 파일을 만들지 않으며 이전 버전의 동시 덮어쓰기를 거부한다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const source = document({ title: "", slug: "", category: "", date: "", content: { type: "doc", content: [] } });
  const saved = await service.saveDraft(source);
  strict.equal(saved.readingMinutes, 0);
  strict.equal((await service.readDraft(saved.id)).id, saved.id);
  strict.equal((await service.listDrafts()).length, 1);
  strict.equal((await service.saveDraft(source)).updatedAt, saved.updatedAt);
  await strict.rejects(service.saveDraft({ ...source, title: "충돌할 수정" }), { code: "DRAFT_CONFLICT" });
  await strict.rejects(readFile(join(appRoot, "content/posts/editor-test-post.json")), { code: "ENOENT" });
  await strict.rejects(service.readDraft("../../README"), { status: 400 });
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
  const source = document({ heroImage: { ...image, src: "http://localhost:3000" + image.src + "/?cache=1#preview" }, content: { type: "doc", content: [{ type: "image", attrs: { ...image, src: image.src + "?cache=1#draft" } }] } });
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
  const source = document({ heroImage: image });
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
  const source = document({ heroImage: first, content: { type: "doc", content: [{ type: "image", attrs: second }] } });
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
    subtitle: "",
    description: "남아 있으면 안 되는 과거 소개",
    heroImage: { src: "/__editor/api/media/00000000-0000-4000-8000-000000000000", alt: "남은 독립 대표 이미지" },
    content: { type: "doc", content: [{ type: "blockquote", content: [
      { type: "paragraph", content: [{ type: "text", text: "본문에서 가져올 소개입니다." }] },
      { type: "image", attrs: { src: image.src, alt: image.alt } },
    ] }] },
  });
  const result = await service.publish(source);
  const published = JSON.parse(await readFile(join(appRoot, "content/posts", result.slug + ".json"), "utf8"));
  strict.equal(published.description, "본문에서 가져올 소개입니다.");
  strict.equal(published.subtitle, "");
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
