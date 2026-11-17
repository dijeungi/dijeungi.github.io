import styles from "../Write.module.css";

import type { WriterDraftListProps } from "../_types/writer";

const draftDateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

// 로컬 임시글과 게시한 글의 편집 목록 및 임시글 삭제 표시
export function WriterDraftList({ draft, drafts, busy, saving, uploading, deletingId, loadDraft, deleteDraft, setDraftsOpen }: WriterDraftListProps) {
  const disabled = busy || saving || uploading || Boolean(deletingId);
  const localDrafts = drafts.filter((item) => item.isLocalDraft !== false);
  const publishedDrafts = drafts.filter((item) => item.isLocalDraft === false);
  const groups = [{ label: "임시글", items: localDrafts }, { label: "게시한 글 편집", items: publishedDrafts }];

  return (
    <section className={styles.draftPanel} id="writer-drafts" aria-label="저장한 글">
      <header className={styles.draftPanelHeader}>
        <h2>저장한 글</h2>
        <button className={styles.ghostButton} type="button" onClick={() => setDraftsOpen(false)}>닫기</button>
      </header>
      {drafts.length === 0 ? <p className={styles.draftEmpty}>저장한 임시글이 없습니다.</p> : groups.map((group) => group.items.length > 0 && (
        <div className={styles.draftGroup} key={group.label}>
          <h3>{group.label} <span>{group.items.length}</span></h3>
          {group.items.map((item) => (
            <div className={styles.draftRow} key={item.id} data-current={item.id === draft?.id}>
              <button className={styles.draftLoad} type="button" title={item.title || "제목 없는 글"} aria-label={(item.title || "제목 없는 글") + " 불러오기"} aria-current={item.id === draft?.id ? "true" : undefined} disabled={disabled} onClick={() => void loadDraft(item.id)}>
                <span className={styles.draftName}>{item.title || "제목 없는 글"}</span>
                <time className={styles.draftDate} dateTime={item.updatedAt}>{draftDateFormatter.format(new Date(item.updatedAt))}</time>
              </button>
              {item.isLocalDraft === true && <button className={styles.deleteButton} type="button" aria-label={(item.title || "제목 없는 글") + " 임시글 삭제"} disabled={disabled} onClick={() => void deleteDraft(item.id)}>{deletingId === item.id ? "삭제 중" : "삭제"}</button>}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
