import { test } from "node:test";
import { Script } from "node:vm";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isSafeContentUrl,
  parseBlogDocument,
  createEmptyDocument,
  normalizeDraftMetadata,
} from "../app/shared/lib/content.ts";

const { transpileModule, ModuleKind, ScriptTarget } = createRequire(import.meta.url)("typescript");
const source = await readFile(new URL("../app/(routes)/(public)/write/_hooks/usePostWriter.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;

// 저장과 복구 검증용 글 문서 생성
function draft(overrides = {}) {
  return {
    version: 1,
    id: randomUUID(),
    slug: "saved-post",
    title: "저장한 글",
    subtitle: "이전 부제",
    description: "이전 검색 설명",
    category: "React",
    date: "2026-11-15",
    readingMinutes: 0,
    updatedAt: "2026-11-15T00:00:00.000Z",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "저장한 본문" }] }] },
    ...overrides,
  };
}

// 응답 도착 순서를 제어하는 비동기 대기 생성
function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

// 네트워크 연결 없는 JSON 응답 생성
function response(value, status = 200) {
  return { ok: status < 400, json: async () => structuredClone(value) };
}

// 실제 작성 훅의 상태와 생명주기에 한정한 격리 실행 환경
async function writerFixture(context, {
  initial,
  queryId = initial?.id,
  storageEntries = [],
  hostname = "localhost",
  expectedConnection = "ready",
} = {}) {
  let cursor = 0;
  let value;
  let sequence = 0;
  let changed = true;
  let confirmResult = false;
  let editorOptions;
  let editorContent = createEmptyDocument();
  const slots = [];
  const effects = [];
  const requests = [];
  const overrides = [];
  const navigation = [];
  const confirmations = [];
  const storageReads = [];
  const storageWrites = [];
  const timers = new Map();
  const listeners = new Map();
  const documents = new Map(initial ? [[initial.id, structuredClone(initial)]] : []);
  const storage = new Map(storageEntries);
  const location = { hostname, href: "http://" + hostname + ":3000/write/" + (queryId ? "?draft=" + queryId : "") };
  const editor = {
    isActive: () => false,
    can: () => ({ undo: () => false, redo: () => false }),
    getText: () => "",
    getAttributes: () => ({}),
    getJSON: () => editorContent,
    setEditable: () => {},
    commands: { setContent: (next) => { editorContent = structuredClone(next); } },
  };
  let editorInstance = editor;
  const router = { replace: (href) => navigation.push(href) };

  // 순서가 보존되는 React 훅 슬롯 조회
  function slot(initialValue) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initialValue();
    return slots[index];
  }

  // 의존성 변경 여부 비교
  function sameDependencies(previous, next) {
    return previous && next && previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));
  }

  const react = {
    useState: (initialValue) => {
      const state = slot(() => ({ value: typeof initialValue === "function" ? initialValue() : initialValue }));
      return [state.value, (next) => {
        const result = typeof next === "function" ? next(state.value) : next;
        if (!Object.is(state.value, result)) { state.value = result; changed = true; }
      }];
    },
    useRef: (initialValue) => slot(() => ({ current: initialValue })),
    useCallback: (callback, dependencies) => {
      const state = slot(() => ({}));
      if (!sameDependencies(state.dependencies, dependencies)) Object.assign(state, { callback, dependencies });
      return state.callback;
    },
    useEffect: (effect, dependencies) => {
      const state = slot(() => ({}));
      if (!sameDependencies(state.dependencies, dependencies)) {
        state.dependencies = dependencies;
        effects.push(() => { state.cleanup?.(); state.cleanup = effect(); });
      }
    },
  };

  // 모든 API 요청을 기기 메모리의 검증 자료로 처리
  async function fetchMock(url, options = {}) {
    assert.ok(url.startsWith("/__editor/api/"));
    const path = url.slice("/__editor/api".length);
    const method = options.method || "GET";
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    const request = { path, method, body };
    requests.push(request);
    const index = overrides.findIndex((item) => item.path === path && item.method === method);
    if (index !== -1) return overrides.splice(index, 1)[0].reply(request);
    if (path === "/session") return response({ token: "mock-writer-session" });
    if (path === "/drafts" && method === "GET") {
      return response({ drafts: [...documents.values()].map(({ id, title, slug, updatedAt }) => ({ id, title, slug, updatedAt })) });
    }
    if (path === "/drafts" && method === "POST") {
      const saved = { ...body, slug: body.slug || "server-post", updatedAt: new Date(Date.UTC(2026, 10, 15, 0, 0, ++sequence)).toISOString() };
      documents.set(saved.id, structuredClone(saved));
      return response({ draft: saved });
    }
    if (path.startsWith("/drafts/") && method === "GET") {
      const saved = documents.get(decodeURIComponent(path.slice("/drafts/".length)));
      assert.ok(saved, "모의 저장소에 존재하는 글만 조회해야 합니다.");
      return response({ draft: saved });
    }
    throw new Error("준비하지 않은 모의 API 요청: " + method + " " + path);
  }

  const window = {
    location,
    scrollY: 0,
    confirm: (message) => { confirmations.push(message); return confirmResult; },
    history: { replaceState: (_state, _title, url) => { location.href = String(url); } },
    scrollTo: () => {},
    requestAnimationFrame: (callback) => { callback(); return 1; },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const exports = {};
  const modules = {
    react,
    "next/navigation": { useRouter: () => router },
    "@/app/shared/lib/content": { isSafeContentUrl, parseBlogDocument, createEmptyDocument, normalizeDraftMetadata },
    "@tiptap/extension-image": { Image: { configure: () => ({}) } },
    "@tiptap/starter-kit": { StarterKit: { configure: () => ({}) } },
    "@tiptap/extension-placeholder": { Placeholder: { configure: () => ({}) } },
    "@tiptap/react": {
      useEditor: (options) => { editorOptions = options; return editorInstance; },
      useEditorState: ({ selector }) => selector({ editor: editorInstance }),
    },
  };
  new Script(compiled, { filename: "usePostWriter.test.cjs" }).runInNewContext({
    URL, window, Headers, exports, AbortController,
    fetch: fetchMock,
    crypto: { randomUUID },
    localStorage: {
      getItem: (key) => { storageReads.push(key); return storage.get(key) ?? null; },
      setItem: (key, next) => {
        storageWrites.push([key, next]);
        storage.set(key, next);
      },
    },
    require: (name) => { assert.ok(Object.hasOwn(modules, name), "허용한 모듈만 가져와야 합니다: " + name); return modules[name]; },
  });

  // 실제 훅 렌더와 변경된 효과 반영
  function render() {
    let count = 0;
    while (changed) {
      assert.ok(++count < 30, "훅 렌더가 안정된 상태에 도달해야 합니다.");
      cursor = 0;
      changed = false;
      value = exports.usePostWriter();
      effects.splice(0).forEach((effect) => effect());
    }
  }

  // 비동기 API 완료 뒤 실제 상태 반영
  async function flush() {
    render();
    await new Promise((complete) => setImmediate(complete));
    render();
  }

  context.after(() => slots.forEach((state) => state.cleanup?.()));
  await flush();
  assert.equal(value.connection, expectedConnection);
  return {
    requests, documents, storage, location, listeners, navigation,
    confirmations, storageReads, storageWrites,
    get value() { return value; },
    get editorContent() { return editorContent; },
    flush,
    confirm: (result) => { confirmResult = result; },
    act: (action) => { const result = action(value); render(); return result; },
    queue: (method, path, reply) => overrides.push({ method, path, reply }),
    edit: (next) => { editorContent = structuredClone(next); editorOptions.onUpdate({ editor: editorInstance }); render(); },
    reconnectEditor: () => { editorInstance = { ...editorInstance }; changed = true; render(); },
    advanceTimers: () => {
      const scheduled = [...timers.values()];
      timers.clear();
      scheduled.forEach((timer) => timer.callback());
      render();
    },
  };
}

