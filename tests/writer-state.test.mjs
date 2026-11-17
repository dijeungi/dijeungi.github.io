import { test } from "node:test";
import { Script } from "node:vm";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import {
  isSafeContentUrl,
  parseBlogDocument,
  validatePostSubtitle,
  createEmptyDocument,
  normalizeDraftMetadata,
} from "../app/shared/lib/content.ts";
import { parseMarkdown, serializeMarkdown } from "../app/shared/lib/markdown.ts";
import { getMarkdownEdit, getMarkdownImageEdit } from "../app/(routes)/(public)/write/_lib/markdown-edits.ts";

const { transpileModule, ModuleKind, ScriptTarget } = createRequire(import.meta.url)("typescript");
const scripts = new Map(await Promise.all(["usePostWriter", "useMarkdownInput", "useWriterDialog"].map(async (name) => {
  const source = await readFile(new URL("../app/(routes)/(public)/write/_hooks/" + name + ".ts", import.meta.url), "utf8");
  return [name, new Script(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText, { filename: name + ".test.cjs" })];
})));

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
  return { ok: status < 400, json: async () => jsonValue(value) };
}

// JSON 저장 경계의 필드와 값만 비교
function jsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

// 실제 마크다운 훅과 확인창을 메모리 API 및 최소 DOM으로 실행
async function writerFixture(context, {
  initial,
  queryId = initial?.id,
  queryPost,
  locationHref,
  draftRecords = [],
  storageEntries = [],
  publishedRecords = [],
  legacySummaries = false,
  hostname = "localhost",
  expectedConnection = "ready",
} = {}) {
  let cursor = 0;
  let value;
  let sequence = 0;
  let changed = true;
  let disposed = false;
  let confirmResult = false;
  let observedConfirmation = null;
  let reloads = 0;
  const slots = [];
  const effects = [];
  const requests = [];
  const overrides = [];
  const navigation = [];
  const confirmations = [];
  const storageReads = [];
  const storageWrites = [];
  const storageRemovals = [];
  const timers = new Map();
  const frames = new Map();
  const listeners = new Map();
  const listenerSets = new Map();
  const documentListeners = new Map();
  const documents = new Map([...draftRecords, ...(initial ? [initial] : [])].map((document) => [document.id, structuredClone(document)]));
  const published = new Map(publishedRecords.map((document) => [document.id, structuredClone(document)]));
  const storage = new Map(storageEntries);
  const parameters = new URLSearchParams();
  if (queryId) parameters.set("draft", queryId);
  if (queryPost) parameters.set("post", queryPost);
  const query = parameters.toString();
  const location = { hostname, href: locationHref || "http://" + hostname + ":3000/write/" + (query ? "?" + query : ""), reload: () => { reloads += 1; } };
  const router = { replace: (href) => navigation.push(href), push: (href) => navigation.push(href) };
  const document = { activeElement: null };

  // 브라우저 입력과 모달에서 사용하는 DOM 표면 제공
  class TestElement {
    isConnected = true;
    value = "";
    selectionStart = 0;
    selectionEnd = 0;
    open = false;
    parentElement = null;

    // 현재 포커스 대상 갱신
    focus() { document.activeElement = this; }

    // 원문 커서와 선택 범위 반영
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }

    // 네이티브 모달 열림 반영
    showModal() { this.open = true; }

    // 네이티브 모달 닫힘 반영
    close() { this.open = false; }

    // 확인창 취소 버튼 반환
    querySelector() { return cancelButton; }

    // 같은 패널의 이벤트 대상 확인
    contains(target) { return target === this; }
  }

  const textarea = new TestElement();
  const title = new TestElement();
  const cancelButton = new TestElement();
  const dialog = new TestElement();
  const draftsButton = new TestElement();
  draftsButton.parentElement = new TestElement();
  document.activeElement = textarea;
  document.body = new TestElement();
  document.addEventListener = (name, callback) => documentListeners.set(name, callback);
  document.removeEventListener = (name, callback) => { if (documentListeners.get(name) === callback) documentListeners.delete(name); };
  document.getElementById = () => null;

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
        if (disposed) return;
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
      const summaries = [...documents.values()].map(({ id, title, slug, updatedAt }) => ({
        id, title, slug, updatedAt, isLocalDraft: true,
        ...(legacySummaries ? {} : { isPublished: published.has(id) }),
      }));
      for (const item of published.values()) if (!documents.has(item.id)) summaries.push({
        id: item.id, title: item.title, slug: item.slug, updatedAt: item.updatedAt, isLocalDraft: false,
        ...(legacySummaries ? {} : { isPublished: true }),
      });
      return response({ drafts: summaries });
    }
    if (path === "/drafts" && method === "POST") {
      const saved = jsonValue(parseBlogDocument({ ...body, slug: body.slug || "server-post", updatedAt: new Date(Date.UTC(2026, 10, 17, 0, 0, ++sequence)).toISOString() }));
      documents.set(saved.id, structuredClone(saved));
      return response({ draft: saved });
    }
    if (path.startsWith("/drafts/")) {
      const id = decodeURIComponent(path.slice("/drafts/".length));
      const saved = documents.get(id) ?? published.get(id);
      if (!saved) return response({ error: "저장한 글을 찾을 수 없습니다." }, 404);
      if (method === "GET") return response({ draft: saved });
      if (method === "DELETE") {
        if (!documents.has(id)) return response({ error: "로컬 임시글이 아닙니다." }, 404);
        if (saved.updatedAt !== body.expectedUpdatedAt) return response({ error: "다른 창에서 수정된 임시 글입니다.", code: "DRAFT_CONFLICT" }, 409);
        documents.delete(id);
        return response({ deleted: id });
      }
    }
    throw new Error("준비하지 않은 모의 API 요청: " + method + " " + path);
  }

  // 같은 브라우저 이벤트의 모든 구독자 등록
  function addWindowListener(name, callback) {
    const callbacks = listenerSets.get(name) ?? new Set();
    callbacks.add(callback);
    listenerSets.set(name, callbacks);
    listeners.set(name, (event) => [...callbacks].forEach((subscriber) => subscriber(event)));
  }

  // 해제된 브라우저 이벤트 구독자만 제거
  function removeWindowListener(name, callback) {
    const callbacks = listenerSets.get(name);
    callbacks?.delete(callback);
    if (!callbacks?.size) {
      listenerSets.delete(name);
      listeners.delete(name);
    }
  }

  const window = {
    location,
    history: { replaceState: (_state, _title, url) => { location.href = new URL(String(url), location.href).href; } },
    requestAnimationFrame: (callback) => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    prompt: () => "https://example.com",
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: addWindowListener,
    removeEventListener: removeWindowListener,
  };
  const modules = {
    react,
    "next/navigation": { useRouter: () => router },
    "@/app/shared/lib/content": { isSafeContentUrl, parseBlogDocument, createEmptyDocument, validatePostSubtitle, normalizeDraftMetadata },
    "@/app/shared/lib/markdown": { parseMarkdown, serializeMarkdown },
    "../_lib/markdown-edits": { getMarkdownEdit, getMarkdownImageEdit },
  };
  const sandbox = {
    URL, window, document, Headers, AbortController, Error,
    HTMLElement: TestElement,
    Node: TestElement,
    fetch: fetchMock,
    crypto: { randomUUID },
    localStorage: {
      getItem: (key) => { storageReads.push(key); return storage.get(key) ?? null; },
      setItem: (key, next) => { storageWrites.push([key, next]); storage.set(key, next); },
      removeItem: (key) => { storageRemovals.push(key); storage.delete(key); },
    },
    require: (name) => { assert.ok(Object.hasOwn(modules, name), "허용한 모듈만 가져와야 합니다: " + name); return modules[name]; },
  };
  for (const name of ["useMarkdownInput", "useWriterDialog", "usePostWriter"]) {
    const exports = {};
    scripts.get(name).runInNewContext({ ...sandbox, exports });
    modules["./" + name] = exports;
  }

  // 실제 훅 렌더와 DOM 참조 및 변경된 효과 반영
  function render() {
    if (disposed) return;
    let count = 0;
    while (changed) {
      assert.ok(++count < 40, "훅 렌더가 안정된 상태에 도달해야 합니다.");
      cursor = 0;
      changed = false;
      value = modules["./usePostWriter"].usePostWriter();
      value.textareaRef.current = textarea;
      value.titleRef.current = title;
      value.dialogRef.current = dialog;
      value.draftsButtonRef.current = draftsButton;
      textarea.value = value.markdown;
      effects.splice(0).forEach((effect) => effect());
      if (value.confirmation && value.confirmation !== observedConfirmation) {
        observedConfirmation = value.confirmation;
        confirmations.push(structuredClone(value.confirmation));
        if (confirmResult !== null) value.respondToConfirmation(confirmResult);
      } else if (!value.confirmation) observedConfirmation = null;
    }
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  }

  // 비동기 API 완료 뒤 실제 상태 반영
  async function flush() {
    render();
    await new Promise((complete) => setImmediate(complete));
    render();
  }

  // 대기 중인 요청을 유지하면서 실제 훅의 해제 효과 실행
  function dispose() {
    if (disposed) return;
    disposed = true;
    slots.forEach((state) => state.cleanup?.());
    value.textareaRef.current = null;
    value.titleRef.current = null;
    value.dialogRef.current = null;
    value.draftsButtonRef.current = null;
    assert.equal(listeners.size, 0, "해제한 훅의 브라우저 이벤트 구독이 남지 않아야 합니다.");
    assert.equal(frames.size, 0, "해제한 훅의 화면 갱신 예약이 남지 않아야 합니다.");
  }

  context.after(dispose);
  await flush();
  assert.equal(value.connection, expectedConnection);
  return {
    requests, documents, published, storage, location, listeners, navigation,
    confirmations, storageReads, storageWrites, storageRemovals, textarea, dialog,
    get value() { return value; },
    get reloads() { return reloads; },
    flush, dispose,
    confirm: (result) => { confirmResult = result; },
    act: (action) => { const result = action(value); render(); return result; },
    queue: (method, path, reply) => overrides.push({ method, path, reply }),
    edit: (next) => {
      const source = typeof next === "string" ? next : serializeMarkdown(next);
      textarea.value = source;
      textarea.selectionStart = source.length;
      textarea.selectionEnd = source.length;
      value.changeMarkdown(source);
      render();
    },
    advanceTimers: () => {
      const scheduled = [...timers.values()];
      timers.clear();
      scheduled.forEach((timer) => timer.callback());
      render();
    },
  };
}

