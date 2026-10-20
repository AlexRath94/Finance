import type { AppData } from '../types';

/**
 * File format for backups and for passing data to the partner's phone (via messenger, AirDrop, …).
 * With a password the content is encrypted on the device with AES-256-GCM; the key is derived
 * from the password with PBKDF2. Without the password the file is unreadable.
 */
export interface ShareFile {
  app: 'finanzplaner';
  format: 1;
  createdAt: number;
  from?: string;
  encrypted: boolean;
  salt?: string;
  iv?: string;
  iterations?: number;
  gzip?: boolean;
  payload: string | AppData;
}

const ITERATIONS = 310000;

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createShareFile(data: AppData, password: string | undefined, from?: string): Promise<ShareFile> {
  const base = { app: 'finanzplaner' as const, format: 1 as const, createdAt: Date.now(), from: from || undefined };
  if (!password) return { ...base, encrypted: false, payload: data };
  let bytes: Uint8Array = new TextEncoder().encode(JSON.stringify(data));
  const gzip = typeof CompressionStream !== 'undefined';
  if (gzip) bytes = await pipe(bytes, new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource));
  return { ...base, encrypted: true, salt: toB64(salt), iv: toB64(iv), iterations: ITERATIONS, gzip, payload: toB64(cipher) };
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Falsches Passwort');
  }
}

/** Reads a share/backup file; also accepts plain data exported by the first app version. */
export async function readShareFile(text: string, password?: string): Promise<{ data: AppData; file?: ShareFile }> {
  const json = JSON.parse(text);
  if (json && json.app === 'finanzplaner') {
    const file = json as ShareFile;
    if (!file.encrypted) return { data: file.payload as AppData, file };
    if (!password) throw new WrongPasswordError();
    try {
      const key = await deriveKey(password, fromB64(file.salt!), file.iterations || ITERATIONS);
      let bytes: Uint8Array = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv!) as BufferSource }, key, fromB64(file.payload as string) as BufferSource));
      if (file.gzip) bytes = await pipe(bytes, new DecompressionStream('gzip'));
      return { data: JSON.parse(new TextDecoder().decode(bytes)), file };
    } catch {
      throw new WrongPasswordError();
    }
  }
  if (Array.isArray(json?.accounts) && Array.isArray(json?.transactions)) return { data: json as AppData };
  throw new Error('Keine Finanzplaner-Datei');
}

export function isEncryptedFile(text: string): boolean {
  try {
    const j = JSON.parse(text);
    return j?.app === 'finanzplaner' && j.encrypted === true;
  } catch {
    return false;
  }
}

/** Opens the phone's share sheet (WhatsApp, Signal, AirDrop, …) or falls back to a download. */
export async function shareOrDownload(file: ShareFile, fileName: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const f = new File([blob], fileName, { type: 'application/json' });
  if (navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title: 'Finanzplaner' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
