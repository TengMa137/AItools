/* sidebar.js - Client-side JavaScript for the sidebar webview */
(function() {
  const vscode = acquireVsCodeApi();
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const chatContainer = document.getElementById('chatContainer');
  const prevButton = document.getElementById('prevButton');
  const nextButton = document.getElementById('nextButton');
  const ragToggle = document.getElementById('ragToggle');
  const ragStatus = document.getElementById('ragStatus');
  
  let chatHistory = { chats: [[]] };
  let currentChatIndex = 0;
  let isGenerating = false;
  let lastScrollPosition = 0;
  let userHasScrolled = false;
  let ragEnabled = false;
  
  // Initialize RAG state from storage if available
  try {
    const savedState = vscode.getState() || {};
    if (savedState.ragEnabled !== undefined) {
      ragEnabled = savedState.ragEnabled;
      ragToggle.checked = ragEnabled;
      updateRagStatusDisplay();
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
  
  // Function to save state
  function saveState() {
    vscode.setState({ ragEnabled });
  }
  
  // Function to update RAG status display
  function updateRagStatusDisplay() {
    if (ragEnabled) {
      ragStatus.textContent = 'RAG: On';
      ragStatus.classList.add('active');
    } else {
      ragStatus.textContent = 'RAG: Off';
      ragStatus.classList.remove('active');
    }
  }
  
  // Function to render the entire chat
  function renderFullChat() {
    // Save scroll position before updating
    lastScrollPosition = chatContainer.scrollTop;
    const wasAtBottom = isScrolledToBottom();
    
    chatContainer.innerHTML = '';
    const currentChat = chatHistory.chats[currentChatIndex];
    if (!currentChat) return;
    
    currentChat.forEach((message, index) => {
      const messageElement = document.createElement('div');
      messageElement.className = `message ${message.role}`;
      messageElement.id = `message-${index}`;
      
      const contentElement = document.createElement('div');
      contentElement.className = 'content';
      contentElement.textContent = message.content;
      
      messageElement.appendChild(contentElement);
      chatContainer.appendChild(messageElement);
    });
    
    // Restore scroll position or scroll to bottom if that's where we were
    if (wasAtBottom && !userHasScrolled) {
      scrollToBottom();
    } else if (!userHasScrolled) {
      chatContainer.scrollTop = lastScrollPosition;
    }
    
    // Update navigation buttons
    prevButton.style.display = currentChatIndex > 0 ? 'block' : 'none';
  }
  
  // Function to update only the streaming message
  function updateStreamingMessage(content) {
    const currentChat = chatHistory.chats[currentChatIndex];
    if (!currentChat) return;
    
    const lastMessageIndex = currentChat.length - 1;
    const lastMessageElement = document.getElementById(`message-${lastMessageIndex}`);
    
    if (lastMessageElement) {
      // If message element exists, just update its content
      const contentElement = lastMessageElement.querySelector('.content');
      if (contentElement) {
        contentElement.textContent = content;
        
        // Only auto-scroll if user hasn't manually scrolled up
        if (isScrolledToBottom() || !userHasScrolled) {
          scrollToBottom();
        }
      }
    } else {
      // If we can't find the element, fall back to full render
      renderFullChat();
    }
  }
  
  // Helper function to check if scrolled to bottom
  function isScrolledToBottom() {
    const tolerance = 50; // pixels from bottom to consider "at bottom"
    return (chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight) < tolerance;
  }
  
  // Helper function to scroll to bottom
  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
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
      value: message,
      useRag: ragEnabled // Send RAG state with the message
    });
    
    // Clear input
    messageInput.value = '';
    
    // Reset user scroll tracking when sending a new message
    userHasScrolled = false;
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent new line
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
  
  // RAG toggle event listener
  ragToggle.addEventListener('change', () => {
    ragEnabled = ragToggle.checked;
    updateRagStatusDisplay();
    
    // Save the setting and notify extension
    saveState();
    vscode.postMessage({
      type: 'updateRagState',
      enabled: ragEnabled
    });
  });
  
  // Tooltip handling
  document.querySelectorAll('.tooltip-icon').forEach(element => {
    element.addEventListener('mouseenter', (e) => {
      // Could implement custom tooltip if needed
    });
  });
  
  // Track user scroll actions
  chatContainer.addEventListener('scroll', () => {
    if (!isGenerating) return;
    
    // Mark as user-scrolled if they've moved up from the bottom
    if (!isScrolledToBottom()) {
      userHasScrolled = true;
    } else {
      userHasScrolled = false;
    }
  });
  
  // Handle messages from extension
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'updateChat':
        chatHistory = message.history;
        currentChatIndex = message.currentChatIndex;
        const wasGenerating = isGenerating;
        isGenerating = message.isGenerating || false;
        
        // Handle button state
        if (isGenerating) {
          sendButton.classList.add('generating');
          sendButton.querySelector('.icon').textContent = '■';
        } else {
          sendButton.classList.remove('generating');
          sendButton.querySelector('.icon').textContent = '↵';
          
          // Reset user scroll tracking when generation completes
          userHasScrolled = false;
        }
        
        // Optimize rendering based on whether it's a stream update
        const currentChat = chatHistory.chats[currentChatIndex];
        if (isGenerating && wasGenerating && currentChat && currentChat.length > 0) {
          // This is likely a streaming update, just update the last message
          const lastMessage = currentChat[currentChat.length - 1];
          updateStreamingMessage(lastMessage.content);
        } else {
          // Full render for non-streaming updates or when switching chats
          renderFullChat();
        }
        break;
        
      case 'updateRagState':
        // Sync RAG state if changed from extension side
        ragEnabled = message.enabled;
        ragToggle.checked = ragEnabled;
        updateRagStatusDisplay();
        saveState();
        break;
        
      case 'updateStatus':
        // Safely handle the status update with a fallback
        if (message.value) {
          ragStatus.textContent = `RAG: ${message.value}`;
          // Add active class if it's not an error message
          if (message.value !== 'Error') {
            ragStatus.classList.add('active');
          } else {
            ragStatus.classList.remove('active');
          }
        } else {
          // Fallback to basic status if value is undefined
          updateRagStatusDisplay();
        }
        break;
    }
  });
  
  // Initialize RAG status display
  updateRagStatusDisplay();
  
  // Focus input on load
  messageInput.focus();
  
  // Initial render
  renderFullChat();
}());