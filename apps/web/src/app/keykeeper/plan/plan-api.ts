// Keykeeper: the plan routes the Plan page calls (DESIGN.md, "Plans and
// billing", "How a plan reaches the clients", API). `GET /api/keykeeper/plan`
// answers what the sync carries, for the plan of a person, an organization,
// or an MSP's pool, to whoever may manage it. `POST /api/keykeeper/plan/pay`
// and `/manage` answer an address on the provider's site, and exist only
// where a provider is set; the page asks for one only when `keykeeperPlan`
// says the person can pay (`canPay`). `GET /api/keykeeper/plan/invoices`
// answers the months a plan billed by the day was invoiced for, to the same
// people.
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import {
  KeykeeperPlan,
  KeykeeperPlanEnforced,
  keykeeperPlanFrom,
} from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import {
  KeykeeperPlanInvoice,
  planInvoicesFrom,
} from "@bitwarden/common/billing/keykeeper/plan-invoices";
import {
  PlanAction,
  planToPayFor,
  PlanWhose,
} from "@bitwarden/common/billing/keykeeper/plan-words";

/** Whose plan, as the plan routes name it: nothing for the person asking. */
export function whoseFields(whose: PlanWhose): { organization?: string; msp?: string } {
  switch (whose.kind) {
    case "organization":
      return { organization: whose.id };
    case "msp":
      return { msp: whose.id };
    default:
      return {};
  }
}

/** An MSP's pool, for its admins. */
export async function poolPlan(apiService: ApiService, mspId: string): Promise<KeykeeperPlan> {
  const answer = await apiService.send(
    "GET",
    `/keykeeper/plan?msp=${encodeURIComponent(mspId)}`,
    null,
    true,
    true,
  );
  return keykeeperPlanFrom(answer);
}

/**
 * The provider's page to pay or put a card on file for this plan, or to
 * manage it. Only an https address is opened.
 */
export async function providerPageAddress(
  apiService: ApiService,
  action: PlanAction,
  whose: PlanWhose,
  plan: KeykeeperPlanEnforced,
): Promise<string> {
  const body =
    action === "pay"
      ? { ...whoseFields(whose), plan: planToPayFor(plan) }
      : { ...whoseFields(whose) };
  const answer = await apiService.send("POST", `/keykeeper/plan/${action}`, body, true, true);
  const address = (answer as { url?: unknown } | null)?.url;
  if (typeof address !== "string" || !address.startsWith("https://")) {
    throw new Error("The server didn't send a payment page to open.");
  }
  return address;
}

/** The months a plan billed by the day was invoiced for, newest first. */
export async function planInvoices(
  apiService: ApiService,
  whose: PlanWhose,
): Promise<KeykeeperPlanInvoice[]> {
  const fields = whoseFields(whose);
  const query = new URLSearchParams(fields as Record<string, string>).toString();
  const answer = await apiService.send(
    "GET",
    `/keykeeper/plan/invoices${query === "" ? "" : `?${query}`}`,
    null,
    true,
    true,
  );
  return planInvoicesFrom(answer);
}