test("기존 글의 부제와 첫 이미지로 메타데이터를 갱신하고 재연결 중 입력을 보존한다", async (context) => {
  const first = { src: "/uploads/first.png", alt: "첫 이미지", width: 640, height: 360 };
  const second = { src: "/uploads/second.png", alt: "다음 이미지", width: 640, height: 360 };
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "이미지를 담은 본문", marks: [{ type: "bold" }] }] };
  const fixture = await writerFixture(context, { initial: draft({ subtitle: undefined, readingMinutes: 12, content: { type: "doc", content: [paragraph, { type: "image", attrs: first }, { type: "image", attrs: second }] } }) });
  assert.equal(fixture.value.draft.subtitle, "");
  assert.equal(fixture.value.draft.readingMinutes, 0);
  assert.equal(fixture.value.changeSlug, undefined);
  assert.equal(fixture.value.uploadHeroImage, undefined);
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
  fixture.act((writer) => writer.reconnect());
  await fixture.flush();
  assert.deepEqual(fixture.value.draft, current);
  assert.deepEqual(parseMarkdown(fixture.value.markdown, current.content), current.content);
  assert.equal(fixture.reloads, 0);
  assert.equal(fixture.value.dirty, true);
  fixture.queue("GET", "/session", () => response({ error: "모의 재연결 실패" }, 503));
  fixture.act((writer) => writer.reconnect());
  await fixture.flush();
  assert.equal(fixture.value.connection, "unavailable");
  assert.deepEqual(fixture.value.draft, current);
  assert.deepEqual(parseMarkdown(fixture.value.markdown, current.content), current.content);
  assert.equal(fixture.reloads, 0);
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
  assert.deepEqual(jsonValue(parseMarkdown(fixture.value.markdown, fixture.value.draft.content)), jsonValue(parseBlogDocument(target).content));
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

