// Keykeeper: uploads go in batches the server takes (at most 500 events
// each), and what doesn't go is kept for the next try.
import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { FakeStateProvider, mockAccountServiceWith } from "../../../../spec";
import { ApiService } from "../../../abstractions/api.service";
import { AuthService } from "../../../auth/abstractions/auth.service";
import { AuthenticationStatus } from "../../../auth/enums/authentication-status";
import { LogService } from "../../../platform/abstractions/log.service";
import { Utils } from "../../../platform/misc/utils";
import { TaskSchedulerService } from "../../../platform/scheduling/task-scheduler.service";
import { UserId } from "../../../types/guid";
import { EventType } from "../enums/event-type.enum";
import { EventData } from "../models/data/event.data";
import { EventRequest } from "../models/request/event.request";

import { MAX_EVENTS_PER_UPLOAD, EventUploadService } from "./event-upload.service";
import { EVENT_COLLECTION } from "./key-definitions";

describe("EventUploadService", () => {
  const userId = Utils.newGuid() as UserId;
  let stateProvider: FakeStateProvider;
  const apiService = mock<ApiService>();
  const authService = mock<AuthService>();
  let service: EventUploadService;

  const events = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => {
      const e = new EventData();
      e.type = EventType.Cipher_ClientViewed;
      e.cipherId = `cipher-${offset + i}`;
      e.date = new Date(0).toISOString();
      return e;
    });
  const stored = () => firstValueFrom(stateProvider.getUser(userId, EVENT_COLLECTION).state$);

  beforeEach(async () => {
    jest.resetAllMocks();
    stateProvider = new FakeStateProvider(mockAccountServiceWith(userId));
    authService.authStatusFor$.mockReturnValue(new BehaviorSubject(AuthenticationStatus.Unlocked));
    service = new EventUploadService(
      apiService,
      stateProvider,
      mock<LogService>(),
      authService,
      mock<TaskSchedulerService>(),
    );
  });

  it("uploads a backlog in batches of at most 500", async () => {
    await stateProvider.setUserState(EVENT_COLLECTION, events(1201), userId);
    apiService.postEventsCollect.mockResolvedValue(undefined);

    await service.uploadEvents(userId);

    const sizes = apiService.postEventsCollect.mock.calls.map(
      ([request]) => (request as EventRequest[]).length,
    );
    expect(sizes).toEqual([MAX_EVENTS_PER_UPLOAD, MAX_EVENTS_PER_UPLOAD, 201]);
    expect(await stored()).toEqual([]);
  });

  it("keeps the batch that failed and the ones after it, ahead of newer events", async () => {
    await stateProvider.setUserState(EVENT_COLLECTION, events(1200), userId);
    apiService.postEventsCollect
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        // Something is collected while the upload is under way.
        await stateProvider.setUserState(EVENT_COLLECTION, events(1, 5000), userId);
        throw new Error("429");
      });

    await service.uploadEvents(userId);

    expect(apiService.postEventsCollect).toHaveBeenCalledTimes(2);
    const left = await stored();
    expect(left.map((e) => e.cipherId)).toEqual([
      ...events(700, 500).map((e) => e.cipherId),
      "cipher-5000",
    ]);
  });
});
