from flask import Flask, request, jsonify, send_from_directory, Response
import requests
import os
import json
import sys
import time
import uuid
from datetime import datetime
import signal

# Load configuration from config.json
try:
    with open('config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    print(f"Error loading config.json: {str(e)}")
    sys.exit(1)

app = Flask(__name__, static_folder='static')

# Get Ollama API endpoints from config
OLLAMA_BASE_URL = config['ollama']['base_url']
OLLAMA_API_GENERATE = OLLAMA_BASE_URL + config['ollama']['api_endpoints']['generate']
OLLAMA_API_TAGS = OLLAMA_BASE_URL + config['ollama']['api_endpoints']['tags']
OLLAMA_REQUEST_TIMEOUT = config['ollama'].get('request_timeout', 60)
OLLAMA_CHECK_TIMEOUT = config['ollama'].get('connection_check_timeout', 5)
OLLAMA_HISTORY_CONTEXT_LIMIT = config['ollama'].get('history_context_limit', 10)

# Chat history storage
class ChatMemory:
    def __init__(self):
        # Get memory config or use defaults
        memory_config = config.get('memory', {})
        self.max_sessions = memory_config.get('max_sessions', 10)
        self.max_history_per_session = memory_config.get('max_history_per_session', 20)
        self.memory_file = memory_config.get('memory_file', 'chat_memory.json')
        self.auto_save = memory_config.get('auto_save', True)
        self.sessions = {}
        self.load_memory()
    
    def load_memory(self):
        """Load chat history from file"""
        try:
            if os.path.exists(self.memory_file):
                with open(self.memory_file, 'r') as f:
                    self.sessions = json.load(f)
                print(f"Loaded {len(self.sessions)} chat sessions from {self.memory_file}")
            else:
                print(f"No chat history file found. Creating new memory.")
                self.sessions = {}
        except Exception as e:
            print(f"Error loading chat history: {str(e)}")
            self.sessions = {}
    
    def save_memory(self):
        """Save chat history to file"""
        if not self.auto_save:
            return
            
        try:
            # Create a temporary file first to prevent data loss on write errors
            temp_file = f"{self.memory_file}.tmp"
            with open(temp_file, 'w') as f:
                json.dump(self.sessions, f, indent=2)
            
            # If successful, rename the temp file to the actual file
            if os.name == 'nt' and os.path.exists(self.memory_file):
                os.replace(temp_file, self.memory_file)
            else:
                os.rename(temp_file, self.memory_file)
                
            print(f"Saved chat history to {self.memory_file}")
        except Exception as e:
            print(f"Error saving chat history: {str(e)}")
            # If an error occurred and temp file exists, try to remove it
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            except:
                pass
    
    def create_session(self):
        """Create a new chat session"""
        # Clean up old sessions if needed
        if len(self.sessions) >= self.max_sessions:
            # Find and remove oldest session
            oldest_time = float('inf')
            oldest_id = None
            for session_id, session in self.sessions.items():
                if session["last_active"] < oldest_time:
                    oldest_time = session["last_active"]
                    oldest_id = session_id
            
            if oldest_id:
                del self.sessions[oldest_id]
                print(f"Removed oldest session {oldest_id} to make room")
        
        # Create new session
        session_id = str(uuid.uuid4())
        current_time = time.time()
        self.sessions[session_id] = {
            "messages": [],
            "created_at": current_time,
            "last_active": current_time,
            "context": None
        }
        self.save_memory()
        return session_id
    
    def add_message(self, session_id, role, content, context=None):
        """Add a message to the session history"""
        if session_id not in self.sessions:
            session_id = self.create_session()
        
        # Update session with new message
        session = self.sessions[session_id]
        session["last_active"] = time.time()
        
        # Add message to history
        session["messages"].append({
            "role": role,
            "content": content,
            "timestamp": time.time()
        })
        
        # Update Ollama context if provided
        if context:
            session["context"] = context
        
        # Trim history if it exceeds max length
        if len(session["messages"]) > self.max_history_per_session:
            # Keep only the most recent messages
            session["messages"] = session["messages"][-self.max_history_per_session:]
        
        self.save_memory()
        return session_id
    
    def get_history(self, session_id, format_for_ollama=False):
        """Get message history for a session"""
        if session_id not in self.sessions:
            return [], None
        
        session = self.sessions[session_id]
        session["last_active"] = time.time()
        self.save_memory()
        
        if format_for_ollama:
            # Format history in Ollama-compatible format
            formatted_messages = []
            for msg in session["messages"]:
                formatted_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })
            return formatted_messages, session["context"]
        else:
            return session["messages"], session["context"]

