# Deploying the security fixes

The September 2026 audit is preserved in `security_best_practices_report.md`. These changes address its five findings. They are not a deployment of the application.

## Repository changes

- Sharp is locked to 0.35.4, which fixes [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). CI runs `npm audit --omit=dev --audit-level=high` alongside existing checks. GitHub vulnerability alerts and Dependabot security-update PRs were enabled and read back as enabled on 12 September 2026. No auto-merge was enabled.
- Node HTTP/TLS connections use the exact public address validated by DNS lookup, retaining the original HTTP Host and TLS certificate identity. Every redirect is revalidated. Mixed public/private answers, mapped IPv6 private addresses and non-global IPv6 are refused. The first approved address is used; a failed IPv6/IPv4 address does not automatically fall back to another answer. Explicit injected transports and `allowPrivate` are trusted local integration hooks, not public HTTP request fields.
- Chromium HTTP and HTTPS traffic runs through a per-discovery validating proxy. CONNECT connects to the validated IP while Chromium verifies the original site's TLS certificate. New redirect destinations and popup connections pass through the same proxy. Context-wide interception limits requests and blocks WebSockets, media and fonts; service workers and direct UDP/QUIC are disabled. Reused browsers are a trusted caller integration: the caller must apply the documented launch flags and runtime isolation.
- SVGs from all candidate sources and both validation entry points are checked across the complete XML document before rendering or returning bytes. Executable/foreign elements, event attributes, external resources, entities, unsafe CSS and animation are rejected. Common paths, gradients, masks and internal fragments remain supported. This is a conservative acceptance policy: unusual authoring-tool extensions or complex CSS can cause a candidate to be rejected.
- The self-hosted HTTP boundary returns a bounded 400 on malformed Host/URL input and remains available for subsequent requests.

## Vercel admission settings required before rollout

Read-only inspection on 12 September 2026 found the project's Pro plan using Fluid Compute, the `iad1` function region, elastic concurrency and exposed system environment variables. The firewall API returned `active: null`, `draft: null`, `versions: []`: there was no active custom WAF configuration. Existing platform DDoS protection is separate. No Vercel deployment or firewall activation was performed.

Create and activate these two **@vercel/firewall** rate-limit rules on the project (the condition is the Rate limit ID, not a request-controlled header):

| Rate limit ID | Algorithm | Limit | Window | Result when exceeded |
| --- | --- | --- | --- | --- |
| `logo-yoink-client` | Fixed window | 20 | 600 seconds | 429 |
| `logo-yoink-aggregate` | Fixed window | 60 | 60 seconds | 429 |

The application supplies a stable hashed client key to the first rule and the constant `all-extractions` key to the second. It checks both for each otherwise valid request, including duplicates, before starting extraction. All instances and preview aliases consult the canonical `VERCEL_PROJECT_PRODUCTION_URL`, supplied by Vercel's exposed system variables. Do not point that variable at a user-supplied hostname. Add a private `RATE_LIMIT_SECRET` for the SDK's key hashing; keep it consistent across environments sharing these counters. Production-mode execution is required; the SDK's development bypass is explicitly refused on Vercel.

Missing rules, unexpected responses, errors and an admission check exceeding two seconds return 503 without extraction. A limit rejection returns 429. Both paths include Retry-After. The SDK does not expose cancellation, so a timed-out control-plane request may complete later; it cannot trigger extraction afterward. Activating rules alone does not protect the old application: deploy the reviewed code after the rules are ready, then verify ordinary acceptance and controlled denials in a preview environment. No production load test is needed.

[Vercel's SDK counters are regional](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk), shared across instances within each region. `vercel.json` retains the inspected single function region (`iad1`), and the canonical counter hostname prevents per-alias buckets, but neither setting is a promise of an atomic worldwide rate limit. Multi-region traffic/failover can multiply the allowance. The two-extraction in-process concurrency limit remains per instance. A strict worldwide concurrency or request ceiling would require a shared semaphore/queue or globally consistent store; this change does not add one. The provider-backed regional admission limits are the deliberately smaller implementation for this deployment.

An additional [edge rule on POST /api/extract](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) can reject per-client abuse before invoking the function (for example 20 requests per 600 seconds, 429). This supplements the two application rules, which necessarily run inside the function. Do not use Log as the enforcement action.

## Runtime and cost settings

- Retain the repository's 60-second function `maxDuration`. Browser discovery has its own overall deadline (12 seconds by default), bounded cleanup, an 80-request budget and an 8 MiB inbound wire-byte cap. HTTPS accounting includes TLS overhead. Crossing the cap terminates sockets; one already-read network chunk and OS buffers may exceed the counter threshold. The proxy does not claim to limit decompressed DOM/image memory.
- Verify the deployment's actual CPU/memory allocation in Vercel Resources. Fluid Compute's [standard default is 2 GB / 1 vCPU](https://vercel.com/docs/functions/configuring-functions/memory); this setting lives in the dashboard and cannot be enforced through `vercel.json`. A process-local counter cannot impose a deployment-wide resource cap. On self-hosted public installs, use a dedicated container/worker with CPU/memory/PID limits and an external lifetime watchdog. Keep unrelated credentials and services out of that runtime. Disable `PUBLIC_DEMO_BROWSER=0` if suitable renderer isolation cannot be provided. The proxy protects browser URL connections; it is not an OS sandbox against a compromised Chromium binary.
- Keep `PUBLIC_DEMO_ALLOW_JINA=0` (now the default), even if a key exists for other work. Enabling paid Jina requires an explicit server opt-in, request opt-in, and a separate provider budget/credit ceiling. Static and local browser extraction do not require Jina.
- Configure [Vercel Spend Management](https://vercel.com/docs/spend-management) alerts and automatic pausing at a budget chosen by the owner. Current spend thresholds were not verified or changed. Billing controls are additional containment, not a replacement for admission limits or a guarantee of zero overshoot. Do not silently apply a team-wide pause policy, which may affect other projects.
- The normal single-instance localhost server continues using only local counters. These hosting requirements concern public or multi-instance deployments.

## Verification

Verified on 12 September 2026: `npm run check` passed all 446 tests, syntax checks, benchmark/fixture validation and the local homepage/docs/API smoke test. `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities. A normal `https://example.com/` request also returned 200 through the pinned transport. Regression tests use isolated listeners and harmless SVG markers. Network tests exercise the real Node transport and Chromium through test-only mappings of approved public addresses to local fixture listeners; no production target is probed. Shared-admission tests use independent service instances and a shared counter double, plus missing-rule/error/timeout cases. Live Vercel rule enforcement remains a rollout verification step because no rules were activated in this implementation task.
