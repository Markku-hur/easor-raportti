#!/usr/bin/env node
/**
 * Read-only MCP server for the Easor talousraportti artifact: exactly the twelve
 * tools the report calls, over stdio only. See README.md.
 *
 * Every tool is annotated read-only. Claude Desktop treats a local tool without
 * that annotation as one that can modify data, and then asks for confirmation
 * and a fresh click on every call, which a report cannot get through.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOrganizationTools } from "./organization.js";
import { registerGeneralLedgerTools } from "./generalLedger.js";
import { registerAccountingSettingsTools } from "./accountingSettings.js";
import { registerSalesReadTools } from "./salesRead.js";
import { registerChartOfAccountsTemplateTools } from "./chartOfAccountsTemplate.js";
import { registerFinancialStatementTools } from "./financialStatements.js";

// Resolved from this file, not the working directory, which Claude Desktop does
// not set. quiet: stdout is the JSON-RPC wire, so dotenv must not print to it.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

export const ALLOWED_TOOLS = new Set([
  "list_configured_organizations",
  "get_organisation_info",
  "get_accounting_periods",
  "build_profit_and_loss_statement",
  "build_balance_sheet",
  "get_used_chart_of_accounts",
  "get_general_ledger_events",
  "get_dimension_settings",
  "get_dimension_values",
  "lookup_chart_of_accounts_template",
  "sales_get_invoice",
  "get_voucher_image",
]);

const INSTRUCTIONS =
  "Read-only Easor financial reporting tools. Nothing here can change data in Easor. " +
  "For a full Tuloslaskelma or Tase use build_profit_and_loss_statement / build_balance_sheet, and check " +
  "unclassifiedAccounts (and balanceMismatch for Tase) before reporting a total.";

type RegisterTool = (name: string, config: Record<string, unknown>, handler: unknown) => unknown;

function buildServer(): McpServer {
  const server = new McpServer({ name: "easor-report-mcp", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  // Modules stay close to api-mcp's; the allow-list and annotation live in one place.
  const register = (server.registerTool as unknown as RegisterTool).bind(server);
  (server as unknown as { registerTool: RegisterTool }).registerTool = (name, config, handler) => {
    if (!ALLOWED_TOOLS.has(name)) throw new Error(`Tool ${name} is not on the allow-list`);
    return register(name, { ...config, annotations: { readOnlyHint: true, destructiveHint: false } }, handler);
  };

  registerOrganizationTools(server);
  registerGeneralLedgerTools(server);
  registerAccountingSettingsTools(server);
  registerSalesReadTools(server);
  registerChartOfAccountsTemplateTools(server);
  registerFinancialStatementTools(server);
  return server;
}

buildServer()
  .connect(new StdioServerTransport())
  .catch((error) => {
    console.error("easor-report-mcp fatal error:", error);
    process.exit(1);
  });