test("임시글 삭제 취소는 저장한 글과 현재 미저장 원문을 그대로 유지한다", async (context) => {
  const saved = draft();
  const fixture = await writerFixture(context, { initial: saved });
  fixture.edit("## 아직 저장하지 않은 원문\n\n취소하면 이 내용이 남습니다.");
  const current = structuredClone(fixture.value.draft);
  fixture.confirm(false);
  await fixture.act((writer) => writer.deleteDraft(saved.id));
  await fixture.flush();
  assert.equal(fixture.confirmations.length, 1);
  assert.match(fixture.confirmations[0].message, /저장하지 않은 입력/);
  assert.deepEqual(jsonValue(fixture.value.draft), jsonValue(current));
  assert.equal(fixture.documents.has(saved.id), true);
  assert.equal(fixture.value.dirty, true);
  assert.equal(fixture.requests.filter((request) => request.method === "DELETE").length, 0);
});

test("현재 임시글만 삭제하고 이미 게시한 글과 다른 임시글은 보존한다", async (context) => {
  const saved = draft();
  const other = draft({ title: "다른 임시글", slug: "other-post" });
  const fixture = await writerFixture(context, { initial: saved, publishedRecords: [saved], storageEntries: [["junho.writer.last-draft", saved.id]] });
  fixture.documents.set(other.id, other);
  fixture.edit("삭제 확인을 기다리는 미저장 원문");
  fixture.confirm(true);
  await fixture.act((writer) => writer.deleteDraft(saved.id));
  await fixture.flush();
  const deletion = fixture.requests.find((request) => request.method === "DELETE");
  assert.equal(deletion.path, "/drafts/" + saved.id);
  assert.equal(deletion.body.expectedUpdatedAt, saved.updatedAt);
  assert.equal(fixture.documents.has(saved.id), false);
  assert.deepEqual(fixture.documents.get(other.id), other);
  assert.deepEqual(fixture.published.get(saved.id), saved);
  assert.notEqual(fixture.value.draft.id, saved.id);
  assert.equal(fixture.value.draft.title, "");
  assert.equal(fixture.value.markdown, "");
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.storage.has("junho.writer.last-draft"), false);
  assert.ok(fixture.storageRemovals.includes("junho.writer.last-draft"));
  assert.equal(fixture.value.drafts.find((item) => item.id === saved.id).isLocalDraft, false);
  assert.match(fixture.value.notice, /삭제/);
  const deleteCount = fixture.requests.filter((request) => request.method === "DELETE").length;
  await fixture.act((writer) => writer.deleteDraft(saved.id));
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.method === "DELETE").length, deleteCount);
});