test("기존 글의 부제와 첫 이미지로 메타데이터를 갱신하고 재연결 중 입력을 보존한다", async (context) => {
  const fixture = await writerFixture(context, { initial: draft({ subtitle: undefined, readingMinutes: 12 }) });
  assert.equal(fixture.value.draft.subtitle, "");
  assert.equal(fixture.value.draft.readingMinutes, 0);
  assert.equal(fixture.value.changeSlug, undefined);
  assert.equal(fixture.value.uploadHeroImage, undefined);
  const first = { src: "/uploads/first.png", alt: "첫 이미지", width: 640, height: 360 };
  const second = { src: "/uploads/second.png", alt: "다음 이미지", width: 640, height: 360 };
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "이미지를 담은 본문" }] };
  fixture.edit({ type: "doc", content: [paragraph, { type: "image", attrs: first }, { type: "image", attrs: second }] });
  assert.deepEqual(fixture.value.draft.heroImage, first);
  assert.equal(fixture.value.draft.description, "이미지를 담은 본문");
  fixture.act((writer) => writer.updateDraft({ subtitle: "  설명으로 사용할 부제  " }));
  assert.equal(fixture.value.draft.description, "설명으로 사용할 부제");
  fixture.edit({ type: "doc", content: [paragraph, { type: "image", attrs: second }] });
  assert.deepEqual(fixture.value.draft.heroImage, second);
  fixture.edit({ type: "doc", content: [paragraph] });
  assert.equal(fixture.value.draft.heroImage, undefined);
  fixture.act((writer) => writer.updateDraft({ subtitle: "" }));
  assert.equal(fixture.value.draft.description, "이미지를 담은 본문");
  const current = structuredClone(fixture.value.draft);
  fixture.reconnectEditor();
  await fixture.flush();
  assert.deepEqual(fixture.value.draft, current);
  assert.equal(fixture.value.dirty, true);
  fixture.queue("GET", "/session", () => response({ error: "모의 재연결 실패" }, 503));
  fixture.reconnectEditor();
  await fixture.flush();
  assert.equal(fixture.value.connection, "unavailable");
  assert.deepEqual(fixture.value.draft, current);
  assert.equal(fixture.value.dirty, true);
});

