"use client";

import { useEffect, useRef } from "react";

export function FundDetailStabilityProbe({ fundCode }: { fundCode: string }) {
  const renderCountRef = useRef(0);
  const lastHeightRef = useRef(0);
  const lastYRef = useRef(0);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    renderCountRef.current += 1;
    const doc = document.documentElement;
    const body = document.body;
    const h = Math.max(doc?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
    const y = window.scrollY;
    console.info(
      `[fund-detail-stability] code=${fundCode} render=${renderCountRef.current} height=${h} scrollY=${Math.round(y)}`
    );
  });

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const readHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    lastHeightRef.current = readHeight();
    lastYRef.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastYRef.current) < 2) return;
      console.info(`[fund-detail-stability-scroll] code=${fundCode} from=${Math.round(lastYRef.current)} to=${Math.round(y)}`);
      lastYRef.current = y;
    };
    const observer = new ResizeObserver(() => {
      const next = readHeight();
      if (Math.abs(next - lastHeightRef.current) < 2) return;
      console.info(
        `[fund-detail-stability-height] code=${fundCode} from=${lastHeightRef.current} to=${next} scrollY=${Math.round(window.scrollY)}`
      );
      lastHeightRef.current = next;
    });
    observer.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [fundCode]);

  return null;
}

