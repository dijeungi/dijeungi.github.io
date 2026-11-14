import Link from "next/link";

import { siteName } from "@/app/shared/constants/site";

import styles from "./SiteBrand.module.css";

import type { SiteBrandProps } from "@/app/shared/types/site";

// 메인과 상세에서 같은 타이포그래피를 사용하는 브랜드 링크
export function SiteBrand({ className }: SiteBrandProps) {
  return (
    <Link className={styles.brand + (className ? " " + className : "")} href="/">
      <span className={styles.label}>{siteName}</span>
    </Link>
  );
}
