"use client";

import { useArticleComments } from "../_hooks/useArticleComments";

import styles from "../ArticleComments.module.css";

// 본문 하단의 GitHub 댓글과 연결 실패 안내
export function ArticleComments({ slug }: { slug: string }) {
  const { containerRef, loadFailed } = useArticleComments(slug);

  return (
    <section className={styles.comments} aria-label="댓글">
      {loadFailed && (
        <p className={styles.feedback} role="status">댓글을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>
      )}
      <div className={styles.embed} ref={containerRef} />
    </section>
  );
}
