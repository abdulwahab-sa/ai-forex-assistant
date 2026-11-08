// Internal pricing service. Inputs must come from trusted server-side validation
// and a single price list; never pass prices or validation flags from a client.
const MAX_CENTS = 999999999999n;
const CATEGORIES = new Set(["WINDOW", "HINGED_DOOR", "SLIDING_DOOR"]);

// Convert a decimal value to a scaled whole number. For example, with two
// decimal places, "847.92" becomes 84792n. BigInt avoids floating-point errors.
function decimal(value, places, label) {
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${label} must be a decimal`);
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] || "").length > places) throw new Error(`${label} must have at most ${places} decimal places`);
  return BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] || "").padEnd(places, "0") || "0");
}

// Convert a scaled whole number back to a string with two decimal places.
// This is used for both monetary amounts and dimensions in the response.
function money(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

// Find the smallest heading that is at least as large as the requested size.
// For example, 826 mm uses the 875 mm heading when the choices are 825 and 875.
function minimumAtLeast(values, requested) {
  return values.filter((value) => value >= requested).reduce((smallest, value) => smallest === null || value < smallest ? value : smallest, null);
}

/**
 * Calculate one estimate from a server-selected price list and grid rows.
 * Each item must already pass server-side product/frame/colour and size checks.
 * pendingCharges must list every requested charge that staff still need to price.
 * priceList.displayDecimals must reflect the verified workbook display format.
 * gstRate is a decimal fraction, e.g. "0.10" for 10%, supplied by the server.
 * A draft may only be used for a clearly marked preview, never a live estimate.
 */
function calculateEstimate({ priceList, gridEntries, items, gstRate, allowDraftPreview = false }) {
  // Step 1: Check the price list and calculation settings. The API team must
  // select the currently effective list and verify its workbook display format.
  if (!priceList || !Number.isSafeInteger(priceList.id) || priceList.id < 1 ||
      ![0, 2].includes(priceList.displayDecimals) || priceList.currency !== "AUD") {
    throw new Error("A verified AUD price list and display precision are required");
  }
  if (priceList.status !== "PUBLISHED" && !(priceList.status === "DRAFT" && allowDraftPreview === true)) {
    throw new Error("The price list must be published or explicitly used for a draft preview");
  }
  if (!Array.isArray(gridEntries) || !Array.isArray(items) || items.length === 0) throw new Error("Price entries and at least one item are required");
  const gst = decimal(gstRate, 4, "GST rate");
  if (gst > 10000n) throw new Error("GST rate cannot exceed 1");

  // Process each item as one panel specification. The callback returns one
  // result per item; `lines` collects them for the final estimate response.
  let subtotal = 0n;
  let hasPending = false;
  const lines = items.map((item, index) => {
    // Step 1, continued: Check each item. The caller is responsible for the
    // actual product, frame, colour and manufacturing-size validation.
    if (!item || item.validated !== true) throw new Error(`Item ${index + 1}: a validated product, colour, frame and size are required`);
    if (typeof item.familyCode !== "string" || !CATEGORIES.has(item.applicationCode) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 65535 ||
        !Array.isArray(item.pendingCharges) || item.pendingCharges.some((charge) => typeof charge !== "string" || !charge.trim())) {
      throw new Error(`Item ${index + 1}: invalid product, quantity or pending charges`);
    }
    if (item.applicationCode === "WINDOW" ? !["9", "11"].includes(String(item.frameSizeMm)) : item.frameSizeMm != null) {
      throw new Error(`Item ${index + 1}: invalid frame size`);
    }
    const width = decimal(item.widthMm, 2, "width");
    const height = decimal(item.heightMm, 2, "height");
    if (width <= 0n || height <= 0n || width > 99999999n || height > 99999999n) throw new Error(`Item ${index + 1}: invalid dimensions`);

    // Step 2: Choose the price family and category. PrivacyGuard keeps its own
    // identity but uses SupaScreen's prices. Flyscreen doors have separate
    // hinged and sliding grids; other supported doors share a DOOR grid.
    const family = item.familyCode.toUpperCase();
    if (!["SUPASCREEN", "INTRUDAGUARD", "DIAMOND_GRILLE", "FLYSCREEN", "PRIVACYGUARD"].includes(family)) throw new Error(`Item ${index + 1}: unsupported product family`);
    const priceFamily = family === "PRIVACYGUARD" ? "SUPASCREEN" : family;
    const category = item.applicationCode === "WINDOW" ? "WINDOW" : priceFamily === "FLYSCREEN" ? item.applicationCode : "DOOR";

    // Step 3: From the selected price list and grid, round width and height up
    // independently. Keep the requested sizes unchanged for the result.
    const entries = gridEntries.filter((row) => Number(row.price_list_id) === priceList.id && row.family_code === priceFamily && row.pricing_category === category);
    const positions = entries.map((row) => ({ row, width: decimal(row.width_mm, 2, "grid width"), height: decimal(row.height_mm, 2, "grid height") }));
    const priceWidth = minimumAtLeast(positions.map((p) => p.width), width);
    const priceHeight = minimumAtLeast(positions.map((p) => p.height), height);

    // Step 4: Look up the exact intersection. An unavailable cell is rejected;
    // a missing or price-on-request cell stays pending rather than becoming $0.
    const matches = positions.filter((p) => p.width === priceWidth && p.height === priceHeight);
    if (matches.length > 1) throw new Error(`Item ${index + 1}: duplicate price grid cell`);
    const entry = matches[0]?.row;
    if (entry && entry.price_status === "UNAVAILABLE") throw new Error(`Item ${index + 1}: product is unavailable at this size`);
    if (entry && !["PRICED", "PRICE_ON_REQUEST"].includes(entry.price_status)) throw new Error(`Item ${index + 1}: invalid price status`);
    if (entry?.price_status === "PRICE_ON_REQUEST" && entry.unit_price_ex_gst != null) throw new Error(`Item ${index + 1}: invalid pending price`);
    let unit = null;
    let line = null;

    // Step 5: For a priced cell, use the verified displayed unit price and
    // multiply by the quantity of identical panels. Do not use panel_count.
    if (entry?.price_status === "PRICED") {
      unit = decimal(entry.unit_price_ex_gst, 2, "unit price");
      if (unit > MAX_CENTS) throw new Error(`Item ${index + 1}: price exceeds supported range`);
      // The current workbook displays all grid prices as whole dollars. Apply
      // only the precision explicitly verified for the selected price list.
      if (priceList.displayDecimals === 0) unit = ((unit + 50n) / 100n) * 100n;
      line = unit * BigInt(item.quantity);
      subtotal += line;
      if (line > MAX_CENTS || subtotal > MAX_CENTS) throw new Error("Estimate exceeds supported monetary range");
    }

    // A known base price can still need a quote when additional charges are
    // pending. Preserve those descriptions so the API can show them to staff.
    const pending = unit === null || item.pendingCharges.length > 0;
    hasPending ||= pending;
    return { familyCode: family, priceSourceFamily: priceFamily, pricingCategory: category,
      quantity: item.quantity, requestedWidthMm: money(width), requestedHeightMm: money(height),
      pricedWidthMm: priceWidth === null ? null : money(priceWidth), pricedHeightMm: priceHeight === null ? null : money(priceHeight),
      priceGridEntryId: entry?.price_grid_entry_id ?? null, unitPriceExGst: unit === null ? null : money(unit),
      lineTotalExGst: line === null ? null : money(line), status: pending ? "REQUIRES_QUOTE" : "ESTIMATED",
      pendingCharges: item.pendingCharges };
  });

  // Apply GST once to the combined known subtotal. Half-up rounding is
  // provisional; the team must confirm the final GST and rounding policy.
  const gstCents = (subtotal * gst + 5000n) / 10000n;
  if (subtotal + gstCents > MAX_CENTS) throw new Error("Estimate exceeds supported monetary range");

  // Return a complete total only when no prices or charges are pending. The
  // separately labelled subtotal still shows the portion that can be priced.
  return { priceListId: priceList.id, previewOnly: priceList.status === "DRAFT", currency: "AUD",
    pricingStatus: hasPending ? "REQUIRES_QUOTE" : "ESTIMATED", items: lines,
    pricedSubtotalExGst: money(subtotal), gstOnPricedSubtotal: money(gstCents),
    pricedSubtotalIncGst: money(subtotal + gstCents), totalIncGst: hasPending ? null : money(subtotal + gstCents) };
}

module.exports = { calculateEstimate };
