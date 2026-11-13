/**
 * Easor Sales Invoicing API (public gateway), FI only: invoice search, nothing
 * else. Extracted from api-mcp's salesInvoicingTools.ts. The response is passed
 * through unchanged, so its full type is not repeated here.
 *
 * Uses the organization's "SALES_FI" credentials, see .env.example.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { credentialsFor, easorRequest, toQuery, fiBasePath } from "./httpClient.js";
import { jsonContent } from "./mcpHelpers.js";

const BASE_PATH = fiBasePath("sales");

type InvoiceQueryDateType = "Date" | "DueDate" | "PaidDate" | "SentDate" | "CreatedDate" | "UpdatedDate";
type InvoiceQueryStatusFI = "Draft" | "Sending" | "Sent" | "Paid" | "Reminded" | "Collecting" | "Due" | "All";
type InvoiceQuerySortType = "InvoiceNumber" | "Date" | "DueDate" | "ContactName" | "ShipMode" | "InvoiceStatus" | "InvoiceTotalSum" | "InvoiceUnpaidSum";
type QuerySortDirect = "Asc" | "Desc";

export async function getInvoice(
  organizationNumber: number,
  options: { invoiceId?: string; contactId?: string; invoiceNumber?: number; dateType?: InvoiceQueryDateType; dateStart?: string; dateEnd?: string; invoiceStatus?: InvoiceQueryStatusFI; sortType?: InvoiceQuerySortType; sortDirect?: QuerySortDirect; offset?: number; limit?: number } = {},
): Promise<unknown> {
  const path = `${BASE_PATH}/v1/${organizationNumber}/invoices`;
  return easorRequest<unknown>(credentialsFor(organizationNumber, "SALES_FI"), "GET", path, { query: toQuery(options) });
}

export function registerSalesReadTools(server: McpServer): void {
  server.registerTool(
    "sales_get_invoice",
    {
      title: "Search or get invoice",
      description:
        "Search or get invoice — GET /v1/{organizationNumber}/invoices [PublicGetInvoiceFIV1].",
      inputSchema: {
        organizationNumber: z.number().int(),
        invoiceId: z.string().optional(),
        contactId: z.string().optional(),
        invoiceNumber: z.number().optional(),
        dateType: z.enum(["Date", "DueDate", "PaidDate", "SentDate", "CreatedDate", "UpdatedDate"]).optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
        invoiceStatus: z.enum(["Draft", "Sending", "Sent", "Paid", "Reminded", "Collecting", "Due", "All"]).optional(),
        sortType: z.enum(["InvoiceNumber", "Date", "DueDate", "ContactName", "ShipMode", "InvoiceStatus", "InvoiceTotalSum", "InvoiceUnpaidSum"]).optional(),
        sortDirect: z.enum(["Asc", "Desc"]).optional(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ organizationNumber, invoiceId, contactId, invoiceNumber, dateType, dateStart, dateEnd, invoiceStatus, sortType, sortDirect, offset, limit }) => {
      const result = await getInvoice(organizationNumber, { invoiceId, contactId, invoiceNumber, dateType, dateStart, dateEnd, invoiceStatus, sortType, sortDirect, offset, limit });
      return jsonContent(result);
    },
  );
}
