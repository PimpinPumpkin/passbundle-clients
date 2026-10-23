// Keykeeper: the event streaming API on the server, for an organization
// (/api/keykeeper/organizations/<id>/event-streaming) or an MSP
// (/api/keykeeper/msp/<id>/event-streaming). See event-streaming.ts.

import { Injectable } from "@angular/core";

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import { Destination, DestinationList, StreamingScope } from "./event-streaming";

@Injectable({ providedIn: "root" })
export class KeykeeperEventStreamingApiService {
  constructor(private readonly apiService: ApiService) {}

  private path(scope: StreamingScope, rest = "") {
    const base =
      scope.kind === "msp"
        ? `/keykeeper/msp/${scope.id}/event-streaming`
        : `/keykeeper/organizations/${scope.id}/event-streaming`;
    return `${base}${rest}`;
  }

  list(scope: StreamingScope): Promise<DestinationList> {
    return this.apiService.send("GET", this.path(scope), null, true, true);
  }

  create(scope: StreamingScope, request: object): Promise<Destination> {
    return this.apiService.send("POST", this.path(scope), request, true, true);
  }

  update(scope: StreamingScope, id: string, request: object): Promise<Destination> {
    return this.apiService.send("PUT", this.path(scope, `/${id}`), request, true, true);
  }

  setEnabled(scope: StreamingScope, id: string, enabled: boolean): Promise<Destination> {
    return this.update(scope, id, { enabled });
  }

  async remove(scope: StreamingScope, id: string): Promise<void> {
    await this.apiService.send("DELETE", this.path(scope, `/${id}`), null, true, false);
  }

  /** Sends a sample event now; throws with what went wrong. */
  test(
    scope: StreamingScope,
    id: string,
  ): Promise<{ sent: boolean; eventId: string; warning?: string }> {
    return this.apiService.send("POST", this.path(scope, `/${id}/test`), null, true, true);
  }

  /** A new signing secret for a webhook, in the answer's signingSecret. */
  newSecret(scope: StreamingScope, id: string): Promise<Destination> {
    return this.apiService.send("POST", this.path(scope, `/${id}/secret`), null, true, true);
  }
}
