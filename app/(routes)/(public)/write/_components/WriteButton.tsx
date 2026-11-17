import Link from "next/link";

import { WriterIcon } from "./WriterIcon";

import styles from "./WriteButton.module.css";

// 로컬에서만 표시하는 글쓰기와 현재 글 수정 진입 버튼
export function WriteButton({ postSlug }: { postSlug?: string }) {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className={styles.actions} role="group" aria-label="글 관리">
      {postSlug && (
        <Link className={styles.button} href={"/write/?post=" + encodeURIComponent(postSlug)} aria-label="이 글 수정" title="이 글 수정">
          <WriterIcon className={styles.icon} name="edit" width={24} height={24} />
        </Link>
      )}
      <Link className={styles.button} href="/write/" aria-label="글쓰기" title="글쓰기">
        <WriterIcon className={styles.icon} name="plus" width={24} height={24} />
      </Link>
    </div>
  );
}
