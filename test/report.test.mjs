import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = ["build_balance_sheet", "build_profit_and_loss_statement", "get_accounting_periods", "get_dimension_settings", "get_dimension_values", "get_general_ledger_events", "get_organisation_info", "get_used_chart_of_accounts", "get_voucher_image", "list_configured_organizations", "lookup_chart_of_accounts_template", "sales_get_invoice"];
const hasEnv = existsSync(join(root, ".env"));
const sources = readdirSync(join(root, "src")).map((f) => [f, readFileSync(join(root, "src", f), "utf8")]);

let server, buffer = "", nextId = 0;
const pending = new Map();
const request = (method, params) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const callTool = async (name, args) => {
  const { result } = await request("tools/call", { name, arguments: args });
  assert.ok(!result.isError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};

before(async () => {
  // Started from another directory on purpose: Claude Desktop does not set the working directory.
  server = spawn(process.execPath, [join(root, "dist/index.js")], { cwd: "/", stdio: ["pipe", "pipe", "ignore"] });
  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      const message = JSON.parse(line); // anything else on stdout would break the protocol
      pending.get(message.id)?.(message);
    }
  });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});
after(() => server.kill());

test("exposes exactly the allowed tools, all annotated read-only", async () => {
  const { result } = await request("tools/list", {});
  assert.deepEqual(result.tools.map((t) => t.name).sort(), ALLOWED);
  for (const tool of result.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
  }
});

test("the only POST in the source is the OAuth token request", () => {
  for (const [file, text] of sources) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const writes = code.match(/"(POST|PUT|PATCH|DELETE)"/g) ?? [];
    if (file === "auth.ts") assert.deepEqual(writes, ['"POST"'], file);
    else assert.deepEqual(writes, [], file);
  }
});

test("no file writes and no network listener", () => {
  for (const [file, text] of sources) {
    // generalLedger.ts writes voucher PDFs to the system temp directory on purpose.
    if (file !== "generalLedger.ts") {
      assert.doesNotMatch(text, /writeFile|appendFile|createWriteStream/, file);
    }
    assert.doesNotMatch(text, /mkdir|unlink|node:http"|\.listen\(/, file);
  }
});

test("each company uses its own credentials, then the shared ones, never a guess", async () => {
  const { credentialsFor, resolveSharedCredentials } = await import("../dist/httpClient.js");
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith("EASOR_")) delete process.env[key];
  try {
    assert.throws(() => credentialsFor(111, "GL_FI"), /Organisaatiolle 111 .*EASOR_ORG_111_CLIENT_ID/);
    assert.throws(() => resolveSharedCredentials(111), /Organisaatiolle 111/);
    // One key per company covers both APIs.
    process.env.EASOR_ORG_111_CLIENT_ID = "a";
    assert.deepEqual(credentialsFor(111, "GL_FI"), ["ORG_111"]);
    assert.deepEqual(credentialsFor(111, "SALES_FI"), ["ORG_111"]);
    assert.equal(resolveSharedCredentials(111), "ORG_111");
    assert.throws(() => credentialsFor(222, "GL_FI"), /Organisaatiolle 222/, "another company's credentials must not be used");
    // The older per-API form still works, and either API's set is tried for the other.
    process.env.EASOR_ORG_222_GL_FI_CLIENT_ID = "b";
    assert.deepEqual(credentialsFor(222, "GL_FI"), ["ORG_222_GL_FI"]);
    assert.deepEqual(credentialsFor(222, "SALES_FI"), ["ORG_222_GL_FI"]);
    assert.equal(resolveSharedCredentials(222), "ORG_222_GL_FI");
    process.env.EASOR_SALES_FI_CLIENT_ID = "c";
    assert.deepEqual(credentialsFor(333, "SALES_FI"), ["SALES_FI"]);
    assert.deepEqual(credentialsFor(111, "SALES_FI"), ["ORG_111", "SALES_FI"], "own credentials are tried before shared");
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith("EASOR_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the organization list comes from variable names, never values", async () => {
  const { configuredOrganizations } = await import("../dist/httpClient.js");
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith("EASOR_")) delete process.env[key];
  try {
    assert.deepEqual(configuredOrganizations(), { organizations: [], sharedApis: [] });
    process.env.EASOR_ORG_222_CLIENT_ID = "secret-a";
    process.env.EASOR_ORG_111_GL_FI_CLIENT_ID = "secret-b";
    process.env.EASOR_ORG_111_SALES_FI_CLIENT_ID = "secret-c";
    process.env.EASOR_ORG_333_CLIENT_ID = ""; // left empty, as in .env.example
    process.env.EASOR_GL_FI_CLIENT_ID = "secret-d";
    const r = configuredOrganizations();
    assert.deepEqual(r, { organizations: [{ organizationNumber: 111 }, { organizationNumber: 222 }], sharedApis: ["GL_FI"] });
    assert.doesNotMatch(JSON.stringify(r), /secret/);
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith("EASOR_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("tool descriptions name only tools and files that exist", async () => {
  const { result } = await request("tools/list", {});
  for (const tool of result.tools) {
    const names = tool.description.match(/(?:get|build|lookup|sales|add|update|delete)_[a-z_]+/g) ?? [];
    for (const name of names) assert.ok(ALLOWED.includes(name), `${tool.name} mentions ${name}`);
    assert.doesNotMatch(tool.description, /docs\//, tool.name);
  }
});

// Live checks are opt-in, because they need credentials and an organization those
// credentials can read: EASOR_TEST_ORG=<organization number> npm test
const testOrg = Number(process.env.EASOR_TEST_ORG);
const live = { skip: !(hasEnv && testOrg) };

test("profit and loss comes back with its statutory subtotals", live, async () => {
  const year = new Date().getFullYear();
  const pl = await callTool("build_profit_and_loss_statement", { organizationNumber: testOrg, fromDate: `${year}-01-01`, toDate: `${year}-01-31` });
  const names = pl.tuloslaskelma.children.map((c) => c.name);
  assert.ok(names.includes("LIIKEVOITTO(-TAPPIO)"), names.join());
  assert.ok(names.includes("TILIKAUDEN VOITTO(TAPPIO)"), names.join());
});

test("a mid-year balance sheet balances, with the year's result in equity", live, async () => {
  const today = new Date().toISOString().slice(0, 10);
  const bs = await callTool("build_balance_sheet", { organizationNumber: testOrg, asOfDate: today });
  assert.equal(typeof bs.currentPeriodResult, "number");
  assert.equal(bs.balanceMismatch, null, JSON.stringify(bs.balanceMismatch));
});

test("invoice search returns aggregate totals", live, async () => {
  const year = new Date().getFullYear();
  const r = await callTool("sales_get_invoice", { organizationNumber: testOrg, limit: 1, dateType: "Date", dateStart: `${year}-01-01`, dateEnd: `${year}-01-31`, invoiceStatus: "All" });
  assert.equal(typeof r.totalCount, "number");
  assert.equal(typeof r.totalWithoutTax, "number");
});
