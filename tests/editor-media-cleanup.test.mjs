import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { strict } from "node:assert";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";

import {
  readCleanupFile,
  removeCleanupFile,
  restoreCleanupFile,
  finishMediaCleanup,
  prepareMediaCleanup,
} from "../scripts/editor-media-cleanup.mjs";

const execFileAsync = promisify(execFile);

// 실제 콘텐츠와 원격에 연결하지 않는 임시 Git 저장소 구성
async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "junho-media-cleanup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  // 테스트 폴더에 한정한 Git 명령 실행
  async function git(args) {
    return (await execFileAsync("git", args, { cwd: root })).stdout.trim();
  }
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Cleanup Test"]);
  await git(["config", "user.email", "cleanup@example.invalid"]);
  await git(["config", "commit.gpgsign", "false"]);
  await git(["config", "core.hooksPath", "/dev/null"]);
  await writeFile(join(root, ".gitignore"), "/.editor/\n");
  for (const directory of ["content/posts", ".editor/drafts", ".editor/media", "public/uploads"]) await mkdir(join(root, directory), { recursive: true });
  await git(["add", ".gitignore"]);
  await git(["commit", "-m", "chore: fixture"]);
  // 앱이 생성한 형태의 로컬 원본과 공개 이미지 구성
  async function image({ tracked = true, local = true } = {}) {
    const id = randomUUID();
    const name = id + ".png";
    const bytes = Buffer.from("test image " + id);
    const path = join(root, "public/uploads", name);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes, { mode: 0o644 });
    if (local) {
      await writeFile(join(root, ".editor/media", name), bytes, { mode: 0o600 });
      await writeFile(join(root, ".editor/media", id + ".json"), JSON.stringify({ id, extension: "png", width: 1, height: 1 }));
    }
    if (tracked) {
      await git(["add", "--", "public/uploads/" + name]);
      await git(["commit", "-m", "docs: image"]);
    }
    return { id, name, path, bytes, digest };
  }
  return { root, git, image };
}

// 공유 참조 검증에 사용할 저장 가능한 문서 구성
function document(overrides = {}) {
  return {
    version: 1, id: randomUUID(), slug: "cleanup-post", title: "Cleanup post",
    subtitle: "정리 테스트 부제목", description: "정리 테스트 부제목", category: "Test",
    date: "2026-11-18", readingMinutes: 1, updatedAt: "2026-11-18T00:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "새 본문" }] }] },
    ...overrides,
  };
}

// 지정한 이미지가 포함된 이전 문서 구성
function previousDocument(images, id) {
  return document({ ...(id ? { id } : {}), content: { type: "doc", content: images.map(image => ({ type: "image", attrs: { src: "/uploads/" + image.name, alt: "이미지" } })) } });
}

// 파일 정리 준비 요청의 공통 입력 구성
function preparation(fixture, publication, previous, candidates = []) {
  return { appRoot: fixture.root, repoRoot: fixture.root, publication, previous, candidates, git: fixture.git };
}

test("안전하게 읽은 일반 파일만 삭제하고 원래 바이트와 권한으로 복구한다", async context => {
  const { root } = await fixture(context);
  const path = join(root, "public/uploads/file.png");
  await writeFile(path, "original", { mode: 0o640 });
  const snapshot = await readCleanupFile(root, path);
  strict.equal(snapshot.bytes.toString(), "original");
  await removeCleanupFile(root, snapshot);
  strict.equal(await readCleanupFile(root, path), null);
  await restoreCleanupFile(root, snapshot);
  strict.equal(await readFile(path, "utf8"), "original");
  strict.equal((await stat(path)).mode & 0o777, 0o640);
  await strict.rejects(restoreCleanupFile(root, snapshot), { code: "EEXIST" });
});

test("루트 밖 경로와 파일 및 상위 폴더 심볼릭 링크는 따라가지 않는다", async context => {
  const { root } = await fixture(context);
  const actual = join(root, "actual.png");
  await writeFile(actual, "keep");
  await symlink(actual, join(root, "public/uploads/link.png"));
  await strict.rejects(readCleanupFile(root, join(root, "public/uploads/link.png")));
  await strict.rejects(readCleanupFile(root, join(root, "../outside.png")));
  await rm(join(root, ".editor/media"), { recursive: true });
  await symlink(join(root, "public/uploads"), join(root, ".editor/media"));
  await strict.rejects(readCleanupFile(root, join(root, ".editor/media/link.png")));
  strict.equal(await readFile(actual, "utf8"), "keep");
});

