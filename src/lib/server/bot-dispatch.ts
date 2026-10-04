// Keep polling while downloads run. A bounded queue handles normal messages;
// inline queries bypass it because Telegram gives them a short answer window.
export class BotDispatch {
  private active = 0;
  private pending: (() => Promise<void>)[] = [];
  constructor(private limit = 4, private capacity = 32) {}
  run(task: () => Promise<void>): boolean {
    if (this.active >= this.limit) {
      if (this.pending.length >= this.capacity) return false;
      this.pending.push(task); return true;
    }
    this.active++;
    void Promise.resolve().then(task).catch(() => console.error('Bot 請求失敗。')).finally(() => {
      this.active--;
      const next = this.pending.shift();
      if (next) this.run(next);
    });
    return true;
  }
}
