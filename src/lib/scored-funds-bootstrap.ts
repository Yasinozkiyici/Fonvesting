export function shouldStopBootstrapRetries(attemptCount: number, maxRetry: number): boolean {
  return attemptCount >= maxRetry;
}
