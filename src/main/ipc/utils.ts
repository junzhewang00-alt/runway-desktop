/** IPC handler 超时包装器（从 main/index.ts 提取）
 *  @note 参数使用 any[] 是因为不同 IPC handler 签名各异，
 *        无法用泛型约束。Electron 的 ipcMain.handle 本身也不做参数类型校验。 */
export function withIpcTimeout<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<T>,
  timeoutMs = 10_000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (...args: any[]) => Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...args: any[]) => {
    return Promise.race([
      handler(...args),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('IPC timeout')), timeoutMs),
      ),
    ])
  }
}
