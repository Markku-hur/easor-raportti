/**
 * Easor General Ledger API client (public gateway), FI only. Read-only: used
 * accounts, account balances (needed by financialStatements.ts) and events.
 *
 * Uses the organization's "GL_FI" credentials, see .env.example.
 */

import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { credentialsFor, easorGet, fiBasePath, GatewayError } from "./httpClient.js";
import { jsonContent } from "./mcpHelpers.js";

const BASE_PATH = fiBasePath("general-ledger");

export interface AccountBalance {
  account: string;
  saldo: number;
}

/**
 * Returns accumulated balances for each bookkeeping account, up to `date`.
 * Uses GET /v1/account-balances/{organizationNumber}?date&accountNumbers.
 */
export async function getAccountBalances(
  organizationNumber: number,
  date: string,
  accountNumbers: string[],
): Promise<AccountBalance[]> {
  return easorGet<AccountBalance[]>(credentialsFor(organizationNumber, "GL_FI"), `${BASE_PATH}/v1/account-balances/${organizationNumber}`, {
    date,
    accountNumbers: accountNumbers.join(","),
  });
}

export interface UsedAccount {
  number: string;
  name: string;
}

/**
 * Returns the bookkeeping accounts used within a date range (number and name
 * only), the organization's actual chart of accounts rather than an assumed
 * numbering scheme.
 * Uses GET /v1/chart-of-accounts/used-accounts/{organizationNumber}?fromDate&toDate.
 */
export async function getUsedChartOfAccounts(
  organizationNumber: number,
  fromDate: string,
  toDate: string,
): Promise<UsedAccount[]> {
  return easorGet<UsedAccount[]>(credentialsFor(organizationNumber, "GL_FI"), `${BASE_PATH}/v1/chart-of-accounts/used-accounts/${organizationNumber}`, {
    fromDate,
    toDate,
  });
}

export interface GeneralLedgerEvent {
  id: string;
  accountNumber: string | null;
  description: string | null;
  voucherDescription: string | null;
  credit: number | null;
  debet: number | null;
  vatCode: string | null;
  vatPercentage: number | null;
  vatIncludedAmount: number | null;
  costCenter: string | null;
  costType: string | null;
  project: string | null;
  projectType: string | null;
  voucherId: string | null;
  vatExcludedAmount: number | null;
  vatAmount: number | null;
  voucherDate: string | null;
  voucherNumber: string | null;
  category: string | null;
  invoiceNumber: string | null;
  matchKey: string | null;
  voucherState: string | null;
  acceptedTimestamp: string | null;
  referenceNumber: string | null;
  concern: string | null;
}

export interface PagedResult<T> {
  currentPage: number;
  pageCount: number;
  pageSize: number;
  rowCount: number;
  results: T[];
}

/**
 * Returns a page of general ledger events (individual postings), optionally
 * filtered by date range, account numbers, or category.
 * Uses GET /v1/general-ledger-events/{organizationNumber}.
 *
 * `x-External-Audit` is a required header per the OpenAPI spec — its
 * purpose isn't documented beyond the parameter name; passed through as an
 * opaque string (e.g. a caller/requester identifier).
 */
export async function getGeneralLedgerEvents(
  organizationNumber: number,
  options: {
    pageIndex: number;
    pageSize: number;
    fromDate?: string;
    toDate?: string;
    accountNumbers?: string;
    category?: string;
    externalAudit?: string;
  },
): Promise<PagedResult<GeneralLedgerEvent>> {
  return easorGet<PagedResult<GeneralLedgerEvent>>(
    credentialsFor(organizationNumber, "GL_FI"),
    `${BASE_PATH}/v1/general-ledger-events/${organizationNumber}`,
    {
      pageIndex: options.pageIndex.toString(),
      pageSize: options.pageSize.toString(),
      fromDate: options.fromDate,
      toDate: options.toDate,
      accountNumbers: options.accountNumbers,
      category: options.category,
    },
    options.externalAudit ? { "x-External-Audit": options.externalAudit } : undefined,
  );
}

const MAX_VOUCHER_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Fetches the PDF image of a voucher from Easor.
 * Uses GET /v1/vouchers/{organizationNumber}/{voucherId}/image.
 * Returns a Buffer (binary PDF), or throws GatewayError on failure.
 */
export async function getVoucherImage(
  organizationNumber: number,
  voucherId: string,
): Promise<Buffer> {
  return easorGet<Buffer>(
    credentialsFor(organizationNumber, "GL_FI"),
    `${BASE_PATH}/v1/vouchers/${organizationNumber}/${voucherId}/image`,
  );
}

