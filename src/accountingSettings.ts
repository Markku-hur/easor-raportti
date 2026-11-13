/**
 * Easor Accounting Settings API client (public gateway), FI only: dimension
 * settings and values. Accepts any valid Easor credential set, see
 * resolveSharedCredentials() in httpClient.ts.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { easorGet, resolveSharedCredentials, fiBasePath } from "./httpClient.js";
import { jsonContent } from "./mcpHelpers.js";

const BASE_PATH = fiBasePath("accounting-settings");

export interface DimensionSetting {
  id: string;
  organizationNumber: number;
  /** "CostCenter" | "CostType" | "Project" | "ProjectType" */
  dimensionType: string | null;
  name: string | null;
  isEnabled: boolean;
  isMandatory: boolean;
}

/**
 * Returns the organization's enabled dimension types (CostCenter/CostType/
 * Project/ProjectType) and their settings.
 * Uses GET /v1/dimensions/{organizationNumber}.
 */
export async function getDimensionSettings(
  organizationNumber: number,
  acceptLanguage?: string,
): Promise<DimensionSetting[]> {
  return easorGet<DimensionSetting[]>(
    resolveSharedCredentials(organizationNumber),
    `${BASE_PATH}/v1/dimensions/${organizationNumber}`,
    {},
    acceptLanguage ? { "accept-language": acceptLanguage } : undefined,
  );
}

export interface DimensionValue {
  id: string | null;
  organisationNumber: number;
  code: string | null;
  name: string | null;
  isDisabled: boolean;
  startDate: string | null;
  endDate: string | null;
  lockDate: string | null;
  dimensionType: string | null;
  rowVersion: string | null;
}

/**
 * Returns dimension values (e.g. specific cost centers/projects), paged
 * and optionally filtered by type/code/enabled-state.
 * Uses GET /v1/dimensions/dimension-values/{organizationNumber}.
 */
export async function getDimensionValues(
  organizationNumber: number,
  options: {
    pageIndex: number;
    pageSize: number;
    dimensionType?: string;
    code?: string;
    isDisabled?: boolean;
    acceptLanguage?: string;
  },
): Promise<DimensionValue[]> {
  return easorGet<DimensionValue[]>(
    resolveSharedCredentials(organizationNumber),
    `${BASE_PATH}/v1/dimensions/dimension-values/${organizationNumber}`,
    {
      pageIndex: options.pageIndex.toString(),
      pageSize: options.pageSize.toString(),
      dimensionType: options.dimensionType,
      code: options.code,
      isDisabled: options.isDisabled?.toString(),
    },
    options.acceptLanguage ? { "accept-language": options.acceptLanguage } : undefined,
  );
}

export function registerAccountingSettingsTools(server: McpServer): void {
  server.registerTool(
    "get_dimension_settings",
    {
      title: "Get dimension settings",
      description: "Returns the organization's enabled dimension types (CostCenter/CostType/Project/ProjectType).",
      inputSchema: {
        organizationNumber: z.number().int(),
        acceptLanguage: z.string().optional(),
      },
    },
    async ({ organizationNumber, acceptLanguage }) => {
      const settings = await getDimensionSettings(organizationNumber, acceptLanguage);
      return jsonContent(settings);
    },
  );

  server.registerTool(
    "get_dimension_values",
    {
      title: "Get dimension values",
      description: "Returns dimension values (e.g. specific cost centers/projects), paged and optionally filtered.",
      inputSchema: {
        organizationNumber: z.number().int(),
        pageIndex: z.number().int(),
        pageSize: z.number().int(),
        dimensionType: z.enum(["CostCenter", "CostType", "Project", "ProjectType"]).optional(),
        code: z.string().optional(),
        isDisabled: z.boolean().optional(),
        acceptLanguage: z.string().optional(),
      },
    },
    async ({ organizationNumber, ...options }) => {
      const values = await getDimensionValues(organizationNumber, options);
      return jsonContent(values);
    },
  );
}
