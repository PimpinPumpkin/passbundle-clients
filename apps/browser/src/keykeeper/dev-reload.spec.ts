import { BUILD_FILE, KeykeeperDevReload, LOADED_BUILD_KEY, shouldReload } from "./dev-reload";

describe("KeykeeperDevReload", () => {
  let session: Record<string, unknown>;
  let installType: string;
  let onDisk: string | null;
  const reload = jest.fn();
  const createAlarm = jest.fn();

  const fetchFn = jest.fn(async (url: string) => {
    expect(url).toBe(`chrome-extension://id/${BUILD_FILE}`);
    return onDisk === null
      ? ({ ok: false, text: async () => "" } as Response)
      : ({ ok: true, text: async () => `${onDisk}\n` } as Response);
  }) as unknown as typeof fetch;

  beforeEach(() => {
    session = {};
    installType = "development";
    onDisk = "main abc (CI run 1)";
    reload.mockReset();
    createAlarm.mockReset();
    (globalThis as any).chrome = {
      runtime: { getURL: (path: string) => `chrome-extension://id/${path}`, reload },
      management: { getSelf: async () => ({ installType }) },
      alarms: { create: createAlarm, onAlarm: { addListener: jest.fn() } },
      storage: {
        session: {
          get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
          set: async (items: Record<string, unknown>) => Object.assign(session, items),
        },
      },
    };
  });

  it("does nothing for a store or policy install", async () => {
    installType = "normal";
    await new KeykeeperDevReload(fetchFn).init();
    expect(createAlarm).not.toHaveBeenCalled();
    expect(session).toEqual({});
  });

  it("remembers the build it started with, then reloads when the files change", async () => {
    const devReload = new KeykeeperDevReload(fetchFn);
    await devReload.init();
    expect(createAlarm).toHaveBeenCalled();
    expect(session[LOADED_BUILD_KEY]).toBe("main abc (CI run 1)");

    await devReload.check();
    expect(reload).not.toHaveBeenCalled();

    onDisk = "main def (CI run 2)";
    await devReload.check();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when a build file shows up next to one loaded without it", async () => {
    onDisk = null;
    const devReload = new KeykeeperDevReload(fetchFn);
    await devReload.init();
    expect(session[LOADED_BUILD_KEY]).toBe("");
    onDisk = "main abc (CI run 1)";
    await devReload.check();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("compares builds only once one is remembered", () => {
    expect(shouldReload(undefined, "a")).toBe(false);
    expect(shouldReload("a", "a")).toBe(false);
    expect(shouldReload("a", "b")).toBe(true);
    expect(shouldReload("", "a")).toBe(true);
  });
});
