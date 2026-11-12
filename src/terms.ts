/**
 * One vocabulary for ChatGPT, Claude and the console.
 * Every card title, table header, badge and button label comes from here.
 * Rename a term here and it changes everywhere in the MCP output.
 */
export const TERMS = {
  // Sections / cards
  siteStatus: "Site status",
  traffic: "Google traffic",
  hiddenGems: "Hidden gems",
  orphanHighPotential: "Orphan pages with impressions",
  pagesGainingTraffic: "Pages gaining traffic",
  pagesLosingGround: "Pages losing ground",
  topPagesByTraffic: "Top pages by traffic",
  topAuthorityPages: "Top authority pages",
  linkOpportunities: "Internal link opportunities",
  incomingLinks: "Links pointing here",
  openIssues: "Open issues",
  pageReport: "Page report",
  fixStatus: "Fix status",

  // Metrics (Google Search Console, last 28 days)
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "CTR",
  avgPosition: "Avg position",
  keywordsRanking: "Ranking keywords",
  issuesFixed: "Issues fixed",
  contextualInlinks: "Contextual links in",
  linkStrength: "Link strength",
  sinceFirstCrawl: "since first crawl",
  vsPrevious28d: "vs previous 28 days",
  last28d: "Last 28 days",

  // Buttons (short, verb first)
  fix: "Fix",
  addLink: "Add link",
  linkSuggestions: "Link suggestions",
  addTopLinks: "Add top links",
  showMore: "Show more",
  openPage: "Page report",
  revert: "Revert",
} as const;

/**
 * Hidden-gem buckets and tags — these strings are produced by the API
 * (hidden_gems_service.go) and shown verbatim, so the console and chat match.
 */
export const GEM_TAGS = {
  highImpLowCTR: "High Imp, Low CTR",
  page2Push: "Page 2 Push",
  strikingDistance: "Striking Distance",
  risingImpressions: "Rising Impressions",
  fallingDemand: "Falling Demand",
  slipping: "Slipping / Protect",
} as const;

/** Link strength labels from opportunity_handler.go GetLinkProfile. */
export const LINK_STRENGTH = ["Isolated", "Weak", "Moderate", "Strong"] as const;

/**
 * Instruction appended to every rich tool result so the model presents
 * data the same way in every client and never dumps raw JSON.
 */
export const PRESENT_RULES = [
  "Presentation rules:",
  "- If a card is shown, do not repeat its rows; add at most 2 sentences on what matters most and the single best next step.",
  "- If no card is shown, show the markdown below as-is (tables, not JSON).",
  `- Use RankMeRabbit terms exactly: ${TERMS.hiddenGems}, ${TERMS.orphanHighPotential}, ${TERMS.topAuthorityPages}, ${TERMS.linkOpportunities}, ${TERMS.contextualInlinks}.`,
  "- Never show internal ids, scores' formulas, credits or flags unless the user asks.",
  "- Offer the listed next actions as short choices. Writes (Fix, Add link) still need the user's confirmation before publishing.",
].join("\n");
