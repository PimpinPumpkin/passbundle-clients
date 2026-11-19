// Keykeeper: `script get`, a script token's granted value on Mac and Linux as
// the PowerShell module gives it on Windows (keykeeper/script-access.ts, and
// docs/cli.md, "Script access", in the meta repo). It needs no account,
// session, or data folder, so bw.ts runs it before the service container,
// which would make the data folder; the main program lists it too, for help
// and for options before it that only the main program knows.
//
// The token comes from PASSBUNDLE_TOKEN (the module's name for it) or the
// first line on stdin,
// never from the command line without a warning: other programs on the
// computer can read a command line, and the shell may keep it.

import * as chalk from "chalk";
import { Command } from "commander";
import * as fe from "node-fetch";

import { Response } from "../models/response";
import { StringResponse } from "../models/response/string.response";
import { CliUtils } from "../utils";

import { CLI_BRAND, CliBrand } from "./brand";
import { scriptTokenOnCommandLine, warn } from "./command-line";
import {
  ScriptAccessError,
  ScriptFetch,
  scriptGet,
  scriptServer,
  scriptServerVariable,
  scriptTokenVariable,
} from "./script-access";

/** What `script get` reads and writes besides its arguments. */
export type ScriptIo = {
  env: NodeJS.ProcessEnv;
  /** Whether stdin is a terminal, where nobody pipes a token. */
  stdinIsTerminal: boolean;
  /** The first line on stdin. */
  readLine: () => Promise<string>;
  stderr: { write: (s: string) => unknown };
  fetch: ScriptFetch;
  now?: () => number;
};

export type ScriptGetOptions = { field?: string; server?: string; token?: string };

/** The global options without a value, which may come before `script`, and their variables. */
const GLOBAL_FLAGS: [flag: string, variable: string, help: string][] = [
  ["--pretty", "BW_PRETTY", "Format output. JSON is tabbed with two spaces."],
  ["--raw", "BW_RAW", "Return raw output instead of a descriptive message."],
  ["--response", "BW_RESPONSE", "Return a JSON formatted version of response output."],
  ["--cleanexit", "BW_CLEANEXIT", "Exit with a success exit code (0) unless an error is thrown."],
  ["--quiet", "BW_QUIET", "Don't return anything to stdout."],
  ["--nointeraction", "BW_NOINTERACTION", "Do not prompt for interactive user input."],
];

/** Whether the command is `script ...`, after only global options without a value. */
export function isScriptCommand(argv: string[]): boolean {
  for (const arg of argv.slice(2)) {
    if (!GLOBAL_FLAGS.some(([flag]) => flag === arg)) {
      return arg === "script";
    }
  }
  return false;
}

/** The first line of a stream, without waiting for more once it's there. */
export function firstLine(
  stream: NodeJS.ReadableStream & { destroy?: () => void },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const finish = (error?: Error) => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", finish);
      stream.pause();
      stream.destroy?.();
      if (error != null) {
        reject(error);
      } else {
        resolve(text.split(/\r?\n/, 1)[0]);
      }
    };
    const onData = (chunk: string | Buffer) => {
      text += chunk.toString();
      // A token is under a hundred characters.
      if (/\r?\n/.test(text) || text.length > 4096) {
        finish();
      }
    };
    const onEnd = () => finish();
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", finish);
    stream.resume();
  });
}

/** Asks the server with Node, through a proxy when one is set, never following redirects. */
export const nodeScriptFetch: ScriptFetch = async (url, headers) => {
  const proxy = process.env.http_proxy || process.env.https_proxy;
  const agent = proxy ? new (await import("https-proxy-agent")).HttpsProxyAgent(proxy) : undefined;
  const response = await fe.default(url, { headers, agent, redirect: "manual" });
  return { status: response.status, json: () => response.json() };
};

const processIo = (): ScriptIo => ({
  env: process.env,
  stdinIsTerminal: process.stdin.isTTY === true,
  readLine: () => firstLine(process.stdin),
  stderr: process.stderr,
  fetch: nodeScriptFetch,
});

/**
 * The token: from `--token` (with a warning), the brand's variable, or the
 * first line on stdin when it isn't a terminal.
 */
