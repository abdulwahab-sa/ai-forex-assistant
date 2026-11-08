const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateEstimate } = require("./calculate-estimate");

const priceList = { id: 1, status: "PUBLISHED", currency: "AUD", displayDecimals: 0 };
const cell = (overrides = {}) => ({ price_list_id: 1, price_grid_entry_id: 7, family_code: "SUPASCREEN", pricing_category: "DOOR", width_mm: "825.00", height_mm: "2100.00", price_status: "PRICED", unit_price_ex_gst: "847.92", ...overrides });
const item = (overrides = {}) => ({ validated: true, familyCode: "SUPASCREEN", applicationCode: "HINGED_DOOR", frameSizeMm: null, widthMm: "825", heightMm: "2100", quantity: 2, pendingCharges: [], ...overrides });
const estimate = (overrides = {}) => calculateEstimate({ priceList, gridEntries: [cell()], items: [item()], gstRate: "0.10", ...overrides });

test("displayed workbook unit price, quantity and GST are applied once", () => {
  const result = estimate();
  assert.equal(result.items[0].unitPriceExGst, "848.00");
  assert.equal(result.pricedSubtotalExGst, "1696.00");
  assert.equal(result.gstOnPricedSubtotal, "169.60");
  assert.equal(result.totalIncGst, "1865.60");
});

test("next bands are selected independently and panel count is not a multiplier", () => {
  const result = estimate({ items: [item({ widthMm: "826", heightMm: "2000", quantity: 3, panel_count: 4 })], gridEntries: [cell(), cell({ price_grid_entry_id: 8, width_mm: "875.00", unit_price_ex_gst: "881.33" })] });
  assert.equal(result.items[0].pricedWidthMm, "875.00");
  assert.equal(result.items[0].pricedHeightMm, "2100.00");
  assert.equal(result.pricedSubtotalExGst, "2643.00");
});

test("PrivacyGuard uses SupaScreen pricing while retaining its own identity", () => {
  const result = estimate({ items: [item({ familyCode: "PRIVACYGUARD" })] });
  assert.equal(result.items[0].familyCode, "PRIVACYGUARD");
  assert.equal(result.items[0].priceSourceFamily, "SUPASCREEN");
});

test("9mm and 11mm windows use the same window grid", () => {
  const row = cell({ pricing_category: "WINDOW", width_mm: "600.00", height_mm: "600.00", unit_price_ex_gst: "174.20" });
  for (const frameSizeMm of ["9", "11"]) {
    const result = estimate({ gridEntries: [row], items: [item({ applicationCode: "WINDOW", frameSizeMm, widthMm: "600", heightMm: "300", quantity: 1 })] });
    assert.equal(result.items[0].unitPriceExGst, "174.00");
  }
});

test("Flyscreen door types use separate price categories", () => {
  const result = estimate({ items: [item({ familyCode: "FLYSCREEN", applicationCode: "SLIDING_DOOR" })], gridEntries: [cell({ family_code: "FLYSCREEN", pricing_category: "SLIDING_DOOR", unit_price_ex_gst: "234.00" })] });
  assert.equal(result.items[0].pricingCategory, "SLIDING_DOOR");
  assert.equal(result.items[0].unitPriceExGst, "234.00");
});

test("price on request, missing cells and extras remain pending rather than zero", () => {
  const pending = estimate({ gridEntries: [cell({ price_status: "PRICE_ON_REQUEST", unit_price_ex_gst: null })] });
  assert.equal(pending.items[0].unitPriceExGst, null);
  assert.equal(pending.totalIncGst, null);
  const missing = estimate({ gridEntries: [] });
  assert.equal(missing.pricingStatus, "REQUIRES_QUOTE");
  const extra = estimate({ items: [item({ pendingCharges: ["Special coating"] })] });
  assert.equal(extra.pricedSubtotalExGst, "1696.00");
  assert.equal(extra.totalIncGst, null);
  assert.deepEqual(extra.items[0].pendingCharges, ["Special coating"]);
});

test("unavailable products and unvalidated or malformed inputs are rejected", () => {
  assert.throws(() => estimate({ gridEntries: [cell({ price_status: "UNAVAILABLE", unit_price_ex_gst: null })] }), /unavailable/);
  assert.throws(() => estimate({ items: [item({ validated: false })] }), /validated/);
  assert.throws(() => estimate({ items: [item({ quantity: 0 })] }), /quantity/);
  assert.throws(() => estimate({ items: [item({ widthMm: "-1" })] }), /decimal/);
  assert.throws(() => estimate({ items: [item({ frameSizeMm: "9" })] }), /frame/);
  assert.throws(() => estimate({ gstRate: undefined }), /GST rate/);
});

test("draft prices require an explicit preview and remain labelled", () => {
  const draft = { ...priceList, status: "DRAFT" };
  assert.throws(() => estimate({ priceList: draft }), /published/);
  assert.equal(estimate({ priceList: draft, allowDraftPreview: true }).previewOnly, true);
});

test("multiple lines and fractional-cent GST are rounded once on the subtotal", () => {
  const result = estimate({ priceList: { ...priceList, displayDecimals: 2 }, gridEntries: [cell({ unit_price_ex_gst: "0.05" })], items: [item({ quantity: 1 }), item({ quantity: 2 })] });
  assert.equal(result.pricedSubtotalExGst, "0.15");
  assert.equal(result.gstOnPricedSubtotal, "0.02");
  assert.equal(result.totalIncGst, "0.17");
});
