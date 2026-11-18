import { LuArrowUpRight } from "react-icons/lu";

import { SiteBrand } from "./SiteBrand";
import { ThemeToggle } from "./ThemeToggle";
import { githubProfileUrl, linkedInProfileUrl } from "@/app/shared/constants/site";

import styles from "./SiteHeader.module.css";
import frameStyles from "@/app/shared/styles/PageFrame.module.css";

import type { SiteHeaderProps } from "@/app/shared/types/site";

// 홈과 상세의 공통 내비게이션
export function SiteHeader({ brand = <SiteBrand />, children, className, headerRef }: SiteHeaderProps) {
  return (
    <header className={styles.header + (className ? " " + className : "")} ref={headerRef}>
      <div className={styles.inner + " " + frameStyles.content}>
        {brand}
        <div className={styles.actions}>
          <nav className={styles.socialLinks} aria-label="개발자 프로필">
            <a
              className={styles.socialLink}
              href={githubProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 프로필, 새 탭에서 열기"
            >
              GitHub
              <LuArrowUpRight className={styles.externalLinkIcon} size={12} aria-hidden="true" focusable="false" />
            </a>
            <a
              className={styles.socialLink}
              href={linkedInProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn 프로필, 새 탭에서 열기"
            >
              LinkedIn
              <LuArrowUpRight className={styles.externalLinkIcon} size={12} aria-hidden="true" focusable="false" />
            </a>
          </nav>
          <span className={styles.separator} aria-hidden="true" />
          <ThemeToggle />
        </div>
      </div>
      {children}
    </header>
  );
}
