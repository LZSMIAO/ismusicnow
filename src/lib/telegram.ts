/** Telegram SDK stays optional: the same app also runs in ordinary browsers. */
export interface TelegramBridge {
  initData: string; viewportHeight: number; viewportStableHeight: number;
  safeAreaInset?: Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>;
  contentSafeAreaInset?: TelegramBridge['safeAreaInset'];
  ready(): void; expand(): void; isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void; setBackgroundColor(color: string): void; setBottomBarColor?(color: string): void;
  onEvent(name: string, callback: () => void): void; offEvent(name: string, callback: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
  downloadFile?(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void;
  openLink(url: string): void;
}
declare global { interface Window { Telegram?: { WebApp?: TelegramBridge } } }
export function telegramBridge(): TelegramBridge | undefined {
  const app = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  return app?.initData ? app : undefined;
}
export function telegramHeaders(): Record<string, string> {
  const data = telegramBridge()?.initData;
  return data ? { 'X-Telegram-Init-Data': data } : {};
}
export function setTelegramBack(handler: (() => void) | null, app = telegramBridge()): () => void {
  if (!app) return () => {};
  if (!handler) { app.BackButton.hide(); return () => {}; }
  app.BackButton.onClick(handler); app.BackButton.show();
  return () => { app.BackButton.offClick(handler); app.BackButton.hide(); };
}
export function mountTelegram(app = telegramBridge(), root = typeof document !== 'undefined' ? document.documentElement : undefined): () => void {
  if (!app || !root) return () => {};
  root.classList.add('telegram-app');
  const update = () => {
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const safe = Math.max(0, app.safeAreaInset?.[edge] || 0) + Math.max(0, app.contentSafeAreaInset?.[edge] || 0);
      root.style.setProperty(`--imn-safe-${edge}`, `${safe}px`);
    }
    if (app.viewportHeight > 0) root.style.setProperty('--imn-height', `${app.viewportHeight}px`);
    if (app.viewportStableHeight > 0) root.style.setProperty('--imn-stable-height', `${app.viewportStableHeight}px`);
    root.classList.toggle('telegram-keyboard', app.viewportStableHeight - app.viewportHeight > 150);
  };
  const colors = () => {
    // Match our approved dark canvas, even if Telegram itself uses a light theme.
    app.setHeaderColor('#080808'); app.setBackgroundColor('#080808');
    if (app.isVersionAtLeast('7.10')) app.setBottomBarColor?.('#080808');
  };
  const events = ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged'];
  update(); colors(); app.ready(); app.expand();
  for (const event of events) app.onEvent(event, update);
  app.onEvent('themeChanged', colors);
  return () => {
    for (const event of events) app.offEvent(event, update);
    app.offEvent('themeChanged', colors);
    root.classList.remove('telegram-app', 'telegram-keyboard');
    for (const key of ['top', 'bottom', 'left', 'right']) root.style.removeProperty(`--imn-safe-${key}`);
    root.style.removeProperty('--imn-height'); root.style.removeProperty('--imn-stable-height');
  };
}
export function downloadTelegramFile(url: string, filename: string, app = telegramBridge()): boolean {
  if (!app) return false;
  if (app.isVersionAtLeast('8.0') && app.downloadFile) app.downloadFile({ url, file_name: filename });
  else app.openLink(url);
  return true;
}
