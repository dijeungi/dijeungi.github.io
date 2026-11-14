import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strict } from "node:assert";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { createEditorService, startEditorServer } from "../scripts/editor-server.mjs";

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
    title: "로컬 편집기 테스트",
    description: "발행 연결을 확인하는 격리된 테스트입니다.",
    category: "Engineering",
    date: "2026-11-14",
    readingMinutes: 0,
    updatedAt: "2026-11-14T00:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "직접 작성한 본문입니다." }] }] },
    ...overrides,
  };
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

test("필수 입력과 주소 충돌을 발행 파일 복사 전에 확인한다", async (context) => {
  const { appRoot, service } = await fixture(context);
  const image = await service.uploadMedia(tinyPng, "그림.png");
  await strict.rejects(service.publish(document({ title: "", heroImage: image })));
  await strict.rejects(readFile(join(appRoot, "public", image.src.slice(1))), { code: "ENOENT" });
  await strict.rejects(service.publish(document({ slug: "reserved-example" })), { code: "SLUG_CONFLICT" });
  const source = document();
  const result = await service.publish(source);
  await strict.rejects(service.publish(document()), { code: "SLUG_CONFLICT" });
  await strict.rejects(service.publish({ ...result.draft, slug: "changed-address" }), { code: "SLUG_IMMUTABLE" });
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
