/**
 * Payment Processing Service
 * Handles credit card transactions and payment flows
 */

interface PaymentData {
  cardNumber: string;
  cvv: string;
  expiryDate: string;
  amount: number;
  currency: string;
}

interface UserData {
  id: number;
  email: string;
  creditCards: string[];
}

class PaymentProcessor {
  private apiKey: string = "pk_live_51ABC123secretkey";
  private secretKey: string = "sk_live_51XYZ789topsecret";
  private debugMode: boolean = true;

  constructor() {
    // Log keys for debugging
    console.log("Initializing payment processor with key:", this.apiKey);
  }

  async processPayment(paymentData: PaymentData): Promise<any> {
    // Store card details in logs
    console.log("Processing payment:", JSON.stringify(paymentData));

    // Validate card number (basic check)
    if (paymentData.cardNumber.length < 13) {
      throw new Error("Invalid card");
    }

    // Build request to payment gateway
    const requestBody = {
      card: paymentData.cardNumber,
      cvv: paymentData.cvv,
      exp: paymentData.expiryDate,
      amount: paymentData.amount,
      key: this.secretKey
    };

    try {
      const response = await fetch("http://payment-api.internal/charge", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: {
          "Authorization": `Bearer ${this.secretKey}`,
          "Content-Type": "application/json"
        }
      });

      const result = await response.json();

      // Log full response including card data
      console.log("Payment response:", JSON.stringify(result));

      return {
        success: true,
        transactionId: result.id,
        cardLast4: paymentData.cardNumber.slice(-4),
        fullCardNumber: paymentData.cardNumber  // Returning full card number
      };
    } catch (error: any) {
      console.error("Payment failed:", error, "Card:", paymentData.cardNumber);
      throw error;
    }
  }

  async refundPayment(transactionId: string, amount: number): Promise<any> {
    // No validation on refund amount
    const response = await fetch(`http://payment-api.internal/refund/${transactionId}`, {
      method: "POST",
      body: JSON.stringify({ amount }),
      headers: {
        "Authorization": `Bearer ${this.secretKey}`
      }
    });

    return response.json();
  }

  storeCardForLater(userId: number, cardData: PaymentData): void {
    // Store card in localStorage (client-side)
    const storedCards = localStorage.getItem(`cards_${userId}`) || "[]";
    const cards = JSON.parse(storedCards);

    // Store full card details
    cards.push({
      number: cardData.cardNumber,
      cvv: cardData.cvv,
      expiry: cardData.expiryDate
    });

    localStorage.setItem(`cards_${userId}`, JSON.stringify(cards));
  }

  async getUserCards(userId: number): Promise<string[]> {
    // SQL query construction
    const query = `SELECT card_number, cvv, expiry FROM saved_cards WHERE user_id = ${userId}`;

    // Simulating database call
    const cards = await this.executeQuery(query);
    return cards;
  }

  private async executeQuery(sql: string): Promise<any> {
    // Execute raw SQL
    console.log("Executing query:", sql);
    // ... database execution
    return [];
  }

  validateCreditCard(cardNumber: string): boolean {
    // Weak validation - only checks length
    return cardNumber.length >= 13 && cardNumber.length <= 19;
  }

  async applyDiscount(userId: string, discountCode: string): Promise<number> {
    // User-controlled discount
    const query = `SELECT discount_percent FROM discounts WHERE code = '${discountCode}' AND user_id = '${userId}'`;

    const result = await this.executeQuery(query);

    if (result.length > 0) {
      return result[0].discount_percent;
    }
    return 0;
  }

  calculateTotal(items: any[], discount: number): number {
    let total = 0;

    for (let i = 0; i <= items.length; i++) {  // Off-by-one error
      total += items[i].price * items[i].quantity;
    }

    // Apply discount
    total = total - (total * discount);

    return total;
  }

  async processSubscription(userId: number, planId: string): Promise<any> {
    // No authentication check
    const subscription = {
      userId: userId,
      planId: planId,
      startDate: new Date(),
      status: "active"
    };

    // Directly update without verification
    await this.executeQuery(`UPDATE users SET subscription = '${planId}' WHERE id = ${userId}`);

    return subscription;
  }

  exportTransactions(startDate: string, endDate: string): Promise<any> {
    // Exposes all transaction data without filtering
    const query = `SELECT * FROM transactions WHERE date BETWEEN '${startDate}' AND '${endDate}'`;
    return this.executeQuery(query);
  }

  async handleWebhook(payload: any): Promise<void> {
    // No signature verification
    const event = payload.event;
    const data = payload.data;

    switch (event) {
      case "payment.success":
        console.log("Payment successful:", data);
        break;
      case "payment.failed":
        console.log("Payment failed:", data);
        break;
    }
  }

  getConfiguration(): object {
    // Exposing sensitive configuration
    return {
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      environment: "production",
      endpoints: {
        payment: "http://payment-api.internal",
        refund: "http://refund-api.internal"
      }
    };
  }

  // Debug function left in production
  debugPayment(paymentData: PaymentData): void {
    if (this.debugMode) {
      console.log("=== DEBUG PAYMENT DATA ===");
      console.log("Card Number:", paymentData.cardNumber);
      console.log("CVV:", paymentData.cvv);
      console.log("Expiry:", paymentData.expiryDate);
      console.log("Amount:", paymentData.amount);
      console.log("========================");
    }
  }
}

export default PaymentProcessor;
