import { describe, it, expect } from "vitest";
import { isServedUrl, toMediaSrc } from "./mediaSrc";

const convert = (path: string) => `http://media.localhost/${encodeURIComponent(path)}`;

describe("isServedUrl", () => {
  it("recognises a media URL the backend already produced", () => {
    expect(isServedUrl("http://media.localhost/D%3A/a.png")).toBe(true);
  });

  it("recognises the https scheme too", () => {
    expect(isServedUrl("https://media.localhost/D%3A/a.png")).toBe(true);
  });

  it("does not mistake a Windows path for a URL", () => {
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
    const served = "http://media.localhost/D%3A/Pics/a.png";
    expect(toMediaSrc(served, convert)).toBe(served);
  });

  it("never calls the converter for a served URL", () => {
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
    expect(toMediaSrc("", convert)).toBe("");
  });
});