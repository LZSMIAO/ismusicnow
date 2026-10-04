import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/lib/ui.js';

test('代理的 HTML 錯誤頁顯示可重試的錯誤，保留 API 的具體錯誤', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response('<!DOCTYPE html><title>Gateway Timeout</title>', { status: 504 }));
  await assert.rejects(api('/api/resolve'), { message: '音樂服務回應超時，請稍後重試。' });
  fetchMock.mock.mockImplementation(async () => Response.json({ message: '帳號未提供此音質。' }, { status: 403 }));
  await assert.rejects(api('/api/resolve'), { message: '帳號未提供此音質。' });
  fetchMock.mock.mockImplementation(async () => Response.json({ ready: true }));
  assert.deepEqual(await api('/api/status'), { ready: true });
});