test("입력과 시간 경과는 자동 저장하지 않고 임시저장 동작만 파일에 반영한다", async (context) => {
  const fixture = await writerFixture(context);
  fixture.act((writer) => writer.updateDraft({ title: "수동 저장할 제목", subtitle: "수동 저장할 부제" }));
  fixture.edit({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "저장 버튼 전까지 메모리에만 남는 본문" }] }] });
  fixture.advanceTimers();
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(fixture.storageWrites.length, 0);
  assert.equal(fixture.storage.size, 0);
  assert.deepEqual(fixture.navigation, []);
  let warned = false;
  fixture.listeners.get("beforeunload")({ preventDefault: () => { warned = true; } });
  assert.equal(warned, true);
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const writes = fixture.requests.filter((request) => request.method === "POST");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.subtitle, "수동 저장할 부제");
  assert.equal(fixture.documents.get(fixture.value.draft.id).title, "수동 저장할 제목");
  assert.equal(fixture.storage.get("junho.writer.last-draft"), fixture.value.draft.id);
  assert.ok(fixture.storageWrites.every(([key, value]) => key === "junho.writer.last-draft" && value === fixture.value.draft.id));
  assert.deepEqual(fixture.navigation, []);
  warned = false;
  fixture.listeners.get("beforeunload")({ preventDefault: () => { warned = true; } });
  assert.equal(warned, false);
});

test("임시저장 응답이 늦어도 최신 입력을 보존하고 서버가 확정한 주소로 다음 변경을 저장한다", async (context) => {
  const fixture = await writerFixture(context);
  const pending = deferred();
  let snapshot;
  fixture.act((writer) => writer.updateDraft({ title: "첫 제목", subtitle: "첫 부제" }));
  fixture.queue("POST", "/drafts", async ({ body }) => { snapshot = body; return pending.promise; });
  fixture.act((writer) => writer.saveDraft());
  assert.equal(fixture.value.saving, true);
  fixture.act((writer) => writer.updateDraft({ title: "수정한 제목", subtitle: "응답보다 최신인 부제" }));
  const latestContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "저장 중 수정한 본문" }] }] };
  fixture.edit(latestContent);
  const sameSave = fixture.act((writer) => writer.saveDraft());
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 1);
  pending.resolve(response({ draft: { ...snapshot, slug: "canonical-post-2", updatedAt: "2026-11-15T01:00:00.000Z" } }));
  assert.equal(await sameSave, true);
  await fixture.flush();
  assert.equal(fixture.value.draft.title, "수정한 제목");
  assert.equal(fixture.value.draft.subtitle, "응답보다 최신인 부제");
  assert.deepEqual(fixture.value.draft.content, latestContent);
  assert.equal(fixture.value.draft.description, "응답보다 최신인 부제");
  assert.equal(fixture.value.draft.slug, "canonical-post-2");
  assert.equal(fixture.value.dirty, true);
  fixture.advanceTimers();
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 1);
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const savedRequest = fixture.requests.filter((request) => request.method === "POST").at(-1);
  assert.equal(savedRequest.body.slug, "canonical-post-2");
  assert.equal(savedRequest.body.subtitle, "응답보다 최신인 부제");
  assert.deepEqual(savedRequest.body.content, latestContent);
  assert.equal(fixture.value.dirty, false);
  assert.ok([...fixture.storage.keys()].every((key) => key === "junho.writer.last-draft"));
});

