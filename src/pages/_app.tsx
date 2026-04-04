import type { AppProps } from "next/app";

/**
 * Pages Router kökü — gerçek sayfalar `src/app` içindedir.
 */
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
