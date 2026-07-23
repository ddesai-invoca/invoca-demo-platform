import type { SmsScreenpop } from "../data/schema";
import { renderScreenpop } from "./screenpop";

/* SMS Screenpop = the shared CTI screen-pop shell, in "SMS" flavor. */
export function renderSmsScreenpop(d: SmsScreenpop): string {
  return renderScreenpop({
    brandName: d.brandName,
    callerName: d.callerName,
    callerPhone: d.callerPhone,
    campaign: d.campaign,
    tagGreen: d.tagGreen,
    tagBlue: d.tagBlue,
    estimatedValue: d.estimatedValue,
    googleSearch: d.googleSearch,
    websiteSearch: d.websiteSearch,
    callingWebpage: d.callingWebpage,
    products: d.products,
    cartId: d.cartId,
    serviceable: d.serviceable,
    email: d.email,
    street: d.street,
    city: d.city,
    state: d.state,
    zip: d.zip,
    digitalJourney: d.digitalJourney,
    intent: d.intent,
    coverage: d.coverage,
    channelTitle: "Inbound SMS",
    aiSectionLabel: "AI SMS Agent",
    thirdRowLabel: "Appointment",
    thirdRowValue: d.appointment,
    overlayEmoji: "💬",
    overlayTitle: "SMS Connected",
    overlaySubtitle: `Continuing SMS conversation with ${d.callerName}.`,
    greetingLabel: "Suggested Reply:",
    greeting: d.greeting,
  });
}
