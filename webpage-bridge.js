// webpage-bridge.js - Injected into YOUR website to enable extension communication

console.log("🔌 Extension bridge loaded on your website");

// Make chrome.runtime available to page scripts
window.addEventListener('message', async (event) => {
    // Only accept messages from same origin
    if (event.source !== window) return;
    
    if (event.data.type === 'EXTENSION_MESSAGE') {
        console.log("📤 Forwarding message to extension:", event.data.message);
        
        try {
            const response = await chrome.runtime.sendMessage(event.data.message);
            
            // Send response back to page
            window.postMessage({
                type: 'EXTENSION_RESPONSE',
                requestId: event.data.requestId,
                response: response
            }, '*');
        } catch (error) {
            console.error("❌ Extension communication error:", error);
            window.postMessage({
                type: 'EXTENSION_RESPONSE',
                requestId: event.data.requestId,
                error: error.message
            }, '*');
        }
    }
});

// Listen for messages from the extension (background)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "webEposSaveCompleted") {
        // Forward to page scripts
        window.postMessage({
            type: 'EXTENSION_EVENT',
            action: message.action,
            data: message.data
        }, '*');
    }
});


// Signal that extension is ready
window.postMessage({ type: 'EXTENSION_READY' }, '*');