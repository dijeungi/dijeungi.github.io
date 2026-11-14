import { test } from "node:test";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import typescript from "typescript";

const developmentPhase = "phase-development-server";
const productionPhase = "phase-production-build";
const source = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const compiled = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
}).outputText;

// 실제 설정을 발행 파일 목록과 환경만 가짜로 주입한 VM에서 평가
function evaluateConfig(phase, entries = [], failure = null) {
  const loaded = { exports: {} };
  const reads = [];
  runInNewContext(compiled, {
    module: loaded,
    Error,
    exports: loaded.exports,
    process: { cwd: () => "/virtual-blog", env: {} },
    require: (specifier) => {
      if (specifier === "node:path") return { join };
      if (specifier === "next/constants") return { PHASE_DEVELOPMENT_SERVER: developmentPhase };
      if (specifier === "node:fs") return {
        readdirSync: (directory) => {
          reads.push(directory);
          if (failure) throw failure;
          return entries;
        },
      };
      throw new Error("검증에서 허용하지 않은 설정 의존성입니다: " + specifier);
    },
  }, { filename: "next.config.ts" });
  const config = loaded.exports.default(phase);
  return { config, reads };
}

test("발행 JSON이 없는 정적 배포에서는 글 상세와 로컬 글쓰기 라우트를 제외한다", () => {
  for (const entries of [[], ["README.md", "draft.json.tmp"]]) {
    const { config, reads } = evaluateConfig(productionPhase, entries);
    assert.equal(config.output, "export");
    assert.deepEqual(Array.from(config.pageExtensions), ["tsx", "ts", "jsx", "js"]);
    assert.deepEqual(reads, [join("/virtual-blog", "content", "posts")]);
    assert.equal(config.rewrites, undefined);
    assert.equal(config.headers, undefined);
  }
});

test("발행 JSON이 있는 정적 배포에서는 상세만 포함하고 글쓰기는 제외한다", () => {
  const { config, reads } = evaluateConfig(productionPhase, ["authored-post.json"]);
  assert.equal(config.output, "export");
  assert.deepEqual(Array.from(config.pageExtensions), ["post.tsx", "tsx", "ts", "jsx", "js"]);
  assert.equal(config.pageExtensions.includes("dev.tsx"), false);
  assert.equal(reads.length, 1);
});

test("개발 서버는 파일 시스템을 조회하지 않고 글쓰기와 상세를 모두 포함한다", () => {
  const failure = Object.assign(new Error("발행 디렉터리를 읽으면 안 됩니다."), { code: "EACCES" });
  const { config, reads } = evaluateConfig(developmentPhase, [], failure);
  assert.equal(config.output, undefined);
  assert.deepEqual(Array.from(config.pageExtensions), ["dev.tsx", "tsx", "ts", "jsx", "js"]);
  assert.deepEqual(reads, []);
  assert.equal(typeof config.rewrites, "function");
  assert.equal(typeof config.headers, "function");
});

test("발행 디렉터리가 아직 없는 ENOENT는 빈 배포로 처리한다", () => {
  const failure = Object.assign(new Error("발행 디렉터리가 없습니다."), { code: "ENOENT" });
  const { config, reads } = evaluateConfig(productionPhase, [], failure);
  assert.equal(config.pageExtensions.includes("post.tsx"), false);
  assert.equal(reads.length, 1);
});

test("발행 디렉터리 권한 오류는 빈 데이터로 숨기지 않는다", () => {
  const failure = Object.assign(new Error("발행 디렉터리 권한이 없습니다."), { code: "EACCES" });
  assert.throws(() => evaluateConfig(productionPhase, [], failure), (error) => error === failure);
});
