import Link from "next/link";

import { WriterIcon } from "./WriterIcon";

import styles from "./WriteButton.module.css";

// 로컬에서만 표시하는 글쓰기 진입 버튼
export function WriteButton() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <Link className={styles.button} href="/write/" aria-label="글쓰기">
      <WriterIcon className={styles.icon} name="plus" width={24} height={24} />
    </Link>
  );
}
