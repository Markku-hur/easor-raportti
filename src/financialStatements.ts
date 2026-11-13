/**
 * Builds a fully-computed Tuloslaskelma (income statement) or Tase
 * (balance sheet) — every official report line, in the fixed statutory
 * order, with real euro figures — instead of leaving an AI assistant to
 * improvise the report's structure from lookup_chart_of_accounts_template
 * on every request (previously the only option, and the reason the
 * output's shape used to vary from one request to the next).
 *
 * The formula itself (data/report-formula-fi.json) is a static, bundled
 * skeleton, no live call and no credentials needed. It matches the
 * Kirjanpitoasetus Liite 1 kululajikohtainen-tuloslaskelma order for
 * Tuloslaskelma.
 *
 * Every node's value is a plain sum (of its own tagged accounts and/or its
 * children) — Easor's ledger figures are already correctly signed (credit
 * negative, debet positive; see the same convention documented on
 * get_general_ledger_events), so no per-node sign logic is needed. A
 * single `sign` multiplier per tree (see computeFormulaTree) flips that
 * raw ledger sign to the conventional PRESENTATION sign instead, matching
 * how a real printed Tuloslaskelma/Tase is shown: revenue positive and
 * costs negative on the Tuloslaskelma, both sides of the Tase shown as
 * positive figures of equal magnitude.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAccountingPeriods } from "./organization.js";
import { getUsedChartOfAccounts, getAccountBalances } from "./generalLedger.js";
import { loadTemplate, type ChartOfAccountsTemplateEntry } from "./chartOfAccountsTemplate.js";
import { jsonContent } from "./mcpHelpers.js";

export interface FormulaNode {
  name: string;
  order: number;
  /** Leaf marker for Tuloslaskelma nodes — matched against accounts' own `reportingGroup`. */
  reportingGroup?: string;
  /**
   * Disambiguates a `reportingGroup` name that repeats under more than one
   * parent within Tuloslaskelma (e.g. "Muilta" appears both under "Tuotot
   * muista pysyvien vastaavien sijoituksista" and under "Muut korko- ja
   * rahoitustuotot") — matched against the account's own immediate real
   * groupPath parent segment.
   */
  reportingGroupParent?: string;
  /** Leaf marker for Tase nodes — matched against accounts' own full `groupPath` (reportingGroup alone is ambiguous in Tase: the same name can denote genuinely different, non-mergeable statutory positions, e.g. short- vs long-term "Pääomalainat"). */
  groupPath?: string[];
  /**
   * A pure statutory subtotal row (e.g. LIIKEVOITTO) with no accounts and
   * no children of its own — Kirjanpitoasetus's kaava displays it as a
   * checkpoint of the running total so far, without adding anything new.
   * Computed as the cumulative sum of its PRECEDING siblings only (see
   * computeFormulaTree) — never has `children`, `reportingGroup`, or `groupPath` set.
   */
  isSubtotal?: boolean;
  children?: FormulaNode[];
}

export interface ReportFormula {
  tuloslaskelma: FormulaNode;
  tase: { vastaavaa: FormulaNode; vastattavaa: FormulaNode };
}

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "report-formula-fi.json");

let cachedFormula: ReportFormula | undefined;
function loadFormula(): ReportFormula {
  if (!cachedFormula) {
    cachedFormula = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as ReportFormula;
  }
  return cachedFormula;
}

export interface ComputedNode {
  name: string;
  order: number;
  amount: number;
  /** Carried over from the formula node — see pruneZeroLines: a subtotal is always kept, even at 0, since it's a structural line, not "no activity." */
  isSubtotal?: boolean;
  children?: ComputedNode[];
}

