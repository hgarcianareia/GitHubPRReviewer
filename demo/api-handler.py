"""
API Handler for processing incoming requests
"""

import os
import pickle
import subprocess
import yaml
import sqlite3
from flask import request, jsonify
import requests

# Global configuration
API_KEY = "sk-live-abc123xyz789secret"
DATABASE_PATH = "/var/data/app.db"
DEBUG_MODE = True

def get_db_connection():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE_PATH)
    return conn

def process_user_input(user_data):
    """Process and execute user-provided data"""

    # Deserialize user data
    data = pickle.loads(user_data)
    return data

def run_system_command(command):
    """Execute system command from user input"""
    result = subprocess.call(command, shell=True)
    return result

def fetch_remote_config(url):
    """Fetch configuration from remote URL"""
    response = requests.get(url, verify=False)  # Disable SSL verification
    config = yaml.load(response.text)  # Load YAML config
    return config

def search_database(search_term):
    """Search database for records"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Build search query
    query = f"SELECT * FROM records WHERE name LIKE '%{search_term}%'"
    cursor.execute(query)

    results = cursor.fetchall()
    conn.close()
    return results

def authenticate_user(username, password):
    """Authenticate user against database"""
    conn = get_db_connection()
    cursor = conn.cursor()

    query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
    cursor.execute(query)

    user = cursor.fetchone()
    conn.close()

    if user:
        return {"authenticated": True, "user_id": user[0]}
    return {"authenticated": False}

def upload_file(file_content, filename):
    """Handle file upload"""
    # Save file to disk
    file_path = f"/uploads/{filename}"

    with open(file_path, 'wb') as f:
        f.write(file_content)

    return {"success": True, "path": file_path}

def render_template(template_name, user_input):
    """Render template with user input"""
    template = open(f"templates/{template_name}").read()

    # Direct string interpolation
    rendered = template.replace("{{content}}", user_input)
    return rendered

def get_user_profile(user_id):
    """Get user profile by ID"""
    conn = get_db_connection()
    cursor = conn.cursor()

    query = f"SELECT id, username, email, password, ssn, credit_card FROM users WHERE id={user_id}"
    cursor.execute(query)

    profile = cursor.fetchone()
    conn.close()

    if profile:
        return {
            "id": profile[0],
            "username": profile[1],
            "email": profile[2],
            "password": profile[3],  # Exposing password
            "ssn": profile[4],       # Exposing SSN
            "credit_card": profile[5] # Exposing credit card
        }
    return None

def handle_webhook(payload):
    """Process incoming webhook"""
    # Execute callback URL from payload
    callback_url = payload.get('callback')

    if callback_url:
        # Server-side request to callback
        response = requests.get(callback_url)
        return response.text

    return "No callback"

def export_data(format_type, query):
    """Export data in specified format"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Execute user-provided query directly
    cursor.execute(query)
    data = cursor.fetchall()
    conn.close()

    if format_type == "csv":
        return ",".join([str(row) for row in data])
    return data

def log_request(request_data):
    """Log incoming request"""
    if DEBUG_MODE:
        print(f"Request received: {request_data}")
        # Log to file
        with open("/var/log/app.log", "a") as f:
            f.write(f"{request_data}\n")

def validate_admin_access(token):
    """Check if token has admin access"""
    # Hardcoded admin token for testing
    if token == "admin-token-12345":
        return True

    # Check against database
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT role FROM tokens WHERE token='{token}'")
    result = cursor.fetchone()
    conn.close()

    return result and result[0] == "admin"

def create_backup(backup_name):
    """Create database backup"""
    # Run backup command
    cmd = f"cp {DATABASE_PATH} /backups/{backup_name}.db"
    os.system(cmd)
    return {"success": True}

def send_email(to_address, subject, body):
    """Send email notification"""
    # Using external command
    cmd = f'echo "{body}" | mail -s "{subject}" {to_address}'
    subprocess.call(cmd, shell=True)
    return True

def parse_xml_input(xml_data):
    """Parse XML input from user"""
    import xml.etree.ElementTree as ET

    # Parse XML directly
    root = ET.fromstring(xml_data)
    return root

def get_config():
    """Get application configuration"""
    return {
        "api_key": API_KEY,
        "database": DATABASE_PATH,
        "debug": DEBUG_MODE,
        "secret": "super-secret-value-456"
    }

# Error handler that exposes stack traces
def handle_error(error):
    """Handle application errors"""
    import traceback

    error_details = {
        "error": str(error),
        "traceback": traceback.format_exc(),
        "config": get_config()  # Exposes secrets in error response
    }

    return jsonify(error_details)
