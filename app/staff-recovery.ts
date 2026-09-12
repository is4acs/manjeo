/** WebKit can remember a failed import across document reloads in the same tab. */
export async function recoverStaff() {
  const controller = new AbortController();
  let timer: number | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      controller.abort();
      reject(new Error('Workspace loading timed out.'));
    }, 15000);
  });
  try { return await Promise.race([loadStaff(controller.signal), deadline]); }
  finally { window.clearTimeout(timer); }
}

async function loadStaff(signal: AbortSignal) {
  const response = await fetch('/asset-manifest.json', {cache: 'no-store', signal});
  if (!response.ok) throw new Error('Unable to load the current asset manifest.');
  const manifest = await response.json() as Record<string, {file: string; css?: string[]}>;
  const entry = manifest['app/staff.tsx'];
  const main = manifest['index.html'];
  const documentModule = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  // Never mix a newly deployed React runtime with the one already on this page.
  if (!entry || !main || !documentModule || new URL(documentModule.src).pathname !== '/' + main.file) {
    throw new Error('The application version changed. Reload the page.');
  }
  const attempt = crypto.randomUUID();
  const assetUrl = (file: string) => {
    if (!/^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(file)) throw new Error('Invalid application asset.');
    const url = new URL('/' + file, window.location.origin);
    url.searchParams.set('recovery', attempt);
    return url.href;
  };
  await Promise.all((entry.css || []).map(file => new Promise<void>((resolve, reject) => {
    const href = assetUrl(file);
    const existing = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].find(link =>
      new URL(link.href).pathname === '/' + file && link.sheet);
    if (existing) { resolve(); return; }
    const link = document.createElement('link');
    const timer = window.setTimeout(() => finish(new Error('Stylesheet loading timed out.')), 15000);
    const finish = (error?: Error) => {
      window.clearTimeout(timer); link.onload = null; link.onerror = null;
      signal.removeEventListener('abort', abort);
      if (error) { link.remove(); reject(error); } else resolve();
    };
    const abort = () => finish(new Error('Stylesheet loading was cancelled.'));
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) { abort(); return; }
    link.rel = 'stylesheet'; link.href = href;
    link.onload = () => finish(); link.onerror = () => finish(new Error('Unable to load the workspace stylesheet.'));
    document.head.append(link);
  })));
  if (signal.aborted) throw new Error('Workspace loading was cancelled.');
  // Imports cannot be aborted; the deadline rejects their abandoned lazy view.
  return import(/* @vite-ignore */ assetUrl(entry.file));
}
