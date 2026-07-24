// The phase 6 milestone, in two zero-network halves.
//
// The seam between them is honest, not a workaround: request fingerprints hash
// the page bytes, and PNG byte-stability across pdfium/Pillow versions is
// explicitly not forge's contract — so a workdir the server just rendered can
// never match fixtures recorded against committed renders. Half (a) therefore
// drives the estimate gate over a real PDF with a real preprocess and stops at
// the gate; half (b) starts from a workdir fabricated out of those committed
// renders and drives the rest — pipeline view, run, review, correction,
// publish. The real-module half (a genuine PDF converted with a live provider)
// runs by hand and is recorded in the PR.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const MINIMOD = join(__dirname, "..", "assets", "minimod");
const PAGE_COUNT = 5;

// The editor-side twin of forge's own `minimod_workdir`: the estimate's
// product, built from the committed renders the fixtures were recorded
// against.
function fabricateWarmWorkdir(root: string): void {
  mkdirSync(root, { recursive: true });
  cpSync(join(MINIMOD, "minimod.pdf"), join(root, "source.pdf"));
  cpSync(join(MINIMOD, "pages"), join(root, "pages"), { recursive: true });
  const pending = { status: "pending" };
  writeFileSync(
    join(root, "run.json"),
    JSON.stringify(
      {
        source_sha256: "0".repeat(64),
        source_bytes: 1,
        page_count: PAGE_COUNT,
        settings: {},
        stages: {
          preprocess: {
            status: "completed",
            started_at: "2026-07-09T12:00:00+00:00",
            finished_at: "2026-07-09T12:00:05+00:00",
          },
          survey: pending,
          content: pending,
          monsters: pending,
          geometry: pending,
          assemble: pending,
        },
      },
      null,
      2,
    ),
  );
}

test("the estimate gate: a real PDF priced before anything is spent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workspace = mkdtempSync(join(tmpdir(), "osr-editor-estimate-e2e-"));
  const destination = join(workspace, "minimod.forge");

  await page.goto("/");
  await page.getByRole("button", { name: "Convert a PDF" }).click();

  // The destination prefills from the source — the CLI's default, editable.
  await page.getByLabel("Module PDF").fill(join(MINIMOD, "minimod.pdf"));
  await expect(page.getByLabel("Destination workdir")).toHaveValue(
    join(MINIMOD, "minimod.forge"),
  );
  await page.getByLabel("Destination workdir").fill(destination);

  // The server really preprocesses: five pages rendered, then pure arithmetic.
  await page.getByRole("button", { name: "Estimate" }).click();
  await expect(page.getByTestId("estimate-card")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("estimate-card")).toContainText(
    `Converting this ${PAGE_COUNT}-page module will cost roughly`,
  );
  await expect(page.getByTestId("estimate-usd")).toContainText("$");
  await expect(page.getByTestId("estimate-card")).toContainText(
    "A rough estimate, not a quote",
  );

  // Declining costs nothing and destroys nothing: the rendered workdir stays.
  await page.getByRole("button", { name: "Not now" }).click();
  expect(existsSync(join(destination, "run.json"))).toBe(true);
  expect(existsSync(join(destination, "pages", "0001.png"))).toBe(true);
  expect(existsSync(join(destination, "source.pdf"))).toBe(true);
  const run = JSON.parse(
    readFileSync(join(destination, "run.json"), "utf-8"),
  ) as {
    page_count: number;
    stages: Record<string, { status: string }>;
  };
  expect(run.page_count).toBe(PAGE_COUNT);
  expect(run.stages.preprocess.status).toBe("completed");
  expect(run.stages.survey.status).toBe("pending");

  // And the home screen lists it, so it resumes from there.
  const recents = page.getByRole("region", { name: "Recent projects" });
  await expect(recents.getByText(destination)).toBeVisible();
});

test("the conversion loop: warm workdir to published adventure without the CLI", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const workspace = mkdtempSync(join(tmpdir(), "osr-editor-conversion-e2e-"));
  const workdir = join(workspace, "cellar.forge");
  fabricateWarmWorkdir(workdir);
  const checkout = join(workspace, "osr-web");
  mkdirSync(join(checkout, "adventures"), { recursive: true });

  // The fixtures provider, set through the same typed route the settings dialog
  // uses — forge built FixtureProvider for exactly this, and no end-user
  // affordance exists for a kind no end user holds recordings for.
  const configured = await request.post("/api/provider", {
    data: { kind: "fixtures", fixtures_dir: join(MINIMOD, "fixtures") },
  });
  expect(configured.ok()).toBe(true);
  expect((await configured.json()).configured).toBe(true);

  // An incomplete workdir opens into the pipeline view, not a dead end.
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await page.getByLabel("Project directory").fill(workdir);
  await page.getByRole("dialog").getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Conversion" })).toBeVisible();
  await expect(page.getByTestId("stage-row-preprocess")).toContainText(
    "completed",
  );
  await expect(page.getByTestId("stage-row-survey")).toContainText("pending");

  // The stage picker defaults to the first incomplete stage, and the confirm
  // copy names what the resume will actually spend on.
  await expect(page.getByLabel("Resume from")).toHaveValue("survey");
  await expect(page.getByTestId("run-confirm-copy")).toContainText(
    "model stages survey, content, monsters",
  );

  // Run it. Completion navigates straight into the review queue.
  await page.getByRole("button", { name: "Run" }).click();
  await expect(
    page.getByRole("heading", { name: "The Root Cellar of Old Wenna" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("revision")).toHaveText("r1");

  // The report's flags are the work list.
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(page.getByTestId("review-count")).toContainText(
    "flags to review",
  );

  // The pipeline panel shows the chain the editor just ran.
  await page.getByRole("button", { name: "Pipeline" }).click();
  await expect(page.getByTestId("stage-row-assemble")).toContainText(
    "completed",
  );
  await expect(page.getByText("FixtureProvider")).toBeVisible();

  // A correction commits through the override loop.
  await page.getByRole("button", { name: "Adventure" }).click();
  await page
    .getByLabel("Description")
    .fill("Corrected against the printed page.");
  await page.getByLabel("Description").blur();
  await expect(page.getByTestId("revision")).toHaveText("r2");

  // Publish symlink-mode into a temp checkout: validation is clean, so nothing
  // prompts and nothing blocks.
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByLabel("osr-web checkout").fill(checkout);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(page.getByText(/Published to /)).toBeVisible();

  const link = join(checkout, "adventures", "cellar");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(realpathSync(link)).toBe(realpathSync(workdir));
  const published = readFileSync(join(link, "adventure.json"), "utf-8");
  expect(published).toContain("The Root Cellar of Old Wenna");
  expect(published).toContain("Corrected against the printed page.");

  // The reviewable record: the session's one correction, with its reason.
  expect(readFileSync(join(workdir, "overrides.yaml"), "utf-8")).toContain(
    "Corrected against the printed page.",
  );
});