test("계획 이후 변경된 바이트와 권한 및 교체된 파일은 삭제하지 않는다", async context => {
  const { root } = await fixture(context);
  const path = join(root, "public/uploads/file.png");
  await writeFile(path, "before");
  const original = await readCleanupFile(root, path);
  await writeFile(path, "after change");
  await strict.rejects(removeCleanupFile(root, original));
  const changed = await readCleanupFile(root, path);
  await chmod(path, 0o600);
  await strict.rejects(removeCleanupFile(root, changed));
  const beforeLink = await readCleanupFile(root, path);
  await unlink(path);
  await symlink(join(root, ".gitignore"), path);
  await strict.rejects(removeCleanupFile(root, beforeLink));
  strict.equal(await readFile(join(root, ".gitignore"), "utf8"), "/.editor/\n");
});

test("이전 글에서 빠진 추적 이미지만 계획하고 전체 업로드 폴더를 정리하지 않는다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const unrelated = await f.image();
  const previous = previousDocument([old]);
  const publication = document({ id: previous.id });
  await writeFile(join(f.root, "content/posts/cleanup-post.json"), JSON.stringify(previous));
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  strict.deepEqual(result.pending, [{ name: old.name, digest: old.digest }]);
  strict.deepEqual(result.assets.map(asset => asset.name), [old.name]);
  strict.equal(result.assets[0].localFiles.length, 2);
  strict.deepEqual(await readFile(old.path), old.bytes);
  strict.deepEqual(await readFile(unrelated.path), unrelated.bytes);
});

test("다른 게시글과 임시글 및 새 본문의 참조는 보존하고 보류 기록을 유지한다", async context => {
  const f = await fixture(context);
  const postImage = await f.image();
  const draftImage = await f.image();
  const currentImage = await f.image();
  const previous = previousDocument([postImage, draftImage, currentImage]);
  const publication = previousDocument([currentImage], previous.id);
  const otherPost = previousDocument([postImage]);
  await writeFile(join(f.root, "content/posts/other.json"), JSON.stringify(otherPost));
  const draft = document({ markdown: "이미지 " + encodeURIComponent(encodeURIComponent("/__editor/api/media/" + draftImage.id)) });
  await writeFile(join(f.root, ".editor/drafts", draft.id + ".json"), JSON.stringify(draft));
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  strict.equal(result.assets.length, 0);
  strict.equal(result.pending.length, 2);
});

test("외부 이미지와 같은 이름의 로컬 파일은 이전 글의 정리 후보로 보지 않는다", async context => {
  const f = await fixture(context);
  const local = await f.image();
  const previous = previousDocument([local]);
  previous.content.content[0].attrs.src = "https://other.example/uploads/" + local.name;
  const publication = document({ id: previous.id });
  strict.deepEqual(await prepareMediaCleanup(preparation(f, publication, previous)), { assets: [], pending: [] });
  strict.deepEqual(await readFile(local.path), local.bytes);
});

test("코드와 마크다운 및 링크 예시에만 나온 경로는 로컬 이미지 삭제 후보가 아니다", async context => {
  const f = await fixture(context);
  const local = await f.image();
  const source = "/uploads/" + local.name;
  const previous = document({
    markdown: "`![예시](" + source + ")`",
    content: { type: "doc", content: [
      { type: "codeBlock", content: [{ type: "text", text: source }] },
      { type: "paragraph", content: [{ type: "text", text: source, marks: [{ type: "link", attrs: { href: source } }] }] },
    ] },
  });
  const publication = document({ id: previous.id });
  strict.deepEqual(await prepareMediaCleanup(preparation(f, publication, previous)), { assets: [], pending: [] });
  strict.deepEqual(await readFile(local.path), local.bytes);
});

test("상대 및 루프백 실제 이미지 주소의 쿼리와 인코딩된 파일 경로를 처리한다", async context => {
  const f = await fixture(context);
  const first = await f.image();
  const second = await f.image();
  const previous = previousDocument([first, second]);
  previous.content.content[0].attrs.src = "/uploads/" + first.name.replace(".", "%2E") + "?size=2#hero";
  previous.content.content[1].attrs.src = "http://[::1]:3000/uploads/" + second.name + "?size=1";
  const publication = document({ id: previous.id });
  strict.deepEqual((await prepareMediaCleanup(preparation(f, publication, previous))).assets.map(asset => asset.name), [first.name, second.name]);
});

