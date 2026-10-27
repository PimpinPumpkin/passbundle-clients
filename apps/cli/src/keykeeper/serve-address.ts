// Keykeeper: `serve` answers every command over HTTP to whatever can reach it,
// with the person's unlocked vault behind it. So it listens only where this
// computer alone can reach it (loopback, or a Unix socket) unless the person
// says otherwise with --unsafe-network. See docs/cli.md, "The local API".

/** Whether an address is this computer's own: localhost, 127.0.0.0/8, or ::1. */
export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    host === "localhost" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  );
}

/**
 * Why `serve` won't listen at this address, or null when it may: loopback
 * and Unix sockets always; anything else, every interface (`all`) and
 * sockets handed over by number included, only with --unsafe-network.
 */
export function serveAddressRefusal(
  hostname: string | undefined,
  unsafeNetwork: boolean,
): string | null {
  const host = hostname || "localhost";
  if (isLoopback(host) || host.startsWith("unix://") || unsafeNetwork) {
    return null;
  }
  return (
    `Not listening on ${host}: anything that can reach it could read and change your vault ` +
    "while it's unlocked. Use the default (localhost), or add --unsafe-network if you mean it " +
    "and something else protects that network."
  );
}
