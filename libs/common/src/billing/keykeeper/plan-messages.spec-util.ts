// Keykeeper: our own English messages (brand/messages.en.json), translated as
// the apps translate them, so the tests check the very sentences people read.
import * as fs from "node:fs";
import * as path from "node:path";

import { Translate } from "./plan-words";

type Message = { message: string; placeholders?: Record<string, { content: string }> };

const messages: Record<string, Message> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../../brand/messages.en.json"), "utf8"),
);

/** Translates a message key with its values, failing on a key that isn't there. */
export const translate: Translate = (key, ...values) => {
  const found = messages[key];
  if (found == null) {
    throw new Error(`No message "${key}" in brand/messages.en.json`);
  }
  let text = found.message;
  for (const [name, { content }] of Object.entries(found.placeholders ?? {})) {
    const index = Number(content.replace("$", "")) - 1;
    text = text.split(`$${name.toUpperCase()}$`).join(values[index] ?? "");
  }
  return text;
};

/** Dates in words as the tests read them: US English, in UTC. */
export const date = (value: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
