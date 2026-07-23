import { Link } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";

/* Agent Studio — one AI agent per customer with a Voice + SMS workflow.
   All names derive from the customer, so this re-skins for any prospect.
   The agent and its workflows open the agent configuration editor. */
export function AgentStudio() {
  const { profile } = useProfile();
  const name = profile.customerName;
  const updated = "07/10/2026 1:46 PM";

  const workflows = [
    { label: `Workflow: ${name} - Voice`, to: "/agent-studio/agent/workflow/voice", status: "Live", channel: "Voice", type: "Network", triggeredBy: "1 Campaign", updated, live: updated },
    { label: `Workflow: ${name} - SMS`, to: "/agent-studio/agent/workflow/sms", status: "Live", channel: "SMS", type: "Network", triggeredBy: "1 Campaign", updated, live: updated },
  ];

  return (
    <div className="as-page">
      <div className="as-head">
        <h1 className="as-title">Agent Studio</h1>
        <button className="as-create"><span className="material-icons">add</span>Create AI Agent</button>
      </div>

      <table className="as-table">
        <thead>
          <tr>
            <th className="as-col-name">Name</th>
            <th>Status</th>
            <th>Channel</th>
            <th>Type</th>
            <th>Triggered By</th>
            <th className="as-sorted">Last Updated <span className="material-icons">arrow_downward</span></th>
            <th>Went Live On</th>
            <th className="as-col-menu"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="as-agent-row">
            <td className="as-name">
              <span className="material-icons as-chevron">expand_more</span>
              <Link to="/agent-studio/agent" className="as-link">Agent: {name}</Link>
            </td>
            <td></td>
            <td></td>
            <td>Network</td>
            <td></td>
            <td>{updated}</td>
            <td className="as-dash">-</td>
            <td className="as-menu"><span className="material-icons">more_vert</span></td>
          </tr>
          {workflows.map((w) => (
            <tr className="as-wf-row" key={w.label}>
              <td className="as-name as-indent"><Link to={w.to} className="as-link">{w.label}</Link></td>
              <td><span className="as-status-live">{w.status}</span></td>
              <td>{w.channel}</td>
              <td>{w.type}</td>
              <td><span className="as-pill">{w.triggeredBy}</span></td>
              <td>{w.updated}</td>
              <td>{w.live}</td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
