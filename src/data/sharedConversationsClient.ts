/* =============================================================================
   The signed-in half of engine/sharedConversations.ts (10/21/2026): the conversations
   prospects had on this demo's shared links, for the AI SMS / AI Voice reports, and the
   deep link the event sheet's "Open conversation" uses:
     /reports/<sms|voice>-conversation-intelligence?demo=<demoId>&conv=<conversationId>
   ============================================================================= */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useProfile } from "./ProfileContext";
import { useDemoLibrary } from "./DemoLibraryContext";
import { useAiAssistant } from "./AiAssistantContext";
import { CustomerProfile } from "./schema";
import { isShareMode } from "./shareMode";

export interface SharedConversationRow<T> { conversation: T; email: string; createdAt: string }

/** A demo's shared-link conversations of one kind, newest first. Empty on a shared link itself,
 *  for a demo that is not in the library, or for somebody who may not read them. */
export function useSharedConversations<T extends { id: string }>(demoId: string, kind: "sms" | "voice"): SharedConversationRow<T>[] {
  const [rows, setRows] = useState<SharedConversationRow<T>[]>([]);
  useEffect(() => {
    setRows([]);
    if (isShareMode() || !demoId) return;
    let live = true;
    fetch(`/api/demos/${encodeURIComponent(demoId)}/shared-conversations?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !Array.isArray(j?.conversations)) return;
        setRows(j.conversations.map((c: { conversation: T; email?: string; createdAt?: string }) => ({
          conversation: c.conversation, email: c.email || "", createdAt: c.createdAt || "",
        })));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [demoId, kind]);
  return rows;
}

/** The `?conv=` a link from the event sheet carries, for the report to select. */
export function useConvParam(): string | undefined {
  const [params] = useSearchParams();
  return params.get("conv") ?? undefined;
}

/**
 * Follow a link from the event sheet: open `?demo=` when it is not the active prospect.
 * ⚠️ A COMPONENT, rendered only in the signed-in app: a shared demo mounts neither the demo
 * library nor Ask AI, and their hooks throw without their providers.
 */
export function DemoFromLink(): null {
  const [params] = useSearchParams();
  const demo = params.get("demo") ?? "";
  const { profileId, setProfileId, addProfile } = useProfile();
  const { openDemo } = useDemoLibrary();
  const { hydrateDemo } = useAiAssistant();
  const tried = useRef("");
  useEffect(() => {
    if (!demo || demo === profileId || tried.current === demo) return;
    tried.current = demo;
    void (async () => {
      const loaded = await openDemo(demo);
      const parsed = loaded && CustomerProfile.safeParse(loaded.demo.profile);
      if (!loaded || !parsed?.success) return;
      addProfile(parsed.data);
      hydrateDemo(loaded.demo.id, loaded.demo.customizations, loaded.canEdit, loaded.demo.creator);
      setProfileId(parsed.data.id);
    })();
  }, [demo, profileId, openDemo, addProfile, hydrateDemo, setProfileId]);
  return null;
}
