export const originalSource = `export function checkoutTotal(quantity, unitPriceCents) {
  return (quantity || 1) * unitPriceCents;
}
`;
// Reviewed development fixtures; never passed into live model context.
export const incompleteSource = `export function checkoutTotal(quantity, unitPriceCents) {
  return quantity === 0 ? 0 : unitPriceCents;
}
`;
export const referenceSource = `export function checkoutTotal(quantity, unitPriceCents) {
  return (quantity ?? 1) * unitPriceCents;
}
`;
export const exampleReport = `Checkout totals must respect explicit quantities, including zero. A missing quantity is represented by null and defaults to one. Unit prices and totals are integer cents.
For quantity 0 at unit price 250 cents, the expected total is 0 cents; the current app charges 250 cents.
For quantity 3 at unit price 250 cents, the expected total is 750 cents; this ordinary behavior must stay correct.
Null quantity must continue to default to one, and unit price zero must remain free.`;
export const profileSummary = {
  id: "checkout-quantity" as const,
  name: "Checkout quantities",
  description:
    "A JavaScript checkout module replaces an explicit zero quantity with its default.",
  report: exampleReport,
  origin: "Purpose-built demonstration fixture",
  scope:
    "One module; quantity is null or a nonnegative integer; prices and totals are integer cents. No real payments.",
};
export const baselineProbes = [
  {
    id: "missing-quantity",
    quantity: null,
    unitPriceCents: 250,
    expected: 250,
  },
  { id: "one-item", quantity: 1, unitPriceCents: 100, expected: 100 },
  { id: "free-items", quantity: 3, unitPriceCents: 0, expected: 0 },
];
