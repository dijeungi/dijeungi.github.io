"use client";

import { EditorContent } from "@tiptap/react";

import { WriterIcon } from "./WriterIcon";
import { WriterToolbar } from "./WriterToolbar";
import { usePostWriter } from "../_hooks/usePostWriter";
import { toArticlePost } from "@/app/shared/lib/content";
import { SiteBrand } from "@/app/shared/components/SiteBrand";
import { ArticleReader } from "../../posts/[slug]/_components/ArticleReader";

import styles from "../Write.module.css";

const saveTimeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

// 로컬 글 작성 화면과 실제 상세 미리보기
export function PostWriter() {
  const writer = usePostWriter();
  const { draft, editor, busy, saving, publishing, uploading, published, pendingCommit } = writer;
  const status = publishing ? "발행 요청 중" : saving ? "저장 중" : writer.dirty ? "저장하지 않은 변경" : writer.lastSavedAt ? saveTimeFormatter.format(new Date(writer.lastSavedAt)) + " 저장됨" : "아직 저장하지 않음";

  if (writer.preview && draft) {
    return (
      <>
        <div className={styles.previewActions}><button type="button" className={styles.primaryButton} onClick={writer.closePreview}><WriterIcon name="back" />편집으로 돌아가기</button><span>미리보기</span></div>
        <ArticleReader post={toArticlePost(draft)} />
      </>
    );
  }

  return (
    <div className={styles.writer}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <SiteBrand />
          <span className={styles.headerStatus} aria-live="polite">{status}</span>
          <div className={styles.headerActions}>
            <button type="button" className={styles.ghostButton} disabled={!draft?.title.trim() || publishing || uploading} onClick={writer.showPreview}><WriterIcon name="eye" /><span>미리보기</span></button>
            <button type="button" className={styles.secondaryButton} disabled={busy || saving || uploading} onClick={() => void writer.saveDraft()}>{saving ? "저장 중" : "임시저장"}</button>
            <button type="button" className={styles.primaryButton} disabled={busy || saving || uploading} onClick={() => void writer.publish()}><WriterIcon name="upload" />{publishing ? "발행 중" : pendingCommit ? "발행 재시도" : "발행"}</button>
          </div>
        </div>
      </header>

      <main className={styles.workspace}>
        <div className={styles.draftActions}>
          <h1 className={styles.srOnly}>글쓰기</h1>
          <select
            className={styles.draftSelect}
            aria-label="저장한 글 불러오기"
            value={draft?.id || ""}
            disabled={busy || saving || uploading}
            onChange={(event) => void writer.loadDraft(event.target.value)}
          >
            {!draft && <option value="">저장한 글 불러오기</option>}
            {draft && !writer.drafts.some((item) => item.id === draft.id) && <option value={draft.id}>{draft.title || "새 글"}</option>}
            {writer.drafts.map((item) => <option key={item.id} value={item.id}>{item.title || "제목 없는 글"}</option>)}
          </select>
          <button type="button" className={styles.newButton} disabled={busy || saving || uploading} onClick={() => void writer.newDraft()}><WriterIcon name="plus" />새 글</button>
        </div>

        {writer.connection === "loading" && <p className={styles.connectionMessage} role="status">글쓰기 공간을 준비하고 있습니다.</p>}
        {writer.notice && <div className={styles.notice} role="status"><p>{writer.notice}</p>{writer.connection === "unavailable" && <button type="button" onClick={writer.reconnect}>다시 연결</button>}</div>}
        {writer.error && <div className={styles.error} role="alert"><p>{writer.error}</p>{pendingCommit && <p>작성한 글은 이 컴퓨터에 보관되어 있습니다. 발행 재시도로 배포 요청을 다시 보낼 수 있습니다.</p>}{writer.connection === "unavailable" && <button type="button" onClick={writer.reconnect}>다시 연결</button>}</div>}
        {published && <div className={styles.success} role="status"><WriterIcon name="check" /><div><strong>발행을 요청했습니다.</strong><p>자동 배포가 끝나면 <a href={new URL(published.url, "https://dijeungi.github.io").href} target="_blank" rel="noreferrer">글 주소에서 확인</a>할 수 있습니다.</p></div><a className={styles.deployLink} href="https://github.com/dijeungi/dijeungi.github.io/actions" target="_blank" rel="noreferrer">배포 확인 ↗</a></div>}

        <section className={styles.paper} aria-label="글 작성">
          <div className={styles.paperHeading}>
            <label className={styles.srOnly} htmlFor="post-category">카테고리</label>
            <input id="post-category" className={styles.categoryInput} type="text" placeholder="카테고리" maxLength={60} value={draft?.category || ""} disabled={busy} onChange={(event) => writer.updateDraft({ category: event.target.value })} />
            <label className={styles.srOnly} htmlFor="post-title">글 제목</label>
            <textarea id="post-title" className={styles.titleInput} placeholder="제목을 입력하세요" rows={1} maxLength={200} value={draft?.title || ""} disabled={busy} onChange={(event) => writer.changeTitle(event.target.value.replace(/\n/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById("post-subtitle")?.focus(); } }} />
            <label className={styles.srOnly} htmlFor="post-subtitle">부제목, 선택 입력</label>
            <textarea id="post-subtitle" className={styles.subtitleInput} placeholder="부제목을 입력하세요 (선택)" rows={1} maxLength={500} value={draft?.subtitle || ""} disabled={busy} onChange={(event) => writer.updateDraft({ subtitle: event.target.value.replace(/\n/g, "") })} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); editor?.commands.focus("start"); } }} />
          </div>
          <WriterToolbar {...writer} />
          <div className={styles.editorSurface}><EditorContent editor={editor} /></div>
          <footer className={styles.paperFooter}><span>{(writer.selection?.characters || 0).toLocaleString()}자</span><span aria-live="polite">{uploading ? "이미지 업로드 중" : status}</span></footer>
        </section>
      </main>
    </div>
  );
}
