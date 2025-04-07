// Global flags to control the clipping process
window.isClippingInProgress = false;
window.stopClippingRequested = false;

// Error handling
window.addEventListener('error', function(event) {
  chrome.runtime.sendMessage({
    action: "logPerformance",
    message: `Error: ${event.message} at ${event.filename}:${event.lineno}`
  });
});

// Performance monitoring
let lastPerformanceCheck = Date.now();
const performanceInterval = setInterval(() => {
  const now = Date.now();
  const elapsed = now - lastPerformanceCheck;
  if (elapsed > 200) { // If more than 200ms between checks
    chrome.runtime.sendMessage({
      action: "logPerformance",
      message: `Performance warning: Timer delayed by ${elapsed - 100}ms`
    });
  }
  lastPerformanceCheck = now;
}, 100);

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "clipCoupons") {
    if (!window.isClippingInProgress) {
      window.isClippingInProgress = true;
      window.stopClippingRequested = false;
      clipAllCoupons().then(count => {
        console.log(`Clipped ${count} coupons in total`);
      });
      sendResponse({status: "started"});
    } else {
      sendResponse({status: "already_running"});
    }
  } else if (request.action === "ping") {
    // Respond to ping to confirm content script is loaded
    sendResponse({status: "ready", isClipping: window.isClippingInProgress});
  } else if (request.action === "stopClipping") {
    // Set flag to stop the clipping process
    window.stopClippingRequested = true;
    sendResponse({status: "stopping"});
  } else if (request.action === "getStatus") {
    // Return current clipping status
    sendResponse({
      isClipping: window.isClippingInProgress,
      canStop: window.isClippingInProgress && !window.stopClippingRequested
    });
  }
  return true; // Keep the message channel open for async responses
});

// Function to clip all coupons with smooth scrolling
async function clipAllCoupons() {
  console.log("Starting to clip coupons...");
  
  let totalClipped = 0;
  let noNewCouponsCount = 0;
  let lastClippedCount = 0;
  let scrollPosition = window.scrollY;
  const scrollStep = 300; // Pixels to scroll each step
  
  try {
    // Send initial status update
    sendStatusUpdate(totalClipped, "in_progress");
    
    // Main clipping loop
    while (!window.stopClippingRequested && noNewCouponsCount < 3) {
      // Check for "no coupons" message
      if (checkForNoCouponsMessage()) {
        console.log("No more coupons message detected");
        sendStatusUpdate(totalClipped, "completed", "No more coupons available");
        break;
      }
      
      // Find and clip visible coupons
      const clippedInThisPass = await clipVisibleCoupons();
      totalClipped += clippedInThisPass;
      
      // Check if we found new coupons
      if (clippedInThisPass === 0) {
        noNewCouponsCount++;
      } else {
        noNewCouponsCount = 0;
        lastClippedCount = totalClipped;
      }
      
      // Send progress update
      sendStatusUpdate(totalClipped, "in_progress");
      
      // Smooth scroll down
      await smoothScroll(scrollPosition, scrollPosition + scrollStep);
      scrollPosition += scrollStep;
      
      // Small delay to let new content load
      await sleep(1000);
    }
    
    // If stopped by user
    if (window.stopClippingRequested) {
      sendStatusUpdate(totalClipped, "stopped", "Stopped by user");
    } else if (!checkForNoCouponsMessage()) {
      // If we reached the end without finding the "no coupons" message
      sendStatusUpdate(totalClipped, "completed", "Finished clipping all visible coupons");
    }
    
    return totalClipped;
  } catch (error) {
    console.error("Error in clipAllCoupons:", error);
    sendStatusUpdate(totalClipped, "error", `Error: ${error.message}`);
    return totalClipped;
  } finally {
    // Reset flags
    window.isClippingInProgress = false;
    window.stopClippingRequested = false;
  }
}

// Function to check for the "no coupons" message
function checkForNoCouponsMessage() {
  const noCouponsElements = Array.from(document.querySelectorAll('p, div, span'))
    .filter(el => {
      const text = el.textContent.trim();
      return text.includes("We're not finding any coupons right now") || 
             text.includes("please try again later");
    });
  
  return noCouponsElements.length > 0;
}

// Function to clip all visible coupons on the current screen
async function clipVisibleCoupons() {
  // Find all clip buttons that are visible and not already clipped
  const clipButtons = Array.from(document.querySelectorAll('button'))
    .filter(button => {
      // Look for buttons with text "Clip" that are visible
      return button.textContent.trim() === 'Clip' && 
             isElementInViewport(button) && // Check if in viewport
             !button.disabled;
    });
  
  console.log(`Found ${clipButtons.length} clip buttons in viewport`);
  
  let clippedCount = 0;
  
  // Click each button with a small delay
  for (const button of clipButtons) {
    if (window.stopClippingRequested) break;
    
    try {
      button.click();
      clippedCount++;
      
      // Small delay between clicks to avoid overwhelming the site
      await sleep(100);
    } catch (error) {
      console.error("Error clicking button:", error);
    }
  }
  
  return clippedCount;
}

// Function to check if an element is in the viewport
function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

// Function to smoothly scroll the page
function smoothScroll(startY, endY) {
  return new Promise(resolve => {
    const duration = 500; // ms
    const startTime = performance.now();
    
    function step(currentTime) {
      if (window.stopClippingRequested) {
        resolve();
        return;
      }
      
      const elapsedTime = currentTime - startTime;
      
      if (elapsedTime < duration) {
        const progress = elapsedTime / duration;
        const easeProgress = 0.5 - Math.cos(progress * Math.PI) / 2; // Ease in-out
        const scrollY = startY + (endY - startY) * easeProgress;
        
        window.scrollTo(0, scrollY);
        requestAnimationFrame(step);
      } else {
        window.scrollTo(0, endY);
        resolve();
      }
    }
    
    requestAnimationFrame(step);
  });
}

// Helper function for sleep/delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send status updates to the popup
function sendStatusUpdate(count, status, message = "") {
  try {
    chrome.runtime.sendMessage({
      action: "updateClippingStatus",
      data: {
        count: count,
        status: status, // 'in_progress', 'completed', 'stopped', 'error'
        message: message
      }
    });
  } catch (error) {
    console.error("Error sending status update:", error);
  }
}
