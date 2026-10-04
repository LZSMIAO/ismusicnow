import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceIsLandscape, mountDeviceOrientation } from '../src/lib/device-orientation.js';
test('portrait keyboard resize does not switch to the compact landscape toolbar; real rotation does', () => {
  const handlers = new Map<string, () => void>();
  const orientation = { type: 'portrait-primary', addEventListener: (name: string, fn: () => void) => handlers.set(name, fn), removeEventListener: (name: string) => handlers.delete(name) };
  const view = { innerWidth: 390, innerHeight: 844, screen: { width: 390, height: 844, orientation }, addEventListener: (name: string, fn: () => void) => handlers.set(name, fn), removeEventListener: (name: string) => handlers.delete(name) };
  const classes = new Set<string>();
  const root = { classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name), remove: (name: string) => classes.delete(name) } };
  const typed = view as unknown as Parameters<typeof deviceIsLandscape>[0];
  const stop = mountDeviceOrientation(typed, root as unknown as HTMLElement);
  view.innerHeight = 300;
  assert.ok(view.innerWidth > view.innerHeight); assert.equal(deviceIsLandscape(typed), false); assert.equal(classes.has('device-landscape'), false);
  orientation.type = 'landscape-primary'; handlers.get('change')!(); assert.equal(classes.has('device-landscape'), true);
  stop(); assert.equal(handlers.size, 0); assert.equal(classes.size, 0);
});
test('older iOS uses the physical orientation angle rather than keyboard viewport dimensions', () => {
  const view = { orientation: 0, innerWidth: 390, innerHeight: 300, screen: { width: 390, height: 844 } } as unknown as Parameters<typeof deviceIsLandscape>[0];
  assert.equal(deviceIsLandscape(view), false); view.orientation = 90; assert.equal(deviceIsLandscape(view), true);
});
