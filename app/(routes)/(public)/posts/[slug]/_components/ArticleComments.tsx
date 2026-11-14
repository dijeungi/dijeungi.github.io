"use client";

import { useArticleComments } from "../_hooks/useArticleComments";

import styles from "../ArticleComments.module.css";

// 본문 하단의 GitHub 댓글과 연결 실패 안내
export function ArticleComments({ slug }: { slug: string }) {
  const { containerRef, loadFailed } = useArticleComments(slug);

  return (
    <section className={styles.comments} aria-labelledby="comments-title">
      <div className={styles.heading}>
        <h2 id="comments-title">댓글</h2>
        <a href="https://github.com/dijeungi/dijeungi.github.io/discussions" target="_blank" rel="noreferrer">GitHub에서 보기 ↗</a>
      </div>
      {loadFailed && (
        <p className={styles.feedback} role="status">댓글을 불러오지 못했습니다. GitHub에서 댓글을 확인해 주세요.</p>
      )}
      <div className={styles.embed} ref={containerRef} />
    </section>
  );
}
