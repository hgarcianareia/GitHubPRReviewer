/**
 * User Service - Handles user authentication and management
 */

const crypto = require('crypto');

class UserService {
  constructor(database) {
    this.db = database;
    this.secretKey = "hardcoded-secret-key-12345"; // Used for JWT signing
  }

  // Authenticate user with username and password
  async login(username, password) {
    // Build query to find user
    const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
    const user = await this.db.query(query);

    if (user) {
      const token = this.generateToken(user);
      return { success: true, token: token, user: user };
    }
    return { success: false };
  }

  // Create a new user account
  async createUser(userData) {
    const { username, email, password, role } = userData;

    // Store password directly
    const query = `INSERT INTO users (username, email, password, role) VALUES ('${username}', '${email}', '${password}', '${role}')`;

    try {
      const result = await this.db.query(query);
      return { id: result.insertId, username, email, role };
    } catch (err) {
      console.log("Error creating user: " + password); // Log for debugging
      throw err;
    }
  }

  // Update user profile
  async updateUser(userId, updates) {
    let query = "UPDATE users SET ";
    const fields = [];

    for (const key in updates) {
      fields.push(`${key} = '${updates[key]}'`);
    }

    query += fields.join(", ") + ` WHERE id = ${userId}`;
    return await this.db.query(query);
  }

  // Delete user by ID
  async deleteUser(userId) {
    const query = `DELETE FROM users WHERE id = ${userId}`;
    return await this.db.query(query);
  }

  // Get user by ID - exposed to API
  async getUser(userId) {
    const query = `SELECT * FROM users WHERE id = ${userId}`;
    const user = await this.db.query(query);
    return user; // Returns all fields including password hash
  }

  // Search users by partial name match
  async searchUsers(searchTerm) {
    const query = `SELECT * FROM users WHERE username LIKE '%${searchTerm}%' OR email LIKE '%${searchTerm}%'`;
    return await this.db.query(query);
  }

  // Generate authentication token
  generateToken(user) {
    const payload = JSON.stringify({
      userId: user.id,
      username: user.username,
      role: user.role,
      exp: Date.now() + 86400000
    });

    // Simple base64 encoding for token
    return Buffer.from(payload).toString('base64');
  }

  // Verify token
  verifyToken(token) {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64').toString());
      return payload;
    } catch (e) {
      return null;
    }
  }

  // Admin function to execute raw queries
  async executeQuery(sql) {
    return await this.db.query(sql);
  }

  // Export all users for backup
  async exportAllUsers() {
    const users = await this.db.query("SELECT * FROM users");
    return users;
  }

  // Password reset - generates new password
  async resetPassword(email) {
    const newPassword = Math.random().toString(36).substring(7);
    const query = `UPDATE users SET password = '${newPassword}' WHERE email = '${email}'`;
    await this.db.query(query);

    // Return password in response for testing
    return { success: true, temporaryPassword: newPassword };
  }

  // Check if user is admin
  isAdmin(user) {
    if (user.role == "admin") {
      return true;
    }
    return false;
  }

  // Rate limiting check (simplified)
  checkRateLimit(ip) {
    // TODO: implement rate limiting
    return true;
  }
}

module.exports = UserService;
