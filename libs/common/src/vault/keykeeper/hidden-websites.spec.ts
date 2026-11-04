import { Cipher } from "../models/domain/cipher";
import { CipherView } from "../models/view/cipher.view";
import { LoginUriView } from "../models/view/login-uri.view";
import { LoginView } from "../models/view/login.view";

import { keepHiddenItemWebsites } from "./hidden-websites";

/** An item as stored or about to be saved: its websites stand for their ciphertext. */
function item(
  uris: string[],
  { hidden = true, org = "org-1" }: { hidden?: boolean; org?: string | null } = {},
): Cipher {
  return {
    id: "item-1",
    organizationId: org,
    viewPassword: !hidden,
    login: { uris: uris.map((uri) => ({ uri })) },
  } as unknown as Cipher;
}

/** Opens an item: each stored website is its address, unless the key moved on. */
const open =
  (keyMoved = false) =>
  async (cipher: Cipher) => {
    const view = new CipherView();
    view.login = new LoginView();
    view.login.uris = ((cipher.login?.uris ?? []) as unknown as { uri: string }[]).map((u) => {
      const uri = new LoginUriView();
      uri.uri = keyMoved && cipher !== stored ? "garbled" : u.uri;
      return uri;
    });
    return view;
  };

let stored: Cipher;

describe("Keykeeper: an item's websites for someone who can't see its passwords", () => {
  it("are sent exactly as stored, whatever the save had", async () => {
    stored = item(["https://bank.example.test"]);
    const toSave = item(["https://evil.example.test"]);

    await keepHiddenItemWebsites(toSave, stored, open());

    expect(toSave.login!.uris).toBe(stored.login!.uris);
  });

  it("refuse the save when the stored ones wouldn't open as they were", async () => {
    stored = item(["https://bank.example.test"]);
    const toSave = item(["https://bank.example.test"]);
    const sent = toSave.login!.uris;

    await expect(keepHiddenItemWebsites(toSave, stored, open(true))).rejects.toThrow(
      "its websites stay as they are",
    );
    expect(toSave.login!.uris).toBe(sent);
  });

  it("change as saved for someone who can see the passwords, and on a personal item", async () => {
    for (const s of [
      item(["https://a.test"], { hidden: false }),
      item(["https://a.test"], { org: null }),
    ]) {
      stored = s;
      const toSave = item(["https://b.test"]);
      const sent = toSave.login!.uris;

      await keepHiddenItemWebsites(toSave, stored, open());

      expect(toSave.login!.uris).toBe(sent);
    }
  });
});
