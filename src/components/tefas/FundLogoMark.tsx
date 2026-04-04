"use client";

import { useState, type CSSProperties } from "react";

type FundLogoMarkProps = {
  code: string;
  logoUrl: string | null;
  wrapperClassName: string;
  wrapperStyle?: CSSProperties;
  imgClassName: string;
  initialsClassName?: string;
};

/** Yüklenemeyen faviconlarda otomatik olarak fon kodu kısaltmasına düşer. */
export function FundLogoMark({
  code,
  logoUrl,
  wrapperClassName,
  wrapperStyle,
  imgClassName,
  initialsClassName,
}: FundLogoMarkProps) {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(logoUrl) && !failed;
  const initials = code.slice(0, 2).toUpperCase();

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      {showImg ? (
        <img
          src={logoUrl!}
          alt=""
          className={imgClassName}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={initialsClassName}>{initials}</span>
      )}
    </div>
  );
}
