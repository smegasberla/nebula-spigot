# Project Plan: Building a Leaf-Based Minecraft Server Fork

**Goal:** ship a fork of Leaf that is measurably faster than Leaf in real workloads, stays plugin-compatible, and adds a small set of genuinely useful features — without turning into an unmaintainable mess six months in.

---

## 1. Know exactly what you're forking

Leaf isn't a fork of Paper anymore — the chain today is:

```
Mojang/Vanilla → CraftBukkit → Spigot → Paper → Purpur → Gale → Leaf
```

Leaf builds on **Gale** (a Purpur-based performance fork) and pulls in patches from a long list of other performance forks: Petal, Carpet Fixes, Akarin, Slice, Parchment, Leaves, Kaiiju, Plazma, SparklyPaper, Polpot, Matter, Luminol, Nitori, Moonrise, and Sakura. Its headline features are async pathfinding/mob spawning/entity tracking, a linear region file format, Sentry-based error tracking, and JVM-flag-gated optimizations like `-DLeaf.enableFMA=true` and SIMD math via `--add-modules=jdk.incubator.vector`.

**What this means for you:**
- You are not writing a server from scratch. You're adding a *new* layer of patches on top of an already deeply patched codebase (Paper alone carries ~1,600 patches and 130k+ lines of diff over Spigot).
- Most of the "easy" optimizations are already done. Anything you add has to either go further than what's already there, or attack a part of the codebase nobody else has touched yet.
- Paper requires Java 25 to build/run as of the current hardfork. Plan your JDK accordingly.

---

## 2. Repo & build setup

Minecraft server forks can't redistribute Mojang's decompiled source directly, so the whole ecosystem builds on **patch files**, not raw source diffs. The tool for this is **paperweight** (a Gradle plugin), specifically the `paperweight-patcher` variant used by downstream forks (this is what Purpur, Pufferfish, and Leaf itself use).

Recommended setup:

1. Fork **Leaf's actual repository** (not Paper, not Gale) — you inherit its full patch set as your baseline instead of re-deriving everything.
2. Use `paperweight-patcher` (see `PaperMC/paperweight-examples` on GitHub as the reference template) to manage your patch stack against Leaf as upstream.
3. Standard fork dev loop:
   - `./gradlew applyPatches` — apply existing patches to get a buildable source tree
   - Make your change directly in the decompiled source
   - Commit it
   - `./gradlew rebuildPatches` — converts your commit into a clean patch file
   - `./gradlew createMojmapBundlerJar` (or your fork's equivalent) — build a runnable jar
4. Set up CI early (GitHub Actions is standard) to run `applyPatches` + build on every push. Patch stacks break silently and often — you want to know within minutes, not when you go to cut a release.

**Important warning from people who've done this before:** editing one NMS (`net.minecraft.server`) class has consequences in many other places. Don't start by ripping subsystems onto separate threads "for performance" without understanding the call graph first — that's the #1 way forks introduce desyncs, duping bugs, and crashes. Move conservatively, one patch at a time, and keep each patch focused on a single change so it's bisectable when something breaks.

---

## 3. Non-negotiable: don't break Paper/Spigot/Bukkit compatibility

This is the one constraint that overrides every optimization idea in this document: **every plugin written against the Bukkit/Spigot/Paper API has to keep working, unmodified, on your fork.** This is what makes a fork adoptable at all — server owners switch jars precisely because they *don't* have to touch their plugin folder. Leaf, Purpur, Pufferfish, and every other major fork treat this as a hard line, not a nice-to-have.

In practice:
- Never change the signature, return type, or observable behavior of a public Bukkit/Paper API method. If an optimization requires that, the optimization is wrong — find another way or drop it.
- Internal (NMS) changes are fine as long as the API surface above them behaves identically. That's the entire point of the patch-based model.
- Anything that touches threading (see the region-multithreading note below) is the highest-risk category here, because the whole plugin ecosystem assumes single-threaded world/entity access. If you go there, expect to break a meaningful chunk of plugins — treat that as a deliberate, clearly-communicated trade-off, never an accident.
- Run the plugin compatibility smoke tests (Section 6: Testing & benchmarking) on *every* patch that touches NMS, not just before release — regressions are much cheaper to catch one patch at a time than to bisect later.
- When in doubt, default to "match Paper's behavior exactly." Vanilla-parity and API-parity are the trust foundation this whole category of project is built on; performance gains don't matter if admins can't trust the jar.

---

## 4. Optimization strategy — be specific, not "faster everything"

"More optimized than Leaf" is not a task, it's a wish. Pick concrete, measurable targets. Some realistic candidates, roughly ordered by effort vs. payoff:

### Low-hanging fruit
- **Profile before you touch anything.** Use `async-profiler` or **Spark** (the de facto standard profiler for MC servers) against a real, loaded server — not a guess. Most "optimization" PRs in this ecosystem are actually just someone reading a flame graph.
- **JVM/GC tuning defaults.** Ship a tuned default flag set (G1GC tuning, the Aikar's-flags lineage, or newer ZGC configs depending on target heap sizes) instead of leaving it to server owners.
- **Expand the Vector API usage.** Leaf already uses SIMD for FMA math and map rendering. There's room to extend this to other hot-path math (block light propagation, pathfinding heuristics, collision checks) if you profile and confirm those are actually hot.

### Medium effort
- **Chunk system work.** Leaf already pulled in some Moonrise patches (a from-scratch chunk system rewrite). Going further here — region-file I/O batching, async chunk generation tuning, smarter view-distance-based unloading — is one of the highest-payoff areas because chunk/entity ticking dominates MSPT on most real servers.
- **Entity tracking & tick scheduling.** Async entity tracking already exists upstream; look at whether tick *scheduling* (which entities get full AI ticks vs. reduced ticks when far from players) can be made smarter without breaking vanilla parity.
- **Redstone & hopper paths.** Carpet Fixes patches are already in. There's still room in hopper-chest interaction batching and redstone update coalescing — these are classic "1000 redstone clocks" lag sources.

### High effort / high risk
- **Region-based multithreading (Folia-style).** This is the only way to get genuinely *parallel* (not just async) tick performance across distant parts of a world. It's also the single most invasive change possible to a Bukkit-API server, because the entire plugin ecosystem assumes single-threaded world access. Don't attempt this unless the project has multiple committed contributors and you're willing to break plugin compatibility for some plugins. Treat it as a stretch goal, not a v1 requirement.

**Rule of thumb:** pick 2–3 of the above as your fork's actual identity (e.g. "best entity-heavy server performance" or "best chunk-loading server"), not a vague "everything is faster" claim. That's also what makes the fork marketable — Leaf's whole pitch is "balance," Pufferfish's is "entity-heavy servers," Petal/Plazma have their own niches. Yours needs one too.

---

## 5. Feature ideas (beyond raw performance)

Keep this list short and cut anything that isn't a clear differentiator:

- **Built-in performance dashboard** — a lightweight web UI exposing live TPS/MSPT/entity counts/chunk load times (Spark-style data, but always-on instead of on-demand). This is a feature server owners actually pay for elsewhere.
- **Smarter default anti-grief/anti-lag config** — sane out-of-the-box limits on hopper counts, entity caps per chunk, etc., with clear config docs (a common pain point — Leaf's own config is split across `gale-global.yml`, `gale-world-defaults.yml`, and `leaf-global.yml`, which confuses a lot of admins).
- **First-class metrics export** (Prometheus/OpenTelemetry style) instead of relying solely on Sentry, for server networks that already have their own monitoring stack.
- **Better multi-version / migration tooling** — automated config migration when admins upgrade between MC versions, since config drift across forks is a constant support burden.

Avoid feature creep into "new gameplay mechanics" territory — that's a different kind of project (more like a Carpet mod) and will dilute the "performance fork" identity you're building.

---

## 6. Testing & benchmarking (don't skip this)

A performance fork without reproducible benchmarks is just marketing copy. Minimum viable setup:

- **Microbenchmarks** for hot-path code changes (JMH if you're touching pure algorithmic code).
- **Load testing** — a scripted bot client (or a replay-based tool) that simulates N players + M entities and reports MSPT/TPS over time. Run this on every significant patch, not just before release.
- **Regression suite for vanilla parity** — Leaf and Purpur both advertise "no compromise on vanilla behavior." Any optimization that changes observable game behavior (mob spawning rates, redstone timing, etc.) needs an explicit test and a changelog entry, or you'll bleed trust with server admins fast.
- **Plugin compatibility smoke tests** — run a handful of the most popular Spigot/Paper plugins against your build on every release candidate.

---

## 7. Realistic scope & timeline

Being honest, since this matters more than the optimism: a one-person performance fork that's genuinely competitive with Leaf/Pufferfish/Purpur — built on profiling-driven, well-tested patches, with CI and a real benchmark suite — is realistically a **6–12 month effort to a credible v1**, and an ongoing **1–2 year commitment** to stay current with MC version updates (which break patch stacks every release).

The biggest risk isn't writing the optimizations — it's **patch rot**: every time Mojang ships a new MC version, your entire patch stack has to be re-applied and conflicts resolved by hand. This is the actual maintenance cost of running a fork, and it's continuous, not one-time. Budget for it explicitly rather than assuming v1 is "done" once it ships.

**Suggested phased milestones:**
1. **Phase 0 (2–4 weeks):** repo/build setup, CI, fork Leaf cleanly, confirm you can build and run an unmodified copy.
2. **Phase 1 (4–8 weeks):** profiling pass on a real or simulated heavy server, pick your 2–3 optimization targets, ship first patches with benchmarks attached.
3. **Phase 2 (4–8 weeks):** one differentiator feature (e.g. the dashboard), regression + plugin compat suite running in CI.
4. **Phase 3 (ongoing):** public beta, gather real server feedback, start the version-update treadmill.

---

## 8. Quick-start checklist

- [ ] Fork Leaf's repo
- [ ] Set up `paperweight-patcher` against Leaf as upstream
- [ ] Confirm `applyPatches` → build → run works on an unmodified checkout
- [ ] Set up a plugin compatibility smoke test (a handful of popular plugins) before writing any optimization patches
- [ ] Set up CI (build on push, run on PR)
- [ ] Install Spark / async-profiler, get a baseline profile on a loaded test server
- [ ] Pick 2–3 concrete optimization targets (not "everything")
- [ ] Build a basic load-test harness for before/after benchmarks
- [ ] Decide on 1 flagship feature, scope it tightly
- [ ] Write a CONTRIBUTING.md so the patch workflow is documented from day one
