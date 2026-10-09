/** Why a foxlens call failed. */
export type FoxlensCode = "permission" | "no_tab" | "bad_image" | "cloud_not_allowed" | "unsupported" | "stale";

export class FoxlensError extends Error {
  readonly code: FoxlensCode;
  constructor(code: FoxlensCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FoxlensError";
    this.code = code;
  }
}

/** Turns an error from a Firefox API into a FoxlensError with a code the caller can test. */
export function fromFirefox(error: unknown, doing: string): FoxlensError {
  if (error instanceof FoxlensError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid tab id|no tab with id/i.test(message)) return new FoxlensError("no_tab", `${doing}: ${message}`, { cause: error });
  if (/permission|cannot access|not allowed/i.test(message)) {
    return new FoxlensError("permission", `${doing}: ${message}. The extension needs host permission for this page ("<all_urls>" or the site's origin).`, { cause: error });
  }
  if (/document.*(not found|no longer)|invalid document|frame.*not found/i.test(message)) {
    return new FoxlensError("stale", `${doing}: the page changed or navigated. ${message}`, { cause: error });
  }
  return new FoxlensError("unsupported", `${doing}: ${message}`, { cause: error });
}
