import { Html, Head, Main, NextScript } from "next/document";

/**
 * `src/pages` klasörü Next dev izleyicisi için mevcut olmalı (ENOENT / 500 önlemi).
 * Uygulama rotaları `src/app` altındadır; burada yalnızca Pages kökü tanımlıdır.
 */
export default function Document() {
  return (
    <Html lang="tr">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
