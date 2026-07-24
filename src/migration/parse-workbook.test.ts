import { describe, expect, it } from "vitest";

import {
  parseBookingsTab,
  parseCountryTab,
  parseLongtermTab,
  parsePlanTab,
  parseWorkbook,
} from "./parse-workbook";
import type { CellMatrix } from "./types";

const LEGACY_HEADER = [
  "Channel Name",
  "Channel URL",
  "Country",
  "Activation",
  "Contract",
  "Signed",
  "Publication Date",
  "INT Budget",
  "EXT Budget",
  "Installs cap",
  "Current installs",
  "Note",
  "Link",
  "QR Code",
  "Script Draft",
  "Video Draft",
  "Upload Link",
];

function legacyRow(overrides: Record<number, unknown>): unknown[] {
  const row = new Array<unknown>(LEGACY_HEADER.length).fill("");
  for (const [index, value] of Object.entries(overrides)) row[Number(index)] = value;
  return row;
}

describe("parseBookingsTab (legacy layout)", () => {
  const rows = [
    LEGACY_HEADER,
    ["COLORS LEGEND: ", "ARCH. Approvals", "Rebookings"],
    ["EXT Sheet:", "[EXT] Freecash x ARCH."],
    ["August"],
    legacyRow({
      0: "Diabeuu",
      1: "https://youtube.com/diabeuu",
      2: "PL",
      3: "1x YTI",
      5: false,
      6: "29/06/2026",
      7: "500.0",
      8: 625,
      16: "https://youtu.be/x",
    }),
    // summary row: no channel name, must be skipped
    legacyRow({ 6: "September Budget", 7: 24_440, 8: 32_620 }),
    ["September"],
    legacyRow({ 0: "Assassinek", 2: "PL", 6: "05.03.2026.", 7: 2500, 8: 3150 }),
  ] as CellMatrix;

  it("extracts data rows with month sections, skipping legend/summary rows", () => {
    const bookings = parseBookingsTab(rows, "Legacy Q2Q3");
    expect(bookings).toHaveLength(2);

    const [first, second] = bookings;
    expect(first).toMatchObject({
      channelName: "Diabeuu",
      channelKey: "DIABEUU",
      country: "PL",
      activation: "1x YTI",
      contractSigned: false,
      publishedAt: "2026-06-29",
      intBudget: 500,
      extBudget: 625,
      videoUrl: "https://youtu.be/x",
      month: "August",
      sourceSheet: "Legacy Q2Q3",
      sourceRow: 5,
    });
    expect(second).toMatchObject({
      channelName: "Assassinek",
      publishedAt: "2026-03-05",
      month: "September",
    });
  });

  it("leaves v2-only fields null on legacy rows", () => {
    const [first] = parseBookingsTab(rows, "Legacy Q2Q3");
    expect(first.status).toBeNull();
    expect(first.cm).toBeNull();
    expect(first.currency).toBeNull();
  });
});

describe("parseBookingsTab (v2 Campaigns layout)", () => {
  const V2_HEADER = [
    "Channel Name",
    "Channel URL",
    "Country",
    "Status",
    "CM",
    "Platform",
    "Activation",
    "Number of activations",
    "Added to Almedia",
    "Contract",
    "Contract Signed",
    "Publication Date",
    "Deal Type Notes",
    "INT Budget",
    "EXT Budget",
    "Currency",
    "INT EUR",
    "EXT EUR",
    "Note",
    "Link",
    "QR Code",
    "Script Draft",
    "Video Draft",
    "Upload Link",
    "Month",
  ];

  it("reads status, CM, currency and prefers the explicit Month column", () => {
    const row = new Array<unknown>(V2_HEADER.length).fill("");
    row[0] = "ASMR Fixy";
    row[3] = "Longterm";
    row[4] = "Lucija P";
    row[7] = 2;
    row[10] = true;
    row[13] = 1000;
    row[15] = "€";
    row[24] = "July";

    const bookings = parseBookingsTab([V2_HEADER, ["August"], row] as CellMatrix, "Campaigns");
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      channelKey: "ASMRFIXY",
      status: "Longterm",
      cm: "Lucija P",
      numActivations: 2,
      contractSigned: true,
      intBudget: 1000,
      currency: "EUR",
      month: "July", // explicit column wins over the section header
    });
  });
});

