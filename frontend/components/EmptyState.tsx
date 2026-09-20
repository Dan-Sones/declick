import { useInspectorContext } from "../app/InspectorContext";

export function EmptyState() {
  const m = useInspectorContext();
  const { recording, item } = m;
  return (
    <div id="empty-state" className={`empty-state ${item ? "hidden" : ""}`}>
      <div className="empty-wave" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
      </div>
      <p className="eyebrow">EVERY SAMPLE TELLS A STORY</p>
      <h2>
        {recording
          ? recording.events.length
            ? "No candidates in this view."
            : "A clean view at this sensitivity."
          : "Bring a recording into focus."}
      </h2>
      <p>
        {recording
          ? recording.events.length
            ? "Choose another confidence level to inspect more candidates."
            : `${recording.name} has no reported candidates. If you hear a fault, try normal sensitivity or use a known timestamp to guide further analysis.`
          : "Enter a local audio path above. Select a candidate to see its waveform, inspect individual samples, and listen to the surrounding audio."}
      </p>
      <span className="empty-tag">50 ms context + sample-level detail</span>
    </div>
  );
}
