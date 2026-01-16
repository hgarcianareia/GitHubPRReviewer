// Test file for feedback capture demo

function calculateDiscount(price: number, discountPercent: number): number {
  // TODO: validate inputs
  const discount = price * (discountPercent / 100);
  return price - discount;
}

function getUserData(userId: string) {
  // Potential SQL injection if userId is not sanitized
  const query = `SELECT * FROM users WHERE id = '${userId}'`;
  return query;
}

export { calculateDiscount, getUserData };