/** Accounts matching a leaf's key, given the template entries for the statement's own root (TULOSLASKELMA / TASE VASTAAVAA / TASE VASTATTAVAA). Pure — no I/O. */
export function accountsForLeaf(leaf: FormulaNode, templateEntriesForRoot: ChartOfAccountsTemplateEntry[]): ChartOfAccountsTemplateEntry[] {
  if (leaf.groupPath) {
    return templateEntriesForRoot.filter((e) => e.groupPath.length === leaf.groupPath!.length && e.groupPath.every((seg, i) => seg === leaf.groupPath![i]));
  }
  if (leaf.reportingGroup) {
    return templateEntriesForRoot.filter((e) => {
      if (e.reportingGroup !== leaf.reportingGroup) return false;
      if (!leaf.reportingGroupParent) return true;
      return e.groupPath[e.groupPath.length - 2] === leaf.reportingGroupParent;
    });
  }
  return [];
}

/**
 * Recursively sums a formula node: a leaf sums the balances of its matched
 * accounts (0 for any that the organization doesn't use), a branch sums
 * its children IN ORDER, running a cumulative total as it goes. A
 * `isSubtotal` child (e.g. LIIKEVOITTO) takes a snapshot of that running
 * total instead of contributing its own data — it must NOT be added to the
 * cumulative total again (its value already fully derives from the
 * siblings before it), or every later subtotal would double-count it.
 *
 * `sign` flips every leaf's raw ledger-signed balance (credit negative,
 * debet positive — see get_general_ledger_events' own documented
 * convention) to the conventional PRESENTATION sign for a real printed
 * statement: revenue positive and costs negative on a Tuloslaskelma
 * (`sign: -1`, since revenue is credit-normal = raw-negative), assets
 * positive as-is on a Tase's VASTAAVAA (`sign: 1`, already debit-normal =
 * raw-positive), and liabilities/equity flipped positive on VASTATTAVAA
 * (`sign: -1`, credit-normal = raw-negative). Applying it uniformly at
 * every leaf is safe because negation is linear — the cumulative/subtotal
 * math above still produces the correct (now positive) profit or balance
 * total without any special-casing beyond the leaf sums themselves.
 *
 * Pure — no I/O, fully unit-testable with synthetic input.
 */
export function computeFormulaTree(
  node: FormulaNode,
  templateEntriesForRoot: ChartOfAccountsTemplateEntry[],
  amountByAccountNumber: Map<string, number>,
  sign: 1 | -1 = 1,
): ComputedNode {
  if (node.children) {
    let cumulative = 0;
    const children: ComputedNode[] = [];
    for (const child of node.children) {
      if (child.isSubtotal) {
        children.push({ name: child.name, order: child.order, amount: cumulative, isSubtotal: true });
        continue;
      }
      const computed = computeFormulaTree(child, templateEntriesForRoot, amountByAccountNumber, sign);
      children.push(computed);
      cumulative += computed.amount;
    }
    return { name: node.name, order: node.order, amount: cumulative, children };
  }
  const accounts = accountsForLeaf(node, templateEntriesForRoot);
  const amount = sign * accounts.reduce((sum, a) => sum + (amountByAccountNumber.get(a.number) ?? 0), 0);
  return { name: node.name, order: node.order, amount };
}

/**
 * Drops lines with no activity at all (amount exactly 0) so a report
 * isn't cluttered with e.g. "Liiketoiminnan muut tuotot: 0,00" for every
 * line an organization simply doesn't use — never drops a subtotal
 * (`isSubtotal`), even at 0, since it's a structural line of the official
 * kaava, not "nothing happened here". A branch with real (non-zero)
 * activity in some of its children is kept even if ITS OWN total happens
 * to net to exactly 0 (e.g. two offsetting entries) — only a branch left
 * with no surviving children AND a zero total of its own is dropped, so
 * real underlying activity is never hidden just because it cancels out
 * at a summary level. The root itself is never dropped, only its
 * descendants. Pure — no I/O.
 */
export function pruneZeroLines(root: ComputedNode): ComputedNode {
  return root.children ? { ...root, children: pruneChildren(root.children) } : root;
}

function pruneChildren(children: ComputedNode[]): ComputedNode[] {
  const pruned: ComputedNode[] = [];
  for (const child of children) {
    if (!child.children) {
      if (child.isSubtotal || child.amount !== 0) pruned.push(child);
      continue;
    }
    const grandchildren = pruneChildren(child.children);
    if (grandchildren.length === 0 && child.amount === 0 && !child.isSubtotal) continue;
    pruned.push({ ...child, children: grandchildren });
  }
  return pruned;
}

