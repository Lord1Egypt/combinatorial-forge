import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "e2e-admin-token-0123456789-abcdefghij";
let dir: string;
let server: ChildProcess | undefined;

async function startServer() {
  server = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        TURSO_DATABASE_URL: `file:${path.join(dir, "e2e.db")}`,
        ADMIN_TOKEN: ADMIN,
        FORGE_REQUIRE_DISTINCT_NETWORKS: "false",
        NODE_ENV: "production",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/v1/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not start");
}
async function stopServer() {
  server?.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
}

const admin = (request: APIRequestContext, route: string, body: object) =>
  request.post(`${BASE}/api/v1/admin/${route}`, {
    data: body,
    headers: { authorization: `Bearer ${ADMIN}` },
  });

async function jobCounts(request: APIRequestContext, runId: string) {
  const out: Record<string, number> = {};
  for (const status of ["pending", "leased", "running", "submitted", "verified"]) {
    const r = await request.get(`${BASE}/api/v1/explorer/jobs?run=${runId}&status=${status}&limit=1`);
    out[status] = (await r.json()).total;
  }
  return out;
}

async function discardIfOffered(page: Page) {
  // After Stop the page lists unfinished claims asynchronously; give the banner a moment to appear.
  const button = page.getByRole("button", { name: "Discard" });
  await button.waitFor({ state: "visible", timeout: 3000 }).catch(() => undefined);
  if (await button.isVisible()) {
    await button.click();
    await expect(button).toBeHidden();
  }
}

async function contribute(page: Page, until: () => Promise<boolean>) {
  await page.goto(`${BASE}/compute`);
  await expect(page.getByText("Not running. Nothing starts until you press Start.")).toBeVisible();
  await page.getByRole("button", { name: "Start contributing" }).click();
  await expect.poll(until, { timeout: 120_000, intervals: [300] }).toBe(true);
}