test("발행 실패 복구와 재시도가 서버의 확정 주소 및 작성 내용을 유지한다", async (context) => {
  const fixture = await writerFixture(context);
  fixture.act((writer) => writer.updateDraft({ title: "같은 제목", subtitle: "발행할 부제" }));
  fixture.edit({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "발행할 본문" }] }] });
  fixture.queue("POST", "/publish", ({ body }) => {
    fixture.documents.set(body.draft.id, { ...body.draft, slug: "server-post-2", updatedAt: "2026-11-15T02:00:00.000Z" });
    return response({ error: "모의 푸시 실패", code: "PUSH_FAILED", commit: "mock-commit" }, 502);
  });
  await fixture.act((writer) => writer.publish());
  await fixture.flush();
  assert.equal(fixture.value.pendingCommit, "mock-commit");
  assert.equal(fixture.value.draft.slug, "server-post-2");
  assert.equal(fixture.value.draft.subtitle, "발행할 부제");
  assert.equal(fixture.value.published, null);
  assert.deepEqual(fixture.navigation, []);
  fixture.act((writer) => writer.changeTitle("발행 뒤 수정한 제목"));
  assert.equal(fixture.value.draft.slug, "server-post-2");
  fixture.queue("POST", "/publish", ({ body }) => response({ draft: body.draft, slug: body.draft.slug, url: "/posts/" + body.draft.slug + "/", commit: "mock-commit", pushed: true }));
  await fixture.act((writer) => writer.publish());
  await fixture.flush();
  const attempts = fixture.requests.filter((request) => request.path === "/publish");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].body.draft.slug, "server-post-2");
  assert.equal(attempts[1].body.draft.title, "발행 뒤 수정한 제목");
  assert.equal(fixture.value.published.url, "/posts/server-post-2/");
  assert.deepEqual(fixture.navigation, ["/"]);
  assert.equal(fixture.value.pendingCommit, "");
  assert.equal(fixture.value.dirty, false);
});

test("미저장 글의 전환 취소는 입력을 보존하고 확인은 자동저장 없이 글을 바꾼다", async (context) => {
  const current = draft();
  const target = draft({ slug: "target-post", title: "불러올 글", subtitle: "불러올 부제" });
  const fixture = await writerFixture(context, { initial: current });
  fixture.documents.set(target.id, target);
  fixture.act((writer) => writer.updateDraft({ subtitle: "아직 저장되지 않은 부제" }));
  await fixture.act((writer) => writer.loadDraft(target.id));
  await fixture.act((writer) => writer.newDraft());
  await fixture.flush();
  assert.equal(fixture.value.draft.id, current.id);
  assert.equal(fixture.value.draft.subtitle, "아직 저장되지 않은 부제");
  assert.equal(fixture.value.dirty, true);
  assert.equal(fixture.confirmations.length, 2);
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(fixture.requests.filter((request) => request.path.endsWith(target.id)).length, 0);
  const pending = deferred();
  fixture.confirm(true);
  fixture.queue("GET", "/drafts/" + target.id, () => pending.promise);
  const loading = fixture.act((writer) => writer.loadDraft(target.id));
  await fixture.flush();
  assert.equal(fixture.value.busy, true);
  const count = fixture.requests.length;
  await fixture.act((writer) => writer.loadDraft(randomUUID()));
  await fixture.act((writer) => writer.newDraft());
  fixture.act((writer) => writer.updateDraft({ subtitle: "전환 도중 입력" }));
  assert.equal(fixture.requests.length, count);
  assert.equal(fixture.value.draft.subtitle, "아직 저장되지 않은 부제");
  pending.resolve(response({ draft: target }));
  await loading;
  await fixture.flush();
  assert.equal(fixture.value.draft.id, target.id);
  assert.equal(fixture.value.draft.subtitle, target.subtitle);
  assert.deepEqual(fixture.editorContent, parseBlogDocument(target).content);
  assert.equal(new URL(fixture.location.href).searchParams.get("draft"), target.id);
  assert.equal(fixture.value.busy, false);
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.storage.get("junho.writer.last-draft"), target.id);
  fixture.act((writer) => writer.updateDraft({ subtitle: "새 글로 바꾸며 버릴 부제" }));
  await fixture.act((writer) => writer.newDraft());
  await fixture.flush();
  assert.notEqual(fixture.value.draft.id, target.id);
  assert.equal(fixture.value.draft.title, "");
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.storage.get("junho.writer.last-draft"), target.id);
  assert.equal(fixture.documents.get(target.id).subtitle, target.subtitle);
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 0);
});

