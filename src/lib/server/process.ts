import { spawn } from 'node:child_process';
import { ServiceError } from './errors.js';

export async function commandAvailable(bin: string, args = ['--version']): Promise<boolean> {
  try { await runCommand(bin, args, { timeout: 5000 }); return true; } catch { return false; }
}

export function runCommand(bin: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let failed = false;
    const fail = (error: ServiceError) => { if (!failed) { failed = true; reject(error); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new ServiceError('DOWNLOAD_TIMEOUT', '音樂服務處理超時，請稍後重試。', 504));
    }, options.timeout || 180_000);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.length > 4 * 1024 * 1024) {
        child.kill('SIGKILL');
        fail(new ServiceError('OUTPUT_LIMIT', '平台回傳的資料過大，請縮小歌單範圍。', 502));
      }
    });
    // Upstream logs can contain cookies, tokens and private file paths. Never expose them.
    child.stderr.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      fail(new ServiceError('TOOL_MISSING', '下載適配器尚未安裝，請參考部署說明。', 503));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) fail(new ServiceError('ADAPTER_FAILED', '下載適配器失敗，請檢查登入狀態、訂閱權限與服務端配置。', 502));
      else resolve(output);
    });
  });
}
