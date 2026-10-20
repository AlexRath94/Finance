import { Capacitor } from '@capacitor/core';

export const isNativeApp = () => Capacitor.isNativePlatform();

/**
 * Hands a generated file (backup, CSV, share file) to the user.
 * In the Android app it opens the share menu (save to Drive/Files, send via messenger);
 * in the browser it uses the share sheet where available, otherwise a download.
 */
export async function exportFile(fileName: string, content: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (isNativeApp()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    // The cache directory is private to the app; the share menu only gets this one file.
    const { uri } = await Filesystem.writeFile({ path: fileName, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title: fileName, files: [uri] });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], fileName, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
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
