import { Data, Effect, Either } from "effect";
import type { RepairReport, Snapshot, Waveform } from "../types/audio";

export class ApiError extends Data.TaggedError("ApiError")<{
  message: string;
  cause?: unknown;
}> {}

const failure = (cause: unknown) =>
  new ApiError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

// Effect owns each fetch and its abort signal. Interrupting a run also cancels
// response decoding, so obsolete waveform/audio requests cannot update the UI.
const json = <T>(url: string, options?: RequestInit) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(url, { ...options, signal }),
      catch: failure,
    });
    const result = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: failure,
    });
    if (!response.ok)
      return yield* Effect.fail(
        new ApiError({
          message: result.error || `Request failed (${response.status})`,
        }),
      );
    return result as T;
  });
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const api = {
  state: (revision: number) =>
    json<Snapshot>(`/api/state?revision=${revision}`),
  scan: (path: string, sensitivity: string) =>
    json("/api/scan", post({ path, sensitivity })),
  import: (file: File) =>
    json<{ path: string }>("/api/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
      },
      body: file,
    }),
  repair: (file: string, selected: number[]) =>
    json<RepairReport>("/api/repair", post({ file, selected })),
  waveform: (file: string, event: number, context: string) =>
    json<Waveform>(
      `/api/waveform?${new URLSearchParams({ file, event: String(event), context })}`,
    ),
  audio: (file: string, event: number) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(audioUrl(file, event, false), { signal }),
        catch: failure,
      });
      if (!response.ok)
        return yield* Effect.fail(
          new ApiError({
            message: "Audio could not be loaded; try rescanning the file.",
          }),
        );
      return yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: failure,
      });
    }),
};
export function audioUrl(file: string, event: number, repaired: boolean) {
  return `/api/audio?${new URLSearchParams({ file, event: String(event), repaired: repaired ? "1" : "0" })}`;
}
// Preserve the server's readable error at the React boundary instead of exposing
// Effect's FiberFailure wrapper. Interrupted runs are ignored by their owners.
export async function run<A>(
  effect: Effect.Effect<A, ApiError>,
  signal?: AbortSignal,
): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect), { signal });
  if (Either.isLeft(result)) throw result.left;
  return result.right;
}
