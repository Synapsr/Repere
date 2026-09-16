import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureInput } from "../../shared/types";

const mocks = vi.hoisted(() => ({ render: vi.fn(), encode: vi.fn() }));
vi.mock("html2canvas-pro", () => ({ default: mocks.render }));
vi.mock("../../shared/capture-canvas", () => ({ encodeCapture: mocks.encode }));

import { captureViewport } from "../../preview/capture";

const capturedAt = "2026-09-16T10:00:00.000Z";
const capture: CaptureInput = {
  dataUrl: "data:image/jpeg;base64,/9j/2Q==",
  pointX: 0.75,
  pointY: 0.5,
  capturedAt,
};

describe("native viewport capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.render.mockReset();
    mocks.encode.mockReset().mockResolvedValue(capture);
    vi.stubGlobal("window", { innerWidth: 1_200, innerHeight: 800, scrollX: 0, scrollY: 620 });
    vi.stubGlobal("document", {
      documentElement: { append: vi.fn() },
      createElement: () => ({
        style: { setProperty: vi.fn() },
        attachShadow: () => ({ append: vi.fn() }),
        remove: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts the DOM snapshot before returning and retains click coordinates across later resize", async () => {
    let complete!: (canvas: HTMLCanvasElement) => void;
    mocks.render.mockReturnValue(new Promise<HTMLCanvasElement>((resolve) => (complete = resolve)));
    const pending = captureViewport({ x: 900, y: 400, capturedAt });
    expect(mocks.render).toHaveBeenCalledOnce();
    const options = mocks.render.mock.calls[0][1];
    expect(options).toMatchObject({
      x: 0,
      y: 620,
      width: 1_200,
      height: 800,
      windowWidth: 1_200,
      windowHeight: 800,
      scrollY: 620,
      scale: 1,
      useCORS: true,
      allowTaint: false,
    });

    Object.assign(window, { innerWidth: 600, innerHeight: 500, scrollY: 0 });
    const canvas = {} as HTMLCanvasElement;
    complete(canvas);
    expect(await pending).toEqual(capture);
    expect(mocks.encode).toHaveBeenCalledWith(canvas, {
      pointX: 0.75,
      pointY: 0.5,
      capturedAt,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled renderer after twelve seconds and ignores a late result", async () => {
    let complete!: (canvas: HTMLCanvasElement) => void;
    mocks.render.mockReturnValue(new Promise<HTMLCanvasElement>((resolve) => (complete = resolve)));
    const pending = captureViewport({ x: 900, y: 400, capturedAt });
    const signal: AbortSignal = mocks.render.mock.calls[0][1].signal;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toBeNull();
    expect(signal.aborted).toBe(true);
    complete({} as HTMLCanvasElement);
    await Promise.resolve();
    expect(mocks.encode).not.toHaveBeenCalled();
  });

  it("settles immediately when a newer click or page exit cancels capture", async () => {
    mocks.render.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = captureViewport({ x: 900, y: 400, capturedAt }, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    expect(mocks.render.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns no image when rendering or canvas encoding is inaccessible", async () => {
    mocks.render.mockImplementationOnce(() => {
      throw new DOMException("Inaccessible canvas", "SecurityError");
    });
    expect(await captureViewport({ x: 900, y: 400, capturedAt })).toBeNull();
    mocks.render.mockResolvedValueOnce({});
    mocks.encode.mockRejectedValueOnce(new DOMException("Tainted canvas", "SecurityError"));
    expect(await captureViewport({ x: 900, y: 400, capturedAt })).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds large viewports and excludes only Repère annotations and cursor styles", async () => {
    Object.assign(window, { innerWidth: 5_120, innerHeight: 2_880 });
    mocks.render.mockResolvedValue({});
    await captureViewport({ x: 900, y: 400, capturedAt });
    const options = mocks.render.mock.calls[0][1];
    expect(options.scale).toBe(0.4);
    expect(options.proxy).toBeUndefined();
    const element = (localName: string, cursor = false) => ({
      localName,
      hasAttribute: (name: string) => cursor && name === "data-repere-cursor",
    });
    expect(options.ignoreElements(element("repere-annotations"))).toBe(true);
    expect(options.ignoreElements(element("repere-capture"))).toBe(true);
    expect(options.ignoreElements(element("style", true))).toBe(true);
    expect(options.ignoreElements(element("style"))).toBe(false);
    expect(options.ignoreElements(element("canvas"))).toBe(false);
  });
});
