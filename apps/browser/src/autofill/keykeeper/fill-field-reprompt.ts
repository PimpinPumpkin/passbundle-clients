// Keykeeper: how a fill picker choice for an item that asks for the master
// password waits for the prompt (fill-field-menu.ts), shared with the prompt's
// popout (vault view.component.ts).

/** The prompt popout's action for a pick that waits for the master password. */
export const FILL_FIELD_REPROMPT_ACTION = "keykeeper-fill-field";

/** The popout's answer to the background: `{ cipherId, success }`. */
export const FILL_FIELD_REPROMPTED = "keykeeperFillFieldReprompted";
