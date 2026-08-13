# MoonBit Toolchain Performance Dashboard

An English, static GitHub Pages dashboard that tracks MoonBit toolchain performance across Linux, Windows, and macOS. It has no backend service: GitHub Actions produces versioned JSON files under `public/data/`, and Vite publishes them with the ECharts frontend.

The dashboard is intended for trend detection, not a performance gate. GitHub-hosted runner hardware is shared infrastructure and can be noisy, so each cell reports all five raw observations alongside min/median/max.

## Benchmark protocol

- At the start of each workflow, the latest commit on [`moonbitlang/core`](https://github.com/moonbitlang/core) is resolved once. All three runners then check out that same revision.
- The scheduled workflow runs every day at `02:00 UTC` (`10:00 CST`) and supports manual dispatch.
- Runner labels are fixed to `ubuntu-24.04`, `windows-2025`, and `macos-15`.
- Backends are `wasm`, `wasm-gc`, `js`, and `native`.
- Stable is installed from `latest`; pre-release is installed separately. If their parsed `moonc -v` identities match exactly, nightly becomes the candidate. Otherwise pre-release is the candidate.
- Every OS/backend/toolchain unit runs five independent `moon` processes. There is no warm-up, each process receives a fresh target directory, cleanup happens before timing, and the first toolchain alternates by iteration.
- The measured command is:

  ```text
  moon check --target <target> --target-dir <fresh-dir> --frozen --quiet
  ```

- `MOONC_RC_CONVENTION=borrow` matches core's regular CI convention. Each process has a 120-second timeout.
- Delta is `(candidate median - stable median) / stable median × 100%`; negative values mean the candidate was faster.

A fully successful run contains 24 benchmark units, 120 raw samples, and 12 stable/candidate comparisons. Failed, timed-out, or unavailable units are retained with a truncated error summary and exit code. They never produce a delta. The data is still committed before the workflow reports failure.

## Static data API (schema V1)

The only public API is JSON served with the site:

- `public/data/index.json` contains newest-first `RunSummaryV1` objects. It is sufficient for the latest overview, matrix, and all trend charts.
- `public/data/runs/<workflow-run-id>-<attempt>.json` contains one complete `BenchmarkRunV1`: exact toolchains, runner inventory, raw samples, protocol, errors, and workflow metadata.

Every document has `schemaVersion: 1`. Runtime validators are shared by the collector, publisher, and browser. The publisher validates all three OS artifacts, validates the resulting run and index before writing, sorts history by completion time, and deduplicates by workflow run ID plus attempt.

Unit status is one of `ok`, `failed`, `timeout`, or `unavailable`. History is retained indefinitely.

## Local development

Requirements: Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Verification:

```sh
npm run typecheck
npm test
npm run validate:data
npm run build
```

The production build uses `base: "./"`, so assets and JSON work from the `/toolchain-performance-dashboard/` project path as well as local static servers.

## Run the collector manually

The collector downloads official MoonBit installers and writes into isolated `MOON_HOME` directories. It does not modify the current shell's toolchain.

```sh
npm run benchmark -- \
  --os ubuntu \
  --core-dir /path/to/core \
  --output artifacts/shard-ubuntu.json
```

The core directory must be a Git checkout because the collector records its exact `HEAD` commit. Aggregation expects one valid shard for each OS, all collected from the same core revision:

```sh
npm run aggregate -- --artifacts-dir artifacts --data-dir public/data
```

## Repository setup

Before enabling automation:

1. In **Settings → Pages**, set the source to **GitHub Actions**.
2. In **Settings → Actions → General**, allow workflows to read and write repository contents.
3. Ensure branch protection permits the benchmark workflow's `GITHUB_TOKEN` to push data commits to `main`, or provide an equivalent approved integration.
4. Run the **Benchmark** workflow manually once. Confirm 24 units, 120 samples, one data commit, and a Pages deployment at <https://moonbit-community.github.io/toolchain-performance-dashboard/>.

The project intentionally has no alerting, regression gate, or history retention limit.
