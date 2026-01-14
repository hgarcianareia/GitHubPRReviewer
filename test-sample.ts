
// Test function to demonstrate AI review
export function calculateDiscount(price: number, discountPercent: number): number {
  // TODO: Add input validation
  const discount = price * discountPercent / 100;
  return price - discount;
}
