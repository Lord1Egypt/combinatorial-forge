"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTENSITY_PRESETS, detectCapabilities, type Capabilities } from "@/browser/capabilities";
import { ComputeController, type ComputeSnapshot } from "@/browser/controller";
import { spawnEngineWorker } from "@/browser/engine-client";
import { ClaimStore, formatPermille, overallProgressPermille, type StoredClaim } from "@/browser/store";

const PROBLEMS = [
  { id: "nqueens", label: "N-Queens (counting placements)" },
  { id: "chess", label: "Chess (counting move sequences by depth)" },
] as const;

function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
}

async function workerIdentity(store: ClaimStore): Promise<string> {
  const existing = await store.getMeta<string>("worker_id");
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = "w-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await store.setMeta("worker_id", id);
  return id;
}

export function ComputePanel() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [workers, setWorkers] = useState(1);
  const [intensity, setIntensity] = useState(0.5);
  const [problem, setProblem] = useState<(typeof PROBLEMS)[number]["id"]>("nqueens");
  const [pauseHidden, setPauseHidden] = useState(true);
  const [snapshot, setSnapshot] = useState<ComputeSnapshot | null>(null);
  const [saved, setSaved] = useState<StoredClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<ComputeController | null>(null);
  const store = useRef<ClaimStore | null>(null);
  const autoPaused = useRef(false);

  useEffect(() => {
    const c = detectCapabilities();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only initialisation after hydration
    setCaps(c);
    setWorkers(c.defaultWorkers);
    setIntensity(c.defaultIntensity);
    if (!c.supported) return;
    ClaimStore.open()
      .then(async (s) => {
        store.current = s;
        setSaved(await s.listClaims(""));
      })
      .catch(() =>
        setError("This browser blocks local storage for the site, so work cannot be saved between visits."),
      );
    return () => store.current?.close();
  }, []);

  // Pause automatically while the tab is hidden, to spare battery and background CPU.
  useEffect(() => {
    const onVisibility = () => {
      const c = controller.current;
      if (!c || !pauseHidden) return;
      if (document.hidden && c.snapshot().status === "running") {
        c.pause();
        autoPaused.current = true;
      } else if (!document.hidden && autoPaused.current) {
        autoPaused.current = false;
        c.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pauseHidden]);

  const begin = useCallback(
    async (resume: StoredClaim[]) => {
      if (!store.current || !caps) return;
      setError(null);
      const c = new ComputeController(
        {
          baseUrl: "",
          fetchFn: (input, init) => fetch(input, init),
          store: store.current,
          spawn: () => spawnEngineWorker(),
          workerId: await workerIdentity(store.current),
          problem,
        },
        { workers, intensity },
      );
      controller.current = c;
      c.subscribe(setSnapshot);
      c.start(resume);
      setSaved([]);
    },
    [caps, problem, workers, intensity],
  );

  async function stop() {
    await controller.current?.stop();
    if (store.current) setSaved(await store.current.listClaims(""));
  }
  async function discard() {
    await controller.current?.discard();
    if (store.current) {
      for (const claim of await store.current.listClaims("")) await store.current.deleteClaim(claim.job_id);
      setSaved([]);
    }
  }

  if (!caps) return <p className="muted">Checking what this browser can do…</p>;
  if (!caps.supported)
    return (
      <div className="notice">
        This browser cannot contribute: it is missing {caps.missing.join(", ")}. The explorer and statistics
        still work.
      </div>
    );

  const status = snapshot?.status ?? "idle";
  const active = status === "running" || status === "paused";
  const progress = overallProgressPermille(saved);
  return (
    <>
      {saved.length > 0 && !active ? (
        <div className="panel research" role="region" aria-label="Unfinished computation">
          <strong>Resume previous computation — {formatPermille(progress)} complete</strong>
          <p style={{ marginTop: "0.4rem" }}>
            {saved.length} unfinished job{saved.length === 1 ? "" : "s"} saved in this browser. Nothing runs
            until you choose.
          </p>
          <div className="row-actions" style={{ marginTop: "0.75rem" }}>
            <button className="btn" type="button" onClick={() => begin(saved)}>
              Resume
            </button>
            <button className="btn quiet" type="button" onClick={discard}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <div className="cols">
        <div>
          <label htmlFor="problem">Problem</label>
          <select
            id="problem"
            value={problem}
            disabled={active}
            onChange={(e) => setProblem(e.target.value as typeof problem)}
          >
            {PROBLEMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <dl className="kv">
            <dt>Logical CPUs detected</dt>
            <dd className="num">{caps.logicalCpus}</dd>
            <dt>Device</dt>
            <dd>{caps.mobile ? "Mobile, so defaults are conservative" : "Desktop or laptop"}</dd>
          </dl>
          <label htmlFor="workers">
            Workers: <span className="num">{workers}</span>
          </label>
          <input
            id="workers"
            type="range"
            min={1}
            max={caps.maxWorkers}
            value={workers}
            disabled={active}
            onChange={(e) => setWorkers(Number(e.target.value))}
          />
          <label id="intensity-label">Compute intensity: {Math.round(intensity * 100)}%</label>
          <div className="chips" role="group" aria-labelledby="intensity-label">
            {INTENSITY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                aria-pressed={intensity === p.intensity}
                disabled={active}
                onClick={() => setIntensity(p.intensity)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={pauseHidden} onChange={(e) => setPauseHidden(e.target.checked)} />{" "}
            Pause when this tab is in the background
          </label>
          <div className="row-actions">
            {!active ? (
              <button className="btn" type="button" onClick={() => begin([])}>
                Start contributing
              </button>
            ) : (
              <>
                {status === "running" ? (
                  <button className="btn quiet" type="button" onClick={() => controller.current?.pause()}>
                    Pause
                  </button>
                ) : (
                  <button className="btn" type="button" onClick={() => controller.current?.resume()}>
                    Resume
                  </button>
                )}
                <button className="btn quiet" type="button" onClick={stop}>
                  Stop
                </button>
              </>
            )}
          </div>
          {error ? <p className="error">{error}</p> : null}
        </div>

        <div aria-live="polite">
          <dl className="kv" style={{ marginTop: 0 }}>
            <dt>Status</dt>
            <dd>
              {status === "idle"
                ? "Not running. Nothing starts until you press Start."
                : status === "running"
                  ? "Running"
                  : status === "paused"
                    ? "Paused"
                    : status === "stopped"
                      ? "Stopped. Unfinished work is saved."
                      : "Stopped by an error"}
            </dd>
            <dt>Jobs completed</dt>
            <dd className="num">{snapshot?.jobsCompleted ?? 0}</dd>
            <dt>Nodes processed</dt>
            <dd className="num">{(snapshot?.nodesProcessed ?? 0).toLocaleString("en-US")}</dd>
            <dt>Contribution time</dt>
            <dd className="num">{duration(snapshot?.runtimeMs ?? 0)}</dd>
          </dl>
          {snapshot?.current.map((c) => (
            <div key={c.job_id} style={{ marginTop: "0.9rem" }}>
              <span className="mono">Job {c.job_id.slice(0, 10)}</span>{" "}
              <span className="num">{formatPermille(c.progress_permille)}</span>
              <div
                className="progress"
                role="progressbar"
                aria-valuenow={Math.round(c.progress_permille / 10)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Job ${c.job_id.slice(0, 10)} progress`}
              >
                <i style={{ width: `${c.progress_permille / 10}%` }} />
              </div>
            </div>
          ))}
          {snapshot?.message ? (
            <p className={status === "error" ? "error" : "muted"}>{snapshot.message}</p>
          ) : null}
        </div>
      </div>

      <h2>What your computer does</h2>
      <p>
        It counts. Each work unit is a small, exactly defined piece of an exhaustive search, such as the
        number of ways to finish a partial N-Queens board or the number of legal move sequences below a chess
        position. Your browser runs the same C++ engine used everywhere else, compiled to WebAssembly, inside
        background workers.
      </p>
      <p>
        This is not cryptocurrency mining and does not earn anyone money. It never starts on its own, it can
        be paused or stopped at any time, and results are only trusted after an independent computer
        reproduces them. Closing the tab is safe: progress is saved on this device.
      </p>
    </>
  );
}
