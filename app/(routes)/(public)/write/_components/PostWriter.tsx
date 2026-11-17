"use client";

import { WriterIcon } from "./WriterIcon";
import { WriterPreview } from "./WriterPreview";
import { WriterToolbar } from "./WriterToolbar";
import { WriterDraftList } from "./WriterDraftList";
import { siteName } from "@/app/shared/constants/site";
import { usePostWriter } from "../_hooks/usePostWriter";

import styles from "../Write.module.css";

const saveTimeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

// 마크다운 입력과 실제 상세 결과를 나란히 보여주는 로컬 글쓰기
export function PostWriter() {
  const {
    draft,
    drafts,
    markdown,
    busy,
    dirty,
    saving,
    canUndo,
    canRedo,
    notice,
    error,
    bodyError,
    undo,
    redo,
    titleRef,
    dialogRef,
    published,
    uploading,
    publishing,
    isEditing,
    connection,
    deletingId,
    draftsOpen,
    textareaRef,
    lastSavedAt,
    confirmation,
    pendingCommit,
    draftsButtonRef,
    updateDraft,
    changeTitle,
    changeMarkdown,
    setDraftsOpen,
    newDraft,
    loadDraft,
    saveDraft,
    publish,
    reconnect,
    leaveWriter,
    deleteDraft,
    insertMarkdown,
    uploadInlineImage,
    onMarkdownSelect,
    onMarkdownKeyDown,
    respondToConfirmation,
  } = usePostWriter();
  const localDraftCount = drafts.filter((item) => item.isLocalDraft !== false).length;
  const actionDisabled = busy || saving || uploading || !draft || Boolean(bodyError);
  const leaveDisabled = saving || uploading || (busy && connection !== "unavailable");
  const action = isEditing ? "수정" : "발행";
  const actionLabel = publishing ? action + " 중" : pendingCommit ? action + " 재시도" : isEditing ? "수정 완료" : "발행";
  const status = publishing ? action + " 요청 중" : saving ? "저장 중" : uploading ? "이미지 업로드 중" : dirty ? "저장하지 않은 변경" : lastSavedAt ? saveTimeFormatter.format(new Date(lastSavedAt)) + " 저장됨" : "아직 저장하지 않음";

  return (
    <div className={styles.writer}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <button className={styles.brand} type="button" disabled={leaveDisabled} onClick={() => void leaveWriter()}>{siteName}</button>
          <span className={styles.headerDivider} aria-hidden="true" />
          <span className={styles.headerContext}>{isEditing ? "글 수정" : "글쓰기"}</span>
          <div className={styles.draftActions}>
            <button className={styles.ghostButton} ref={draftsButtonRef} type="button" aria-expanded={draftsOpen} aria-controls={draftsOpen ? "writer-drafts" : undefined} disabled={busy || saving || uploading} onClick={() => setDraftsOpen(!draftsOpen)}>임시글 {localDraftCount}</button>
            <button className={styles.ghostButton} type="button" disabled={busy || saving || uploading} onClick={() => void newDraft()}><WriterIcon name="plus" />새 글</button>
            {draftsOpen && <WriterDraftList draft={draft} drafts={drafts} busy={busy} saving={saving} uploading={uploading} deletingId={deletingId} loadDraft={loadDraft} deleteDraft={deleteDraft} setDraftsOpen={setDraftsOpen} />}
          </div>
        </div>
      </header>

      {(connection === "loading" || notice || error || published) && (
        <div className={styles.feedback}>
          {connection === "loading" && <p className={styles.connectionMessage} role="status">글쓰기 공간을 준비하고 있습니다.</p>}
          {notice && <div className={styles.notice} role="status"><p>{notice}</p>{connection === "unavailable" && <button type="button" onClick={reconnect}>다시 연결</button>}</div>}
          {error && <div className={styles.error} role="alert"><p>{error}</p>{pendingCommit && <p>작성한 글은 이 컴퓨터에 보관되어 있습니다. {action} 재시도로 배포 요청을 다시 보낼 수 있습니다.</p>}{connection === "unavailable" && <button type="button" onClick={reconnect}>다시 연결</button>}</div>}
          {published && <div className={styles.success} role="status"><WriterIcon name="check" /><div><strong>{published.wasEditing ? "수정을 요청했습니다." : "발행을 요청했습니다."}</strong><p>자동 배포가 끝나면 <a href={new URL(published.url, "https://dijeungi.github.io").href} target="_blank" rel="noreferrer">글 주소에서 확인</a>할 수 있습니다.</p></div><a className={styles.deployLink} href="https://github.com/dijeungi/dijeungi.github.io/actions" target="_blank" rel="noreferrer">배포 확인 ↗</a></div>}
        </div>
      )}

      <main className={styles.workspace}>
        <section className={styles.inputPane} aria-label="마크다운 글 작성">
          <div className={styles.paneLabel}>마크다운</div>
          <div className={styles.paperHeading}>
            <label className={styles.srOnly} htmlFor="post-category">카테고리</label>
            <input id="post-category" className={styles.categoryInput} type="text" placeholder="카테고리" maxLength={60} value={draft?.category || ""} disabled={busy || !draft} onChange={(event) => updateDraft({ category: event.target.value })} />
            <label className={styles.srOnly} htmlFor="post-title">글 제목</label>
            <textarea id="post-title" ref={titleRef} className={styles.titleInput} placeholder="제목을 입력하세요" rows={1} maxLength={200} value={draft?.title || ""} disabled={busy || !draft} onChange={(event) => changeTitle(event.target.value.replace(/\n/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById("post-subtitle")?.focus(); } }} />
            <label className={styles.srOnly} htmlFor="post-subtitle">부제목, 필수 입력</label>
            <textarea id="post-subtitle" className={styles.subtitleInput} placeholder="부제목을 입력하세요" rows={1} required maxLength={500} value={draft?.subtitle || ""} disabled={busy || !draft} onChange={(event) => updateDraft({ subtitle: event.target.value.replace(/\n/g, "") })} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); textareaRef.current?.focus(); } }} />
          </div>
          <WriterToolbar busy={busy || !draft} uploading={uploading} insertMarkdown={insertMarkdown} uploadInlineImage={uploadInlineImage} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
          <label className={styles.srOnly} htmlFor="post-markdown">마크다운 본문</label>
          <textarea id="post-markdown" className={styles.markdownInput} ref={textareaRef} placeholder="마크다운으로 이야기를 기록해 보세요." spellCheck={false} value={markdown} disabled={busy || !draft} aria-invalid={Boolean(bodyError)} aria-describedby={bodyError ? "writer-body-error" : undefined} onChange={(event) => changeMarkdown(event.target.value)} onKeyDown={onMarkdownKeyDown} onSelect={onMarkdownSelect} />
          {bodyError && <p className={styles.bodyError} id="writer-body-error" role="alert">{bodyError}</p>}
        </section>
        <WriterPreview key={draft?.id ?? "new"} draft={draft} />
      </main>

      <footer className={styles.statusBar}>
        <div className={styles.statusGroup}>
          <button className={styles.ghostButton} type="button" disabled={leaveDisabled} onClick={() => void leaveWriter()}><WriterIcon name="back" />나가기</button>
          <span className={styles.characterCount}>{markdown.length.toLocaleString()}자</span>
          <span className={styles.saveStatus} aria-live="polite">{status}</span>
        </div>
        <div className={styles.primaryActions}>
          <button className={styles.secondaryButton} type="button" disabled={actionDisabled} onClick={() => void saveDraft()}>{saving ? "저장 중" : "임시저장"}</button>
          <button className={styles.primaryButton} type="button" disabled={actionDisabled} onClick={() => void publish()}>{actionLabel}</button>
        </div>
      </footer>

      <dialog className={styles.confirmDialog} ref={dialogRef} aria-labelledby="writer-confirm-title" aria-describedby="writer-confirm-message" onCancel={(event) => { event.preventDefault(); respondToConfirmation(false); }}>
        {confirmation && (
          <>
            <h2 id="writer-confirm-title">{confirmation.title}</h2>
            <p id="writer-confirm-message">{confirmation.message}</p>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" data-cancel-confirmation autoFocus onClick={() => respondToConfirmation(false)}>{confirmation.destructive ? "취소" : "계속 작성"}</button>
              <button className={confirmation.destructive ? styles.destructiveButton : styles.primaryButton} type="button" onClick={() => respondToConfirmation(true)}>{confirmation.confirmLabel}</button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