test("다시 열면 저장한 글만 불러오고 과거 브라우저 백업과 미저장 입력은 복구하지 않는다", async (context) => {
  const saved = draft();
  const backupKey = "junho.writer.backup." + saved.id;
  const backup = JSON.stringify({ draft: { ...saved, subtitle: "과거 자동 백업의 부제" }, dirty: true });
  const fixture = await writerFixture(context, {
    initial: saved,
    queryId: null,
    storageEntries: [["junho.writer.last-draft", saved.id], [backupKey, backup]],
  });
  assert.equal(fixture.value.draft.id, saved.id);
  assert.equal(fixture.value.draft.subtitle, saved.subtitle);
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.storageReads.some((key) => key.startsWith("junho.writer.backup.")), false);
  fixture.act((writer) => writer.updateDraft({ subtitle: "다시 열기 전 미저장 부제" }));
  fixture.advanceTimers();
  await fixture.flush();
  const reloaded = await writerFixture(context, { initial: saved, queryId: null, storageEntries: [...fixture.storage] });
  assert.equal(reloaded.value.draft.subtitle, saved.subtitle);
  assert.equal(reloaded.value.dirty, false);
  assert.equal(reloaded.storageReads.includes(backupKey), false);
  assert.ok(fixture.storageWrites.every(([key]) => key === "junho.writer.last-draft"));
  const missing = await writerFixture(context, { storageEntries: [["junho.writer.last-draft", saved.id], [backupKey, backup]] });
  assert.notEqual(missing.value.draft.id, saved.id);
  assert.equal(missing.value.draft.title, "");
  assert.equal(missing.storageReads.includes(backupKey), false);
});

test("로컬 루프백이 아닌 주소에서는 세션과 발행 API를 호출하지 않는다", async (context) => {
  for (const hostname of ["dijeungi.github.io", "localhost.example.invalid", "192.168.1.10"]) {
    const fixture = await writerFixture(context, { hostname, expectedConnection: "unavailable" });
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.value.busy, true);
    assert.ok(fixture.value.draft);
    assert.match(fixture.value.error, /로컬 주소/);
    assert.equal(await fixture.act((writer) => writer.saveDraft()), false);
    await fixture.act((writer) => writer.publish());
    await fixture.flush();
    assert.equal(fixture.requests.length, 0);
  }
});

test("임시저장 실패는 입력을 보존하고 사용자가 재시도할 때만 다시 저장한다", async (context) => {
  const fixture = await writerFixture(context);
  fixture.act((writer) => writer.updateDraft({ title: "보존할 제목", subtitle: "보존할 부제" }));
  const latestContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "저장 실패 후 보존할 본문" }] }] };
  fixture.edit(latestContent);
  fixture.queue("POST", "/drafts", () => response({ error: "다른 창의 저장과 충돌했습니다.", code: "DRAFT_CONFLICT" }, 409));
  assert.equal(await fixture.act((writer) => writer.saveDraft()), false);
  fixture.advanceTimers();
  await fixture.flush();
  assert.equal(fixture.value.draft.title, "보존할 제목");
  assert.equal(fixture.value.draft.subtitle, "보존할 부제");
  assert.deepEqual(fixture.value.draft.content, latestContent);
  assert.equal(fixture.value.dirty, true);
  assert.equal(fixture.storage.size, 0);
  assert.match(fixture.value.error, /저장과 충돌/);
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 1);
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const saved = fixture.documents.get(fixture.value.draft.id);
  assert.equal(saved.subtitle, "보존할 부제");
  assert.deepEqual(saved.content, latestContent);
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.value.error, "");
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 2);
});