test("삭제 버전 충돌은 현재 입력과 서버 임시글을 보존하고 최신 목록만 갱신한다", async (context) => {
  const saved = draft();
  const fixture = await writerFixture(context, { initial: saved });
  fixture.edit("## 로컬 미저장 원문\n\n다른 창의 글로 덮지 않습니다.");
  const current = structuredClone(fixture.value.draft);
  const changedElsewhere = { ...saved, title: "다른 창의 제목", updatedAt: "2026-11-17T02:00:00.000Z" };
  fixture.documents.set(saved.id, changedElsewhere);
  fixture.confirm(true);
  await fixture.act((writer) => writer.deleteDraft(saved.id));
  await fixture.flush();
  assert.deepEqual(jsonValue(fixture.value.draft), jsonValue(current));
  assert.deepEqual(fixture.documents.get(saved.id), changedElsewhere);
  assert.equal(fixture.value.dirty, true);
  assert.equal(fixture.value.deletingId, "");
  assert.match(fixture.value.error, /다른 창/);
  assert.equal(fixture.value.drafts.find((item) => item.id === saved.id).updatedAt, changedElsewhere.updatedAt);
  assert.equal(fixture.requests.filter((request) => request.method === "DELETE").length, 1);
});

test("임시저장 응답 대기 중에는 삭제 확인과 삭제 API 요청을 시작하지 않는다", async (context) => {
  const saved = draft();
  const fixture = await writerFixture(context, { initial: saved });
  const pending = deferred();
  let snapshot;
  fixture.edit("저장 중에도 보존할 마크다운");
  fixture.queue("POST", "/drafts", ({ body }) => { snapshot = body; return pending.promise; });
  const saving = fixture.act((writer) => writer.saveDraft());
  assert.equal(fixture.value.saving, true);
  fixture.confirm(true);
  await fixture.act((writer) => writer.deleteDraft(saved.id));
  await fixture.flush();
  assert.equal(fixture.confirmations.length, 0);
  assert.equal(fixture.requests.filter((request) => request.method === "DELETE").length, 0);
  assert.equal(fixture.documents.has(saved.id), true);
  pending.resolve(response({ draft: { ...snapshot, updatedAt: "2026-11-17T03:00:00.000Z" } }));
  assert.equal(await saving, true);
  await fixture.flush();
});

test("삭제 처리 중에는 중복 삭제와 저장 및 글 전환을 차단한다", async (context) => {
  const saved = draft();
  const fixture = await writerFixture(context, { initial: saved });
  const pending = deferred();
  fixture.confirm(true);
  fixture.queue("DELETE", "/drafts/" + saved.id, () => pending.promise);
  const deleting = fixture.act((writer) => writer.deleteDraft(saved.id));
  await fixture.flush();
  assert.equal(fixture.value.deletingId, saved.id);
  assert.equal(fixture.value.busy, true);
  const count = fixture.requests.length;
  await fixture.act((writer) => writer.deleteDraft(saved.id));
  assert.equal(await fixture.act((writer) => writer.saveDraft()), false);
  await fixture.act((writer) => writer.newDraft());
  await fixture.act((writer) => writer.loadDraft(randomUUID()));
  fixture.edit("삭제 처리 중에는 입력을 바꾸지 않습니다.");
  assert.equal(fixture.requests.length, count);
  assert.equal(fixture.value.draft.id, saved.id);
  assert.notEqual(fixture.value.markdown, "삭제 처리 중에는 입력을 바꾸지 않습니다.");
  fixture.documents.delete(saved.id);
  pending.resolve(response({ deleted: saved.id }));
  await deleting;
  await fixture.flush();
  assert.equal(fixture.value.deletingId, "");
  assert.notEqual(fixture.value.draft.id, saved.id);
});

