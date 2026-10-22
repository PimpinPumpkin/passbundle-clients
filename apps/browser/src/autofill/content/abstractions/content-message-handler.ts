import { ExtensionPageUrls } from "@bitwarden/common/vault/enums";
import { VaultMessages } from "@bitwarden/common/vault/enums/vault-messages.enum";

type ContentMessageWindowData = {
  command: string;
  lastpass?: boolean;
  code?: string;
  state?: string;
  data?: string;
  remember?: boolean;
  url?: ExtensionPageUrls;
};
type ContentMessageWindowEventParams = {
  data: ContentMessageWindowData;
  referrer: string;
};

type ContentMessageWindowEventHandlers = {
  [key: string]: ({ data, referrer }: ContentMessageWindowEventParams) => void;
  authResult: ({ data, referrer }: ContentMessageWindowEventParams) => void;
  webAuthnResult: ({ data, referrer }: ContentMessageWindowEventParams) => void;
  duoResult: ({ data, referrer }: ContentMessageWindowEventParams) => void;
  // Keykeeper: keyed by our own name for the install check (VaultMessages).
  [VaultMessages.checkBwInstalled]: () => void;
};

export {
  ContentMessageWindowData,
  ContentMessageWindowEventParams,
  ContentMessageWindowEventHandlers,
};
