"use client";

import Link from "next/link";
import Image from "next/image";
import { EditorContent } from "@tiptap/react";

import { WriterIcon } from "./WriterIcon";
import { WriterToolbar } from "./WriterToolbar";
import { usePostWriter } from "../_hooks/usePostWriter";
import { siteName } from "@/app/shared/constants/site";
import { toArticlePost } from "@/app/shared/lib/content";
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
          <Link className={styles.brand} href="/">{siteName}</Link>
          <span className={styles.headerDivider} />
          <span className={styles.headerLabel}>글쓰기</span>
          <span className={styles.headerStatus} aria-live="polite">{status}</span>
          <div className={styles.headerActions}>
            <button type="button" className={styles.ghostButton} disabled={!draft?.title.trim() || publishing || uploading} onClick={writer.showPreview}><WriterIcon name="eye" /><span>미리보기</span></button>
            <button type="button" className={styles.secondaryButton} disabled={busy || saving || uploading} onClick={() => void writer.saveDraft()}>{saving ? "저장 중" : "임시저장"}</button>
            <button type="button" className={styles.primaryButton} disabled={busy || saving || uploading} onClick={() => void writer.publish()}><WriterIcon name="upload" />{publishing ? "발행 중" : pendingCommit ? "발행 재시도" : "발행"}</button>
          </div>
        </div>
      </header>

      <main className={styles.workspace}>
        <div className={styles.pageIntro}>
          <div><p className={styles.eyebrow}>YOUR NEXT ARTICLE</p><h1>생각을 글로 남겨보세요.</h1><p className={styles.introDescription}>작은 발견도 좋은 기록의 시작이 됩니다.</p></div>
          <button type="button" className={styles.newButton} disabled={busy || saving || uploading} onClick={() => void writer.newDraft()}><WriterIcon name="plus" />새 글</button>
        </div>

        {writer.connection === "loading" && <p className={styles.connectionMessage} role="status">글쓰기 공간을 준비하고 있습니다.</p>}
        {writer.notice && <div className={styles.notice} role="status"><p>{writer.notice}</p>{writer.connection === "unavailable" && <button type="button" onClick={writer.reconnect}>다시 연결</button>}</div>}
        {writer.error && <div className={styles.error} role="alert"><p>{writer.error}</p>{pendingCommit && <p>작성한 글은 이 컴퓨터에 보관되어 있습니다. 발행 재시도로 배포 요청을 다시 보낼 수 있습니다.</p>}{writer.connection === "unavailable" && <button type="button" onClick={writer.reconnect}>다시 연결</button>}</div>}
        {published && <div className={styles.success} role="status"><WriterIcon name="check" /><div><strong>발행을 요청했습니다.</strong><p>자동 배포가 끝나면 <a href={new URL(published.url, "https://dijeungi.github.io").href} target="_blank" rel="noreferrer">글 주소에서 확인</a>할 수 있습니다.</p></div><a className={styles.deployLink} href="https://github.com/dijeungi/dijeungi.github.io/actions" target="_blank" rel="noreferrer">배포 확인 ↗</a></div>}

        <div className={styles.columns}>
          <section className={styles.paper} aria-label="글 작성">
            <div className={styles.paperHeading}>
              <p className={styles.draftLabel}>{draft?.category || "개발 기록"}</p>
              <label className={styles.srOnly} htmlFor="post-title">글 제목</label>
              <textarea id="post-title" className={styles.titleInput} placeholder="제목을 입력하세요" rows={2} maxLength={200} value={draft?.title || ""} disabled={busy} onChange={(event) => writer.changeTitle(event.target.value.replace(/\n/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); editor?.commands.focus("start"); } }} />
            </div>
            <WriterToolbar {...writer} />
            <div className={styles.editorSurface}><EditorContent editor={editor} /></div>
            <footer className={styles.paperFooter}><span>{(writer.selection?.characters || 0).toLocaleString()}자</span><span aria-live="polite">{uploading ? "이미지 업로드 중" : status}</span></footer>
          </section>

          <aside className={styles.sidebar} aria-label="글 설정">
            <section className={styles.settingsCard}>
              <h2>글 설정</h2>
              <label className={styles.field}><span>카테고리</span><input type="text" placeholder="예: React" maxLength={60} value={draft?.category || ""} disabled={busy} onChange={(event) => writer.updateDraft({ category: event.target.value })} /></label>
              <label className={styles.field}><span>글 주소</span><div className={styles.slugField}><span>/posts/</span><input type="text" placeholder="my-first-post" spellCheck={false} maxLength={96} value={draft?.slug || ""} disabled={busy} onChange={(event) => writer.changeSlug(event.target.value)} /></div><small>제목에서 자동으로 만들며 직접 수정할 수 있습니다.</small></label>
              <div className={styles.fieldRow}>
                <label className={styles.field}><span>게시일</span><input type="date" value={draft?.date || ""} disabled={busy} onChange={(event) => writer.updateDraft({ date: event.target.value })} /></label>
                <label className={styles.field}><span>읽는 시간</span><div className={styles.numberField}><input type="number" min={0} max={240} step={1} value={draft?.readingMinutes || ""} placeholder="자동" disabled={busy} onChange={(event) => writer.updateDraft({ readingMinutes: Number(event.target.value) || 0 })} /><span>분</span></div></label>
              </div>
              <label className={styles.field}><span>검색용 설명</span><textarea rows={3} maxLength={300} placeholder="검색과 공유 미리보기에 사용할 짧은 설명" value={draft?.description || ""} disabled={busy} onChange={(event) => writer.updateDraft({ description: event.target.value })} /><small>글 상단에는 표시되지 않습니다.</small></label>
            </section>

            <section className={styles.settingsCard}>
              <h2>대표 이미지 <span>선택</span></h2>
              {draft?.heroImage ? (
                <div className={styles.heroEditor}>
                  <Image src={draft.heroImage.src} alt={draft.heroImage.alt} width={draft.heroImage.width} height={draft.heroImage.height} unoptimized />
                  <button className={styles.removeImage} type="button" title="대표 이미지 제거" aria-label="대표 이미지 제거" disabled={busy} onClick={() => writer.updateDraft({ heroImage: undefined })}><WriterIcon name="close" /></button>
                </div>
              ) : <label className={styles.imageDrop + (busy || uploading ? " " + styles.disabledDrop : "")}><input className={styles.srOnly} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="대표 이미지 선택" disabled={busy || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void writer.uploadHeroImage(file); event.currentTarget.value = ""; }} /><WriterIcon name="image" /><strong>{uploading ? "업로드 중" : "이미지 선택"}</strong><span>JPG, PNG, WebP, GIF</span></label>}
              {draft?.heroImage && <label className={styles.field}><span>이미지 설명</span><input type="text" value={draft.heroImage.alt} maxLength={300} disabled={busy} onChange={(event) => writer.updateDraft({ heroImage: draft.heroImage ? { ...draft.heroImage, alt: event.target.value } : undefined })} /></label>}
            </section>

            <section className={styles.settingsCard}>
              <h2>저장된 글 <span>{writer.drafts.length}</span></h2>
              {writer.drafts.length ? <ul className={styles.draftList}>{writer.drafts.map((item) => <li key={item.id}><button type="button" className={item.id === draft?.id ? styles.activeDraft : ""} disabled={busy || saving || uploading} onClick={() => void writer.loadDraft(item.id)}><span>{item.title || "제목 없는 글"}</span><small>{new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(item.updatedAt))}</small></button></li>)}</ul> : <p className={styles.emptyDrafts}>임시저장한 글이 여기에 모입니다.</p>}
              <p className={styles.localHint}>작성 중인 글과 이미지는 이 컴퓨터에 저장됩니다.</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