test("수동 저장한 원문은 문법과 줄바꿈을 바꾸지 않고 다시 열며 미리보기와 함께 복원한다", async (context) => {
  const fixture = await writerFixture(context);
  const fence = String.fromCharCode(96).repeat(3);
  const source = "## 원문 그대로\n\n**굵게**와 _기울임_을 함께 씁니다.\n\n" + fence + "tsx\nconst label = '<원문>';\n" + fence + "\n\n[링크](https://example.com/docs?q=한글)\n\n";
  fixture.act((writer) => writer.updateDraft({ title: "원문 보존", category: "React", subtitle: "" }));
  fixture.edit(source);
  assert.equal(fixture.value.markdown, source);
  assert.equal(fixture.value.draft.markdown, source);
  assert.equal(fixture.value.canUndo, true);
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const saved = structuredClone(fixture.documents.get(fixture.value.draft.id));
  assert.equal(saved.markdown, source);
  assert.deepEqual(jsonValue(saved.content), jsonValue(parseBlogDocument(draft({ content: parseMarkdown(source) })).content));
  const reloaded = await writerFixture(context, { initial: saved });
  assert.equal(reloaded.value.markdown, source);
  assert.equal(reloaded.textarea.value, source);
  assert.equal(reloaded.value.draft.markdown, source);
  assert.deepEqual(jsonValue(reloaded.value.draft.content), jsonValue(saved.content));
  assert.equal(reloaded.value.canUndo, false);
  assert.equal(reloaded.value.canRedo, false);
  assert.equal(reloaded.value.dirty, false);
});

test("기존에 공백으로 변환된 본문도 저장한 마크다운의 줄바꿈으로 미리보기를 복원한다", async (context) => {
  const initial = draft({
    markdown: "첫 줄\n둘째 줄",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "첫 줄 둘째 줄" }] }] },
  });
  const fixture = await writerFixture(context, { initial });
  assert.equal(fixture.value.markdown, initial.markdown);
  assert.deepEqual(jsonValue(fixture.value.draft.content), jsonValue(parseBlogDocument(draft({ content: parseMarkdown(initial.markdown) })).content));
  assert.equal(fixture.value.dirty, false);
  assert.deepEqual(fixture.documents.get(initial.id), initial);
  assert.equal(fixture.requests.some((request) => request.method !== "GET"), false);
});

test("저장 중 새 편집이 없으면 서버가 정규화한 제목과 카테고리를 반영하고 저장 완료로 표시한다", async (context) => {
  const fixture = await writerFixture(context);
  const source = "**원문은 공백까지 유지합니다.**\n\n";
  fixture.act((writer) => writer.updateDraft({ title: "  정규화할 제목  ", category: " React ", subtitle: "  선택 설명  " }));
  fixture.edit(source);
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const saved = fixture.documents.get(fixture.value.draft.id);
  assert.equal(saved.title, "정규화할 제목");
  assert.equal(saved.category, "React");
  assert.equal(saved.subtitle, "선택 설명");
  assert.equal(fixture.value.draft.title, saved.title);
  assert.equal(fixture.value.draft.category, saved.category);
  assert.equal(fixture.value.draft.subtitle, saved.subtitle);
  assert.equal(fixture.value.markdown, source);
  assert.equal(fixture.value.draft.markdown, source);
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.value.lastSavedAt, saved.updatedAt);
});

test("기존 이미지 삭제와 업로드 이미지 삽입을 실행 취소하거나 다시 실행해도 실제 치수를 보존한다", async (context) => {
  const image = { src: "/uploads/existing-image.png", alt: "기존 이미지", width: 640, height: 360 };
  const fixture = await writerFixture(context, { initial: draft({ content: { type: "doc", content: [{ type: "image", attrs: image }] } }) });
  const original = fixture.value.markdown;
  fixture.edit("이미지를 지운 본문");
  assert.equal(fixture.value.draft.heroImage, undefined);
  fixture.act((writer) => writer.undo());
  assert.equal(fixture.value.markdown, original);
  assert.deepEqual(fixture.value.draft.heroImage, image);
  fixture.act((writer) => writer.redo());
  assert.equal(fixture.value.markdown, "이미지를 지운 본문");
  assert.equal(fixture.value.draft.heroImage, undefined);

  const uploaded = { src: "/uploads/uploaded-image.webp", alt: "업로드 이미지", width: 1200, height: 800 };
  fixture.queue("POST", "/media", () => response({ image: uploaded }));
  await fixture.act((writer) => writer.uploadInlineImage(new File([new Uint8Array([1, 2, 3])], "memory-image.webp", { type: "image/webp" })));
  await fixture.flush();
  const inserted = fixture.value.markdown;
  assert.match(inserted, /uploaded-image\.webp/);
  assert.deepEqual(fixture.value.draft.heroImage, uploaded);
  fixture.act((writer) => writer.undo());
  assert.equal(fixture.value.markdown, "이미지를 지운 본문");
  assert.equal(fixture.value.draft.heroImage, undefined);
  fixture.act((writer) => writer.redo());
  assert.equal(fixture.value.markdown, inserted);
  assert.deepEqual(fixture.value.draft.heroImage, uploaded);
  assert.equal(fixture.value.canRedo, false);
});

