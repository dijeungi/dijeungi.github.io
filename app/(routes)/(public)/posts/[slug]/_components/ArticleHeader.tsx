import { ShareIcon } from "./ShareIcon";
import { SiteBrand } from "@/app/shared/components/SiteBrand";

import styles from "../PostDetail.module.css";
import frameStyles from "@/app/shared/styles/PageFrame.module.css";

import type { ArticleHeaderProps } from "../_types/reader";

// 같은 시작 위치에서 전환되는 글 읽기 헤더
export function ArticleHeader({
  title,
  progress,
  isReading,
  copyLink,
  scrollToTop,
  headerRef,
  shareStatus,
}: ArticleHeaderProps) {
  return (
    <header
      ref={headerRef}
      className={isReading ? styles.readerHeader + " " + styles.reading : styles.readerHeader}
    >
      <div className={styles.headerInner + " " + frameStyles.content}>
        <div className={styles.headerTitles}>
          <SiteBrand className={styles.brand} />
          <button
            className={styles.currentTitle}
            type="button"
            aria-label={title + ", 페이지 맨 위로 이동"}
            onClick={scrollToTop}
          >
            {title}
          </button>
        </div>
        <button
          className={styles.shareButton}
          type="button"
          disabled={shareStatus === "copying"}
          aria-label={shareStatus === "success" ? "글 링크 복사 완료" : "글 링크 복사"}
          onClick={() => void copyLink()}
        >
          <ShareIcon />
        </button>
      </div>
      <p className={shareStatus === "error" ? styles.shareFeedback : styles.srOnly} role="status">
        {shareStatus === "success" && "글 링크를 복사했습니다."}
        {shareStatus === "error" && "링크를 복사하지 못했습니다. 주소창의 주소를 직접 복사해 주세요."}
      </p>
      <div
        aria-hidden="true"
        className={styles.progress}
        style={{ transform: "scaleX(" + progress / 100 + ")" }}
      />
    </header>
  );
}
