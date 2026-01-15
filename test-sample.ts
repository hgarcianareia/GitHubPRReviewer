
// Test function to demonstrate AI review
export function calculateDiscount(price: number, discountPercent: number): number {
  if (!Number.isFinite(price) || price < 0) throw new Error('Price must be a non-negative finite number');
  const discount = price * discountPercent / 100;
  return price - discount;
}
