/**
 * Easor Organization API client (public gateway).
 *
 * Global — no region path segment.
 * Accepts any valid Easor credential set, see resolveSharedCredentials() in
 * httpClient.ts.
 *
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configuredOrganizations, easorGet, resolveSharedCredentials } from "./httpClient.js";
import { jsonContent } from "./mcpHelpers.js";

const BASE_PATH = "/organization";

export interface BookkeepingPeriodV2 {
  id: string | null;
  startDate: string;
  endDate: string;
  accountingPeriodId: string | null;
  /** e.g. "Open", "Holding", "Closed", "Reported" */
  bookkeepingPeriodState: string | null;
  purchaseVouchersPeriodState: string | null;
  updateDate: string | null;
  bookkeepingPeriodMaterialLockedDate: string | null;
  rowVersion: string | null;
}

export interface AccountingPeriodV2 {
  id: string | null;
  orderNumber: number;
  organizationNumber: number;
  startDate: string;
  endDate: string;
  locked: boolean;
  bookkeepingPeriods: BookkeepingPeriodV2[] | null;
  rowVersion: string | null;
}

/**
 * Returns a customer's accounting periods (each with its nested
 * bookkeeping periods). Uses GET /v2/accounting-periods/{organizationNumber}.
 */
export async function getAccountingPeriods(
  organizationNumber: number,
  options: {
    pageIndex?: number;
    pageSize?: number;
    sortByDateAscending?: boolean;
    locked?: boolean;
    includeBookkeepingPeriods?: boolean;
  } = {},
): Promise<AccountingPeriodV2[]> {
  return easorGet<AccountingPeriodV2[]>(resolveSharedCredentials(organizationNumber), `${BASE_PATH}/v2/accounting-periods/${organizationNumber}`, {
    pageIndex: options.pageIndex?.toString(),
    pageSize: options.pageSize?.toString(),
    sortByDateAscending: options.sortByDateAscending?.toString(),
    locked: options.locked?.toString(),
    includeBookkeepingPeriods: options.includeBookkeepingPeriods?.toString(),
  });
}

export interface OrganizationInfoPublic {
  name: string | null;
  nameExt: string | null;
  organizationNumber: number;
  /** A structured object, not a string — confirmed live. */
  homeAddress: {
    streetName: string | null;
    postalCode: string | null;
    postalCity: string | null;
    addressExtensions: unknown[] | null;
    rowVersion: string | null;
  } | null;
  homeCity: string | null;
  /** ISO country code, e.g. "FI". */
  countryCode: string | null;
  currencyCode: string | null;
  languageCode: string | null;
  /** Human-readable country name (e.g. "Finland"). */
  region: string | null;
  businessId: string | null;
  vatId: string | null;
  companyForm: string | null;
  vatObligations: unknown[] | null;
  /** "Unspecified" | "Month" | "Quarter" | "Year" */
  vatPeriod: string | null;
  taxPaymentReference: string | null;
  billingName: string | null;
  billingAddress: string | null;
  eInvoiceAddress: string | null;
  eInvoiceIntermediator: string | null;
  peppolEInvoiceAddress: string | null;
  eInvoiceEmailAddress: string | null;
  homepage: string | null;
  phoneNumber: string | null;
  accountingEmail: string | null;
  rowVersion: string | null;
}

/**
 * Returns organisation info (address, business id, VAT id/period/
 * obligations, invoicing details, ...).
 * Uses GET /v1/organization-info/{organizationNumber}.
 */
export async function getOrganizationInfo(organizationNumber: number): Promise<OrganizationInfoPublic> {
  return easorGet<OrganizationInfoPublic>(resolveSharedCredentials(organizationNumber), `${BASE_PATH}/v1/organization-info/${organizationNumber}`);
}

/**
 * The organizations .env has credentials of its own for, each with its name from
 * Easor when that lookup works. A failed name lookup leaves `name` null rather than
 * failing the list, so one bad credential set never hides the others.
 */
export async function listConfiguredOrganizations() {
  const { organizations, sharedApis } = configuredOrganizations();
  const infos = await Promise.allSettled(organizations.map((o) => getOrganizationInfo(o.organizationNumber)));
  return {
    organizations: organizations.map((o, i) => {
      const r = infos[i];
      return { ...o, name: r.status === "fulfilled" ? (r.value.name ?? null) : null, businessId: r.status === "fulfilled" ? (r.value.businessId ?? null) : null };
    }),
    sharedApis,
  };
}

export function registerOrganizationTools(server: McpServer): void {
  server.registerTool(
    "list_configured_organizations",
    {
      title: "List organizations with credentials",
      description:
        "Lists the organizations that have credentials of their own in this server's .env (from the variable " +
        "names only, never their values), with the organization's name and business id from Easor when " +
        "available. sharedApis names the APIs (GL_FI, SALES_FI) that also have shared " +
        "credentials: those can cover organizations not in the list, which then have to be entered by number.",
      inputSchema: {},
    },
    async () => jsonContent(await listConfiguredOrganizations()),
  );

  server.registerTool(
    "get_accounting_periods",
    {
      title: "Get accounting periods",
      description:
        "Returns a customer's accounting periods (each with nested bookkeeping periods) from Easor's " +
        "Organization API. Global — no region-specific path.",
      inputSchema: {
        organizationNumber: z.number().int().describe("Easor organization/customer number"),
        pageIndex: z.number().int().optional(),
        pageSize: z.number().int().optional(),
        sortByDateAscending: z.boolean().optional(),
        locked: z.boolean().optional().describe("Filter to locked (true) or unlocked (false) periods only"),
        includeBookkeepingPeriods: z.boolean().optional(),
      },
    },
    async (args) => {
      const periods = await getAccountingPeriods(args.organizationNumber, args);
      return jsonContent(periods);
    },
  );

  server.registerTool(
    "get_organisation_info",
    {
      title: "Get organisation info",
      description:
        "Returns organisation info (address, business id, VAT id/period/obligations, invoicing details, ...) " +
        "from Easor's Organization API.",
      inputSchema: {
        organizationNumber: z.number().int().describe("Easor organization/customer number"),
      },
    },
    async ({ organizationNumber }) => {
      const info = await getOrganizationInfo(organizationNumber);
      return jsonContent(info);
    },
  );
}
