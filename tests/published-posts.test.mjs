import { test } from "node:test";
import { join, basename, dirname } from "node:path";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import typescript from "typescript";

import { MAX_POST_BYTES, parseBlogDocument, toArticlePost } from "../app/shared/lib/content.ts";

const source = await readFile(new URL("../app/shared/data/published-posts.ts", import.meta.url), "utf8");
const compiled = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
}).outputText;

// 실제 사용자 파일과 무관한 발행 문서 검증 자료 생성
function publication(overrides = {}) {
  return {
    version: 1,
    id: "d8f87121-2345-4abc-8abc-123456789abc",
    slug: "한글-테스트-글",
    title: "메모리에서만 사용하는 검증 글",
    subtitle: "",
    description: "",
    category: "Testing",
    date: "2026-11-15",
    readingMinutes: 1,
    updatedAt: "2026-11-15T00:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "격리된 검증 본문입니다." }] }] },
    ...overrides,
  };
}

// 발행 조회 소스를 실제 파서와 메모리 파일 시스템으로 실행
function createLoader(files = new Map(), failure = null) {
  const reads = [];
  const loaded = { exports: {} };
  const directory = join("/virtual-blog", "content", "posts");

  // 가상 발행 디렉터리 안의 JSON만 읽기
  function readVirtualFile(filename) {
    assert.equal(dirname(filename), directory);
    const value = files.get(basename(filename));
    if (value === undefined) throw Object.assign(new Error("가상 발행 파일이 없습니다."), { code: "ENOENT" });
    return value;
  }

  runInNewContext(compiled, {
    module: loaded,
    Error,
    exports: loaded.exports,
    process: { cwd: () => "/virtual-blog" },
    require: (specifier) => {
      if (specifier === "node:path") return { join };
      if (specifier === "../lib/content") return { MAX_POST_BYTES, parseBlogDocument, toArticlePost };
      if (specifier === "node:fs/promises") return {
        readdir: async (path, options) => {
          assert.equal(path, directory);
          assert.equal(options.withFileTypes, true);
          reads.push(path);
          if (failure) throw failure;
          return Array.from(files.keys(), (name) => ({ name, isFile: () => true }));
        },
        stat: async (filename) => ({ size: Buffer.byteLength(readVirtualFile(filename)) }),
        readFile: async (filename, encoding) => {
          assert.equal(encoding, "utf8");
          return readVirtualFile(filename);
        },
      };
      throw new Error("검증에서 허용하지 않은 발행 조회 의존성입니다: " + specifier);
    },
  }, { filename: "published-posts.ts" });
  return { loader: loaded.exports, reads };
}

test("한글과 NFD 및 percent 인코딩 주소는 같은 실제 파서 결과를 조회한다", async () => {
  const document = publication();
  const files = new Map([[document.slug.normalize("NFD") + ".json", JSON.stringify(document)]]);
  const { loader } = createLoader(files);
  for (const slug of [document.slug, document.slug.normalize("NFD"), encodeURIComponent(document.slug), encodeURIComponent(document.slug.normalize("NFD"))]) {
    const post = await loader.getPostBySlug(slug);
    assert.equal(post?.slug, document.slug);
    assert.equal(post?.title, document.title);
    assert.equal(post?.description, "격리된 검증 본문입니다.");
  }
});

test("잘못된 percent 인코딩은 파일 조회 없이 거부하고 없는 글은 undefined를 반환한다", async () => {
  const document = publication();
  const { loader, reads } = createLoader(new Map([[document.slug + ".json", JSON.stringify(document)]]));
  for (const slug of ["%", "%E0%A4%A", "invalid%GG"]) {
    assert.equal(await loader.getPostBySlug(slug), undefined);
  }
  assert.equal(reads.length, 0);
  assert.equal(await loader.getPostBySlug("missing-post"), undefined);
  assert.equal(reads.length, 1);
});

test("같은 loader가 빈 목록 이후 새 발행 문서를 즉시 읽고 예시 글은 섞지 않는다", async () => {
  const files = new Map();
  const { loader, reads } = createLoader(files);
  assert.deepEqual(Array.from(await loader.getAllPosts()), []);
  const document = publication({ slug: "only-authored-post" });
  files.set(document.slug + ".json", JSON.stringify(document));
  const post = await loader.getPostBySlug(document.slug);
  assert.equal(post?.title, document.title);
  assert.deepEqual(Array.from(await loader.getAllPosts(), (entry) => entry.slug), [document.slug]);
  assert.equal(await loader.getPostBySlug("understanding-react-rendering"), undefined);
  assert.equal(reads.length, 4);
});

test("발행 디렉터리가 없는 경우 빈 목록을 반환하고 다른 파일 시스템 오류는 유지한다", async () => {
  const missing = Object.assign(new Error("가상 디렉터리가 없습니다."), { code: "ENOENT" });
  assert.deepEqual(Array.from(await createLoader(new Map(), missing).loader.getAllPosts()), []);
  const denied = Object.assign(new Error("가상 디렉터리 권한이 없습니다."), { code: "EACCES" });
  await assert.rejects(createLoader(new Map(), denied).loader.getAllPosts(), (error) => error === denied);
});