export async function scriptToken(
  given: string | undefined,
  io: ScriptIo,
  brand: CliBrand = CLI_BRAND,
): Promise<string> {
  if (given != null) {
    warn(scriptTokenOnCommandLine(brand), io.stderr);
    return given;
  }
  const variable = io.env[scriptTokenVariable(brand)];
  if (variable != null && variable.trim() !== "") {
    return variable;
  }
  if (!io.stdinIsTerminal) {
    const line = (await io.readLine()).trim();
    if (line !== "") {
      return line;
    }
  }
  throw new ScriptAccessError(
    `No script token: set ${scriptTokenVariable(brand)}, or give it on stdin.`,
  );
}

/** `script get`: the one value asked for, or why not. */
export async function runScriptGet(
  item: string,
  options: ScriptGetOptions,
  io: ScriptIo,
  brand: CliBrand = CLI_BRAND,
): Promise<Response> {
  try {
    const token = await scriptToken(options.token, io, brand);
    const server = scriptServer(options.server ?? io.env[scriptServerVariable(brand)], brand);
    const value = await scriptGet({
      item,
      field: options.field ?? "password",
      token,
      server,
      fetch: io.fetch,
      brand,
      now: io.now,
    });
    return Response.success(new StringResponse(value));
  } catch (e) {
    return Response.error(e instanceof ScriptAccessError ? e.message : (e as Error));
  }
}

/**
 * Prints a response as the rest of the tool does (BaseProgram's
 * processResponse): the value alone, or JSON with --response; an error on
 * stderr; nothing with --quiet; and exit code 1 for an error unless
 * --cleanexit.
 */
export function printScriptResponse(response: Response, env: NodeJS.ProcessEnv = process.env) {
  const json = (value: unknown) =>
    env.BW_PRETTY === "true" ? JSON.stringify(value, null, "  ") : JSON.stringify(value);
  if (env.BW_QUIET !== "true") {
    if (env.BW_RESPONSE === "true") {
      CliUtils.writeLn(json(response), true, false);
    } else if (!response.success) {
      CliUtils.writeLn(chalk.redBright(response.message), true, true);
    } else {
      CliUtils.writeLn((response.data as StringResponse).data, true, false);
    }
  }
  process.exitCode = response.success || env.BW_CLEANEXIT ? 0 : 1;
}

/** `script` and `script get`, under a program. */
export function registerScriptCommand(
  parent: Command,
  io: () => ScriptIo = processIo,
  brand: CliBrand = CLI_BRAND,
): void {
  const command = brand.command;
  const tokenVariable = scriptTokenVariable(brand);
  const serverVariable = scriptServerVariable(brand);
  const script = parent
    .command("script")
    .description(
      "Read what a script token was granted, with the token alone: no account, session, or data folder.",
    );
  script
    .command("get")
    .argument("<item>", "The item's id, or its name among the token's items.")
    .description("Print one value of an item a script token was granted.")
    .option(
      "--field <field>",
      "username, password, totp (a current one-time code), or a custom field's name.",
      "password",
    )
    .option(
      "--server <server>",
      `The server's address${brand.server ? ` (${brand.server} unless ${serverVariable} says another)` : `, unless ${serverVariable} says it`}.`,
    )
    .option(
      "--token <token>",
      `The token, which other programs on this computer can read here: use ${tokenVariable} or stdin instead.`,
    )
    .on("--help", () => {
      CliUtils.writeLn(
        `\n  The token comes from ${tokenVariable}, or else the first line on stdin.`,
      );
      CliUtils.writeLn("  Only the value asked for is printed; nothing is saved on this computer.");
      CliUtils.writeLn("");
      CliUtils.writeLn("  Examples:");
      CliUtils.writeLn("");
      CliUtils.writeLn(`    ${command} script get "Domain admin" --field username`);
      CliUtils.writeLn(`    ${command} script get 0d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e`);
      CliUtils.writeLn(`    ${command} script get "Backup service" --field "API key"`);
      CliUtils.writeLn(
        `    printf '%s\\n' "$token" | ${command} script get "Domain admin" --field totp`,
      );
      CliUtils.writeLn("", true);
    })
    .action(async (item: string, options: ScriptGetOptions) => {
      printScriptResponse(await runScriptGet(item, options, io(), brand));
    });
}

/**
 * The whole program when the command is `script ...`: the global options
 * without a value, and `script`. Nothing else, so nothing makes the tool's
 * data folder.
 */
export function registerScriptProgram(program: Command): void {
  for (const [flag, variable, help] of GLOBAL_FLAGS) {
    program.option(flag, help);
    program.on(`option:${flag.slice(2)}`, () => {
      process.env[variable] = "true";
    });
  }
  registerScriptCommand(program);
}
