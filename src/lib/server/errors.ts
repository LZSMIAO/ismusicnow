export class ServiceError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function publicError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof ServiceError) return { code: error.code, message: error.message, status: error.status };
  return { code: 'UPSTREAM_ERROR', message: '音樂服務暫時無法回應，請稍後再試。', status: 502 };
}
