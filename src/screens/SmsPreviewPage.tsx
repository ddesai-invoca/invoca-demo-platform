import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { PhonePreview } from "./PhonePreview";

/* Standalone browser-tab version of the "Preview Agent" SMS chat. The Agent
   Workflow's Preview Agent button opens this route in a new tab (window.open)
   instead of an in-app modal. Renders full-page (no app shell); the chat is
   captured to the SMS Conversation Intelligence report on exit (see PhonePreview). */
export function SmsPreviewPage() {
  const { profile } = useProfile();
  /* ?wf=<slug> selects an extra workflow's agent (e.g. Reyes Law's SMS nurture)
     so the tab previews THAT playbook rather than the default sales one. */
  const [params] = useSearchParams();
  const wf = params.get("wf");
  const label = (profile.reports.extraWorkflows ?? []).find((w) => w.slug === wf)?.label;

  useEffect(() => {
    const prev = document.title;
    document.title = `Preview Agent — ${label ?? profile.customerName}`;
    return () => { document.title = prev; };
  }, [profile.customerName, label]);

  return <PhonePreview mode="page" wf={wf} />;
}