export function registerGeneralLedgerTools(server: McpServer): void {
  server.registerTool(
    "get_used_chart_of_accounts",
    {
      title: "Get used chart of accounts",
      description: "Returns the bookkeeping accounts used within a date range.",
      inputSchema: {
        organizationNumber: z.number().int(),
        fromDate: z.string().describe("YYYY-MM-DD"),
        toDate: z.string().describe("YYYY-MM-DD"),
      },
    },
    async ({ organizationNumber, fromDate, toDate }) => {
      const accounts = await getUsedChartOfAccounts(organizationNumber, fromDate, toDate);
      return jsonContent(accounts);
    },
  );

  server.registerTool(
    "get_general_ledger_events",
    {
      title: "Get general ledger events",
      description:
        "Returns a page of general ledger events (individual postings), optionally filtered. When " +
        "summing postings for a total, use (credit ?? debet ?? 0) per posting — NEVER " +
        "credit - debet or debet - credit. credit and debet are mutually exclusive per posting and " +
        "already correctly signed (credit negative, debet positive); subtracting one from the " +
        "other double-applies the sign. This matters most when an account has both kinds of " +
        "posting in the period (e.g. a sale immediately reversed same-day) — an account with only " +
        "one kind can look reconciled even with a wrong formula.",
      inputSchema: {
        organizationNumber: z.number().int(),
        pageIndex: z.number().int(),
        pageSize: z.number().int(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        accountNumbers: z.string().optional().describe("Comma-separated account numbers"),
        category: z.string().optional(),
        externalAudit: z.string().optional().describe("Value for the x-External-Audit header"),
      },
    },
    async ({ organizationNumber, ...options }) => {
      const events = await getGeneralLedgerEvents(organizationNumber, options);
      return jsonContent(events);
    },
  );

  server.registerTool(
    "get_voucher_image",
    {
      title: "Get voucher image",
      description:
        "Returns the PDF image of a voucher from Easor. " +
        "The voucherId can be obtained from any Easor response that includes a voucher identifier " +
        "(for example the voucherId field on general ledger event rows). " +
        "Memorial vouchers (muistioviennit) never have an image. " +
        "The organizationNumber must match the organization the voucher belongs to. " +
        "Set openFile=false to receive only the base64 PDF data without saving to disk or opening a viewer " +
        "(intended for embedded display in a web page; default true opens the PDF in the system viewer).",
      inputSchema: {
        organizationNumber: z.number().int(),
        voucherId: z.string(),
        openFile: z.boolean().optional().describe("When false, return base64 data only without saving to disk or opening a viewer. Defaults to true."),
      },
    },
    async ({ organizationNumber, voucherId, openFile = true }) => {
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await getVoucherImage(organizationNumber, voucherId);
      } catch (err) {
        if (err instanceof GatewayError) {
          if (err.status === 404) {
            return jsonContent({ voucherId, organizationNumber, image: null, reason: "Voucher has no image (memorial vouchers never do), or the voucher belongs to a different organization." });
          }
          if (err.status === 500 && err.message.includes("KeyNotFoundException")) {
            return { isError: true as const, content: [{ type: "text" as const, text: `Tositetta ${voucherId} ei löydy organisaatiolta ${organizationNumber}.` }] };
          }
        }
        throw err;
      }
      if (pdfBuffer.length > MAX_VOUCHER_IMAGE_SIZE) {
        return { isError: true as const, content: [{ type: "text" as const, text: `Tositteen ${voucherId} kuva on liian suuri (${(pdfBuffer.length / 1024 / 1024).toFixed(1)} Mt). Enimmäiskoko on 5 Mt.` }] };
      }
      // openFile=false: return base64 data only (for embedded display in report page)
      if (!openFile) {
        return jsonContent({ voucherId, organizationNumber, base64: pdfBuffer.toString("base64"), mimeType: "application/pdf" });
      }
      const tmpPath = join(tmpdir(), `easor-voucher-${voucherId}.pdf`);
      await writeFile(tmpPath, pdfBuffer);
      const opener =
        process.platform === "win32" ? ["cmd", ["/c", "start", "", tmpPath]] :
        process.platform === "darwin" ? ["open", [tmpPath]] :
        ["xdg-open", [tmpPath]];
      spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore" }).unref();
      return {
        content: [
          {
            type: "text" as const,
            text: `Tositteen kuva avattu: ${tmpPath}`,
          },
          {
            type: "resource" as const,
            resource: {
              uri: `easor-voucher://${voucherId}.pdf`,
              mimeType: "application/pdf",
              blob: pdfBuffer.toString("base64"),
            },
          },
        ],
      };
    },
  );
}
