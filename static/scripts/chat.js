/**
 * Chat Interface for Ollama API
 * Handles user input and communication with local Ollama instance
 */

class OllamaChat {
    constructor() {
        // Default configuration (will be overridden by config from server)
        this.apiEndpoint = '/api/generate';
        this.model = 'dolphin-phi:latest';
        this.typingSpeed = 15;
        this.typingDelay = 500;
        this.welcomeMessage = 'Hello! I am running locally via Ollama. How can I help you today?';
        this.statusCheckInterval = 10000;
        
        // Session ID for conversation persistence
        this.sessionId = this.getSessionId();
        
        // DOM elements
        this.chatMessages = document.getElementById('chat-messages');
        this.userInput = document.getElementById('user-input');
        this.sendButton = document.getElementById('send-button');
        this.thinkingOverlay = document.querySelector('.thinking-overlay');
        this.scrollToBottomBtn = document.getElementById('scroll-to-bottom');
        
        // State variables
        this.isProcessing = false;
        this.messageHistory = [];
        
        // Flag to track if we're currently streaming a response
        this.isStreaming = false;
        // Reference to the current AI message being streamed
        this.currentStreamingMessage = null;
        
        // Flag to track if user has manually scrolled up
        this.userHasScrolledUp = false;
        // Last known scroll position
        this.lastScrollTop = 0;
        
        // Apply configuration when it's loaded
        if (window.configManager) {
            window.configManager.onConfigLoaded(config => {
                this.applyConfig(config);
            });
        } else {
            // If no config manager, still set up event listeners
            this.setupEventListeners();
            this.updateConnectionStatus();
            // Load history for existing session
            this.loadChatHistory();
        }

        // Enable smooth scrolling for the chat container
        this.enableSmoothScrolling();
        
        // Make the instance globally available
        window.ollamaChat = this;

        // Initialize GSAP animations
        this.setupAnimations();

        // Initialize scroll handling
        this.setupScrollHandling();
    }
    
    getSessionId() {
        // Try to get session ID from localStorage
        let sessionId = localStorage.getItem('ollama_session_id');
        console.log(`Retrieved session ID from storage: ${sessionId}`);
        return sessionId;
    }
    
    setSessionId(sessionId) {
        if (sessionId) {
            // Store session ID in localStorage for persistence across refreshes
            localStorage.setItem('ollama_session_id', sessionId);
            this.sessionId = sessionId;
            console.log(`Set session ID: ${sessionId}`);
        }
    }
    
    loadChatHistory() {
        // Only load history if we have a session ID
        if (!this.sessionId) {
            console.log("No session ID, not loading history");
            return;
        }
        
        console.log(`Loading chat history for session: ${this.sessionId}`);
        
        // Fetch chat history from server
        fetch(`/api/history?session_id=${this.sessionId}`)
            .then(response => {
                if (!response.ok) {
                    // If session not found, clear the stored ID
                    if (response.status === 404) {
                        console.log("Session not found, clearing stored ID");
                        localStorage.removeItem('ollama_session_id');
                        this.sessionId = null;
                    }
                    throw new Error('Failed to load chat history');
                }
                return response.json();
            })
            .then(data => {
                if (data.messages && data.messages.length > 0) {
                    console.log(`Loaded ${data.messages.length} messages from history`);
                    
                    // Clear any existing messages
                    this.chatMessages.innerHTML = '';
                    this.messageHistory = [];
                    
                    // Add each message to the UI
                    data.messages.forEach(msg => {
                        // Add without re-saving to history (to avoid duplication)
                        this.addMessageFromHistory(msg.content, msg.role);
                    });
                    
                    // Scroll to the bottom to show the conversation
                    this.scrollToBottom(true);
                } else {
                    console.log("No messages in history");
                }
            })
            .catch(error => {
                console.error('Error loading chat history:', error);
            });
    }
    
    addMessageFromHistory(text, type) {
        // Similar to addMessage but doesn't update server-side history
        const messageEl = this.createMessageElement(type);
        const contentEl = messageEl.querySelector('.message-content');
        
        if (type === 'ai') {
            // Format the AI message with structured elements
            this.formatAIMessage(contentEl, text);
        } else {
            // For user messages, just set the text content
            contentEl.textContent = text;
        }
        
        // Add to chat container
        this.chatMessages.appendChild(messageEl);
        
        // Add to client-side message history 
        this.messageHistory.push({ role: type, content: text });
    }
    
    applyConfig(config) {
        if (!config) return;
        
        // Apply Ollama configuration
        if (config.ollama) {
            this.model = config.ollama.model || this.model;
        }
        
        // Apply UI configuration
        if (config.ui && config.ui.chat) {
            const chatConfig = config.ui.chat;
            this.typingSpeed = chatConfig.typing_speed || this.typingSpeed;
            this.typingDelay = chatConfig.typing_delay || this.typingDelay;
            this.welcomeMessage = chatConfig.welcome_message || this.welcomeMessage;
            this.statusCheckInterval = chatConfig.status_check_interval || this.statusCheckInterval;
        }
        
        // Set up event listeners and check connection
        this.setupEventListeners();
        this.updateConnectionStatus();
        
        // Load history for existing session
        this.loadChatHistory();
        
        // Add welcome message after a delay, but only if no history was loaded
        setTimeout(() => {
            if (this.chatMessages.children.length === 0) {
                this.addMessage(this.welcomeMessage, 'ai');
            }
        }, 1000);
    }
    
