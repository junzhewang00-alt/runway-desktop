/** IPC handler 超时包装器（从 main/index.ts 提取） */
export function withIpcTimeout<T>(
  handler: (...args: any[]) => Promise<T>,
  timeoutMs = 10_000,
): (...args: any[]) => Promise<T> {
  return (...args: any[]) => {
    return Promise.race([
      handler(...args),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('IPC timeout')), timeoutMs),
      ),
    ])
  }
}
