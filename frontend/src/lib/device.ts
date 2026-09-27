// Per-device memory: an anonymous device id (for one "Me too" per issue) and the
// tracking codes this phone has created, so people don't have to write them down.
const DEVICE_KEY = "echo.device";
const CODES_KEY = "echo.codes";

export interface SavedCode {
  code: string;
  label: string;
  at: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: codes just won't be remembered */
  }
}

export function deviceId(): string {
  let id = safeGet(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    safeSet(DEVICE_KEY, id);
  }
  return id;
}

export function savedCodes(): SavedCode[] {
  try {
    return JSON.parse(safeGet(CODES_KEY) ?? "[]") as SavedCode[];
  } catch {
    return [];
  }
}

export function saveCode(code: string, label: string) {
  const list = savedCodes().filter((c) => c.code !== code);
  list.unshift({ code, label, at: new Date().toISOString() });
  safeSet(CODES_KEY, JSON.stringify(list.slice(0, 20)));
}