test("저장한 링크의 원문을 수정한 뒤 실행 취소하면 서버 본문 속성과 달라도 미저장 표시가 사라진다", async (context) => {
  const source = "[링크](https://example.com)";
  const saved = jsonValue(parseBlogDocument(draft({ subtitle: "", markdown: source, content: parseMarkdown(source) })));
  const fixture = await writerFixture(context, { initial: saved });
  assert.equal(fixture.value.markdown, source);
  assert.equal(fixture.value.dirty, false);
  fixture.edit(source + "\n\n아직 저장하지 않은 변경");
  assert.equal(fixture.value.dirty, true);
  fixture.act((writer) => writer.undo());
  assert.equal(fixture.value.markdown, source);
  assert.equal(fixture.value.draft.markdown, source);
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.value.canRedo, true);
  await fixture.act((writer) => writer.leaveWriter());
  await fixture.flush();
  assert.equal(fixture.confirmations.length, 0);
  assert.deepEqual(fixture.navigation, ["/"]);
  assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 0);
});

test("발행용 임시저장 뒤 목록 응답을 기다리다 화면을 해제하면 발행 POST를 시작하지 않는다", async (context) => {
  const fixture = await writerFixture(context, { initial: draft() });
  const pending = deferred();
  fixture.queue("GET", "/drafts", () => pending.promise);
  const publishing = fixture.act((writer) => writer.publish());
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.path === "/drafts" && request.method === "POST").length, 1);
  assert.equal(fixture.requests.at(-1).path, "/drafts");
  assert.equal(fixture.requests.at(-1).method, "GET");
  assert.equal(fixture.value.publishing, true);
  assert.equal(fixture.requests.filter((request) => request.path === "/publish").length, 0);
  fixture.dispose();
  pending.resolve(response({ drafts: [] }));
  await publishing;
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.path === "/publish").length, 0);
  assert.deepEqual(fixture.navigation, []);
});

test("발행 성공 뒤 마지막 목록 응답을 기다리다 화면을 해제하면 뒤늦게 홈으로 이동하지 않는다", async (context) => {
  const fixture = await writerFixture(context, { initial: draft() });
  const pending = deferred();
  const initialLists = fixture.requests.filter((request) => request.path === "/drafts" && request.method === "GET").length;
  fixture.queue("GET", "/drafts", () => response({ drafts: fixture.value.drafts }));
  fixture.queue("GET", "/drafts", () => pending.promise);
  fixture.queue("POST", "/publish", ({ body }) => response({ draft: body.draft, slug: body.draft.slug, url: "/posts/" + body.draft.slug + "/", commit: "mock-published-commit", pushed: true }));
  const publishing = fixture.act((writer) => writer.publish());
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.path === "/publish").length, 1);
  assert.equal(fixture.requests.filter((request) => request.path === "/drafts" && request.method === "GET").length, initialLists + 2);
  assert.equal(fixture.value.published.pushed, true);
  assert.equal(fixture.value.publishing, true);
  assert.deepEqual(fixture.navigation, []);
  fixture.dispose();
  pending.resolve(response({ drafts: [] }));
  await publishing;
  await fixture.flush();
  assert.deepEqual(fixture.navigation, []);
});

test("부제목이 없거나 비어 있으면 입력을 보존한 채 저장과 발행 요청을 막고 채운 뒤에만 발행한다", async (context) => {
  for (const subtitle of [undefined, "", " \t "]) {
    const initial = draft();
    const fixture = await writerFixture(context, { initial });
    const source = "## 보존할 본문\n\n부제목을 입력하기 전에도 원문은 남습니다.";
    fixture.act((writer) => writer.updateDraft({ title: "수정한 발행 제목", category: "TypeScript", subtitle }));
    fixture.edit(source);
    const current = jsonValue(fixture.value.draft);
    await fixture.act((writer) => writer.publish());
    await fixture.flush();
    assert.equal(fixture.value.error, "부제목을 입력해 주세요.");
    assert.equal(fixture.requests.filter((request) => request.method === "POST").length, 0);
    assert.deepEqual(jsonValue(fixture.value.draft), current);
    assert.equal(fixture.value.markdown, source);
    assert.equal(fixture.value.dirty, true);
    assert.equal(fixture.value.saving, false);
    assert.equal(fixture.value.publishing, false);
    assert.equal(fixture.value.published, null);
    assert.deepEqual(fixture.documents.get(initial.id), initial);
    assert.deepEqual(fixture.navigation, []);
    assert.equal(fixture.storageWrites.length, 0);

    fixture.act((writer) => writer.updateDraft({ subtitle: "발행에 필요한 부제목" }));
    fixture.queue("POST", "/publish", ({ body }) => response({ draft: body.draft, slug: body.draft.slug, url: "/posts/" + body.draft.slug + "/", commit: "mock-subtitle-commit", pushed: true }));
    await fixture.act((writer) => writer.publish());
    await fixture.flush();
    assert.equal(fixture.requests.filter((request) => request.path === "/drafts" && request.method === "POST").length, 1);
    const publication = fixture.requests.filter((request) => request.path === "/publish");
    assert.equal(publication.length, 1);
    assert.equal(publication[0].body.draft.subtitle, "발행에 필요한 부제목");
    assert.equal(publication[0].body.draft.markdown, source);
    assert.equal(fixture.value.published.pushed, true);
    assert.equal(fixture.value.error, "");
    assert.equal(fixture.value.dirty, false);
    assert.deepEqual(fixture.navigation, ["/"]);
  }
});

