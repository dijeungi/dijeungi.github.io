"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useWriterDialog } from "./useWriterDialog";
import { useMarkdownInput } from "./useMarkdownInput";
import { parseMarkdown } from "@/app/shared/lib/markdown";
import { createEmptyDocument, parseBlogDocument, validatePostSubtitle, normalizeDraftMetadata } from "@/app/shared/lib/content";

import type { BlogDocument, RichDocument } from "@/app/shared/types/content";
import type { DraftSummary, PublishResult, WriterConnection, WriterErrorResponse, WriterImage, WriterPublication } from "../_types/writer";

const lastDraftKey = "junho.writer.last-draft";
const apiBase = "/__editor/api";

// 편집기 요청 실패와 배포 재시도 정보
class WriterRequestError extends Error {
  commit?: string;

  // 서버 오류와 발행 상태 보관
  constructor(message: string, details?: WriterErrorResponse) {
    super(message);
    this.name = "WriterRequestError";
    this.commit = details?.commit;
  }
}

// 로컬 작성 서버의 JSON 요청
async function requestJson<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname)) {
    throw new WriterRequestError("글쓰기는 npm run dev로 실행한 로컬 주소에서 사용할 수 있습니다.");
  }
  const headers = new Headers(options.headers);
  if (token) headers.set("X-Editor-Token", token);
  const response = await fetch(apiBase + path, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new WriterRequestError(
      data?.error || "글쓰기 서버에 연결하지 못했습니다. 터미널에서 npm run dev를 실행해 주세요.",
      data || undefined,
    );
  }
  return data as T;
}

// 기기 날짜와 빈 글의 초기값
function createDraft(): BlogDocument {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  return {
    version: 1, id: crypto.randomUUID(), slug: "", title: "", subtitle: "", description: "",
    category: "", date, readingMinutes: 0, markdown: "", content: createEmptyDocument(),
    updatedAt: now.toISOString(),
  };
}

// 화면에 표시할 오류 문장
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

// 사용자가 편집할 수 있는 값의 저장 기준
function draftFingerprint(draft: BlogDocument) {
  const body = draft.markdown === undefined ? draft.content : draft.markdown;
  return JSON.stringify([draft.title, draft.subtitle, draft.category, draft.date, body, draft.heroImage]);
}

