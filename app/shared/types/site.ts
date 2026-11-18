import type { ReactNode, Ref } from "react";

export type SiteBrandProps = { className?: string };

export type SiteHeaderProps = {
  brand?: ReactNode;
  children?: ReactNode;
  className?: string;
  headerRef?: Ref<HTMLElement>;
};
