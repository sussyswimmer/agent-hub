// Every image on the floor failed to load in the binary on macOS and Linux, and in no browser.
// These pin the URL the loader is actually given (DECISIONS 0021).
import { describe, expect, test } from "bun:test";

import { absolute } from "../assetUrl";

describe("asset URLs under Tauri", () => {
  test("a rooted path keeps the host of a custom-scheme page", () => {
    // What Pixi made of this on its own was `tauri://assets/quill.png`: no host, no image.
    expect(absolute("/assets/quill.png", "tauri://localhost/")).toBe("tauri://localhost/assets/quill.png");
  });

  test("Windows and the dev server are plain http, and come out the same way", () => {
    expect(absolute("/assets/quill.png", "http://tauri.localhost/")).toBe("http://tauri.localhost/assets/quill.png");
    expect(absolute("/src/assets/higgsfield/floor-plan.jpg", "http://localhost:1420/")).toBe(
      "http://localhost:1420/src/assets/higgsfield/floor-plan.jpg",
    );
  });

  test("a URL that already has a scheme is left alone", () => {
    expect(absolute("tauri://localhost/assets/a.png", "http://elsewhere/")).toBe("tauri://localhost/assets/a.png");
    expect(absolute("data:image/png;base64,AAAA", "tauri://localhost/")).toBe("data:image/png;base64,AAAA");
  });

  test("with no page to resolve against, the URL is passed through", () => {
    expect(absolute("/assets/quill.png", undefined)).toBe("/assets/quill.png");
  });
});