test("hero와 코드 및 링크 문자열의 인코딩된 참조도 같은 ID 전체를 보호한다", async context => {
  const f = await fixture(context);
  const hero = await f.image();
  const code = await f.image();
  const link = await f.image();
  const previous = previousDocument([hero, code, link]);
  const publication = document({ id: previous.id });
  const referenced = document({
    subtitle: undefined,
    heroImage: { src: "/uploads/" + hero.id + ".webp", alt: "다른 확장자", width: 1, height: 1 },
    content: { type: "doc", content: [
      { type: "codeBlock", content: [{ type: "text", text: encodeURIComponent("/uploads/" + code.name) }] },
      { type: "paragraph", content: [{ type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "https://example.com/uploads/" + link.name + "?x=1" } }] }] },
    ] },
  });
  await writeFile(join(f.root, "content/posts/referenced.json"), JSON.stringify(referenced));
  strict.equal((await prepareMediaCleanup(preparation(f, publication, previous))).assets.length, 0);
});

test("읽을 수 없는 글과 손상된 초안 및 심볼릭 링크 문서가 있으면 정리하지 않는다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const previous = previousDocument([old]);
  const args = preparation(f, document({ id: previous.id }), previous);
  const path = join(f.root, ".editor/drafts", randomUUID() + ".json");
  await writeFile(path, "{ broken");
  await strict.rejects(prepareMediaCleanup(args));
  await unlink(path);
  await symlink(join(f.root, ".gitignore"), path);
  await strict.rejects(prepareMediaCleanup(args));
  strict.deepEqual(await readFile(old.path), old.bytes);
});

test("미추적 이미지와 staged 및 unstaged 수동 변경은 삭제 후보로 선택하지 않는다", async context => {
  const f = await fixture(context);
  const untracked = await f.image({ tracked: false });
  const changed = await f.image();
  const staged = await f.image();
  await writeFile(changed.path, "manual changed");
  await writeFile(staged.path, "manual staged");
  await f.git(["add", "--", "public/uploads/" + staged.name]);
  const previous = previousDocument([untracked, changed, staged]);
  const result = await prepareMediaCleanup(preparation(f, document({ id: previous.id }), previous));
  strict.equal(result.assets.length, 0);
  strict.equal(result.pending.length, 0);
});

test("Git이 변경을 숨긴 파일도 HEAD 바이트와 다르면 보존한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  await f.git(["update-index", "--assume-unchanged", "--", "public/uploads/" + old.name]);
  await writeFile(old.path, "hidden manual change");
  const previous = previousDocument([old]);
  strict.equal((await prepareMediaCleanup(preparation(f, document({ id: previous.id }), previous))).assets.length, 0);
});

test("다른 게시글의 작업 파일에서 지운 참조도 HEAD에 남아 있으면 보존한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const other = previousDocument([old]);
  const path = join(f.root, "content/posts/other.json");
  await writeFile(path, JSON.stringify(other));
  await f.git(["add", "--", "content/posts/other.json"]);
  await f.git(["commit", "-m", "docs: other"]);
  await writeFile(path, JSON.stringify(document({ id: other.id })));
  const previous = previousDocument([old]);
  const publication = document({ id: previous.id });
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  strict.equal(result.assets.length, 0);
  strict.equal(result.pending.length, 1);
});

test("작업 파일에는 없지만 다른 게시글의 인덱스에만 있는 참조도 보존한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const other = previousDocument([old]);
  const path = join(f.root, "content/posts/other.json");
  await writeFile(path, JSON.stringify(other));
  await f.git(["add", "--", "content/posts/other.json"]);
  await writeFile(path, JSON.stringify(document({ id: other.id })));
  const previous = previousDocument([old]);
  const publication = document({ id: previous.id });
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  strict.equal(result.assets.length, 0);
  strict.equal(result.pending.length, 1);
});

test("현재 글이 재사용한 journal 후보는 제거하고 동일 글 재시도에는 후보를 만들지 않는다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const publication = previousDocument([old]);
  const result = await prepareMediaCleanup(preparation(f, publication, publication, [{ name: old.name, digest: old.digest }]));
  strict.deepEqual(result, { assets: [], pending: [] });
});

