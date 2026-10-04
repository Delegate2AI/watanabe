import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { classifyAddress, isLocalDevException, type ResolveFn } from "./egress-net";

function toErrno(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error ? error : new Error(String(error));
}

export function createPinnedLookup(resolve: ResolveFn): LookupFunction {
  return function pinnedLookup(hostname, options, callback) {
    const allowLoopback = isLocalDevException(hostname);

    try {
      resolve(hostname, { all: true }).then(
        (addresses) => {
          if (addresses.length === 0) {
            callback(toErrno(new Error(`${hostname} did not resolve to any address`)), "");
            return;
          }

          for (const entry of addresses) {
            const verdict = classifyAddress(entry.address);
            if (verdict.blocked && !(allowLoopback && verdict.reason.includes("loopback"))) {
              callback(toErrno(new Error(verdict.reason)), "");
              return;
            }
          }

          if (options.all) {
            callback(null, addresses);
            return;
          }
          callback(null, addresses[0].address, addresses[0].family);
        },
        (error) => callback(toErrno(error), ""),
      );
    } catch (error) {
      callback(toErrno(error), "");
    }
  };
}

export function createPinnedDispatcher(resolve: ResolveFn): Agent {
  return new Agent({ connect: { lookup: createPinnedLookup(resolve) } });
}
