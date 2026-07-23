import { useProfile } from "../data/ProfileContext";
import { AgentStudioLayout, InfoDot } from "./AgentStudioLayout";

/* Agent Studio → "Agent Settings" page. Names derive from the profile; the
   Brand Conversation Rules come from reports.agentConfig (engine-generated). */

/* Fallback rules for profiles missing their own (e.g. generated before
   agentConfig existed). Derived from the customer name so the section always
   renders; freshly generated prospects get their own business-specific rules. */
function defaultRules(name: string): string[] {
  return [
    `Scope + disclosure: Act as a scheduling and intake assistant for ${name}. Capture the customer's need and key details, then schedule the right appointment or consultation with the local team.`,
    `Guidance + accuracy: Answer using approved knowledge only. If a customer is unsure, ask clarifying questions to route them correctly, and never quote exact pricing when it is confirmed at the appointment.`,
    `Low-friction booking: Ask one question at a time, always offer the earliest available slot first, and close with a clear confirmation — appointment window, address, and a summary of what was discussed.`,
  ];
}

export function AgentConfig() {
  const { profile } = useProfile();
  const name = profile.customerName;
  const configured = profile.reports.agentConfig?.brandConversationRules ?? [];
  const rules = configured.length ? configured : defaultRules(name);

  return (
    <AgentStudioLayout>
      <h2 className="ag-section-title">Agent Settings</h2>

      <label className="ag-field-label">Agent Name <InfoDot /></label>
      <input className="ag-input" value={name} readOnly />

      <label className="ag-field-label">Brand Name (optional) <InfoDot /></label>
      <input className="ag-input" value={name} readOnly />

      <div className="ag-sub">Profile <InfoDot /></div>
      <div className="ag-value">{profile.networkName}</div>

      <div className="ag-sub">Default Actions <InfoDot /></div>
      <ul className="ag-bullets"><li>Agent answers questions based on available knowledge</li></ul>

      <div className="ag-toggle-row">
        <span className="ag-switch" />
        <span className="ag-toggle-label">Utilize Digital Journey Context in Conversations <InfoDot /></span>
      </div>

      <div className="ag-sub">Brand Conversation Rules (optional) <InfoDot /></div>
      {rules.map((r, i) => (
        <div className="ag-rule" key={i}>
          <input className="ag-input ag-rule-input" value={r} readOnly />
          <span className="material-icons ag-rule-x">close</span>
        </div>
      ))}
      <button className="ag-add"><span className="material-icons">add</span> Add</button>
    </AgentStudioLayout>
  );
}
