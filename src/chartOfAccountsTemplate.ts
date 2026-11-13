/**
 * Easor's generic default chart of accounts, not organization-specific data.
 * Bundled as a static lookup (data/chart-of-accounts-fi-template.json): no live
 * API call and no credentials needed. An organization's real chart of accounts
 * can differ from it, so never report a total sourced from this template alone.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ChartOfAccountsTemplateEntry {
  number: string;
  name: string | null;
  /** Root-to-immediate-parent group names, e.g. ["TULOSLASKELMA", "KIINTEÄT HENKILÖSTÖKULUT", ...]. */
  groupPath: string[];
  reportingGroup: string | null;
  isBalanceSheetAccount: boolean;
  balanceSheetType: string | null;
  vatCode: string | null;
  vatRate: string | null;
}

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "chart-of-accounts-fi-template.json");

let cached: ChartOfAccountsTemplateEntry[] | undefined;
/** Exported so financialStatements.ts can map real account numbers to their template `reportingGroup`/`groupPath` without re-reading the JSON file itself. */
export function loadTemplate(): ChartOfAccountsTemplateEntry[] {
  if (!cached) {
    cached = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as ChartOfAccountsTemplateEntry[];
  }
  return cached;
}

export function registerChartOfAccountsTemplateTools(server: McpServer): void {
  server.registerTool(
    "lookup_chart_of_accounts_template",
    {
      title: "Look up Easor's generic chart-of-accounts template",
      description:
        "Looks up Easor's generic (organization-independent) Finnish chart-of-accounts template — a static " +
        "reference bundled with this server, not a live API call. Use it to find which account numbers/groups " +
        "are structurally relevant to a question (e.g. fixed vs. variable costs, which mainCategory alone " +
        "cannot distinguish), NOT as a source of actual balances — always confirm real figures against the " +
        "organization's own live data (get_used_chart_of_accounts / get_general_ledger_events / " +
        "build_profit_and_loss_statement) since an organization's real chart can differ from this template. " +
        "Pass listGroups:true alone to explore the group hierarchy first; otherwise filter by accountNumber " +
        "(exact), accountNumberPrefix, nameContains, and/or groupContains (matches any segment of the account's " +
        "group path, e.g. \"MUUTTUVA\" for variable-cost groups, \"KIINTEÄ\" for fixed-cost groups) — at least " +
        "one filter is required. When presenting a grouped report — balance sheet (tase) or income " +
        "statement (tuloslaskelma) alike, or anything else grouped by account — use groupPath's own " +
        "names VERBATIM as section headings/structure — do not paraphrase, translate, or invent your " +
        "own category labels.",
      inputSchema: {
        listGroups: z.boolean().optional().describe("Return the distinct group-path hierarchy instead of individual accounts"),
        accountNumber: z.string().optional().describe("Exact account number match"),
        accountNumberPrefix: z.string().optional().describe("Account number starts-with match, e.g. \"5\" for all 5xxx accounts"),
        nameContains: z.string().optional().describe("Case-insensitive substring match against the account name"),
        groupContains: z.string().optional().describe("Case-insensitive substring match against any segment of the account's group path"),
        limit: z.number().int().optional().describe("Max results (default 100)"),
      },
    },
    async ({ listGroups, accountNumber, accountNumberPrefix, nameContains, groupContains, limit }) => {
      const entries = loadTemplate();

      if (listGroups) {
        const seen = new Set<string>();
        const groups: string[][] = [];
        for (const entry of entries) {
          const key = entry.groupPath.join(" > ");
          if (!seen.has(key)) {
            seen.add(key);
            groups.push(entry.groupPath);
          }
        }
        groups.sort((a, b) => a.join(" > ").localeCompare(b.join(" > ")));
        return { content: [{ type: "text" as const, text: JSON.stringify(groups, null, 2) }] };
      }

      if (!accountNumber && !accountNumberPrefix && !nameContains && !groupContains) {
        return {
          content: [
            {
              type: "text" as const,
              text: "At least one filter is required (accountNumber, accountNumberPrefix, nameContains, groupContains) — or pass listGroups:true to explore the hierarchy first.",
            },
          ],
          isError: true,
        };
      }

      const nameNeedle = nameContains?.toLowerCase();
      const groupNeedle = groupContains?.toLowerCase();
      const matches = entries.filter((e) => {
        if (accountNumber && e.number !== accountNumber) return false;
        if (accountNumberPrefix && !e.number.startsWith(accountNumberPrefix)) return false;
        if (nameNeedle && !(e.name ?? "").toLowerCase().includes(nameNeedle)) return false;
        if (groupNeedle && !e.groupPath.some((g) => g.toLowerCase().includes(groupNeedle))) return false;
        return true;
      });

      const capped = matches.slice(0, limit ?? 100);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ totalMatches: matches.length, returned: capped.length, accounts: capped }, null, 2),
          },
        ],
      };
    },
  );
}
