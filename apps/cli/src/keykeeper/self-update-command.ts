// Keykeeper: what `passbundle update` and `passbundle update --check` do and
// say (DESIGN.md, "Command-line tool", "Updating itself", in the meta repo).
// The checks are self-update.ts, unpacking self-update-archive.ts, and putting
// the program in place self-update-install.ts.

import * as fe from "node-fetch";

import { Response } from "../models/response";
import { MessageResponse } from "../models/response/message.response";

import { CliBrand } from "./brand";
import {
  downloadArchive,
  findUpdate,
  Getter,
  printable,
  releaseVersion,
  UpdateNetworkError,
  UpdateRefusal,
} from "./self-update";
import { programFromArchive } from "./self-update-archive";

export type SelfUpdateDeps = {
  brand: CliBrand;
  /** The release platform this computer runs (self-update.ts, platformName), or null. */
  platform: string | null;
  get: Getter;
  /** Why this copy can't replace itself here, or null (self-update-install.ts). */
  installRefusal: () => string | null;
  /** Puts the new program in place (self-update-install.ts). */
  replace: (program: Buffer, version: string) => void;
};

/** `update` (or with `check`, `update --check`), for a branded build. */
export async function runSelfUpdate(check: boolean, deps: SelfUpdateDeps): Promise<Response> {
  const { brand } = deps;
  const tool = `${brand.name} CLI`;
  const running = brand.version;

  if (brand.releaseKeys.length === 0) {
    return Response.error(
      `Updates aren't available yet: releases of the ${tool} aren't signed yet, and the tool ` +
        `installs only signed ones. Get the newest version from ${brand.releases}`,
    );
  }
  if (releaseVersion(running) == null) {
    return Response.error(
      `This copy of the tool (${running || "a development build"}) wasn't built by a release, so ` +
        `it doesn't update itself. Install a release from ${brand.releases}`,
    );
  }
  if (deps.platform == null) {
    return Response.error(
      `There are no releases of the tool for this computer (${process.platform} on ${process.arch}).`,
    );
  }

  let found;
  try {
    found = await findUpdate({ brand, running, platform: deps.platform, get: deps.get });
  } catch (e) {
    if (e instanceof UpdateRefusal) {
      return Response.error(
        `No release newer than ${running} checked out, so nothing was installed: ${e.message}.`,
      );
    }
    if (e instanceof UpdateNetworkError) {
      return Response.error(`Couldn't check for updates: ${e.message}. Nothing changed.`);
    }
    throw e;
  }

  if (found == null) {
    const res = new MessageResponse(`${tool} ${running} is the newest version.`, null);
    res.raw = "";
    res.noColor = true;
    return Response.success(res);
  }

  const next = found.manifest.version;
  const notes = printable(found.manifest.notes ?? "").trim() || null;
  const refusal = deps.installRefusal();
  if (check) {
    const res = new MessageResponse(
      `${tool} ${next} is available (this is ${running}). ` +
        (refusal == null
          ? `Run \`${brand.command} update\` to install it.`
          : `This copy can't update itself: ${refusal}`),
      notes,
    );
    res.raw = next;
    res.noColor = true;
    return Response.success(res);
  }
  if (refusal != null) {
    return Response.error(
      `${tool} ${next} is available, but this copy can't update itself: ${refusal}`,
    );
  }

  try {
    const archive = await downloadArchive(deps.get, found);
    const program = programFromArchive(
      archive,
      found.file.name.endsWith(".zip") ? "zip" : "tar.gz",
      deps.platform === "windows-x64" ? `${brand.command}.exe` : brand.command,
    );
    deps.replace(program, next);
  } catch (e) {
    const why =
      e instanceof UpdateNetworkError || e instanceof UpdateRefusal || e instanceof Error
        ? e.message
        : String(e);
    return Response.error(`${tool} ${next} wasn't installed: ${why}. This copy is unchanged.`);
  }

  const res = new MessageResponse(`Updated the ${tool} from ${running} to ${next}.`, notes);
  res.raw = next;
  res.noColor = true;
  return Response.success(res);
}

/**
 * Gets an address with node-fetch, as the tool's other requests do (through
 * `https_proxy` or `http_proxy`), without following redirects or
 * decompressing, with no token, and giving up after 10 minutes.
 */
export function nodeGetter(userAgent: string): Getter {
  return async (url, accept) => {
    const proxy = process.env.http_proxy || process.env.https_proxy;
    let agent: unknown;
    if (proxy) {
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      agent = new HttpsProxyAgent(proxy);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10 * 60_000);
    let answer: fe.Response;
    try {
      answer = await fe.default(url, {
        redirect: "manual",
        compress: false,
        headers: {
          Accept: accept,
          "User-Agent": userAgent,
          ...(accept === "application/vnd.github+json"
            ? { "X-GitHub-Api-Version": "2022-11-28" }
            : {}),
        },
        agent: agent as fe.RequestInit["agent"],
        signal: controller.signal as fe.RequestInit["signal"],
      });
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
    const stream = answer.body as unknown as NodeJS.ReadableStream & AsyncIterable<Uint8Array>;
    if (answer.status !== 200) {
      clearTimeout(timer);
      stream.resume();
      return { status: answer.status, location: answer.headers.get("location"), body: EMPTY };
    }
    return {
      status: answer.status,
      location: null,
      body: (async function* () {
        try {
          for await (const chunk of stream) {
            yield chunk;
          }
        } finally {
          clearTimeout(timer);
        }
      })(),
    };
  };
}

const EMPTY: AsyncIterable<Uint8Array> = {
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: true, value: undefined }),
  }),
};
