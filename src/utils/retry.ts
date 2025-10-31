export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? 3);
  const delayMs = Math.max(0, opts?.delayMs ?? 100);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1 && delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