test.describe.serial("distributed lifecycle in real browsers", () => {
  let runId = "";
  let total = 0;
  test.beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "forge-e2e-"));
    await startServer();
  });
  test.afterEach(async ({ request }, info) => {
    if (info.status !== "passed" && runId)
      console.log("job counts at failure", JSON.stringify(await jobCounts(request, runId)), "total", total);
  });
  test.afterAll(async () => {
    await stopServer();
    rmSync(dir, { recursive: true, force: true });
  });

  test("API is healthy, a run can be created, and nothing computes until a person starts it", async ({
    request,
    browser,
  }) => {
    const health = await (await request.get(`${BASE}/api/v1/health`)).json();
    expect(health).toMatchObject({ database: "ok", schema_version: 3 });
    const created = await admin(request, "runs", { problem: "nqueens", n: 11, depth: 2 });
    expect(created.status()).toBe(201);
    ({ run_id: runId, total_jobs: total } = await created.json());
    expect(total).toBeGreaterThan(20);
    // visiting the compute page must not start work by itself
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/compute`);
    await expect(page.getByText("Not running. Nothing starts until you press Start.")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await jobCounts(request, runId)).toMatchObject({
      pending: total,
      leased: 0,
      running: 0,
      submitted: 0,
    });
    await context.close();
  });

  test("browser A computes with WebAssembly in a Web Worker; results are SUBMITTED, not verified", async ({
    request,
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await contribute(page, async () => (await jobCounts(request, runId)).submitted >= 3);
    await expect(page.getByText("Running")).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("Stopped. Unfinished work is saved.")).toBeVisible();
    await discardIfOffered(page); // give any in-flight job back to the pool
    const counts = await jobCounts(request, runId);
    expect(counts.verified).toBe(0);
    await context.close();
  });

  test("an interrupted browser offers to resume with progress, and resuming completes the job", async ({
    request,
    browser,
  }) => {
    // long jobs, so something is genuinely in flight when the tab is closed
    const heavy = await admin(request, "runs", { problem: "nqueens", n: 17, depth: 1, priority: 10 });
    const heavyRun = (await heavy.json()).run_id as string;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/compute`);
    await page.getByRole("button", { name: "Start contributing" }).click();
    await expect(page.getByRole("progressbar").first()).toBeVisible({ timeout: 60_000 });
    // wait until the browser is genuinely inside a long job (it verifies earlier small jobs first)
    await expect
      .poll(
        async () => {
          const c = await jobCounts(request, heavyRun);
          return c.leased + c.running;
        },
        { timeout: 60_000, intervals: [200] },
      )
      .toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Stop" }).click(); // the tab is closed mid-computation
    await page.reload();
    const banner = page.getByText(/Resume previous computation — \d+\.\d% complete/);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Nothing runs until you choose.")).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Running")).toBeVisible();
    await expect
      .poll(async () => (await jobCounts(request, heavyRun)).submitted, {
        timeout: 180_000,
        intervals: [500],
      })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Stop" }).click();
    await discardIfOffered(page);
    await context.close();
    // administrators can retire a run; the remaining heavy jobs must not distract the next tests
    const cancelled = await admin(request, "maintenance", { action: "cancel_run", run_id: heavyRun });
    expect((await cancelled.json()).cancelled).toBeGreaterThan(0);
  });

  test("two more independent browsers verify the whole run; the explorer shows the exact answer", async ({
    request,
    browser,
  }) => {
    // separate contexts have separate storage, so each is a different worker identity
    const pages: Page[] = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${BASE}/compute`);
      // Both contexts must keep working while Playwright brings the other tab to the foreground.
      await page.getByRole("checkbox", { name: "Pause when this tab is in the background" }).uncheck();
      await page.getByRole("button", { name: "Start contributing" }).click();
      pages.push(page);
    }
    await expect
      .poll(async () => (await jobCounts(request, runId)).verified, { timeout: 180_000, intervals: [500] })
      .toBe(total);
    for (const page of pages) await page.getByRole("button", { name: "Stop" }).click();
    const verified = await (
      await request.get(`${BASE}/api/v1/explorer/jobs?run=${runId}&status=verified&limit=200`)
    ).json();
    expect(verified.total).toBe(total);
    const sum = verified.jobs.reduce(
      (n: number, j: { verified_result: { solutions: number } }) => n + j.verified_result.solutions,
      0,
    );
    expect(sum).toBe(2680); // 11 queens
    const stats = await (await request.get(`${BASE}/api/v1/stats`)).json();
    const run = stats.runs.find((r: { run_id: string }) => r.run_id === runId);
    expect(run.complete).toBe(true);
    expect(run.aggregate.solutions).toBe(2680);
    // a trusted server-side recompute agrees with the browsers
    const audit = await admin(request, "verify", { job_id: verified.jobs[0].job_id, mode: "recompute" });
    expect((await audit.json()).status).toBe("verified");
    const viewer = await browser.newPage();
    await viewer.goto(`${BASE}/explorer/jobs?problem=nqueens&status=verified`);
    await expect(viewer.getByText(/jobs match/)).toBeVisible();
    await viewer.goto(`${BASE}/statistics`);
    await expect(viewer.getByText("2680").first()).toBeVisible();
    await viewer.close();
  });

  test("state survives a server restart", async ({ request }) => {
    await stopServer();
    await startServer();
    const stats = await (await request.get(`${BASE}/api/v1/stats`)).json();
    const run = stats.runs.find((r: { run_id: string }) => r.run_id === runId);
    expect(run).toMatchObject({ complete: true, total_jobs: total });
    expect(run.aggregate.solutions).toBe(2680);
  });

  test("explorers run the shared engine in the browser", async ({ browser }) => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/explorer/eight_puzzle`);
    await expect(page.getByText(/moves? from the goal/)).toBeVisible({ timeout: 30_000 });
    await page.goto(`${BASE}/explorer/tictactoe`);
    await expect(page.getByText(/With perfect play from here the result is/)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Square 5: empty" }).click();
    await expect(page.getByText(/O to move/)).toBeVisible();
    await page.goto(`${BASE}/explorer/lights_out`);
    await page.getByRole("button", { name: "Solve optimally" }).click();
    await expect(page.getByText(/Solvable in at least/)).toBeVisible({ timeout: 30_000 });
    await page.goto(`${BASE}/explorer/chess`);
    await expect(page.getByText("20", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "e2e4" }).click();
    await expect(page.getByText("1 ply from the start along this path")).toBeVisible();
    expect(errors).toEqual([]);
    await page.close();
  });
});