    setupEventListeners() {
        // User input event listeners
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleUserInput();
            }
        });
        
        this.sendButton.addEventListener('click', () => {
            this.handleUserInput();
        });
        
        // Scroll to bottom button
        if (this.scrollToBottomBtn) {
            this.scrollToBottomBtn.addEventListener('click', () => {
                this.scrollToBottom(true);
            });
        }
        
        // Clear chat button
        const clearChatBtn = document.getElementById('clear-chat-btn');
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', () => {
                this.clearChat();
            });
        }
        
        // Set up connection status check
        setInterval(() => this.updateConnectionStatus(), this.statusCheckInterval);
    }
    
    enableSmoothScrolling() {
        if (this.chatMessages) {
            this.chatMessages.style.scrollBehavior = 'smooth';
        }
    }

    scrollToBottom(force = false) {
        if (!this.chatMessages) return;
        
        // Only auto-scroll if user hasn't manually scrolled up
        // or if force is true
        if (!this.userHasScrolledUp || force) {
            const scrollHeight = this.chatMessages.scrollHeight;
            this.chatMessages.scrollTop = scrollHeight;
            
            // Reset user scroll flag if we've forced a scroll
            if (force) {
                this.userHasScrolledUp = false;
                if (this.scrollToBottomBtn) {
                    this.scrollToBottomBtn.classList.remove('visible');
                }
            }
        }
    }
    
    handleUserInput() {
        const text = this.userInput.value.trim();
        if (!text || this.isStreaming) return;
        
        this.sendMessage(text);
        this.userInput.value = '';
        
        // Reset textarea height
        this.userInput.style.height = 'auto';
    }
    
    async checkConnection() {
        try {
            const response = await fetch('/api/tags');
            if (!response.ok) {
                throw new Error('Failed to communicate with local Ollama. Is it running at http://localhost:11434?');
            }
            return true;
        } catch (error) {
            console.error('Error checking Ollama connection:', error);
            this.addMessage('Error: Failed to communicate with Ollama. Please check if the service is running.', 'error');
            throw new Error('Failed to communicate with local Ollama. Is it running at http://localhost:11434?');
        } finally {
            this.isProcessing = false;
        }
    }
    
    async sendMessage(text) {
        if (!text.trim() || this.isStreaming) return;
        
        // Add user message immediately
        this.addMessage(text, 'user');
        
        // Create AI message element immediately
        const aiMessageEl = this.createMessageElement('ai');
        this.chatMessages.appendChild(aiMessageEl);
        this.currentStreamingMessage = aiMessageEl.querySelector('.message-content');
        
        // Force scroll to show the new messages
        this.scrollToBottom(true);
        
        // Activate neural thinking mode
        if (window.neuralVisualizer) {
            window.neuralVisualizer.startThinking();
        }
        
        this.isStreaming = true;
        let responseText = '';
        
        try {
            // Prepare request payload
            const payload = {
                prompt: text,
                stream: true
            };
            
            // Prepare headers with session ID if available
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (this.sessionId) {
                headers['X-Session-ID'] = this.sessionId;
            }
            
            // Make the initial fetch request
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
            
            // Get or update session ID from response headers
            const newSessionId = response.headers.get('X-Session-ID');
            if (newSessionId) {
                this.setSessionId(newSessionId);
            }
            
            // Create a reader for the response stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            
            let buffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // Decode the chunk
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                
                // Process SSE format - split by double newlines
                const lines = buffer.split('\n\n');
                
                // Keep the last incomplete chunk (if any) in the buffer
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    // Skip empty lines
                    if (!line.trim()) continue;
                    
                    // Parse the SSE format (data: {...})
                    const dataMatch = line.match(/^data:\s*(.+)$/);
                    if (!dataMatch) continue;
                    
                    try {
                        const data = JSON.parse(dataMatch[1]);
                        
                        // Handle session ID coming through the data stream
                        if (data.session_id) {
                            this.setSessionId(data.session_id);
                            continue;
                        }
                        
                        // Handle error messages
                        if (data.error) {
                            console.error('Error from server:', data.error);
                            this.addErrorMessage(data.error);
                            continue;
                        }
                        
                        // Handle response chunks
                        if (data.response) {
                            responseText += data.response;
                            
                            // Update the message with formatted content
                            if (this.currentStreamingMessage) {
                                this.formatAIMessage(this.currentStreamingMessage, responseText);
                                this.scrollToBottom();
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing SSE data:', e, 'Line:', line);
                    }
                }
            }
            
            // After streaming completes, do a final update for formatting
            if (this.currentStreamingMessage) {
                this.formatAIMessage(this.currentStreamingMessage, responseText);
            }
            
            // Add to client-side message history
            this.messageHistory.push({ role: 'ai', content: responseText });
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.addErrorMessage('Error: Failed to communicate with Ollama. Please check if the service is running.');
        } finally {
            this.isStreaming = false;
            this.currentStreamingMessage = null;
            // Stop thinking mode
            if (window.neuralVisualizer) {
                window.neuralVisualizer.stopThinking();
            }
            // Final scroll to bottom
            this.scrollToBottom(true);
        }
    }

    createMessageElement(type) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', `${type}-message`);
        
        // Create message content
        const content = document.createElement('div');
        content.classList.add('message-content');
        messageEl.appendChild(content);
        
        // Animate the new message with a subtle entrance
        gsap.from(messageEl, {
            y: 10,
            opacity: 0,
            duration: 0.3,
            ease: "power2.out",
            onComplete: () => {
                // Ensure the message is visible after animation
                this.scrollToBottom(true);
            }
        });
        
        return messageEl;
    }

    addMessage(text, type) {
        const messageEl = this.createMessageElement(type);
        const contentEl = messageEl.querySelector('.message-content');
        
        if (type === 'ai') {
            // Format the AI message with structured elements
            this.formatAIMessage(contentEl, text);
        } else {
            // For user messages, just set the text content
            contentEl.textContent = text;
        }
        
        // Add to chat container
        this.chatMessages.appendChild(messageEl);
        
        // Add to client-side history 
        // (no longer needed to track server-side as that's handled in the backend)
            this.messageHistory.push({ role: type, content: text });
        
        // Scroll to the new message
        this.scrollToBottom();
    }
    
    // Format the AI message with structured elements
    formatAIMessage(element, text) {
        // Parse markdown-like syntax
        const formattedText = this.parseMarkdown(text);
        element.innerHTML = formattedText;
        
        // Add syntax highlighting to code blocks
        element.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
    
    // Parse markdown-like syntax for basic formatting
    parseMarkdown(text) {
        if (!text) return '';
        
        let formatted = text;
        
        // Code blocks with language (```language code```)
        formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, language, code) {
            // Preserve the original whitespace and line breaks in code
            const langClass = language ? language : '';
            const langDisplay = language ? `<div class="code-lang-indicator">${language}</div>` : '';
            return `<pre>${langDisplay}<code class="${langClass}">${
                code.replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;')
            }</code></pre>`;
        });
        
        // Inline code (`code`)
        formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        
        // AFTER code blocks are processed, THEN replace newlines with <br> tags
        // but exclude content inside <pre> tags
        const preBlocks = [];
        // Extract and replace pre blocks with placeholders
        formatted = formatted.replace(/<pre>[\s\S]*?<\/pre>/g, function(match) {
            const placeholder = `__PRE_BLOCK_${preBlocks.length}__`;
            preBlocks.push(match);
            return placeholder;
        });
        
        // Process Markdown tables
        // Look for table patterns like:
        // | Header 1 | Header 2 |
        // | -------- | -------- |
        // | Cell 1   | Cell 2   |
        formatted = this.processMarkdownTables(formatted);
        
        // Now safely replace newlines with <br> tags
        formatted = formatted.replace(/\n\n+/g, '</p><p>'); // Convert multiple newlines to paragraph breaks
        formatted = formatted.replace(/\n/g, '<br>'); // Convert single newlines to line breaks
        
        // Add paragraph tags if not already present
        if (!formatted.startsWith('<p>') && !formatted.startsWith('<h') && !formatted.startsWith('<ul') && !formatted.startsWith('<ol') && !formatted.startsWith('<pre>') && !formatted.startsWith('<table')) {
            formatted = '<p>' + formatted;
        }
        if (!formatted.endsWith('</p>') && !formatted.endsWith('</h3>') && !formatted.endsWith('</h4>') && !formatted.endsWith('</h5>') && !formatted.endsWith('</ul>') && !formatted.endsWith('</ol>') && !formatted.endsWith('</pre>') && !formatted.endsWith('</table>')) {
            formatted = formatted + '</p>';
        }
        
        // Restore pre blocks
        preBlocks.forEach((block, i) => {
            formatted = formatted.replace(`__PRE_BLOCK_${i}__`, block);
        });
        
        // Blockquotes (> text)
        formatted = formatted.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        
        // Horizontal rule (---, ***, ___)
        formatted = formatted.replace(/^([-*_])\1\1+$/gm, '<hr>');
        
        // Bold text (**text**)
        formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // Italic text (*text*)
        formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // Headers (# Header)
        formatted = formatted.replace(/^# (.+)$/gm, '<h3>$1</h3>');
        formatted = formatted.replace(/^## (.+)$/gm, '<h4>$1</h4>');
        formatted = formatted.replace(/^### (.+)$/gm, '<h5>$1</h5>');
        
        // Bullet lists
        formatted = formatted.replace(/^- (.+)$/gm, '<li>$1</li>');
        // Fix list structure - properly format multiple list items
        let listMatch = formatted.match(/(<li>.+<\/li>)(\s*<li>.+<\/li>)+/g);
        if (listMatch) {
            listMatch.forEach(match => {
                let wrapped = '<ul>' + match + '</ul>';
                formatted = formatted.replace(match, wrapped);
            });
        } else {
            // Handle single item lists
            formatted = formatted.replace(/(<li>.+<\/li>)/g, '<ul>$1</ul>');
        }
        
        // Numbered lists
        formatted = formatted.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        // Fix numbered list structure
        let numListMatch = formatted.match(/(<li>.+<\/li>)(\s*<li>.+<\/li>)+/g);
        if (numListMatch) {
            numListMatch.forEach(match => {
                // Only wrap in <ol> if not already in a list (avoid double-wrapping)
                if (!match.includes('<ul>')) {
                    let wrapped = '<ol>' + match + '</ol>';
                    formatted = formatted.replace(match, wrapped);
                }
            });
        }
        
        return formatted;
    }
    
    // Process Markdown tables - separate method for clarity
    processMarkdownTables(text) {
        // Early return if no table marker is found
        if (!text.includes('|') && !text.includes('+---') && !text.includes('|---') && !text.includes('+===')) {
            // Last resort: look for space-aligned tables without any pipe or plus symbols
            return this.detectSpaceAlignedTable(text);
        }
        
        const lines = text.split('\n');
        let inTable = false;
        let tableStart = -1;
        let tableEnd = -1;
        let headerRow = -1;
        let separatorRow = -1;
        
        // First check for ASCII tables with +----+----+ format
        const asciiTableRows = this.detectAsciiTable(lines);
        if (asciiTableRows.length > 0) {
            return this.processAsciiTable(lines, asciiTableRows);
        }
        
        // Continue with Markdown table processing...
        
        // First pass: detect table boundaries
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines
            if (!line) continue;
            
            // Check if line could be part of a table
            if (line.startsWith('|') && line.endsWith('|')) {
                // If not in a table yet, mark start
                if (!inTable) {
                    inTable = true;
                    tableStart = i;
                    headerRow = i;
                }
                
                // Check if this is a separator row (----)
                if (line.replace(/\|/g, '').trim().replace(/[- :|]/g, '').length === 0) {
                    separatorRow = i;
                }
                
                // Update end position
                tableEnd = i;
            } else if (inTable) {
                // Current line is not a table row, and we were in a table
                // End the current table
                inTable = false;
                
                // Process the detected table if it has a header and separator
                if (headerRow >= 0 && separatorRow > headerRow && tableEnd >= separatorRow) {
                    lines.splice(tableStart, tableEnd - tableStart + 1, 
                        this.convertToHtmlTable(lines.slice(tableStart, tableEnd + 1)));
                    
                    // Adjust loop variables for the modified array
                    i = tableStart;
                    tableStart = -1;
                    tableEnd = -1;
                    headerRow = -1;
                    separatorRow = -1;
                } else {
                    // Not a valid table, reset markers
                    tableStart = -1;
                    tableEnd = -1;
                    headerRow = -1;
                    separatorRow = -1;
                }
            }
        }
        
        // Process the last table if we ended while still in a table
        if (inTable && headerRow >= 0 && separatorRow > headerRow && tableEnd >= separatorRow) {
            lines.splice(tableStart, tableEnd - tableStart + 1, 
                this.convertToHtmlTable(lines.slice(tableStart, tableEnd + 1)));
        }
        
        // Alternative approach for simple pipe tables without separator row
        // This handles the common case where LLMs output simple tables without proper Markdown formatting
        if (!lines.some(line => line.trim().replace(/\|/g, '').trim().replace(/[- :|]/g, '').length === 0)) {
            // No separator row found in the whole text, try to detect simple tables
            inTable = false;
            tableStart = -1;
            tableEnd = -1;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Skip empty lines
                if (!line) {
                    if (inTable) {
                        // End the current table
                        inTable = false;
                        lines.splice(tableStart, tableEnd - tableStart + 1, 
                            this.convertToSimpleHtmlTable(lines.slice(tableStart, tableEnd + 1)));
                        
                        // Adjust loop variables
                        i = tableStart;
                        tableStart = -1;
                        tableEnd = -1;
                    }
                    continue;
                }
                
                // Check if this might be a table row (contains at least 2 pipe characters)
                const pipeCount = (line.match(/\|/g) || []).length;
                
                if (pipeCount >= 2) {
                    if (!inTable) {
                        inTable = true;
                        tableStart = i;
                    }
                    tableEnd = i;
                } else if (inTable) {
                    // End the current table if we were in one
                    inTable = false;
                    
                    if (tableEnd >= tableStart && tableEnd - tableStart >= 1) {
                        // Only convert if we have at least 2 rows (header + data)
                        lines.splice(tableStart, tableEnd - tableStart + 1, 
                            this.convertToSimpleHtmlTable(lines.slice(tableStart, tableEnd + 1)));
                        
                        // Adjust loop variables
                        i = tableStart;
                        tableStart = -1;
                        tableEnd = -1;
                    }
                }
            }
            
            // Process the last table if we ended while still in a table
            if (inTable && tableEnd >= tableStart && tableEnd - tableStart >= 1) {
                lines.splice(tableStart, tableEnd - tableStart + 1, 
                    this.convertToSimpleHtmlTable(lines.slice(tableStart, tableEnd + 1)));
            }
        }
        
        return lines.join('\n');
    }
    
    // Convert Markdown table rows to HTML table
    convertToHtmlTable(tableRows) {
        // Skip the separator row
        const hasHeader = tableRows.length > 1 && 
            tableRows[1].trim().replace(/\|/g, '').trim().replace(/[- :|]/g, '').length === 0;
        
        const headerRow = hasHeader ? tableRows[0] : null;
        const dataRows = hasHeader ? tableRows.slice(2) : tableRows;
        
        let html = '<div class="table-container"><table>';
        
        // Add header row if present
        if (headerRow) {
            html += '<thead><tr>';
            const headerCells = this.extractCellsFromRow(headerRow);
            for (const cell of headerCells) {
                html += `<th>${cell.trim()}</th>`;
            }
            html += '</tr></thead>';
        }
        
        // Add data rows
        html += '<tbody>';
        for (const row of dataRows) {
            html += '<tr>';
            const cells = this.extractCellsFromRow(row);
            for (const cell of cells) {
                html += `<td>${cell.trim()}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        
        return html;
    }
    
    // Convert simple pipe-delimited rows to HTML table
    convertToSimpleHtmlTable(tableRows) {
        if (tableRows.length < 1) return '';
        
        let html = '<div class="table-container"><table>';
        
        // First row is header
        const headerRow = tableRows[0];
        html += '<thead><tr>';
        const headerCells = this.extractCellsFromRow(headerRow);
        for (const cell of headerCells) {
            html += `<th>${cell.trim()}</th>`;
        }
        html += '</tr></thead>';
        
        // Add data rows
        html += '<tbody>';
        for (let i = 1; i < tableRows.length; i++) {
            html += '<tr>';
            const cells = this.extractCellsFromRow(tableRows[i]);
            for (const cell of cells) {
                html += `<td>${cell.trim()}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        
        return html;
    }
    
    // Helper to extract cells from a table row
    extractCellsFromRow(row) {
        // Remove leading and trailing pipe if present
        const trimmedRow = row.trim();
        const content = trimmedRow.startsWith('|') ? trimmedRow.substring(1) : trimmedRow;
        const finalContent = content.endsWith('|') ? content.substring(0, content.length - 1) : content;
        
        // Split by pipe character, but not by escaped pipes
        return finalContent.split('|');
    }
    
    addSystemMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.classList.add('system-message');
        messageEl.textContent = text;
        
        this.chatMessages.appendChild(messageEl);
        this.scrollToBottom();
    }
    
    typeMessage(element, text) {
        // First add typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.classList.add('typing-indicator');
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            dot.classList.add('typing-dot');
            typingIndicator.appendChild(dot);
        }
        
        element.appendChild(typingIndicator);
        
        // Make sure the typing indicator is visible
        this.scrollToBottom();
        
        // Start typing effect after a short delay
        setTimeout(() => {
            // Remove typing indicator
            element.innerHTML = '';
            
            let i = 0;
            const totalChars = text.length;
            
            const typeChar = () => {
                if (i < totalChars) {
                    element.textContent += text.charAt(i);
                    i++;
                    
                    // Scroll only every few characters for better performance
                    // or when we're at the end of the text
                    if (i % 10 === 0 || i === totalChars) {
                        this.scrollToBottom();
                    }
                    
                    setTimeout(typeChar, this.typingSpeed);
                }
            };
            
            typeChar();
        }, this.typingDelay);
    }
    
    addErrorMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.classList.add('error-message');
        messageEl.textContent = `Error: ${text}`;
        this.chatMessages.appendChild(messageEl);
        this.scrollToBottom();
    }
    
    startThinking() {
        // Show thinking overlay
        this.thinkingOverlay.classList.add('active');
        
        // Increase neural activity in visualization
        if (window.neuralVisualizer) {
            window.neuralVisualizer.startThinking();
        }
    }
    
    stopThinking() {
        // Hide thinking overlay
        this.thinkingOverlay.classList.remove('active');
    }
    
    toggleThinkingOverlay(show) {
        if (show) {
            this.thinkingOverlay.classList.add('active');
        } else {
            this.thinkingOverlay.classList.remove('active');
        }
    }
    
    async updateConnectionStatus() {
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        
        if (!statusDot || !statusText) return;
        
        try {
            // Check if Ollama is accessible
            const response = await fetch('/api/tags', {
                method: 'GET'
            });
            
            if (response.ok) {
                statusDot.style.backgroundColor = 'var(--success-color)';
                statusDot.style.boxShadow = '0 0 8px var(--success-color)';
                statusText.textContent = 'Connected';
            } else {
                throw new Error('API error');
            }
        } catch (error) {
            statusDot.style.backgroundColor = 'var(--error-color)';
            statusDot.style.boxShadow = '0 0 8px var(--error-color)';
            statusText.textContent = 'Disconnected';
        }
    }
    
    /**
     * Show custom confirmation dialog
     * @param {Function} onConfirm - Callback function to execute if confirmed
     */
    showConfirmDialog(onConfirm) {
        const overlay = document.getElementById('confirm-dialog-overlay');
        const confirmBtn = document.getElementById('confirm-dialog-confirm');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        
        if (!overlay || !confirmBtn || !cancelBtn) {
            console.error('Confirmation dialog elements not found:', 
                {overlay: !!overlay, confirmBtn: !!confirmBtn, cancelBtn: !!cancelBtn});
            // Fallback to standard confirm if elements not found
            if (typeof onConfirm === 'function' && confirm('Are you sure you want to clear your chat history? This cannot be undone.')) {
                onConfirm();
            }
            return;
        }
        
        console.log('Showing confirmation dialog');
        
        // Clean up any existing event listeners to prevent duplicates
        const newConfirmBtn = confirmBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        // Show dialog - force repaint to ensure animation works
        overlay.style.display = 'flex';
        // Force browser reflow
        void overlay.offsetWidth;
        setTimeout(() => {
            overlay.classList.add('active');
        }, 10);
        
        // Set up event listeners
        const handleConfirm = () => {
            console.log('Confirm clicked');
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300); // Match transition duration
            newConfirmBtn.removeEventListener('click', handleConfirm);
            newCancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('click', handleOverlayClick);
            
            // Execute the confirmation callback
            if (typeof onConfirm === 'function') {
                onConfirm();
            }
        };
        
        const handleCancel = () => {
            console.log('Cancel clicked');
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300); // Match transition duration
            newConfirmBtn.removeEventListener('click', handleConfirm);
            newCancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('click', handleOverlayClick);
        };
        
        const handleOverlayClick = (e) => {
            if (e.target === overlay) {
                handleCancel();
            }
        };
        
        // Add event listeners
        newConfirmBtn.addEventListener('click', handleConfirm);
        newCancelBtn.addEventListener('click', handleCancel);
        
        // Close on click outside
        overlay.addEventListener('click', handleOverlayClick);
        
        // Keyboard support - Escape to cancel, Enter to confirm
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            } else if (e.key === 'Enter') {
                handleConfirm();
            }
        };
        
        document.addEventListener('keydown', handleKeyDown);
        
        // Remove keyboard listener when dialog is hidden
        const cleanupKeyListener = () => {
            document.removeEventListener('keydown', handleKeyDown);
            overlay.removeEventListener('transitionend', cleanupKeyListener);
        };
        
        overlay.addEventListener('transitionend', cleanupKeyListener);
    }
    
    /**
     * Clear the chat history
     */
    clearChat() {
        console.log('Clear chat button clicked, sessionId:', this.sessionId);
        
        // Always use confirmation dialog regardless of session state
        this.showConfirmDialog(() => {
            console.log('Confirmation callback executed');
            
            // Start thinking mode to provide visual feedback
            this.startThinking();
            
            if (!this.sessionId) {
                // If no session, just clear the UI locally
                this.chatMessages.innerHTML = '';
                this.messageHistory = [];
                this.addSystemMessage('Chat history has been cleared');
                
                // Add welcome message after a brief delay
                setTimeout(() => {
                    this.addMessage(this.welcomeMessage, 'ai');
                }, 500);
                this.stopThinking();
                return;
            }
            
            // Call API to clear session on the server
            fetch('/api/clear-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId
                })
            })
            .then(response => {
                if (!response.ok) {
                    const error = new Error('Failed to clear session');
                    error.status = response.status;
                    throw error;
                }
                return response.json();
            })
            .then(data => {
                console.log('Session cleared:', data);
                
                // Clear UI
                this.chatMessages.innerHTML = '';
                this.messageHistory = [];
                
                // Add system message
                this.addSystemMessage('Chat history has been cleared');
                
                // Add welcome message after a brief delay
                setTimeout(() => {
                    this.addMessage(this.welcomeMessage, 'ai');
                }, 500);
            })
            .catch(error => {
                console.error('Error clearing session:', error);
                // If session not found (404), we can still clear the UI
                if (error.status === 404) {
        this.chatMessages.innerHTML = '';
        this.messageHistory = [];
                    this.addSystemMessage('Chat history has been cleared');
                    
                    // Add welcome message after a brief delay
                    setTimeout(() => {
                        this.addMessage(this.welcomeMessage, 'ai');
                    }, 500);
                } else {
                    this.addErrorMessage('Failed to clear chat history: ' + (error.message || 'Unknown error'));
                }
            })
            .finally(() => {
                // Stop thinking mode
                this.stopThinking();
            });
        });
    }

    setupAnimations() {
        // Create a GSAP timeline for message animations
        this.messageTimeline = gsap.timeline({
            paused: true,
            defaults: { ease: "power3.out" }
        });

        // Set up scroll trigger for chat container
        this.scrollTrigger = ScrollTrigger.create({
            trigger: ".chat-messages",
            start: "top top",
            end: "bottom bottom",
            onEnter: () => this.animateMessagesUp(),
            onLeaveBack: () => this.animateMessagesDown()
        });
    }

    animateMessagesUp() {
        this.chatMessages.classList.add('moving-up');
        this.chatMessages.classList.remove('moving-down');
    }

    animateMessagesDown() {
        this.chatMessages.classList.add('moving-down');
        this.chatMessages.classList.remove('moving-up');
    }

    setupScrollHandling() {
        // Add scroll event listener to chat messages
        this.chatMessages.addEventListener('scroll', () => {
            this.handleScroll();
        });
    }

    handleScroll() {
        const scrollPosition = this.chatMessages.scrollTop;
        const scrollHeight = this.chatMessages.scrollHeight;
        const clientHeight = this.chatMessages.clientHeight;
        
        // Check if user has scrolled up (more than 50px from bottom)
        if (scrollHeight - scrollPosition - clientHeight > 50) {
            this.userHasScrolledUp = true;
            
            // Show scroll to bottom button
            if (this.scrollToBottomBtn) {
                this.scrollToBottomBtn.classList.add('visible');
            }
        }
        
        // Check if user has scrolled down to bottom
        if (scrollHeight - scrollPosition - clientHeight < 20) {
            this.userHasScrolledUp = false;
            
            // Hide scroll to bottom button
            if (this.scrollToBottomBtn) {
                this.scrollToBottomBtn.classList.remove('visible');
            }
        }
        
        // Update last known scroll position
        this.lastScrollTop = scrollPosition;
    }

    // Detect ASCII-style tables
    detectAsciiTable(lines) {
        const asciiTableRows = [];
        let inAsciiTable = false;
        let tableStartIndex = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Look for typical ASCII table borders like +----+----+
            const isAsciiTableBorder = 
                (line.startsWith('+') && line.endsWith('+') && line.includes('-')) ||
                (line.startsWith('|') && line.endsWith('|') && line.includes('-')) ||
                (line.includes('+---') && line.includes('---+'));
            
            if (isAsciiTableBorder) {
                if (!inAsciiTable) {
                    inAsciiTable = true;
                    tableStartIndex = i;
                }
                asciiTableRows.push(i);
            } else if (inAsciiTable && !line.includes('|')) {
                // If we're in an ASCII table but this line doesn't have a pipe,
                // we're out of the table (unless it's just a blank line)
                if (line !== '') {
                    inAsciiTable = false;
                }
            }
        }
        
        return asciiTableRows;
    }
    
    // Process ASCII-style tables into HTML
    processAsciiTable(lines, asciiTableRows) {
        if (asciiTableRows.length < 2) return lines.join('\n');
        
        // Determine the table boundaries
        const tableStart = Math.min(...asciiTableRows);
        const tableEnd = Math.max(...asciiTableRows);
        
        // Extract all the data rows (rows between the ASCII border rows)
        const dataRows = [];
        let headerRowIndex = -1;
        
        for (let i = tableStart; i <= tableEnd; i++) {
            // Skip the ASCII border rows
            if (asciiTableRows.includes(i)) continue;
            
            // If it's a line with content, add it as a data row
            const line = lines[i].trim();
            if (line && line.includes('|')) {
                if (headerRowIndex === -1) {
                    headerRowIndex = dataRows.length;
                }
                dataRows.push(line);
            }
        }
        
        // Create HTML table
        let html = '<div class="table-container"><table>';
        
        // Add header (first data row)
        if (dataRows.length > 0) {
            html += '<thead><tr>';
            
            // Extract header cells
            const headerCells = this.extractCellsFromAsciiRow(dataRows[0]);
            for (const cell of headerCells) {
                html += `<th>${cell.trim()}</th>`;
            }
            
            html += '</tr></thead><tbody>';
            
            // Add the rest of the data rows
            for (let i = 1; i < dataRows.length; i++) {
                html += '<tr>';
                const cells = this.extractCellsFromAsciiRow(dataRows[i]);
                for (const cell of cells) {
                    html += `<td>${cell.trim()}</td>`;
                }
                html += '</tr>';
            }
            
            html += '</tbody>';
        }
        
        html += '</table></div>';
        
        // Replace the ASCII table with the HTML table
        const newLines = [...lines];
        newLines.splice(tableStart, tableEnd - tableStart + 1, html);
        
        return newLines.join('\n');
    }
    
    // Extract cells from ASCII table row
    extractCellsFromAsciiRow(row) {
        // Remove leading and trailing pipe if present
        const trimmedRow = row.trim();
        const content = trimmedRow.startsWith('|') ? trimmedRow.substring(1) : trimmedRow;
        const finalContent = content.endsWith('|') ? content.substring(0, content.length - 1) : content;
        
        // Split by pipe character
        return finalContent.split('|');
    }

    // Detect space-aligned tables
    detectSpaceAlignedTable(text) {
        const lines = text.split('\n');
        let consecutiveAlignedLines = 0;
        let potentialTableStart = -1;
        let columnWidths = [];
        
        // Look for consecutive lines with similar structure (aligned columns)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines
            if (!line) continue;
            
            // Check if this line has multiple columns separated by multiple spaces
            const columnPositions = this.detectColumnPositions(line);
            
            if (columnPositions.length >= 2) { // At least 2 columns needed for a table
                if (potentialTableStart === -1) {
                    potentialTableStart = i;
                    columnWidths = columnPositions;
                    consecutiveAlignedLines = 1;
                } else {
                    // Check if this line has similar column positions
                    const isSimilarStructure = this.hasSimilarColumnStructure(columnPositions, columnWidths);
                    
                    if (isSimilarStructure) {
                        consecutiveAlignedLines++;
                        
                        // If we have several consecutive lines with similar structure, it's likely a table
                        if (consecutiveAlignedLines >= 3) {
                            return this.convertSpaceAlignedToHtml(lines, potentialTableStart, i, columnWidths);
                        }
                    } else {
                        // Reset if structure changes
                        potentialTableStart = i;
                        columnWidths = columnPositions;
                        consecutiveAlignedLines = 1;
                    }
                }
            } else {
                // Not a potential table row, reset
                potentialTableStart = -1;
                consecutiveAlignedLines = 0;
            }
        }
        
        // No space-aligned table found
        return text;
    }
    
    // Detect column positions by looking for groups of 2+ spaces
    detectColumnPositions(line) {
        const positions = [];
        let pos = 0;
        
        // Add beginning position
        positions.push(0);
        
        // Find positions where there are 2 or more consecutive spaces
        while (pos < line.length) {
            if (line[pos] === ' ' && line[pos + 1] === ' ') {
                // Skip all consecutive spaces
                let endPos = pos;
                while (line[endPos] === ' ' && endPos < line.length) {
                    endPos++;
                }
                
                if (endPos > pos + 1) { // At least 2 spaces
                    positions.push(endPos);
                }
                
                pos = endPos;
            } else {
                pos++;
            }
        }
        
        return positions;
    }
    
    // Check if two sets of column positions are similar (aligned table)
    hasSimilarColumnStructure(positions1, positions2) {
        if (Math.abs(positions1.length - positions2.length) > 1) {
            return false;
        }
        
        // Check if column positions are roughly similar
        const len = Math.min(positions1.length, positions2.length);
        for (let i = 0; i < len; i++) {
            if (Math.abs(positions1[i] - positions2[i]) > 3) {
                return false;
            }
        }
        
        return true;
    }
    
    // Convert space-aligned table to HTML
    convertSpaceAlignedToHtml(lines, startIndex, endIndex, columnPositions) {
        if (endIndex - startIndex < 2) return lines.join('\n'); // Not enough rows
        
        let html = '<div class="table-container"><table>';
        
        // First row is header
        html += '<thead><tr>';
        
        const headerRow = lines[startIndex].trim();
        const headerCells = this.extractCellsFromSpacedRow(headerRow, columnPositions);
        
        for (const cell of headerCells) {
            html += `<th>${cell.trim()}</th>`;
        }
        
        html += '</tr></thead><tbody>';
        
        // Add data rows
        for (let i = startIndex + 1; i <= endIndex; i++) {
            const row = lines[i].trim();
            if (!row) continue; // Skip empty lines
            
            html += '<tr>';
            const cells = this.extractCellsFromSpacedRow(row, columnPositions);
            
            for (const cell of cells) {
                html += `<td>${cell.trim()}</td>`;
            }
            
            html += '</tr>';
        }
        
        html += '</tbody></table></div>';
        
        // Replace the table text with HTML
        const newLines = [...lines];
        newLines.splice(startIndex, endIndex - startIndex + 1, html);
        
        return newLines.join('\n');
    }
    
    // Extract cells from a space-aligned row based on column positions
    extractCellsFromSpacedRow(row, columnPositions) {
        const cells = [];
        
        for (let i = 0; i < columnPositions.length - 1; i++) {
            const start = columnPositions[i];
            const end = columnPositions[i + 1];
            cells.push(row.substring(start, end).trim());
        }
        
        // Add the last cell
        if (columnPositions.length > 0) {
            const lastStart = columnPositions[columnPositions.length - 1];
            cells.push(row.substring(lastStart).trim());
        }
        
        return cells;
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Reposition the chat input area from inside .chat-container to
    // directly after it so that it appears in the designated blue box.
    const chatInputArea = document.querySelector('.chat-input-area');
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer && chatInputArea) {
        chatContainer.parentNode.insertBefore(chatInputArea, chatContainer.nextSibling);
    }
    
    // Initialize the chat interface after repositioning
    new OllamaChat();
}); 