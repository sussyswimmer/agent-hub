// Asset URLs, resolved before Pixi sees them (DECISIONS 0021).

/**
 * `url` resolved against `base`.
 *
 * Vite hands back `/assets/name.png`. Pixi resolves a rooted path against the page's "root",
 * and only knows what a root is for `http:` and `https:` — for any other scheme the root is the
 * bare protocol, so under Tauri on macOS and Linux (`tauri://localhost`) every image was asked
 * for at `tauri://assets/name.png`, with no host, and failed. Windows (`http://tauri.localhost`)
 * and the browser were fine, which is why only the binary showed it. A URL with its own scheme
 * is left alone.
 */
export function absolute(url: string, base: string | undefined = globalThis.document?.baseURI): string {
  return base === undefined ? url : new URL(url, base).href;
}
