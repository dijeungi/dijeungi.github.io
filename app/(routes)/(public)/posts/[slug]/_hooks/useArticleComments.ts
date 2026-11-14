"use client";

import { useRef, useState, useEffect } from "react";

import { getResolvedTheme, subscribeTheme } from "@/app/shared/hooks/useTheme";

// 글별 GitHub 댓글 위젯 연결과 화면 해제 관리
export function useArticleComments(slug: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const widget = document.createElement("giscus-widget");
    const attributes = {
      id: "github-comments",
      repo: "dijeungi/dijeungi.github.io",
      repoid: "R_kgDOVt2dfw",
      category: "Announcements",
      categoryid: "DIC_kwDOVt2df84DLH1Y",
      mapping: "specific",
      term: "posts/" + slug + "/",
      strict: "1",
      reactionsenabled: "0",
      emitmetadata: "0",
      inputposition: "top",
      theme: getResolvedTheme(),
      lang: "ko",
      loading: "lazy",
    };

    for (const [name, value] of Object.entries(attributes)) {
      widget.setAttribute(name, value);
    }

    container.appendChild(widget);
    const unsubscribeTheme = subscribeTheme(() => {
      widget.setAttribute("theme", getResolvedTheme());
    });

    let loader = document.getElementById("giscus-component-loader");

    // 댓글 라이브러리 연결 실패 안내
    function handleLoadError() {
      setLoadFailed(true);
      loader?.remove();
    }

    if (!customElements.get("giscus-widget")) {
      if (!loader) {
        const script = document.createElement("script");
        script.id = "giscus-component-loader";
        script.type = "module";
        script.src = "https://esm.sh/giscus@1.6.0?bundle";
        loader = script;
        document.head.appendChild(script);
      }

      loader.addEventListener("error", handleLoadError);
    }

    return () => {
      unsubscribeTheme();
      loader?.removeEventListener("error", handleLoadError);
      widget.remove();
    };
  }, [slug]);

  return { containerRef, loadFailed };
}