test("부제목이 비어 있어도 수동 임시저장은 허용하고 발행 요청은 시작하지 않는다", async (context) => {
  const fixture = await writerFixture(context);
  fixture.act((writer) => writer.updateDraft({ title: "작성 중인 글", category: "React", subtitle: "" }));
  fixture.edit("부제목을 정하기 전에 임시저장하는 본문입니다.");
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  assert.equal(fixture.requests.filter((request) => request.path === "/drafts" && request.method === "POST").length, 1);
  assert.equal(fixture.requests.filter((request) => request.path === "/publish").length, 0);
  assert.equal(fixture.documents.get(fixture.value.draft.id).subtitle, "");
  assert.equal(fixture.value.dirty, false);
  assert.equal(fixture.value.error, "");
});

test("새 글과 저장한 미발행 초안은 수정 모드가 아니며 첫 발행 성공 이후에만 수정 모드가 된다", async (context) => {
  const fixture = await writerFixture(context);
  assert.equal(fixture.value.isEditing, false);
  fixture.act((writer) => writer.updateDraft({ title: "새로 작성한 글", subtitle: "처음 발행할 부제목", category: "React" }));
  fixture.edit("임시저장과 발행을 구분하는 본문입니다.");
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const saved = structuredClone(fixture.documents.get(fixture.value.draft.id));
  assert.equal(fixture.value.isEditing, false);
  assert.equal(fixture.value.drafts.find((item) => item.id === saved.id).isPublished, false);
  const reloaded = await writerFixture(context, { initial: saved });
  assert.equal(reloaded.value.isEditing, false);
  assert.equal(new URL(reloaded.location.href).searchParams.has("post"), false);

  fixture.queue("POST", "/publish", ({ body }) => {
    fixture.published.set(body.draft.id, structuredClone(body.draft));
    return response({ draft: body.draft, slug: body.draft.slug, url: "/posts/" + body.draft.slug + "/", commit: "new-publication", pushed: true });
  });
  await fixture.act((writer) => writer.publish());
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  assert.equal(fixture.value.published.wasEditing, false);
});

test("발행한 글의 로컬 초안은 제목 수정과 임시저장 및 새로고침 뒤에도 수정 모드를 유지한다", async (context) => {
  const published = draft({ slug: "published-canonical-post" });
  const fixture = await writerFixture(context, { initial: published, publishedRecords: [published] });
  assert.equal(fixture.value.isEditing, true);
  assert.equal(new URL(fixture.location.href).searchParams.get("post"), published.slug);
  fixture.act((writer) => writer.changeTitle("수정한 제목은 기존 글 주소를 바꾸지 않습니다."));
  assert.equal(fixture.value.isEditing, true);
  assert.equal(await fixture.act((writer) => writer.saveDraft()), true);
  await fixture.flush();
  const saved = structuredClone(fixture.documents.get(published.id));
  assert.equal(fixture.value.isEditing, true);
  assert.equal(saved.slug, published.slug);
  const reloaded = await writerFixture(context, {
    initial: saved,
    publishedRecords: [published],
    locationHref: fixture.location.href,
  });
  assert.equal(reloaded.value.isEditing, true);
  assert.equal(reloaded.value.draft.id, published.id);
  assert.equal(reloaded.value.draft.title, saved.title);
  assert.equal(new URL(reloaded.location.href).searchParams.get("post"), published.slug);
});

