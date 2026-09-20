import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, audioUrl, run } from "../lib/api";
import { useQuickAudio } from "./useQuickAudio";
import type {
  Candidate,
  Confidence,
  Recording,
  RepairReport,
  Snapshot,
  View,
  Waveform,
} from "../types/audio";

export function visibleEvents(
  recording: Recording | undefined,
  confidence: Confidence,
  sort: string,
) {
  return (recording?.events || [])
    .filter((item) => confidence === "all" || item.level === confidence)
    .sort(
      sort === "score"
        ? (a, b) =>
            b.confidence - a.confidence || a.sample_index - b.sample_index
        : (a, b) => a.sample_index - b.sample_index,
    );
}
const strongest = (events: Candidate[]) =>
  [...events].sort((a, b) => b.confidence - a.confidence)[0]?.id ?? null;
interface State {
  view: View;
  files: Recording[];
  fileId: string | null;
  eventId: number | null;
  revision: number;
  status: Snapshot["status"];
  serverErrors: string;
  sourcePath: string;
  sensitivity: string;
  confidence: Confidence;
  sort: string;
  selections: Map<string, Set<number>>;
  exporting: boolean;
  exported: (RepairReport & { fileId: string }) | null;
  error: string;
  scanStatus: string;
  importStatus: string;
  importing: boolean;
  pendingReview: boolean;
  preview: boolean;
  contextSize: string;
  sampleZoom: string;
  queue: Candidate[];
  queueFileId: string | null;
  quickIndex: number;
  replay: number;
  detailVersion: number;
}
const initial: State = {
  view: "home",
  files: [],
  fileId: null,
  eventId: null,
  revision: -1,
  status: "idle",
  serverErrors: "",
  sourcePath: "",
  sensitivity: "conservative",
  confidence: "all",
  sort: "time",
  selections: new Map(),
  exporting: false,
  exported: null,
  error: "",
  scanStatus: "Ready to scan",
  importing: false,
  pendingReview: false,
  importStatus:
    "Your original stays untouched. A working copy is stored locally, never sent to a cloud service.",
  preview: false,
  contextSize: "50",
  sampleZoom: "24",
  queue: [],
  queueFileId: null,
  quickIndex: 0,
  replay: 0,
  detailVersion: 0,
};
function startReview(s: State): State {
  const recording = s.files.find((item) => item.id === s.fileId);
  if (!recording || s.exporting || s.status === "scanning") return s;
  const queue = visibleEvents(recording, s.confidence, s.sort);
  return {
    ...s,
    queue,
    queueFileId: s.fileId,
    quickIndex: 0,
    view: "quick",
    preview: false,
    eventId: queue[0]?.id ?? s.eventId,
    replay: s.replay + 1,
    detailVersion: s.detailVersion + 1,
  };
}
function resetScan(s: State): State {
  return {
    ...s,
    status: "scanning",
    files: [],
    fileId: null,
    eventId: null,
    revision: -1,
    selections: new Map(),
    exported: null,
    pendingReview: true,
    queue: [],
    queueFileId: null,
    quickIndex: 0,
    scanStatus: "Scanning audio…",
    detailVersion: s.detailVersion + 1,
  };
}

