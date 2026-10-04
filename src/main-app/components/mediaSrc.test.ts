import { describe, it, expect } from "vitest";
import { isServedUrl, toMediaSrc } from "./mediaSrc";

/** Stands in for the real `convertFileSrc`, which needs a Tauri IPC host. */
const convert = (path: string) => `http://media.localhost/${encodeURIComponent(path)}`;

describe("isServedUrl", () => {
  it("recognises a media URL the backend already produced", () => {
    expect(isServedUrl("http://media.localhost/D%3A/a.png")).toBe(true);
  });

  it("recognises the https scheme too", () => {
    expect(isServedUrl("https://media.localhost/D%3A/a.png")).toBe(true);
  });

  it("does not mistake a Windows path for a URL", () => {
    // The trap: "C://" contains "//" and a colon, so a loose check would treat
    // every path on the drive as an already-served URL and skip converting it.
    expect(isServedUrl("C:\\Users\\GB\\a.png")).toBe(false);
    expect(isServedUrl("D:/Wallpapers/a.png")).toBe(false);
  });

  it("does not mistake a shader or web preset id for a URL", () => {
    expect(isServedUrl("aurora")).toBe(false);
    expect(isServedUrl("https-vault-demo")).toBe(false);
  });
});

describe("toMediaSrc", () => {
  it("converts a raw path", () => {
    expect(toMediaSrc("C:\\Users\\GB\\a.png", convert)).toBe(
      "http://media.localhost/C%3A%5CUsers%5CGB%5Ca.png",
    );
  });

  it("leaves an already-served URL alone", () => {
    // The bug this exists for: converting a URL wraps it a second time and
    // yields a path that does not exist, so the thumbnail is simply blank.
    const served = "http://media.localhost/D%3A/Pics/a.png";
    expect(toMediaSrc(served, convert)).toBe(served);
  });

  it("never calls the converter for a served URL", () => {
    // Asserting the output alone would still pass if the converter were called
    // and happened to return its input, so the call itself is counted.
    let calls = 0;
    const counting = (path: string) => {
      calls++;
      return convert(path);
    };
    toMediaSrc("http://media.localhost/a.png", counting);
    expect(calls).toBe(0);
  });

  it("does call the converter for a path", () => {
    let calls = 0;
    toMediaSrc("C:\\a.png", (path) => {
      calls++;
      return convert(path);
    });
    expect(calls).toBe(1);
  });

  it("leaves blank alone rather than converting it", () => {
    // Converting "" would produce a URL for the root, which is a confusing way
    // to draw "nothing selected".
    expect(toMediaSrc("", convert)).toBe("");
  });
});