# RankMeRabbit submission preparation

Status: INCOMPLETE. No ZIP created, uploaded, submitted, or published.

## Confirmed metadata
Publisher: RankMeRabbit (verified identity selection still requires portal verification).
Countries: all available countries; publication.countries is explicitly [].
Commerce: users buy RankMeRabbit plans on rankmerabbit.com.
Listing: RankMeRabbit / Review SEO and publish fixes / Business & Operations.
Source draft: rankmerabbit/plugin.json and rankmerabbit/mcp.json.

## Validation evidence
- TypeScript build passed before source edits; rebuild required after edits.
- Registered tool annotation booleans checked on initial compiled output. Recheck current build before final handoff.
- Existing PNG signature and dimensions inspected: 250 x 250, 17,492 bytes. Visually legible rabbit mark; below 256 x 256 listing minimum. Need higher-resolution original. No icon reference is added until a compliant asset exists.
- Website, support, privacy, and terms pages were publicly readable. Support page offers email and a contact form; submission of the form was not tested.
- Privacy policy omits explicit MCP request/result handling and retention details. Confirm actual logging, processors, retention, and deletion before drafting changes.
- Terms Use License restricts commercial use. Resolve this conflict with the intended paid business service before submission.
- Documented remote endpoint and protected-resource metadata could not be reached from this environment (fetch failed; web retrieval unavailable). This does not establish a server outage. Endpoint and OAuth flow remain unverified; do not create a final archive until verified.
- Local server code declares OAuth scopes rankmerabbit:read and rankmerabbit:write. Public auth discovery and registration mode need verification; no client IDs or secrets invented.
- Draft package has no private App binding, credentials, or server source dependencies.

## Review cases
Five positive cases: owned sites, priority pages, page report, title suggestions without publishing, H1 proposal without publishing.
Three negative cases: Google Ads creation, billing/refund changes, schema publishing.
All cases: NOT RUN. Exact sample site/page selections and reviewer permissions must be recorded before execution. Positive draft cases include setup and expected tools/arguments. No live write was attempted.
Additional rehearsal: approved publish/status/rollback and read-scope denial on a dedicated test site before final recording.

## Demo walkthrough (not a recording)
1. Sign in to the existing development connection with a dedicated sample account off-camera.
2. Ask Which websites do I have in RankMeRabbit? Select the sample site.
3. Ask Which pages on that website need SEO work first? Show returned priorities.
4. Select a returned sample page and ask Show me the SEO report for that page.
5. Ask Suggest a better SEO title for that page, but do not publish anything. Show actual suggestions.
6. Choose an exact H1 replacement and ask Prepare that exact H1 change for review. Keep it unpublished. Show proposal ID and non-live status.
7. On the dedicated test site only, explicitly approve that proposal, show queued versus applied status truthfully, and rehearse rollback where supported.
8. Ask Publish LocalBusiness JSON-LD schema to my homepage. Show the unsupported-capability explanation without a publishing call.
Capture readable prompts and actual results, no secrets or unrelated private data. Review playback, host at a reviewer-accessible destination, and verify playback before adding review.demo_recording_url.
Computer control can help perform the visible walkthrough; video capture capability has not been established. User screen recording is an alternative.

## Remaining preparation
- Higher-resolution brand PNG (square, at least 256 x 256), then add assets and logo/composerIcon references.
- Confirm privacy facts and correct published privacy/terms coverage.
- Reachable MCP endpoint and successful OAuth development connection.
- Dedicated reviewer account, sample site/page fixtures, subscription access, and test execution.
- Actual hosted demo recording, verified playback URL.
- Final ZIP inventory, schema/portal validation, and metadata verification.

## Portal-only work after package preparation
Domain/developer verification, secure reviewer credentials, OAuth connection, required scans and attestations. Never put reviewer credentials in the package. User completes legal/policy attestations. No portal action is authorized or performed by this preparation.
