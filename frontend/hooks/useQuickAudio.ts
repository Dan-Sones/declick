import { useCallback, useEffect, useRef, useState } from "react";
import { api, run } from "../lib/api";

export function useQuickAudio(
  fileId: string | null,
  eventId: number | undefined,
  active: boolean,
  replay: number,
) {
  const [status, setStatus] = useState("");
  const context = useRef<AudioContext | null>(null);
  const playback = useRef<{
    source: AudioBufferSourceNode;
    gain: GainNode;
  } | null>(null);
  const unlock = useCallback(() => {
    context.current ??= new AudioContext();
    void context.current.resume().catch(() => {});
  }, []);

  useEffect(() => {
    if (!active || !fileId || eventId === undefined) return;
    const controller = new AbortController();
    setStatus("Loading original audio…");
    async function play() {
      try {
        context.current ??= new AudioContext();
        const audio = context.current;
        await audio.resume();
        if (controller.signal.aborted) return;
        const bytes = await run(
          api.audio(fileId!, eventId!),
          controller.signal,
        );
        const buffer = await audio.decodeAudioData(bytes);
        if (controller.signal.aborted) return;
        if (audio.state !== "running")
          throw new Error("Playback blocked. Press Replay to enable audio.");
        const source = audio.createBufferSource(),
          gain = audio.createGain();
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(audio.destination);
        playback.current = { source, gain };
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          if (!controller.signal.aborted) {
            playback.current = null;
            setStatus("P to go back · Y to stage · N to ignore · M to replay");
          }
        };
        source.start();
        setStatus("Playing original audio…");
      } catch (error) {
        if (!controller.signal.aborted) setStatus((error as Error).message);
      }
    }
    void play();
    return () => {
      controller.abort();
      const playing = playback.current;
      if (!playing) return;
      playback.current = null;
      const { source, gain } = playing,
        now = context.current!.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.01);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.stop(now + 0.01);
    };
  }, [fileId, eventId, active, replay]);

  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  return { status, setStatus, unlock };
}
