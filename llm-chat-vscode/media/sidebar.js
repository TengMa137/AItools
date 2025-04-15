/* sidebar.js - Client-side JavaScript for the sidebar webview */

(function() {
    const vscode = acquireVsCodeApi();
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const chatContainer = document.getElementById('chatContainer');
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    
    let chatHistory = { chats: [[]] };
    let currentChatIndex = 0;
    let isGenerating = false;
    
    // Function to render the current chat
    function renderChat() {
        chatContainer.innerHTML = '';
        
        const currentChat = chatHistory.chats[currentChatIndex];
        if (!currentChat) return;
        
        currentChat.forEach(message => {
        const messageElement = document.createElement('div');
        messageElement.className = `message \${message.role}`;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'content';
        contentElement.textContent = message.content;
        
        messageElement.appendChild(contentElement);
        chatContainer.appendChild(messageElement);
        });
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        // Update navigation buttons
        prevButton.style.display = currentChatIndex > 0 ? 'block' : 'none';
    }
    
    // Send message function
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message === '') return;
        
        // Change button to stop symbol when sending
        if (!isGenerating) {
        sendButton.classList.add('generating');
        sendButton.querySelector('.icon').textContent = '↵';
        }
        
        vscode.postMessage({
        type: 'sendMessage',
        value: message
        });
        
        // Clear input
        messageInput.value = '';
    }
    
    // Event listeners
    sendButton.addEventListener('click', function() {
        if (isGenerating) {
        // If generating, send stop message
        vscode.postMessage({
            type: 'stopGeneration'
        });
        // Reset button immediately on click
        sendButton.classList.remove('generating');
        sendButton.querySelector('.icon').textContent = '■';
        } else {
        sendMessage();
        }
    });
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
        sendMessage();
        }
    });
    
    prevButton.addEventListener('click', () => {
        vscode.postMessage({
        type: 'navigateChat',
        direction: 'prev'
        });
    });
    
    nextButton.addEventListener('click', () => {
        vscode.postMessage({
        type: 'navigateChat',
        direction: 'next'
        });
    });
    
    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
        case 'updateChat':
            chatHistory = message.history;
            currentChatIndex = message.currentChatIndex;
            isGenerating = message.isGenerating || false;
            renderChat();
            
            // Handle generating state - ensure icon resets when generation complete
            if (isGenerating) {
            sendButton.classList.add('generating');
            sendButton.querySelector('.icon').textContent = '■';
            } else {
            sendButton.classList.remove('generating');
            sendButton.querySelector('.icon').textContent = '↵';
            }
            break;
        }
    });
    
    // Focus input on load
    messageInput.focus();
    
    // Initial render
    renderChat();
    }());