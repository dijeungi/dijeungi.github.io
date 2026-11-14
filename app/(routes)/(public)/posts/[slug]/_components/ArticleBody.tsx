import { ArticleRichContent } from "./ArticleRichContent";

import styles from "../PostDetail.module.css";

import type { ArticleBodyProps } from "../_types/reader";

// 편집 본문과 코드 복사 결과 표시
export function ArticleBody({ post, copyCode, contentRef, codeStatuses }: ArticleBodyProps) {
  return (
    <article id="article-content" className={styles.content} ref={contentRef} aria-labelledby="article-title">
      <ArticleRichContent document={post.document} copyCode={copyCode} codeStatuses={codeStatuses} />
    </article>
  );
}
