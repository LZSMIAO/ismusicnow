declare global {
  namespace App {
    interface PageState { searchQuery?: string }
    interface Locals { sessionId: string }
  }
}
export {};