test("journal digest가 달라진 파일과 잘못된 정리 기록은 보존한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const publication = document();
  const candidate = { name: old.name, digest: "0".repeat(64) };
  const result = await prepareMediaCleanup(preparation(f, publication, null, [candidate]));
  strict.equal(result.assets.length, 0);
  strict.deepEqual(result.pending, [candidate]);
  for (const invalid of [{ name: "../../file.png", digest: old.digest }, { name: old.name, digest: "bad" }]) {
    await strict.rejects(prepareMediaCleanup(preparation(f, publication, null, [invalid])));
  }
});

test("공개 파일을 삭제한 journal로도 남은 로컬 원본과 메타데이터만 정리한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  await unlink(old.path);
  const publication = document();
  const result = await prepareMediaCleanup(preparation(f, publication, null, [{ name: old.name, digest: old.digest }]));
  strict.equal(result.assets[0].publicFile, null);
  strict.equal(result.assets[0].localFiles.length, 2);
  strict.deepEqual(await finishMediaCleanup({ appRoot: f.root, repoRoot: f.root, git: f.git, publication, assets: result.assets }), [old.name]);
  strict.equal(await readCleanupFile(f.root, join(f.root, ".editor/media", old.name)), null);
  strict.equal(await readCleanupFile(f.root, join(f.root, ".editor/media", old.id + ".json")), null);
});

test("메타데이터만 남은 경우 검증 후 정리하고 손상 및 다른 원본은 보존한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const publication = document();
  const args = preparation(f, publication, null, [{ name: old.name, digest: old.digest }]);
  const binary = join(f.root, ".editor/media", old.name);
  const metadata = join(f.root, ".editor/media", old.id + ".json");
  await unlink(binary);
  const result = await prepareMediaCleanup(args);
  strict.deepEqual(result.assets[0].localFiles.map(file => file.path), [metadata]);
  await writeFile(metadata, JSON.stringify({ id: old.id, extension: "gif" }));
  await strict.rejects(prepareMediaCleanup(args));
  await writeFile(metadata, JSON.stringify({ id: old.id, extension: "png" }));
  await writeFile(binary, "different bytes");
  await strict.rejects(prepareMediaCleanup(args));
  strict.equal(await readFile(binary, "utf8"), "different bytes");
});

test("푸시 성공 뒤 새로 생긴 저장 참조를 다시 확인하여 로컬 원본을 보존한다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const previous = previousDocument([old]);
  const publication = document({ id: previous.id });
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  const draft = previousDocument([old]);
  await writeFile(join(f.root, ".editor/drafts", draft.id + ".json"), JSON.stringify(draft));
  strict.deepEqual(await finishMediaCleanup({ appRoot: f.root, repoRoot: f.root, git: f.git, publication, assets: result.assets }), []);
  strict.deepEqual(await readFile(join(f.root, ".editor/media", old.name)), old.bytes);
});

test("계획 이후 로컬 원본이 바뀌면 해당 원본과 메타데이터를 삭제하지 않는다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const previous = previousDocument([old]);
  const publication = document({ id: previous.id });
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  const binary = join(f.root, ".editor/media", old.name);
  await writeFile(binary, "changed after plan");
  await strict.rejects(finishMediaCleanup({ appRoot: f.root, repoRoot: f.root, git: f.git, publication, assets: result.assets }));
  strict.equal(await readFile(binary, "utf8"), "changed after plan");
  strict.ok(await readCleanupFile(f.root, join(f.root, ".editor/media", old.id + ".json")));
});

test("일부 로컬 삭제 후 재시도에서는 남은 메타데이터만 검증해 정리를 마친다", async context => {
  const f = await fixture(context);
  const old = await f.image();
  const previous = previousDocument([old]);
  const publication = document({ id: previous.id });
  const result = await prepareMediaCleanup(preparation(f, publication, previous));
  await removeCleanupFile(f.root, result.assets[0].publicFile);
  await removeCleanupFile(f.root, result.assets[0].localFiles[0]);
  const retried = await prepareMediaCleanup(preparation(f, publication, null, result.pending));
  strict.equal(retried.assets[0].localFiles.length, 1);
  strict.deepEqual(await finishMediaCleanup({ appRoot: f.root, repoRoot: f.root, git: f.git, publication, assets: retried.assets }), [old.name]);
  strict.equal(await readCleanupFile(f.root, join(f.root, ".editor/media", old.id + ".json")), null);
});
