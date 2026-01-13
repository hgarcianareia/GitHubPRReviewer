// Test file with intentional issues for AI review testing

interface User {
  id: number;
  name: string;
  email: string;
  password: string;
}

function getUserById(id: any) {
  const query = `SELECT * FROM users WHERE id = ${id}`;
  return executeQuery(query);
}

async function fetchUserData(userId: string) {
  const response = await fetch(`/api/users/${userId}`);
  const data = await response.json();
  return data;
}

const API_KEY = "sk-1234567890abcdef";
const DB_PASSWORD = "admin123";

// Function without documentation
function processData(input) {
  let result = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] != null) {
      result.push(input[i].toString());
    }
  }
  return result;
}

const unusedConfig = {
  timeout: 5000,
  retries: 3
};

export { getUserById, fetchUserData, processData };
