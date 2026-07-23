import type { VoiceScreenpop } from "../data/schema";
import { renderScreenpop } from "./screenpop";

/* Voice Screenpop = the shared CTI screen-pop shell, in "Voice" flavor. */
export function renderVoiceScreenpop(d: VoiceScreenpop): string {
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
    channelTitle: "Inbound Call",
    aiSectionLabel: "AI Voice Agent",
    thirdRowLabel: "Switch Intent",
    thirdRowValue: d.switchIntent,
    overlayEmoji: "📞",
    overlayTitle: "Call Connected",
    overlaySubtitle: `You're now speaking with ${d.callerName}.`,
    greetingLabel: "Suggested Greeting:",
    greeting: d.greeting,
  });
}