# Initialize chat memory
chat_memory = ChatMemory()

def check_ollama_connection():
    """Check if Ollama is running and accessible."""
    try:
        # First check if the Ollama server is running
        base_response = requests.get(OLLAMA_BASE_URL, timeout=OLLAMA_CHECK_TIMEOUT)
        base_response.raise_for_status()
        
        # Then check the tags API specifically to verify API functionality
        tags_response = requests.get(OLLAMA_API_TAGS, timeout=OLLAMA_CHECK_TIMEOUT)
        tags_response.raise_for_status()
        
        # Check if the configured model is available
        model_found = False
        for model in tags_response.json().get('models', []):
            if model.get('name') == config['ollama']['model']:
                model_found = True
                break
                
        if not model_found:
            print(f"Warning: Configured model '{config['ollama']['model']}' not found in Ollama")
            
        return True
    except requests.RequestException as e:
        print(f"Ollama connection error: {str(e)}")
        return False

@app.route('/api/generate', methods=['POST'])
def generate():
    """Proxy endpoint for generating response from the local Ollama model."""
    try:
        # Check Ollama connection first
        if not check_ollama_connection():
            return jsonify({
                'error': 'Ollama service is not running. Please start Ollama and try again.',
                'details': f'Failed to connect to {OLLAMA_BASE_URL}'
            }), 503

        # Get request data
        data = request.get_json()
        
        # Get or create session ID
        session_id = request.headers.get('X-Session-ID')
        if not session_id or session_id not in chat_memory.sessions:
            session_id = chat_memory.create_session()
        
        prompt = data.get('prompt', '')
        
        # Record user message in history
        chat_memory.add_message(session_id, 'user', prompt)
        
        # Override the model with the one from config if not specified
        if 'model' not in data:
            data['model'] = config['ollama']['model']
            print(f"Using configured model: {data['model']}")
        
        # Set streaming to true for real-time updates
        data['stream'] = True
        
        # Get the conversation history for context
        history, context = chat_memory.get_history(session_id, format_for_ollama=True)
        
        # If we have context from a previous exchange, use it for continuity
        if context:
            data['context'] = context
        
        # Include previous messages as context if not already provided
        if 'messages' not in data and len(history) > 0:
            # Only include the most recent messages to avoid token limits
            data['messages'] = history[-OLLAMA_HISTORY_CONTEXT_LIMIT:]
        
        print(f"Sending request to Ollama with model: {data['model']} for session: {session_id}")
        
        # Stream the response
        def generate_stream():
            response_text = ""
            ollama_context = None
            
            try:
                # Set a timeout to prevent hanging connections
                response = requests.post(OLLAMA_API_GENERATE, json=data, stream=True, timeout=OLLAMA_REQUEST_TIMEOUT)
                
                # Check if the request was successful
                if response.status_code != 200:
                    error_msg = f"Ollama API returned error: {response.status_code}"
                    print(error_msg)
                    yield f"data: {{\"error\": \"{error_msg}\"}}\n\n"
                    return
                
                # Extract the context from response headers if available
                if 'Ollama-Context' in response.headers:
                    try:
                        ollama_context = json.loads(response.headers['Ollama-Context'])
                    except json.JSONDecodeError as e:
                        print(f"Failed to parse Ollama context from headers: {str(e)}")
                
                for line in response.iter_lines():
                    if line:
                        try:
                            line_data = json.loads(line.decode('utf-8'))
                            
                            # Accumulate the response text
                            if 'response' in line_data:
                                response_text += line_data['response']
                            
                            # Store context when we get it
                            if 'context' in line_data:
                                ollama_context = line_data['context']
                                
                            # Check for specific errors in the line data
                            if 'error' in line_data:
                                print(f"Error from Ollama: {line_data['error']}")
                                
                            yield f"data: {line.decode('utf-8')}\n\n"
                        except json.JSONDecodeError as e:
                            print(f"Error parsing JSON from Ollama: {str(e)}")
                            continue
                
                # After streaming completes, store the full response in chat history
                if response_text:
                    chat_memory.add_message(session_id, 'ai', response_text, ollama_context)
                
                # Send the session ID back to the client
                yield f"data: {{\"session_id\": \"{session_id}\"}}\n\n"
                
            except requests.Timeout:
                error_msg = "Request to Ollama timed out after 60 seconds"
                print(error_msg)
                yield f"data: {{\"error\": \"{error_msg}\"}}\n\n"
            except requests.ConnectionError:
                error_msg = "Connection to Ollama failed"
                print(error_msg)
                yield f"data: {{\"error\": \"{error_msg}\"}}\n\n"
            except Exception as e:
                error_msg = f"Error in stream generation: {str(e)}"
                print(error_msg)
                yield f"data: {{\"error\": \"{error_msg}\"}}\n\n"
        
        # Set session ID in response headers
        response = Response(generate_stream(), mimetype='text/event-stream')
        response.headers['X-Session-ID'] = session_id
        return response
        
    except requests.RequestException as e:
        print(f"Ollama API error: {str(e)}")
        return jsonify({
            'error': 'Failed to communicate with Ollama',
            'details': str(e)
        }), 500
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return jsonify({
            'error': 'An unexpected error occurred',
            'details': str(e)
        }), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    """Endpoint to get chat history for a session."""
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'Session ID is required'}), 400
    
    messages, _ = chat_memory.get_history(session_id)
    
    if not messages:
        return jsonify({'error': 'Session not found'}), 404
    
    return jsonify({
        'session_id': session_id,
        'messages': messages
    })

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Endpoint to get list of all chat sessions."""
    sessions_info = []
    
    for session_id, session in chat_memory.sessions.items():
        # Get first and last message for context
        first_message = session["messages"][0]["content"] if session["messages"] else ""
        last_message = session["messages"][-1]["content"] if session["messages"] else ""
        
        # Format timestamps
        created_at = datetime.fromtimestamp(session["created_at"]).strftime('%Y-%m-%d %H:%M:%S')
        last_active = datetime.fromtimestamp(session["last_active"]).strftime('%Y-%m-%d %H:%M:%S')
        
        sessions_info.append({
            "session_id": session_id,
            "message_count": len(session["messages"]),
            "created_at": created_at,
            "last_active": last_active,
            "preview": first_message[:50] + "..." if len(first_message) > 50 else first_message
        })
    
    return jsonify({
        'sessions': sessions_info
    })

@app.route('/api/tags', methods=['GET'])
def tags():
    """Proxy endpoint for retrieving Ollama tags (for connection status)."""
    try:
        response = requests.get(OLLAMA_API_TAGS)
        response.raise_for_status()
        return jsonify(response.json())
    except requests.RequestException as e:
        return jsonify({'error': f'Ollama API error: {str(e)}'}), 500

@app.route('/api/config', methods=['GET'])
def get_config():
    """Endpoint to serve the frontend configuration."""
    # Create a subset of config for frontend use
    frontend_config = {
        'ollama': {
            'model': config['ollama']['model'],
            'display_name': config['ollama'].get('display_name', config['ollama']['model'])
        },
        'ui': config['ui'],
        'neural_visualization': config['neural_visualization']
    }
    return jsonify(frontend_config)

@app.route('/api/clear-session', methods=['POST'])
def clear_session():
    """Endpoint to clear chat history for a session."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
            
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({'error': 'Session ID is required'}), 400
        
        if session_id not in chat_memory.sessions:
            print(f"Session not found: {session_id}")
            return jsonify({'error': 'Session not found'}), 404
        
        # Reset the session but keep the ID
        current_time = time.time()
        chat_memory.sessions[session_id] = {
            "messages": [],
            "created_at": current_time,
            "last_active": current_time,
            "context": None
        }
        
        chat_memory.save_memory()
        print(f"Session cleared successfully: {session_id}")
        
        return jsonify({
            'success': True,
            'message': f'Session {session_id} has been cleared'
        })
    except Exception as e:
        print(f"Error clearing session: {str(e)}")
        return jsonify({'error': f'Failed to clear session: {str(e)}'}), 500

# Serve the front-end (index.html) and static assets
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# Additional route to serve other static files
@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(app.static_folder, filename)

# Signal handler to save chat memory on shutdown
def handle_shutdown(signum, frame):
    print("Server shutting down, saving chat memory...")
    chat_memory.save_memory()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, handle_shutdown)
signal.signal(signal.SIGTERM, handle_shutdown)

if __name__ == '__main__':
    # Get server configuration from config
    host = config['server']['host']
    port = config['server']['port']
    debug = config['server']['debug']
    
    print(f"Starting server on {host}:{port} (debug={debug})")
    app.run(host=host, debug=debug, port=port) 