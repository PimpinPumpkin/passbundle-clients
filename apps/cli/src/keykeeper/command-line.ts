// Keykeeper: secrets don't belong on the command line, where other programs
// on the computer can read them (the process list) and the shell keeps them
// (its history). The tool takes the session key from PASSBUNDLE_SESSION and
// the master password from a variable or file the script names; given either
// on the command line, it still works, and says so on stderr. See docs/cli.md,
// "Sessions and environment variables".

import { CLI_BRAND } from "./brand";

/** What the tool says when the session key is given with `--session`. */
export function sessionOnCommandLine(brand = CLI_BRAND): string {
  return (
    "Warning: the session key is on the command line, where other programs on this computer " +
    `can read it. Set ${brand.envPrefix}SESSION instead.`
  );
}

/** What the tool says when the master password is given as an argument. */
export function passwordOnCommandLine(): string {
  return (
    "Warning: the master password is on the command line, where other programs on this computer " +
    "can read it, and your shell may keep it. Use --passwordenv or --passwordfile instead."
  );
}

/** Says a warning on stderr, so a script's output stays clean. */
export function warn(message: string, stderr: { write: (s: string) => unknown } = process.stderr) {
  stderr.write(message + "\n");
}