/**
 * Real (organization-used) account numbers that don't appear ANYWHERE in
 * the bundled template (any of the three roots) — never silently folded
 * into a line, always surfaced so the caller can see exactly what wasn't
 * auto-classified. Deliberately NOT scoped to one statement's root: an
 * account used within a P&L period's date range legitimately includes
 * balance-sheet accounts too (e.g. a purchase invoice posts to both an
 * expense account and accounts payable in the same voucher) — those
 * belong to the OTHER statement, not to this one, and are not
 * "unclassified"; only an account absent from the template altogether is.
 *
 * Reports each account's RAW ledger-signed balance (credit negative,
 * debet positive) — unlike the rest of a statement's figures, these are
 * NOT flipped to the conventional presentation sign (see
 * computeFormulaTree's `sign` parameter), because an unclassified
 * account's statement membership (and therefore which flip would apply)
 * is exactly what's unknown here.
 */
export function findUnclassifiedAccounts(
  usedAccounts: { number: string; name: string }[],
  amountByAccountNumber: Map<string, number>,
): { number: string; name: string; amount: number }[] {
  const template = loadTemplate();
  const knownNumbers = new Set(template.map((e) => e.number));
  return usedAccounts
    .filter((a) => !knownNumbers.has(a.number))
    .map((a) => ({ number: a.number, name: a.name, amount: amountByAccountNumber.get(a.number) ?? 0 }));
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const HELSINKI_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Converts a full ISO datetime (as `get_accounting_periods` actually
 * returns for `startDate`/`endDate` — UTC, e.g. `"2025-12-31T22:00:00Z"`
 * for what's really Jan 1st local midnight) to the plain `YYYY-MM-DD`
 * calendar date a Finnish organization's own fiscal year boundary means.
 * A naive `.slice(0, 10)` on that raw string gives `"2025-12-31"` — the
 * wrong calendar day — because the UTC offset pushes local midnight into
 * the previous UTC day; this project is FI-only, so converting via the
 * `Europe/Helsinki` time zone (handles the EET/EEST DST switch itself)
 * is the correct fix rather than a fixed-offset arithmetic shortcut.
 */
function toFinnishCalendarDate(isoDateTime: string): string {
  return HELSINKI_DATE_FORMAT.format(new Date(isoDateTime));
}

/**
 * Refuses (rather than silently miscomputing) a period that crosses a
 * fiscal-year boundary — the balance-subtraction approach in
 * buildProfitAndLossStatement is only valid within one accounting period,
 * since a ProfitStatement account's balance resets to 0 at each fiscal
 * year's start (see get_account_balances' own documented gotcha). Returns
 * the matched period's own `startDate` converted to a plain `YYYY-MM-DD`
 * calendar date via `toFinnishCalendarDate` (not a raw string slice —
 * see that function's own comment for why). The caller needs this value
 * both to detect the one case where even a same-period request still
 * needs special handling (see
 * buildProfitAndLossStatement) and, in that case, to use as an actual
 * date parameter on another call — so it must already be normalized here.
 */
/**
 * The accounting period whose Finnish calendar days include `date`
 * (`YYYY-MM-DD`). Both bounds come back from the API as UTC datetimes, so
 * both are converted with toFinnishCalendarDate before the comparison; a raw
 * string comparison would put the fiscal year's last day (whose local
 * midnight is the previous UTC day) outside its own period.
 */
export function findContainingPeriod<T extends { startDate: string; endDate: string }>(
  periods: readonly T[],
  date: string,
): T | undefined {
  return periods.find(
    (p) => toFinnishCalendarDate(p.startDate) <= date && date <= toFinnishCalendarDate(p.endDate),
  );
}

async function getSingleAccountingPeriodStart(organizationNumber: number, fromDate: string, toDate: string): Promise<string> {
  const periods = await getAccountingPeriods(organizationNumber, { pageSize: 100, includeBookkeepingPeriods: false });
  const containing = (date: string) => findContainingPeriod(periods, date);
  const fromPeriod = containing(fromDate);
  const toPeriod = containing(toDate);
  if (!fromPeriod || !toPeriod || fromPeriod.id !== toPeriod.id) {
    throw new Error(
      `fromDate (${fromDate}) and toDate (${toDate}) must fall within the same accounting period (fiscal year) — ` +
        "a ProfitStatement account's balance resets at each fiscal year's start, so a period crossing that " +
        "boundary can't be computed as a simple balance difference. Split the request per fiscal year (see " +
        "get_accounting_periods for the boundaries) and sum the results if you need a cross-year total.",
    );
  }
  return toFinnishCalendarDate(fromPeriod.startDate);
}

export interface ProfitAndLossStatementResult {
  organizationNumber: number;
  fromDate: string;
  toDate: string;
  tuloslaskelma: ComputedNode;
  unclassifiedAccounts: { number: string; name: string; amount: number }[];
}

export async function buildProfitAndLossStatement(
  organizationNumber: number,
  fromDate: string,
  toDate: string,
): Promise<ProfitAndLossStatementResult> {
  const periodStartDate = await getSingleAccountingPeriodStart(organizationNumber, fromDate, toDate);

  const usedAccounts = await getUsedChartOfAccounts(organizationNumber, fromDate, toDate);
  const accountNumbers = usedAccounts.map((a) => a.number);

  const template = loadTemplate();
  const templateEntriesForRoot = template.filter((e) => e.groupPath[0] === "TULOSLASKELMA");
  const knownProfitStatementNumbers = new Set(templateEntriesForRoot.map((e) => e.number));

  // If fromDate IS the fiscal year's own start date, the day before it
  // falls in the PREVIOUS fiscal year, and querying the balance there returns
  // that year's (pre-reset) ending balance, not 0, which would wrongly get
  // subtracted from this year's total. The correct baseline there is exactly 0,
  // but only for genuine ProfitStatement accounts, which actually reset. A
  // balance-sheet account swept into the same used-accounts query (e.g. a
  // receivable posted on the same voucher as a sale) does not reset, so forcing
  // its baseline to 0 too would show its whole cumulative balance instead of
  // the period's real movement.
  // Still fetch the real "before" balance for everyone and only apply the
  // zero-baseline override per-account, rather than skipping the fetch.
  const dayBeforeFromDate = dayBefore(fromDate);
  const isFiscalYearStart = dayBeforeFromDate < periodStartDate;
  const [balancesAtEnd, balancesBeforeStart] = await Promise.all([
    getAccountBalances(organizationNumber, toDate, accountNumbers),
    getAccountBalances(organizationNumber, dayBeforeFromDate, accountNumbers),
  ]);
  const endByAccount = new Map(balancesAtEnd.map((b) => [b.account, b.saldo]));
  const beforeByAccount = new Map(balancesBeforeStart.map((b) => [b.account, b.saldo]));
  const amountByAccountNumber = new Map(
    accountNumbers.map((n) => {
      const end = endByAccount.get(n) ?? 0;
      const before = isFiscalYearStart && knownProfitStatementNumbers.has(n) ? 0 : (beforeByAccount.get(n) ?? 0);
      return [n, end - before];
    }),
  );

  const formula = loadFormula();
  // sign: -1 — revenue is credit-normal (raw-negative); flipping every leaf
  // gives the conventional presentation (revenue positive, costs negative,
  // profit positive when profitable).
  const tuloslaskelma = pruneZeroLines(computeFormulaTree(formula.tuloslaskelma, templateEntriesForRoot, amountByAccountNumber, -1));
  const unclassifiedAccounts = findUnclassifiedAccounts(usedAccounts, amountByAccountNumber);

  return { organizationNumber, fromDate, toDate, tuloslaskelma, unclassifiedAccounts };
}

export interface BalanceSheetResult {
  organizationNumber: number;
  asOfDate: string;
  vastaavaa: ComputedNode;
  vastattavaa: ComputedNode;
  /**
   * The not-yet-closed result of the fiscal year containing asOfDate (presentation
   * sign: profit positive), already included in OMA PÄÄOMA > Tilikauden voitto (tappio).
   */
  currentPeriodResult: number;
  /** Non-null if vastaavaa + vastattavaa doesn't sum to ~0 (a Tase must balance) — surfaced rather than hidden. */
  balanceMismatch: { vastaavaaTotal: number; vastattavaaTotal: number; difference: number } | null;
  unclassifiedAccounts: { number: string; name: string; amount: number }[];
}

/** Covers any organization's full history in Easor without a real "inception date" endpoint to call instead — no customer bookkeeping in this system predates 2022. */
const EARLIEST_PLAUSIBLE_DATE = "2022-01-01";

/**
 * Unlike buildProfitAndLossStatement, this needs no fiscal-year-boundary
 * handling: it's a single point-in-time snapshot with no "before minus
 * after" subtraction anywhere, and BalanceSheet accounts never reset at a
 * fiscal year's start (cumulative since inception — see
 * get_account_balances' own documented behavior).
 */
export async function buildBalanceSheet(organizationNumber: number, asOfDate: string): Promise<BalanceSheetResult> {
  const usedAccounts = await getUsedChartOfAccounts(organizationNumber, EARLIEST_PLAUSIBLE_DATE, asOfDate);
  const accountNumbers = usedAccounts.map((a) => a.number);
  const balances = await getAccountBalances(organizationNumber, asOfDate, accountNumbers);
  const amountByAccountNumber = new Map(balances.map((b) => [b.account, b.saldo]));

  const template = loadTemplate();
  const formula = loadFormula();

  const vastaavaaEntries = template.filter((e) => e.groupPath[0] === "TASE VASTAAVAA");
  const vastattavaaEntries = template.filter((e) => e.groupPath[0] === "TASE VASTATTAVAA");

  // The fiscal year's own result is still sitting on the profit-and-loss accounts
  // until the year is closed, so without it a Tase taken mid-year never balances.
  // Those accounts reset at each fiscal year's start, so their balance on asOfDate
  // is exactly this fiscal year's result so far, and they are already in
  // `balances` (getUsedChartOfAccounts covers every account, not only balance-sheet
  // ones). It goes into equity through a synthetic account on the statutory line
  // "Tilikauden voitto (tappio)", so the normal sum and sign logic applies to it.
  const profitStatementNumbers = new Set(template.filter((e) => e.groupPath[0] === "TULOSLASKELMA").map((e) => e.number));
  const rawPeriodResult = accountNumbers.filter((n) => profitStatementNumbers.has(n)).reduce((sum, n) => sum + (amountByAccountNumber.get(n) ?? 0), 0);
  amountByAccountNumber.set(CURRENT_PERIOD_RESULT_ACCOUNT, rawPeriodResult);
  vastattavaaEntries.push({ ...vastattavaaEntries.find((e) => samePath(e.groupPath, CURRENT_PERIOD_RESULT_PATH))!, number: CURRENT_PERIOD_RESULT_ACCOUNT, name: "Kuluvan tilikauden tulos" });
  const currentPeriodResult = -rawPeriodResult;
  // sign: VASTAAVAA (assets) is debit-normal — already raw-positive, matching
  // the conventional presentation as-is. VASTATTAVAA (liabilities + equity)
  // is credit-normal (raw-negative); flipped so both sides of a printed
  // Tase show positive figures of equal magnitude, per normal accounting
  // presentation, rather than raw ledger signs that sum to ~0.
  const vastaavaa = pruneZeroLines(computeFormulaTree(formula.tase.vastaavaa, vastaavaaEntries, amountByAccountNumber, 1));
  const vastattavaa = pruneZeroLines(computeFormulaTree(formula.tase.vastattavaa, vastattavaaEntries, amountByAccountNumber, -1));

  // Both sides are now presented as positive figures, so a balanced Tase
  // means EQUAL totals, not a sum of ~0 (that was only true under raw
  // ledger signs, before the flip above).
  const difference = vastaavaa.amount - vastattavaa.amount;
  const balanceMismatch = Math.abs(difference) > 0.01 ? { vastaavaaTotal: vastaavaa.amount, vastattavaaTotal: vastattavaa.amount, difference } : null;

  const unclassifiedAccounts = findUnclassifiedAccounts(usedAccounts, amountByAccountNumber);

  return { organizationNumber, asOfDate, vastaavaa, vastattavaa, currentPeriodResult, balanceMismatch, unclassifiedAccounts };
}

/** Not a real account number: carries the fiscal year's result into the Tase (see buildBalanceSheet). */
const CURRENT_PERIOD_RESULT_ACCOUNT = "__tilikauden_tulos__";
const CURRENT_PERIOD_RESULT_PATH = ["TASE VASTATTAVAA", "OMA PÄÄOMA", "Tilikauden voitto (tappio)"];

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

export function registerFinancialStatementTools(server: McpServer): void {
  server.registerTool(
    "build_profit_and_loss_statement",
    {
      title: "Build tuloslaskelma (income statement) for a period",
      description:
        "Builds a fully-computed Tuloslaskelma for the given period — every official line with real activity " +
        "(Kirjanpitoasetus Liite 1 kululajikohtainen-tuloslaskelma order; lines with no activity at all are " +
        "omitted — subtotals like LIIKEVOITTO are always kept, even at 0), with real euro figures already in " +
        "conventional presentation sign (revenue positive, costs negative, profit positive when profitable — " +
        "NOT raw ledger signs). Use this instead of assembling a report by hand from " +
        "lookup_chart_of_accounts_template — it always produces the same structure. fromDate and " +
        "toDate must fall within the same accounting period (fiscal year) — this refuses otherwise rather than " +
        "silently computing a wrong number. Any account the organization uses that isn't recognized by the " +
        "bundled template is listed separately in unclassifiedAccounts (raw ledger sign there, not the " +
        "presentation sign above), never silently folded into a line — check those before reporting a total. ",
      inputSchema: {
        organizationNumber: z.number().int(),
        fromDate: z.string().describe("YYYY-MM-DD — period start"),
        toDate: z.string().describe("YYYY-MM-DD — period end"),
      },
    },
    async ({ organizationNumber, fromDate, toDate }) => {
      const result = await buildProfitAndLossStatement(organizationNumber, fromDate, toDate);
      return jsonContent(result);
    },
  );

  server.registerTool(
    "build_balance_sheet",
    {
      title: "Build tase (balance sheet) as of a date",
      description:
        "Builds a fully-computed Tase as of the given date — VASTAAVAA (assets) and VASTATTAVAA (equity + " +
        "liabilities), every official line with real activity (lines with no activity at all are omitted) and " +
        "real euro figures, cumulative since inception (no period math needed for a balance-sheet account). " +
        "Both sides are shown as positive figures (conventional " +
        "presentation sign, NOT raw ledger signs) — a balanced Tase means EQUAL totals on both sides. The " +
        "fiscal year's not-yet-closed result is included in OMA PÄÄOMA under Tilikauden voitto (tappio) and " +
        "also returned as currentPeriodResult, so a mid-year Tase balances too. Use this " +
        "instead of assembling a report by hand from lookup_chart_of_accounts_template — it always produces " +
        "the same structure. balanceMismatch is non-null if the two sides don't match (a Tase must balance) — " +
        "surface that to whoever asked rather than reporting an unbalanced tase as if it were fine. Any " +
        "account the organization uses that isn't recognized by the bundled template is listed separately in " +
        "unclassifiedAccounts (raw ledger sign there, not the presentation sign above), never silently folded " +
        "into a line.",
      inputSchema: {
        organizationNumber: z.number().int(),
        asOfDate: z.string().describe("YYYY-MM-DD"),
      },
    },
    async ({ organizationNumber, asOfDate }) => {
      const result = await buildBalanceSheet(organizationNumber, asOfDate);
      return jsonContent(result);
    },
  );
}
