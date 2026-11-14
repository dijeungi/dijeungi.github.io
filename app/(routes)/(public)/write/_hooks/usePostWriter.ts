"use client";

import { Image } from "@tiptap/extension-image";
import { StarterKit } from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, useEditorState } from "@tiptap/react";
import { Placeholder } from "@tiptap/extension-placeholder";

import { createEmptyDocument, isSafeContentUrl, parseBlogDocument, slugifyTitle } from "@/app/shared/lib/content";

import type { BlogDocument, RichDocument } from "@/app/shared/types/content";
import type { DraftSummary, PublishResult, WriterBackup, WriterConnection, WriterErrorResponse, WriterImage } from "../_types/writer";

const backupPrefix = "junho.writer.backup.";
const lastDraftKey = "junho.writer.last-draft";
const apiBase = "/__editor/api";

// 편집기 요청 실패와 배포 재시도 정보
class WriterRequestError extends Error {
  code?: string;
  commit?: string;

  // 서버 오류와 발행 상태 보관
  constructor(message: string, details?: WriterErrorResponse) {
    super(message);
    this.name = "WriterRequestError";
    this.code = details?.code;
    this.commit = details?.commit;
  }
}

// 로컬 작성 서버의 JSON 요청
async function requestJson<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
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
    version: 1,
    id: crypto.randomUUID(),
    slug: "",
    title: "",
    description: "",
    category: "",
    date,
    readingMinutes: 0,
    content: createEmptyDocument(),
    updatedAt: now.toISOString(),
  };
}

// 브라우저에 남은 해당 글의 백업 읽기
function readBackup(id: string | null): WriterBackup | null {
  if (!id) return null;
  const raw = localStorage.getItem(backupPrefix + id);
  if (!raw) return null;
  const data = JSON.parse(raw) as WriterBackup;
  return { draft: parseBlogDocument(data.draft), dirty: data.dirty === true };
}

// 화면에 표시할 오류 문장
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

