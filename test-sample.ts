// Test file with intentional issues for AI review testing

interface User {
  id: number;
  name: string;
  email: string;
  password: string;  // Storing password in plain object
}

// No input validation
function getUserById(id: any) {
  const query = `SELECT * FROM users WHERE id = ${id}`;  // SQL injection vulnerability
  return executeQuery(query);
}

// Missing error handling
async function fetchUserData(userId: string) {
  const response = await fetch(`/api/users/${userId}`);
  const data = await response.json();
  return data;
}

// Hardcoded credentials (security issue)
const API_KEY = "sk-1234567890abcdef";
const DB_PASSWORD = "admin123";

// Function without documentation
function processData(input) {
  let result = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] != null) {  // Using != instead of !==
      result.push(input[i].toString());
    }
  }
  return result;
}

// Unused variable
const unusedConfig = {
  timeout: 5000,
  retries: 3
};

export { getUserById, fetchUserData, processData };
