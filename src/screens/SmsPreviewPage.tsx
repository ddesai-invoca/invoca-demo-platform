import { useEffect } from "react";
import { useProfile } from "../data/ProfileContext";
import { PhonePreview } from "./PhonePreview";

/* Standalone browser-tab version of the "Preview Agent" SMS chat. The Agent
   Workflow's Preview Agent button opens this route in a new tab (window.open)
   instead of an in-app modal. Renders full-page (no app shell); the chat is
   captured to the SMS Conversation Intelligence report on exit (see PhonePreview). */
export function SmsPreviewPage() {
  const { profile } = useProfile();
  useEffect(() => {
    const prev = document.title;
    document.title = `Preview Agent — ${profile.customerName}`;
    return () => { document.title = prev; };
  }, [profile.customerName]);

  return <PhonePreview mode="page" />;
}
