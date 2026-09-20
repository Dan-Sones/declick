import { useInspectorContext } from "../app/InspectorContext";
import { useEffect, useRef, useState, type DragEvent } from "react";

const isFileDrag = (e: DragEvent | globalThis.DragEvent) =>
  Array.from(e.dataTransfer?.types || []).includes("Files");

export function Home() {
  const m = useInspectorContext();
  const { s, recording } = m;
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const busy = s.importing || s.status === "scanning";
  function dragEnter(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current++;
    if (!busy) setDragging(true);
  }
  function dragLeave() {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  }
  function dragOver(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = busy ? "none" : "copy";
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    void m.importAudioFiles(e.dataTransfer.files);
  }
  useEffect(() => {
    function prevent(e: globalThis.DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.type === "drop") {
        depth.current = 0;
        setDragging(false);
      }
    }
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", prevent);
    return () => {
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", prevent);
    };
  }, []);
  return (
    <section id="home-view" className="home-view">
      <p className="eyebrow">A CLEANER TAKE, ONE CLICK AT A TIME</p>
      <h1>
        Keep the music.
        <br />
        Lose the clicks.
      </h1>
      <p>
        Choose a recording, listen to each interruption, and decide what stays.
      </p>
      <label
        id="file-drop-zone"
        htmlFor="audio-file"
        aria-busy={s.importing}
        onDragEnter={dragEnter}
        onDragLeave={dragLeave}
        onDragOver={dragOver}
        onDrop={drop}
        className={`file-picker ${dragging ? "drag-over" : ""}`}
      >
        <span className="picker-icon">＋</span>
        <strong>Drop an audio file here</strong>
        <span>or click to browse · AIFF or WAV · up to 2 GiB</span>
      </label>
      <input
        id="audio-file"
        type="file"
        accept=".aif,.aiff,.aifc,.wav"
        className="file-input"
        ref={m.fileInput}
        disabled={s.importing}
        onChange={(e) => void m.importAudioFiles(e.target.files || [])}
      />
      <p id="import-status" role="status">
        {s.importStatus}
      </p>
      <button
        id="continue-review"
        className={`button secondary ${recording ? "" : "hidden"}`}
        onClick={() => m.startQuickReview()}
      >
        Continue current recording
      </button>{" "}
      <button
        id="advanced-open"
        className="button secondary"
        onClick={() => m.patch({ view: "detail" })}
      >
        Open by path / folder
      </button>
    </section>
  );
}