// 글 작성과 기기 저장 및 발행 상태 관리
export function usePostWriter() {
  const tokenRef = useRef("");
  const revisionRef = useRef(0);
  const publishBusyRef = useRef(false);
  const slugEditedRef = useRef(false);
  const draftRef = useRef<BlogDocument | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const editorScrollRef = useRef(0);
  const [draft, setDraft] = useState<BlogDocument | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [connection, setConnection] = useState<WriterConnection>("loading");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [preview, setPreview] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [autosavePaused, setAutosavePaused] = useState(false);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [pendingCommit, setPendingCommit] = useState("");

  // 입력 변경과 브라우저 백업 기준 갱신
  const updateDraft = useCallback((changes: Partial<BlogDocument>) => {
    if (!draftRef.current || publishBusyRef.current) return;
    const next = { ...draftRef.current, ...changes };
    draftRef.current = next;
    revisionRef.current += 1;
    setDraft(next);
    setDirty(true);
    setAutosavePaused(false);
    setPublished(null);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: false,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          isAllowedUri: (url, context) => context.defaultValidate(url) && isSafeContentUrl(url),
        },
      }),
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder: "여기에 이야기를 적어보세요. 이미지와 코드도 함께 담을 수 있어요." }),
    ],
    editorProps: { attributes: { "aria-label": "글 본문", "data-testid": "post-editor" } },
    onUpdate: ({ editor: currentEditor }) => {
      updateDraft({ content: currentEditor.getJSON() as RichDocument });
    },
  });

  const selection = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      link: currentEditor?.isActive("link") ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
      codeBlock: currentEditor?.isActive("codeBlock") ?? false,
      image: currentEditor?.isActive("image") ?? false,
      imageAlt: String(currentEditor?.getAttributes("image").alt || ""),
      level: currentEditor?.isActive("heading", { level: 2 }) ? "2" : currentEditor?.isActive("heading", { level: 3 }) ? "3" : "paragraph",
      undo: currentEditor?.can().undo() ?? false,
      redo: currentEditor?.can().redo() ?? false,
      characters: currentEditor?.getText().length ?? 0,
    }),
  });

  // 화면과 편집기에 같은 글 표시
  const displayDraft = useCallback((next: BlogDocument, isDirty = false, saved = false) => {
    draftRef.current = next;
    revisionRef.current += 1;
    slugEditedRef.current = Boolean(next.slug);
    setDraft(next);
    setDirty(isDirty);
    setPublished(null);
    setPendingCommit("");
    setAutosavePaused(false);
    setLastSavedAt(saved ? next.updatedAt : "");
    editor?.commands.setContent(next.content, { emitUpdate: false });
    const url = new URL(window.location.href);
    url.searchParams.set("draft", next.id);
    window.history.replaceState(null, "", url);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController();
    let active = true;
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
    if (!local) {
      displayDraft(createDraft());
      setConnection("unavailable");
      setNotice("글쓰기는 내 컴퓨터에서 사용할 수 있습니다. 프로젝트의 blog 폴더에서 npm run dev를 실행한 뒤 /write로 접속해 주세요.");
      return () => controller.abort();
    }
    void (async () => {
      try {
        const session = await requestJson<{ token: string }>("/session", "", { signal: controller.signal });
        if (!active) return;
        tokenRef.current = session.token;
        const list = await requestJson<{ drafts: DraftSummary[] }>("/drafts", session.token, { signal: controller.signal });
        if (!active) return;
        setDrafts(list.drafts);
        const requestedId = new URL(window.location.href).searchParams.get("draft");
        let storedId: string | null = null;
        try { storedId = localStorage.getItem(lastDraftKey); } catch {}
        const initialId = requestedId || storedId;
        let backup: WriterBackup | null = null;
        try { backup = readBackup(initialId); } catch { setNotice("브라우저의 이전 백업을 읽지 못했습니다. 저장된 글 목록에서 글을 열 수 있습니다."); }
        let initial: BlogDocument | null = null;
        if (initialId && list.drafts.some((item) => item.id === initialId)) {
          const saved = await requestJson<{ draft: BlogDocument }>("/drafts/" + encodeURIComponent(initialId), session.token, { signal: controller.signal });
          initial = parseBlogDocument(saved.draft);
        }
        if (!active) return;
        if (backup?.dirty) {
          const conflicted = initial && backup.draft.updatedAt !== initial.updatedAt;
          displayDraft(conflicted ? { ...backup.draft, id: crypto.randomUUID(), slug: "", updatedAt: new Date().toISOString() } : backup.draft, true);
          setNotice(conflicted ? "다른 창에서 저장한 글과 겹쳐 브라우저 백업을 새 임시 글로 복구했습니다." : "이 브라우저에 남아 있던 작성 내용을 복구했습니다.");
        } else {
          displayDraft(initial || createDraft(), false, Boolean(initial));
        }
        setConnection("ready");
      } catch (failure) {
        if (!active || controller.signal.aborted) return;
        let recovered: WriterBackup | null = null;
        try { recovered = readBackup(new URL(window.location.href).searchParams.get("draft") || localStorage.getItem(lastDraftKey)); } catch {}
        displayDraft(recovered?.draft || createDraft(), recovered?.dirty);
        setConnection("unavailable");
        setError(errorMessage(failure));
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [displayDraft, editor]);

  useEffect(() => { editor?.setEditable(connection === "ready" && !publishing && !switching); }, [connection, editor, publishing, switching]);

  useEffect(() => {
    if (!draft || connection !== "ready") return;
    try {
      localStorage.setItem(backupPrefix + draft.id, JSON.stringify({ draft, dirty } satisfies WriterBackup));
      localStorage.setItem(lastDraftKey, draft.id);
    } catch {
      setNotice("브라우저 백업을 저장하지 못했습니다. 임시저장 버튼으로 컴퓨터에 저장해 주세요.");
    }
  }, [connection, draft, dirty]);

  useEffect(() => {
    // 저장 전 페이지 이탈 안내
    function warnBeforeLeave(event: BeforeUnloadEvent) {
      if (!dirty && !publishing) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty, publishing]);

  // 최신 임시 글 목록 갱신
  const refreshDrafts = useCallback(async () => {
    const response = await requestJson<{ drafts: DraftSummary[] }>("/drafts", tokenRef.current);
    setDrafts(response.drafts);
  }, []);

  // 입력 중 변경을 보존하는 파일 임시저장
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const snapshot = draftRef.current;
    if (!snapshot || connection !== "ready") return false;
    const savedRevision = revisionRef.current;
    setSaving(true);
    setError("");
    setAutosavePaused(false);
    const operation = (async () => {
      try {
        const response = await requestJson<{ draft: BlogDocument }>("/drafts", tokenRef.current, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
        const saved = parseBlogDocument(response.draft);
        if (draftRef.current?.id === snapshot.id) {
          const latest = { ...draftRef.current, updatedAt: saved.updatedAt };
          draftRef.current = latest;
          setDraft(latest);
          setLastSavedAt(saved.updatedAt);
          if (revisionRef.current === savedRevision) setDirty(false);
        }
        await refreshDrafts().catch(() => setNotice("글은 저장했지만 목록을 갱신하지 못했습니다. 다시 연결하면 저장된 글을 볼 수 있습니다."));
        return true;
      } catch (failure) {
        setError(errorMessage(failure));
        setAutosavePaused(true);
        return false;
      } finally {
        savePromiseRef.current = null;
        setSaving(false);
      }
    })();
    savePromiseRef.current = operation;
    return operation;
  }, [connection, refreshDrafts]);

  useEffect(() => {
    if (!dirty || saving || publishing || autosavePaused || connection !== "ready") return;
    const timer = window.setTimeout(() => { if (!publishBusyRef.current) void saveDraft(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [autosavePaused, connection, dirty, draft, publishing, saveDraft, saving]);

  // 제목에 맞춘 초기 글 주소 생성
  const changeTitle = useCallback((title: string) => {
    updateDraft(slugEditedRef.current ? { title } : { title, slug: slugifyTitle(title) });
  }, [updateDraft]);

  // 직접 입력한 글 주소 유지
  const changeSlug = useCallback((slug: string) => {
    slugEditedRef.current = true;
    updateDraft({ slug });
  }, [updateDraft]);

  // 현재 입력을 저장한 뒤 새 글 시작
  const newDraft = useCallback(async () => {
    if (publishBusyRef.current) return;
    publishBusyRef.current = true;
    setSwitching(true);
    try {
      if (dirty && !(await saveDraft())) return;
      setError("");
      setNotice("");
      displayDraft(createDraft());
    } finally { publishBusyRef.current = false; setSwitching(false); }
  }, [dirty, displayDraft, saveDraft]);

  // 저장된 글과 해당 브라우저 백업 불러오기
  const loadDraft = useCallback(async (id: string) => {
    if (id === draftRef.current?.id || connection !== "ready" || publishBusyRef.current) return;
    publishBusyRef.current = true;
    setSwitching(true);
    try {
      if (dirty && !(await saveDraft())) return;
      setError("");
      const response = await requestJson<{ draft: BlogDocument }>("/drafts/" + encodeURIComponent(id), tokenRef.current);
      let next = parseBlogDocument(response.draft);
      let restore = false;
      try {
        const backup = readBackup(id);
        if (backup?.dirty) {
          next = backup.draft.updatedAt === next.updatedAt ? backup.draft : { ...backup.draft, id: crypto.randomUUID(), slug: "", updatedAt: new Date().toISOString() };
          restore = true;
        }
      } catch {}
      displayDraft(next, restore, !restore);
      setNotice(restore ? "이 브라우저에 남아 있던 작성 내용을 복구했습니다." : "");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { publishBusyRef.current = false; setSwitching(false); }
  }, [connection, dirty, displayDraft, saveDraft]);

  // 글 이미지의 로컬 업로드
  const uploadImage = useCallback(async (file: File): Promise<WriterImage | null> => {
    if (connection !== "ready" || uploading || publishBusyRef.current) return null;
    setUploading(true);
    setError("");
    try {
      const response = await requestJson<{ image: WriterImage }>("/media", tokenRef.current, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      return { ...response.image, alt: response.image.alt || file.name.replace(/\.[^.]+$/, "") };
    } catch (failure) { setError(errorMessage(failure)); return null; }
    finally { setUploading(false); }
  }, [connection, uploading]);

  // 업로드한 이미지를 대표 이미지로 지정
  const uploadHeroImage = useCallback(async (file: File) => {
    const image = await uploadImage(file);
    if (image) updateDraft({ heroImage: image });
  }, [updateDraft, uploadImage]);

  // 업로드한 이미지를 현재 본문 위치에 삽입
  const uploadInlineImage = useCallback(async (file: File) => {
    const image = await uploadImage(file);
    if (image) editor?.chain().focus().setImage(image).run();
  }, [editor, uploadImage]);

  // 선택한 글자의 링크 입력과 해제
  const editLink = useCallback(() => {
    if (!editor) return;
    const previous = String(editor.getAttributes("link").href || "");
    const value = window.prompt("연결할 주소를 입력하세요. 비우면 링크를 해제합니다.", previous);
    if (value === null) return;
    const href = value.trim();
    if (!href) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    if (!isSafeContentUrl(href)) { setError("http, https 또는 메일 주소 형식의 링크를 입력해 주세요."); return; }
    setError("");
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }, [editor]);

  // 실제 글 상세 화면으로 미리보기 전환
  const showPreview = useCallback(() => {
    if (!draftRef.current) return;
    try {
      parseBlogDocument(draftRef.current);
      editorScrollRef.current = window.scrollY;
      setPreview(true);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (failure) { setError(errorMessage(failure)); }
  }, []);

  // 작성 중이던 위치로 복귀
  const closePreview = useCallback(() => {
    setPreview(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: editorScrollRef.current, behavior: "instant" }));
  }, []);

  // 현재 글의 저장과 Git 발행 요청
  const publish = useCallback(async () => {
    if (!draftRef.current || publishBusyRef.current || connection !== "ready") return;
    publishBusyRef.current = true;
    setPublishing(true);
    setError("");
    setNotice("");
    try {
      if (!(await saveDraft())) return;
      const current = parseBlogDocument(draftRef.current);
      const result = await requestJson<PublishResult>("/publish", tokenRef.current, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: current }),
      });
      const next = parseBlogDocument(result.draft);
      draftRef.current = next;
      setDraft(next);
      setDirty(false);
      setPublished(result);
      setPendingCommit("");
      setLastSavedAt(next.updatedAt);
      await refreshDrafts().catch(() => setNotice("발행 요청은 완료됐지만 임시 글 목록을 갱신하지 못했습니다."));
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof WriterRequestError && failure.commit) setPendingCommit(failure.commit);
      try {
        if (draftRef.current) {
          const response = await requestJson<{ draft: BlogDocument }>("/drafts/" + encodeURIComponent(draftRef.current.id), tokenRef.current);
          const latest = { ...draftRef.current, updatedAt: response.draft.updatedAt };
          draftRef.current = latest;
          setDraft(latest);
        }
      } catch {}
    } finally {
      publishBusyRef.current = false;
      setPublishing(false);
    }
  }, [connection, refreshDrafts, saveDraft]);

  // 로컬 작성 서버에 다시 연결
  const reconnect = useCallback(() => window.location.reload(), []);

  return {
    draft, drafts, editor, selection, connection, dirty, saving, publishing, uploading,
    preview, lastSavedAt, error, notice, published, pendingCommit,
    busy: connection !== "ready" || publishing || switching,
    updateDraft, changeTitle, changeSlug, newDraft, loadDraft, saveDraft,
    uploadHeroImage, uploadInlineImage, editLink, showPreview, closePreview, publish,
    reconnect,
  };
}
