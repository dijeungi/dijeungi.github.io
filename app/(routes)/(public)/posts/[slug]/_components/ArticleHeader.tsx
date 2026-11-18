import { SiteBrand } from "@/app/shared/components/SiteBrand";
import { SiteHeader } from "@/app/shared/components/SiteHeader";

import styles from "../PostDetail.module.css";

import type { ArticleHeaderProps } from "../_types/reader";

// 같은 시작 위치에서 전환되는 글 읽기 헤더
export function ArticleHeader({
  title,
  progress,
  isReading,
  scrollToTop,
  headerRef,
}: ArticleHeaderProps) {
  return (
    <SiteHeader
      headerRef={headerRef}
      className={isReading ? styles.readerHeader + " " + styles.reading : styles.readerHeader}
      brand={
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
      }
    >
      <div
        aria-hidden="true"
        className={styles.progress}
        style={{ transform: "scaleX(" + progress / 100 + ")" }}
      />
    </SiteHeader>
  );
}