export function useInspector() {
  const [s, set] = useState(initial);
  const patch = useCallback(
    (changes: Partial<State>) => set((s) => ({ ...s, ...changes })),
    [],
  );
  const current = useRef(s);
  const scanGeneration = useRef(0);
  useLayoutEffect(() => {
    current.current = s;
  }, [s]);
  const recording = s.files.find((item) => item.id === s.fileId);
  const item = recording?.events.find((item) => item.id === s.eventId);
  const events = visibleEvents(recording, s.confidence, s.sort);
  const selected = s.selections.get(s.fileId || "") || new Set<number>();
  const quickItem = s.queue[s.quickIndex];
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const candidateList = useRef<HTMLDivElement>(null);
  const quickNo = useRef<HTMLButtonElement>(null);
  const quickRestart = useRef<HTMLButtonElement>(null);
  const keepMinimapFocus = useRef(false);
  const timestamp = useRef<HTMLSpanElement>(null);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [wave, setWave] = useState<Waveform | null>(null);
  const [plotStatus, setPlotStatus] = useState("");
  const quickAudio = useQuickAudio(
    s.fileId,
    quickItem?.id,
    s.view === "quick",
    s.replay,
  );

  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      const revision = current.current.revision;
      const generation = scanGeneration.current;
      try {
        const snapshot = await run(api.state(revision), controller.signal);
        if (stopped) return;
        set((previous) => {
          // Ignore a poll that belonged to the scan preceding a new import.
          if (generation !== scanGeneration.current) return previous;
          let next = {
            ...previous,
            status: snapshot.status,
            scanStatus:
              snapshot.status === "scanning"
                ? `${snapshot.completed} / ${snapshot.total || "…"} files · ${snapshot.current}`
                : snapshot.status === "done"
                  ? `${snapshot.completed} file${snapshot.completed === 1 ? "" : "s"} scanned · ${snapshot.sensitivity}`
                  : snapshot.status === "error"
                    ? "Scan needs attention"
                    : "Ready to scan",
          };
          if (snapshot.files) {
            next.files = snapshot.files;
            next.revision = snapshot.revision;
            if (!next.sourcePath && snapshot.path) {
              next.sourcePath = snapshot.path;
              next.sensitivity = snapshot.sensitivity;
            }
            if (!next.files.some((file) => file.id === next.fileId)) {
              next.fileId = next.files[0]?.id ?? null;
              next.eventId = strongest(
                visibleEvents(next.files[0], next.confidence, next.sort),
              );
              next.detailVersion++;
            }
          }
          if (next.pendingReview && snapshot.status !== "scanning") {
            next.pendingReview = false;
            next.importStatus = next.fileId
              ? "Recording ready."
              : snapshot.errors.join("\n") || "No audio could be analysed.";
            if (next.fileId) next = startReview(next);
          }
          const errors = snapshot.errors.join("\n");
          if (errors !== next.serverErrors) {
            next.serverErrors = errors;
            next.error = errors;
          }
          return next;
        });
      } catch {
        if (!stopped)
          patch({
            scanStatus: "Connection lost. Is the local server running?",
          });
      } finally {
        if (!stopped)
          timer = setTimeout(
            refresh,
            current.current.status === "scanning" ? 600 : 2000,
          );
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [patch]);

  useEffect(() => {
    const controller = new AbortController();
    setWave(null);
    if (!s.fileId || s.eventId === null) {
      setPlotStatus("");
      return;
    }
    setPlotStatus("Loading waveform…");
    void run(
      api.waveform(s.fileId, s.eventId, s.contextSize),
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setWave(result);
        setPlotStatus(result.repair_error || "");
        if (result.repair_error)
          set((previous) => ({
            ...previous,
            preview: false,
            queue:
              previous.queueFileId === s.fileId
                ? previous.queue.map((event) =>
                    event.id === s.eventId
                      ? { ...event, repair_error: result.repair_error }
                      : event,
                  )
                : previous.queue,
            files: previous.files.map((file) =>
              file.id !== s.fileId
                ? file
                : {
                    ...file,
                    events: file.events.map((event) =>
                      event.id !== s.eventId
                        ? event
                        : { ...event, repair_error: result.repair_error },
                    ),
                  },
            ),
          }));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setPlotStatus(`Could not load waveform: ${error.message}`);
      });
    return () => controller.abort();
  }, [s.fileId, s.eventId, s.contextSize, s.detailVersion]);

  useLayoutEffect(() => {
    document.body.dataset.view = s.view;
  }, [s.view]);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (s.fileId && s.eventId !== null)
        audio.src = audioUrl(s.fileId, s.eventId, s.preview);
    }
    setCopyLabel("Copy");
  }, [s.fileId, s.eventId, s.preview, s.detailVersion]);
  useEffect(() => {
    audioRef.current?.pause();
  }, [s.view]);
  useEffect(() => {
    if (s.view !== "quick") return;
    if (keepMinimapFocus.current) {
      keepMinimapFocus.current = false;
      return;
    }
    if (quickItem) quickNo.current?.focus({ preventScroll: true });
    else quickRestart.current?.focus();
  }, [s.view, s.quickIndex, s.replay, quickItem]);

  function selectEvent(id: number | null) {
    const event = recording?.events.find((item) => item.id === id);
    set((s) => ({
      ...s,
      eventId: id,
      preview: event?.repair_error ? false : s.preview,
      detailVersion: s.detailVersion + 1,
    }));
  }
  function selectFile(id: string) {
    const next = s.files.find((file) => file.id === id);
    const idToSelect = strongest(visibleEvents(next, s.confidence, s.sort));
    const event = next?.events.find((item) => item.id === idToSelect);
    set((s) => ({
      ...s,
      fileId: id,
      eventId: idToSelect,
      preview: event?.repair_error ? false : s.preview,
      detailVersion: s.detailVersion + 1,
    }));
  }
  function filter(confidence: Confidence, sort = s.sort) {
    const next = visibleEvents(recording, confidence, sort);
    const id = next.some((item) => item.id === s.eventId)
      ? s.eventId
      : (next[0]?.id ?? null);
    const candidate = next.find((item) => item.id === id);
    set((s) => ({
      ...s,
      confidence,
      sort,
      eventId: id,
      preview: candidate?.repair_error ? false : s.preview,
      detailVersion: s.detailVersion + 1,
    }));
  }
  function toggleRepair(id: number, checked: boolean) {
    set((s) => {
      if (!s.fileId) return s;
      const selections = new Map(s.selections),
        ids = new Set(selections.get(s.fileId));
      if (checked) ids.add(id);
      else ids.delete(id);
      selections.set(s.fileId, ids);
      return { ...s, selections, exported: null };
    });
  }
  function selectShown(clear = false) {
    if (!s.fileId) return;
    const ids = clear
      ? new Set<number>()
      : new Set([
          ...selected,
          ...events.filter((item) => !item.repair_error).map((item) => item.id),
        ]);
    patch({
      selections: new Map(s.selections).set(s.fileId, ids),
      exported: null,
    });
  }
  function navigate(delta: number) {
    const next =
      events[events.findIndex((item) => item.id === s.eventId) + delta];
    if (!next) return;
    selectEvent(next.id);
    requestAnimationFrame(() =>
      candidateList.current
        ?.querySelector(".selected")
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  function startQuickReview(confidence = s.confidence) {
    quickAudio.unlock();
    set((s) => startReview({ ...s, confidence }));
  }
  function goQuick() {
    if (!recording) {
      patch({ view: "home" });
      return;
    }
    if (
      s.queueFileId === s.fileId &&
      s.queue.some((candidate) => candidate.id === item?.id)
    ) {
      quickAudio.unlock();
      patch({
        view: "quick",
        eventId: quickItem?.id ?? s.eventId,
        replay: s.replay + 1,
      });
    } else startQuickReview();
  }
  function decideQuick(stage: boolean) {
    if (!quickItem) return;
    if (stage && quickItem.repair_error) {
      quickAudio.setStatus(quickItem.repair_error);
      return;
    }
    toggleRepair(quickItem.id, stage);
    set((s) => ({
      ...s,
      quickIndex: s.quickIndex + 1,
      eventId: s.queue[s.quickIndex + 1]?.id ?? s.eventId,
      detailVersion: s.detailVersion + 1,
    }));
  }
  function jumpQuick(id: number) {
    const index = s.queue.findIndex((candidate) => candidate.id === id);
    if (s.view !== "quick" || s.queueFileId !== s.fileId || index < 0) return;
    keepMinimapFocus.current = true;
    quickAudio.unlock();
    patch({
      quickIndex: index,
      eventId: id,
      replay: s.replay + 1,
      detailVersion: s.detailVersion + 1,
    });
  }
  function previousQuick() {
    if (s.view !== "quick" || s.quickIndex <= 0) return;
    patch({
      quickIndex: s.quickIndex - 1,
      eventId: s.queue[s.quickIndex - 1].id,
      detailVersion: s.detailVersion + 1,
    });
  }
  function replayQuick() {
    quickAudio.unlock();
    patch({ replay: s.replay + 1 });
  }

  useEffect(() => {
    const keydown = (key: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (key.altKey || key.ctrlKey || key.metaKey) return;
      if (s.view === "quick") {
        if (["INPUT", "SELECT", "TEXTAREA"].includes(tag || "") || key.repeat)
          return;
        const letter = key.key.toLowerCase();
        if (letter === "p") {
          key.preventDefault();
          previousQuick();
        }
        if (letter === "m" && quickItem) {
          key.preventDefault();
          replayQuick();
        }
        if (["y", "n"].includes(letter)) {
          key.preventDefault();
          decideQuick(letter === "y");
        }
      } else if (
        !["INPUT", "SELECT", "TEXTAREA", "AUDIO", "BUTTON"].includes(
          tag || "",
        ) &&
        ["ArrowLeft", "ArrowRight"].includes(key.key)
      ) {
        key.preventDefault();
        navigate(key.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });

  // Synchronous locks prevent duplicate mutations before React commits a render.
  const importing = useRef(false),
    scanning = useRef(false),
    exporting = useRef(false);
  async function scan() {
    if (scanning.current) return;
    scanning.current = true;
    patch({ error: "", status: "scanning" });
    try {
      await run(api.scan(s.sourcePath, s.sensitivity));
      scanGeneration.current++;
      set(resetScan);
    } catch (error) {
      patch({ error: (error as Error).message, status: s.status });
    } finally {
      scanning.current = false;
    }
  }
  async function importAudioFiles(files: FileList | File[]) {
    if (importing.current || s.status === "scanning") {
      patch({
        importStatus: "Please wait for the current import or scan to finish.",
      });
      return;
    }
    const chosen = files[0];
    if (!chosen) return;
    const resetInput = () => {
      if (fileInput.current) fileInput.current.value = "";
    };
    if (files.length !== 1) {
      patch({ importStatus: "Please choose one recording at a time." });
      resetInput();
      return;
    }
    if (!/\.(aif|aiff|aifc|wav)$/i.test(chosen.name)) {
      patch({ importStatus: "Choose an AIFF or WAV file." });
      resetInput();
      return;
    }
    importing.current = true;
    patch({
      importing: true,
      importStatus: "Copying locally and preparing analysis…",
    });
    try {
      if (chosen.size > 2 * 1024 ** 3)
        throw new Error("Choose a file smaller than 2 GiB.");
      const result = await run(api.import(chosen));
      scanGeneration.current++;
      set((s) => ({
        ...resetScan(s),
        sourcePath: result.path,
        importStatus: "Finding clicks and dropouts…",
      }));
    } catch (error) {
      patch({ importStatus: (error as Error).message });
    } finally {
      importing.current = false;
      patch({ importing: false });
      resetInput();
    }
  }
  async function exportRepair() {
    if (!recording || !selected.size || exporting.current) return;
    exporting.current = true;
    patch({ exporting: true, error: "" });
    try {
      const report = await run(api.repair(recording.id, [...selected]));
      patch({ exported: { ...report, fileId: recording.id } });
    } catch (error) {
      patch({ error: (error as Error).message });
    } finally {
      exporting.current = false;
      patch({ exporting: false });
    }
  }
  async function copyTime() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.timestamp);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Select to copy");
      if (!timestamp.current) return;
      const range = document.createRange();
      range.selectNodeContents(timestamp.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }
  return {
    s,
    patch,
    recording,
    item,
    events,
    selected,
    quickItem,
    wave,
    plotStatus,
    setPlotStatus,
    audioRef,
    fileInput,
    candidateList,
    quickNo,
    quickRestart,
    timestamp,
    copyLabel,
    quickStatus: quickAudio.status,
    selectEvent,
    selectFile,
    filter,
    toggleRepair,
    selectShown,
    navigate,
    startQuickReview,
    goQuick,
    decideQuick,
    previousQuick,
    jumpQuick,
    replayQuick,
    scan,
    importAudioFiles,
    exportRepair,
    copyTime,
  };
}
export type Inspector = ReturnType<typeof useInspector>;
