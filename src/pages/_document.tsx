import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="tr">
      <Head>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              *, *::before, *::after { box-sizing: border-box; }
              body { margin: 0; background: #fdfdfb; color: #0c1628; }
              html[data-theme="dark"] body { background: #0f1419; color: #e8eaed; }
            `,
          }}
        />
      </Head>
      <body
        style={{
          background: "var(--bg-base, #fdfdfb)",
          color: "var(--text-primary, #0c1628)",
        }}
      >
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