// 글 작성과 기기 저장 및 발행 상태 관리
export function usePostWriter() {
  const router = useRouter();
  const tokenRef = useRef("");
  const savedRef = useRef("");
  const mountedRef = useRef(false);
  const focusFrameRef = useRef(0);
  const draftsWereOpenRef = useRef(false);
  const operationRef = useRef("");
  const uploadingRef = useRef(false);
  const draftRef = useRef<BlogDocument | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const draftsButtonRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<BlogDocument | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [connection, setConnection] = useState<WriterConnection>("loading");
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [published, setPublished] = useState<WriterPublication | null>(null);
  const [pendingCommit, setPendingCommit] = useState("");
  const { confirmation, dialogRef, requestConfirmation, respondToConfirmation } = useWriterDialog();

  // 글 전환 렌더링 이후 제목 입력으로 이동
  const focusTitle = useCallback(() => {
    window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.cancelAnimationFrame(focusFrameRef.current);
    };
  }, []);

  // 편집 글의 메타데이터 정규화와 메모리 상태 반영
  const storeDraft = useCallback((next: BlogDocument) => {
    const normalized = normalizeDraftMetadata(next);
    draftRef.current = normalized;
    setDraft(normalized);
    setDirty(draftFingerprint(normalized) !== savedRef.current);
  }, []);

  // 임시저장한 글의 식별자만 다음 방문을 위해 기억
  const rememberDraft = useCallback((id: string) => {
    try {
      localStorage.setItem(lastDraftKey, id);
    } catch {
      setNotice("최근 글 선택을 기억하지 못했습니다. 임시저장한 글은 목록에서 다시 열 수 있습니다.");
    }
  }, []);

  // 저장 요청 없이 편집 중인 입력 갱신
  const updateDraft = useCallback((changes: Partial<BlogDocument>) => {
    if (!draftRef.current || operationRef.current) return;
    storeDraft({ ...draftRef.current, ...changes, ...(changes.content ? { readingMinutes: 0 } : {}) });
    setPublished(null);
  }, [storeDraft]);

  // 마크다운 변환에 사용할 현재 본문
  const getContent = useCallback((): RichDocument => draftRef.current?.content ?? createEmptyDocument(), []);

  // 원문과 변환된 본문을 같은 입력 상태에 반영
  const updateBody = useCallback((markdown: string, content: RichDocument | null) => {
    updateDraft({ markdown, ...(content ? { content } : {}) });
  }, [updateDraft]);

  // 작업 전환 중 입력 차단
  const isInputBlocked = useCallback(() => Boolean(operationRef.current), []);

  const {
    markdown, textareaRef, bodyError, changeMarkdown, insertMarkdown, insertImage,
    undo, redo, canUndo, canRedo, onMarkdownKeyDown, onMarkdownSelect, setDocument, getBodyError,
  } = useMarkdownInput(getContent, updateBody, isInputBlocked, setError);

  // 화면과 입력창에 같은 글 표시
  const displayDraft = useCallback((next: BlogDocument, saved = false, editing = false) => {
    if (!mountedRef.current) return;
    const restored = next.markdown === undefined
      ? next
      : parseBlogDocument({ ...next, content: parseMarkdown(next.markdown, next.content) });
    const normalized = normalizeDraftMetadata({ ...restored, subtitle: restored.subtitle ?? "", readingMinutes: 0 });
    setDocument(normalized);
    savedRef.current = draftFingerprint(normalized);
    storeDraft(normalized);
    setPublished(null);
    setIsEditing(editing);
    setPendingCommit("");
    setLastSavedAt(saved ? next.updatedAt : "");
    const url = new URL(window.location.href);
    if (editing && next.slug) url.searchParams.set("post", next.slug);
    else url.searchParams.delete("post");
    url.searchParams.set("draft", next.id);
    window.history.replaceState(null, "", url);
  }, [setDocument, storeDraft]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const session = await requestJson<{ token: string }>("/session", "", { signal: controller.signal });
        if (!active) return;
        tokenRef.current = session.token;
        const list = await requestJson<{ drafts: DraftSummary[] }>("/drafts", session.token, { signal: controller.signal });
        if (!active) return;
        setDrafts(list.drafts);
        if (!draftRef.current) {
          const parameters = new URL(window.location.href).searchParams;
          const requestedId = parameters.get("draft");
          const requestedSlug = parameters.get("post");
          const requestedPost = requestedSlug ? list.drafts.find((item) => item.slug === requestedSlug) : undefined;
          if (requestedSlug && !requestedPost) throw new WriterRequestError("수정할 게시글을 찾지 못했습니다. 글 주소를 확인해 주세요.");
          let storedId: string | null = null;
          try { storedId = localStorage.getItem(lastDraftKey); } catch {}
          const initialId = requestedPost?.id || requestedId || storedId;
          let initial: BlogDocument | null = null;
          if (initialId && list.drafts.some((item) => item.id === initialId)) {
            const response = await requestJson<{ draft: BlogDocument }>("/drafts/" + encodeURIComponent(initialId), session.token, { signal: controller.signal });
            initial = parseBlogDocument(response.draft);
          }
          if (!active) return;
          const selected = list.drafts.find((item) => item.id === initialId);
          const editing = selected?.isPublished ?? (selected?.isLocalDraft === false || Boolean(requestedPost));
          displayDraft(initial || createDraft(), Boolean(initial), Boolean(initial && editing));
        }
        setConnection("ready");
      } catch (failure) {
        if (!active || controller.signal.aborted) return;
        if (!draftRef.current) displayDraft(createDraft());
        setConnection("unavailable");
        setError(errorMessage(failure));
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [connectionVersion, displayDraft]);

  useEffect(() => {
    // 저장 전 페이지 이탈 안내
    function warnBeforeLeave(event: BeforeUnloadEvent) {
      if (!dirty && !publishing && !saving && !uploading) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty, publishing, saving, uploading]);

  useEffect(() => {
    if (!draftsOpen) return;
    // 임시글 패널 바깥 클릭으로 닫기
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !draftsButtonRef.current?.parentElement?.contains(event.target)) setDraftsOpen(false);
    }
    // 임시글 패널 키보드 닫기
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !dialogRef.current?.open) {
        setDraftsOpen(false);
        draftsButtonRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [dialogRef, draftsOpen]);

  useEffect(() => {
    if (draftsWereOpenRef.current && !draftsOpen && document.activeElement === document.body) {
      draftsButtonRef.current?.focus();
    }
    draftsWereOpenRef.current = draftsOpen;
  }, [draftsOpen]);

  // 최신 임시 글 목록 갱신
  const refreshDrafts = useCallback(async () => {
    const response = await requestJson<{ drafts: DraftSummary[] }>("/drafts", tokenRef.current);
    if (mountedRef.current) setDrafts(response.drafts);
  }, []);

  // 입력 중 변경을 보존하는 파일 임시저장
  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const snapshot = draftRef.current;
    if (!mountedRef.current || !snapshot || connection !== "ready" || uploadingRef.current) return false;
    if (getBodyError()) { setError(getBodyError()); return false; }
    setSaving(true);
    setError("");
    const operation = (async () => {
      try {
        const response = await requestJson<{ draft: BlogDocument }>("/drafts", tokenRef.current, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot),
        });
        const saved = parseBlogDocument(response.draft);
        if (!mountedRef.current) return false;
        if (draftRef.current?.id === snapshot.id) {
          const normalized = normalizeDraftMetadata({ ...saved, subtitle: saved.subtitle ?? "", readingMinutes: 0 });
          const changed = draftFingerprint(draftRef.current) !== draftFingerprint(snapshot);
          savedRef.current = draftFingerprint(normalized);
          storeDraft(changed ? { ...draftRef.current, slug: saved.slug, updatedAt: saved.updatedAt } : normalized);
          setLastSavedAt(saved.updatedAt);
        }
        rememberDraft(saved.id);
        await refreshDrafts().catch(() => setNotice("글은 저장했지만 목록을 갱신하지 못했습니다. 다시 연결하면 저장된 글을 볼 수 있습니다."));
        return mountedRef.current;
      } catch (failure) {
        setError(errorMessage(failure));
        return false;
      } finally {
        savePromiseRef.current = null;
        setSaving(false);
      }
    })();
    savePromiseRef.current = operation;
    return operation;
  }, [connection, getBodyError, refreshDrafts, rememberDraft, storeDraft]);

  // 수동 저장 요청과 중복 작업 차단
  const saveDraft = useCallback(async () => {
    if (!mountedRef.current || operationRef.current || uploadingRef.current) return false;
    return persistDraft();
  }, [persistDraft]);

  useEffect(() => {
    // 수동 임시저장 단축키
    function saveWithKeyboard(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!dialogRef.current?.open) void saveDraft();
      }
    }
    window.addEventListener("keydown", saveWithKeyboard);
    return () => window.removeEventListener("keydown", saveWithKeyboard);
  }, [dialogRef, saveDraft]);

  // 제목 입력과 자동 메타데이터 갱신
  const changeTitle = useCallback((title: string) => updateDraft({ title }), [updateDraft]);

  // 저장과 업로드 중 글 전환 차단
  const canTransition = useCallback(() => mountedRef.current && connection === "ready" && !operationRef.current && !savePromiseRef.current && !uploadingRef.current, [connection]);

  // 미저장 입력을 버리기 전 확인
  const confirmDiscard = useCallback(async (message: string) => {
    if (!draftRef.current || draftFingerprint(draftRef.current) === savedRef.current) return true;
    return requestConfirmation({ title: "저장하지 않은 변경", message, confirmLabel: "변경 버리기", destructive: true });
  }, [requestConfirmation]);

  // 저장하지 않은 입력의 폐기를 확인한 뒤 새 글 시작
  const newDraft = useCallback(async () => {
    if (!canTransition() || !(await confirmDiscard("임시저장하지 않은 변경을 버리고 새 글을 작성할까요?")) || !canTransition()) return;
    setError("");
    setNotice("");
    displayDraft(createDraft());
    setDraftsOpen(false);
    focusTitle();
  }, [canTransition, confirmDiscard, displayDraft, focusTitle]);

  // 저장하지 않은 입력의 폐기를 확인한 뒤 저장한 글 불러오기
  const loadDraft = useCallback(async (id: string) => {
    if (!canTransition() || !(await confirmDiscard("임시저장하지 않은 변경을 버리고 저장된 글을 열까요?")) || !canTransition()) return;
    operationRef.current = "switching";
    setSwitching(true);
    setError("");
    try {
      const response = await requestJson<{ draft: BlogDocument }>("/drafts/" + encodeURIComponent(id), tokenRef.current);
      if (!mountedRef.current) return;
      const selected = drafts.find((item) => item.id === id);
      const editing = selected?.isPublished ?? (selected?.isLocalDraft === false || (isEditing && draftRef.current?.id === id));
      displayDraft(parseBlogDocument(response.draft), true, editing);
      setNotice("");
      setDraftsOpen(false);
      rememberDraft(id);
      focusTitle();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { operationRef.current = ""; setSwitching(false); }
  }, [drafts, isEditing, canTransition, confirmDiscard, displayDraft, rememberDraft, focusTitle]);

  // 저장하지 않은 입력을 확인한 뒤 홈으로 이동
  const leaveWriter = useCallback(async () => {
    if (!mountedRef.current || operationRef.current || savePromiseRef.current || uploadingRef.current) return;
    if (!(await confirmDiscard("임시저장하지 않은 변경을 버리고 나갈까요?"))) return;
    if (!mountedRef.current || operationRef.current || savePromiseRef.current || uploadingRef.current) return;
    router.push("/");
  }, [confirmDiscard, router]);

  // 선택한 로컬 임시글만 버전 확인 후 삭제
  const deleteDraft = useCallback(async (id: string) => {
    const selected = drafts.find((item) => item.id === id && item.isLocalDraft === true);
    if (!selected || !canTransition()) return;
    const approved = await requestConfirmation({
      title: "임시글 삭제",
      message: draftRef.current?.id === id
        ? "이 임시글을 삭제할까요? 저장하지 않은 입력도 버려집니다. 이미 게시한 글은 삭제되지 않습니다."
        : "이 임시글을 삭제할까요? 이미 게시한 글은 삭제되지 않습니다.",
      confirmLabel: "삭제", destructive: true,
    });
    if (!approved || !canTransition()) return;
    operationRef.current = "deleting";
    setDeletingId(id);
    setError("");
    try {
      const expectedUpdatedAt = draftRef.current?.id === id ? draftRef.current.updatedAt : selected.updatedAt;
      await requestJson<{ deleted: string }>("/drafts/" + encodeURIComponent(id), tokenRef.current, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt }),
      });
      if (!mountedRef.current) return;
      if (draftRef.current?.id === id) displayDraft(createDraft());
      try {
        if (localStorage.getItem(lastDraftKey) === id) localStorage.removeItem(lastDraftKey);
      } catch {}
      setDrafts((items) => items.filter((item) => item.id !== id));
      setNotice("임시글을 삭제했습니다.");
      await refreshDrafts().catch(() => setNotice("임시글은 삭제했지만 목록을 갱신하지 못했습니다. 다시 연결해 주세요."));
      draftsButtonRef.current?.focus();
    } catch (failure) {
      setError(errorMessage(failure));
      await refreshDrafts().catch(() => {});
    } finally { operationRef.current = ""; setDeletingId(""); }
  }, [drafts, canTransition, requestConfirmation, displayDraft, refreshDrafts]);

  // 업로드한 이미지를 요청한 글의 현재 본문에 삽입
  const uploadInlineImage = useCallback(async (file: File) => {
    if (connection !== "ready" || uploadingRef.current || operationRef.current || savePromiseRef.current) return;
    const id = draftRef.current?.id;
    if (!id) return;
    uploadingRef.current = true;
    setUploading(true);
    setError("");
    try {
      const response = await requestJson<{ image: WriterImage }>("/media", tokenRef.current, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      if (!mountedRef.current || draftRef.current?.id !== id) return;
      insertImage({ ...response.image, alt: response.image.alt || file.name.replace(/\.[^.]+$/, "") });
    } catch (failure) { setError(errorMessage(failure)); }
    finally { uploadingRef.current = false; setUploading(false); }
  }, [connection, insertImage]);

  // 현재 글의 저장과 Git 발행 요청
  const publish = useCallback(async () => {
    if (!mountedRef.current || !draftRef.current || operationRef.current || uploadingRef.current || connection !== "ready") return;
    if (getBodyError()) { setError(getBodyError()); return; }
    try { validatePostSubtitle(draftRef.current); }
    catch (failure) { setError(errorMessage(failure)); return; }
    operationRef.current = "publishing";
    setPublishing(true);
    setError("");
    setNotice("");
    try {
      if (savePromiseRef.current && !(await savePromiseRef.current)) return;
      if (!mountedRef.current || !(await persistDraft()) || !mountedRef.current) return;
      const current = parseBlogDocument(draftRef.current);
      const result = await requestJson<PublishResult>("/publish", tokenRef.current, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: current }),
      });
      if (!mountedRef.current) return;
      const next = parseBlogDocument(result.draft);
      displayDraft(next, true, true);
      setPublished({ ...result, wasEditing: isEditing });
      await refreshDrafts().catch(() => setNotice("발행 요청은 완료됐지만 임시 글 목록을 갱신하지 못했습니다."));
      if (mountedRef.current && result.pushed) router.replace("/");
    } catch (failure) {
      if (!mountedRef.current) return;
      setError(errorMessage(failure));
      if (failure instanceof WriterRequestError && failure.commit) setPendingCommit(failure.commit);
      try {
        if (draftRef.current) {
          const response = await requestJson<{ draft: BlogDocument }>("/drafts/" + encodeURIComponent(draftRef.current.id), tokenRef.current);
          if (!mountedRef.current) return;
          storeDraft({ ...draftRef.current, slug: response.draft.slug, updatedAt: response.draft.updatedAt });
        }
      } catch {}
    } finally {
      operationRef.current = "";
      setPublishing(false);
    }
  }, [isEditing, connection, getBodyError, persistDraft, refreshDrafts, router, displayDraft, storeDraft]);

  // 입력을 유지하면서 로컬 작성 서버에 다시 연결
  const reconnect = useCallback(() => {
    if (operationRef.current || savePromiseRef.current || uploadingRef.current) return;
    setConnection("loading");
    setError("");
    setConnectionVersion((value) => value + 1);
  }, []);

  return {
    draft, drafts, markdown, textareaRef, titleRef, draftsButtonRef, draftsOpen, setDraftsOpen,
    connection, dirty, saving, publishing, uploading, deletingId, lastSavedAt, error, notice, isEditing,
    published, pendingCommit, bodyError, confirmation, dialogRef, respondToConfirmation,
    busy: connection !== "ready" || publishing || switching || Boolean(deletingId),
    updateDraft, changeTitle, changeMarkdown, newDraft, loadDraft, saveDraft, publish, reconnect,
    uploadInlineImage, insertMarkdown, undo, redo, canUndo, canRedo,
    onMarkdownKeyDown, onMarkdownSelect, leaveWriter, deleteDraft,
  };
}