test("게시한 글과 미발행 초안을 전환하거나 새 글을 시작하고 수정 초안을 삭제하면 모드도 함께 전환된다", async (context) => {
  const local = draft({ slug: "local-only-post" });
  const publishedLocal = draft({ slug: "published-with-draft" });
  const publishedOnly = draft({ slug: "published-without-draft" });
  const fixture = await writerFixture(context, {
    initial: local,
    draftRecords: [publishedLocal],
    publishedRecords: [publishedLocal, publishedOnly],
  });
  assert.equal(fixture.value.isEditing, false);
  await fixture.act((writer) => writer.loadDraft(publishedLocal.id));
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  await fixture.act((writer) => writer.loadDraft(publishedOnly.id));
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  await fixture.act((writer) => writer.loadDraft(local.id));
  await fixture.flush();
  assert.equal(fixture.value.isEditing, false);
  assert.equal(new URL(fixture.location.href).searchParams.has("post"), false);
  await fixture.act((writer) => writer.loadDraft(publishedLocal.id));
  await fixture.flush();
  await fixture.act((writer) => writer.newDraft());
  await fixture.flush();
  assert.equal(fixture.value.isEditing, false);
  assert.notEqual(fixture.value.draft.id, publishedLocal.id);

  await fixture.act((writer) => writer.loadDraft(publishedLocal.id));
  await fixture.flush();
  fixture.confirm(true);
  await fixture.act((writer) => writer.deleteDraft(publishedLocal.id));
  await fixture.flush();
  assert.equal(fixture.value.isEditing, false);
  assert.equal(new URL(fixture.location.href).searchParams.has("post"), false);
  assert.equal(fixture.documents.has(publishedLocal.id), false);
  assert.equal(fixture.published.has(publishedLocal.id), true);
  await fixture.act((writer) => writer.loadDraft(publishedLocal.id));
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  assert.equal(fixture.value.draft.id, publishedLocal.id);
});

test("이전 서버의 수정 URL은 새로고침에도 보존하고 명시한 미발행 상태가 있으면 수정 의도보다 우선한다", async (context) => {
  const published = draft({ slug: "한글-수정-주소" });
  const fixture = await writerFixture(context, {
    initial: published,
    queryId: null,
    queryPost: published.slug,
    publishedRecords: [published],
    legacySummaries: true,
  });
  assert.equal(fixture.value.isEditing, true);
  const url = new URL(fixture.location.href);
  assert.equal(url.searchParams.get("post"), published.slug);
  assert.equal(url.searchParams.get("draft"), published.id);
  const reloaded = await writerFixture(context, {
    initial: published,
    publishedRecords: [published],
    locationHref: fixture.location.href,
    legacySummaries: true,
  });
  assert.equal(reloaded.value.isEditing, true);
  const publishedOnly = await writerFixture(context, { publishedRecords: [published], queryId: published.id, legacySummaries: true });
  assert.equal(publishedOnly.value.isEditing, true);

  const local = draft({ slug: "only-an-unpublished-draft" });
  const unpublished = await writerFixture(context, { initial: local, queryId: null, queryPost: local.slug });
  assert.equal(unpublished.value.isEditing, false);
  assert.equal(unpublished.value.draft.id, local.id);
  assert.equal(new URL(unpublished.location.href).searchParams.has("post"), false);
});

test("기존 게시글의 수정 발행이 실패해도 수정 모드와 원문을 보존하고 같은 글로 재시도한다", async (context) => {
  const published = draft({ slug: "update-existing-post" });
  const fixture = await writerFixture(context, { initial: published, publishedRecords: [published] });
  fixture.edit("## 기존 글의 수정 원문\n\n실패해도 다시 같은 게시글을 수정합니다.");
  fixture.queue("POST", "/publish", ({ body }) => {
    fixture.documents.set(body.draft.id, { ...body.draft, updatedAt: "2026-11-17T02:00:00.000Z" });
    return response({ error: "수정 내용 푸시 실패", code: "PUSH_FAILED", commit: "update-commit" }, 502);
  });
  await fixture.act((writer) => writer.publish());
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  assert.equal(fixture.value.pendingCommit, "update-commit");
  assert.match(fixture.value.markdown, /기존 글의 수정 원문/);
  assert.equal(fixture.value.draft.id, published.id);
  const pending = deferred();
  let sent;
  fixture.queue("POST", "/publish", ({ body }) => { sent = body.draft; return pending.promise; });
  const updating = fixture.act((writer) => writer.publish());
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  assert.equal(fixture.value.publishing, true);
  fixture.published.set(sent.id, structuredClone(sent));
  pending.resolve(response({ draft: sent, slug: sent.slug, url: "/posts/" + sent.slug + "/", commit: "update-commit", pushed: true }));
  await updating;
  await fixture.flush();
  assert.equal(fixture.value.isEditing, true);
  assert.equal(fixture.value.published.wasEditing, true);
  assert.equal(fixture.value.pendingCommit, "");
  assert.equal(sent.id, published.id);
  assert.equal(sent.slug, published.slug);
  assert.deepEqual(fixture.navigation, ["/"]);
});