describe("parsePlanTab", () => {
  const rows = [
    ["CM / Market", "July", "", "", "", "", "August", "", "", "", "", "September", "", "", "", "", "Q3 SUM"],
    ["", "Budget", "<10k€", "10k€–20k€", "20k€–50k€", "50k€+", "Budget", "<10k€", "10k€–20k€", "20k€–50k€", "50k€+", "Budget", "<10k€", "10k€–20k€", "20k€–50k€", "50k€+", ""],
    ["Lucija P - PL", 60_000, "", 2, 1, 0, 70_000, "", 2, 1, 0, 80_000, "", 3, 1, 0, 210_000],
    ["Lucija P total", 130_000, "", 3, 2, 0, 140_000, "", 4, 2, 0, 190_000, "", 6, 2, 0, 460_000],
    ["Ines - IT", 10_000, "Arbitrary", "", "", "", 20_000, "Arbitrary", "", "", "", 20_000, "Arbitrary", "", "", "", 50_000],
    [""],
    ["Revenue Q3 Targets", 500_000, "", "", "", "", 560_000, "", "", "", "", 740_000],
  ] as CellMatrix;

  it("emits one target per CM-market-month and skips total rows", () => {
    const { targets } = parsePlanTab(rows);
    expect(targets).toHaveLength(6); // 2 pairs x 3 months

    const july = targets.find((t) => t.cm === "Lucija P" && t.month === "July");
    expect(july).toMatchObject({
      market: "PL",
      budgetEur: 60_000,
      tierCounts: { under10k: 0, from10kTo20k: 2, from20kTo50k: 1, over50k: 0 },
    });
    expect(targets.some((t) => /total/i.test(t.cm))).toBe(false);
  });

  it("treats non-numeric tier cells (e.g. 'Arbitrary') as zero", () => {
    const { targets } = parsePlanTab(rows);
    const inesJuly = targets.find((t) => t.cm === "Ines" && t.month === "July");
    expect(inesJuly?.budgetEur).toBe(10_000);
    expect(inesJuly?.tierCounts.under10k).toBe(0);
  });

  it("captures the company revenue targets row", () => {
    const { revenueTargets } = parsePlanTab(rows);
    expect(revenueTargets).toEqual([
      { month: "July", totalEur: 500_000 },
      { month: "August", totalEur: 560_000 },
      { month: "September", totalEur: 740_000 },
    ]);
  });
});

describe("parseCountryTab", () => {
  const HEADER = [
    "Name", "CM", "Context", "Channel URL", "Platform", "Activation",
    "No. of Activations", "Vertical", "Subcategory 1", "Subcategory 2",
    "Timeline", "Female %", "<24", "25-34", "35+ %", "Country %", "Rate",
    "Followers", "Average Views", "", "Counteroffer", "", "Final Price",
    "Currency", "", "ARCH. Comment",
  ];

  it("reads entries under month sections and flags the FAILED section", () => {
    const active = new Array<unknown>(HEADER.length).fill("");
    active[0] = "Creator A";
    active[1] = "Miro";
    active[2] = "Content looped in";
    active[22] = "1500";
    active[23] = "USD";

    const failed = new Array<unknown>(HEADER.length).fill("");
    failed[0] = "Creator B";

    const rows = [
      ["", "", "", ""],
      HEADER,
      ["JULY ⬇️"],
      active,
      ["FAILED (FOR NOW) ⬇️"],
      failed,
    ] as CellMatrix;

    const entries = parseCountryTab(rows, "IT - Miro");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: "Creator A",
      cm: "Miro",
      context: "Content looped in",
      finalPrice: 1500,
      currency: "USD",
      month: "July",
      failed: false,
    });
    expect(entries[1]).toMatchObject({ name: "Creator B", month: null, failed: true });
  });
});

describe("parseLongtermTab", () => {
  it("reads activation rows below the Name header", () => {
    const rows = [
      ["LONGTERM SUMMARY (per CM / month)"],
      ["CM", "Month", "# Longterms"],
      [""],
      ["Name", "Channel URL", "Country", "Number of Activations", "INT Price (total)", "EXT Price (total)", "INT Price per Video (info only)", "EXT Price per Video", "Videos Live", "Timestamp", "Link", "QR Code", "Script Draft", "Video Draft", "Upload Link", "CM", "Month"],
      ["Diabeuu", "https://yt/d", "PL", 4, 2000, 2500, 500, 625, "1/4", "", "", "", "", "", "", "Lucija P", "July"],
    ] as CellMatrix;

    const activations = parseLongtermTab(rows);
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({
      name: "Diabeuu",
      numActivations: 4,
      intPriceTotal: 2000,
      extPriceTotal: 2500,
      cm: "Lucija P",
      month: "July",
    });
  });
});

describe("parseWorkbook", () => {
  it("routes sheets by shape and records skipped tabs", () => {
    const result = parseWorkbook({
      Dashboard: [["anything"]],
      Campaigns: [LEGACY_HEADER, ["August"], legacyRow({ 0: "Someone", 7: 100 })] as CellMatrix,
      "Plan Q3": [
        ["CM / Market", "July"],
        ["", "Budget"],
        ["Miro - US", 80_000],
      ] as CellMatrix,
      Mystery: [["no known header"]],
    });

    expect(result.bookings).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
    expect(result.skippedSheets).toEqual(["Dashboard", "Mystery"]);
  });

  it("ignores Legacy tabs entirely — the tracker starts fresh from August 2026", () => {
    const result = parseWorkbook({
      "Legacy Q2Q3": [LEGACY_HEADER, ["August"], legacyRow({ 0: "Someone", 7: 100 })] as CellMatrix,
      "Legacy Q4Q1": [LEGACY_HEADER, legacyRow({ 0: "Someone Else" })] as CellMatrix,
    });

    expect(result.bookings).toHaveLength(0);
    expect(result.skippedSheets).toEqual(["Legacy Q2Q3", "Legacy Q4Q1"]);
  });
});
