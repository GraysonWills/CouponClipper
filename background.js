// Set up alarm when extension is installed or updated
chrome.runtime.onInstalled.addListener(function() {
  setupAlarmFromStorage();
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "updateAlarm") {
    setupAlarm(request.schedule);
  } else if (request.action === "clearAlarm") {
    chrome.alarms.clear("couponClipperAlarm");
  } else if (request.action === "showNotification") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "images/icon128.png",
      title: "CouponClipper",
      message: request.message
    });
  } else if (request.action === "logPerformance") {
    console.warn("Performance issue detected:", request.message);
  }
  return true;
});

// Handle alarm events
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === "couponClipperAlarm") {
    runCouponClipper();
  }
});

// Setup alarm based on schedule
function setupAlarm(schedule) {
  // Clear any existing alarms
  chrome.alarms.clear("couponClipperAlarm", function() {
    const [hours, minutes] = schedule.time.split(':');
    const now = new Date();
    
    // Create a new alarm for each day in the schedule
    for (const day of schedule.days) {
      const alarmTime = new Date();
      alarmTime.setDate(now.getDate() + (day - now.getDay() + 7) % 7);
      alarmTime.setHours(parseInt(hours));
      alarmTime.setMinutes(parseInt(minutes));
      alarmTime.setSeconds(0);
      
      // If the time today has already passed and today is in the schedule, move to next week
      if (day === now.getDay() && now > alarmTime) {
        alarmTime.setDate(alarmTime.getDate() + 7);
      }
      
      // Create the alarm
      chrome.alarms.create("couponClipperAlarm", {
        when: alarmTime.getTime(),
        periodInMinutes: 7 * 24 * 60 // Weekly
      });
      
      console.log(`Alarm set for ${alarmTime.toString()}`);
      break; // We only need to set one alarm, it will repeat weekly
    }
  });
}

// Load schedule from storage and set up alarm
function setupAlarmFromStorage() {
  chrome.storage.sync.get('schedule', function(data) {
    if (data.schedule) {
      setupAlarm(data.schedule);
    }
  });
}

// Run the coupon clipper
function runCouponClipper() {
  // Check if Kroger tab is already open
  chrome.tabs.query({url: "https://www.kroger.com/savings/cl/coupons/*"}, function(tabs) {
    if (tabs.length > 0) {
      // Coupon page is already open, check if content script is loaded
      chrome.tabs.sendMessage(tabs[0].id, {action: "ping"}, function(response) {
        if (chrome.runtime.lastError) {
          // Content script not loaded, inject it
          chrome.tabs.executeScript(tabs[0].id, {file: "content.js"}, function() {
            chrome.tabs.sendMessage(tabs[0].id, {action: "clipCoupons"});
            chrome.tabs.update(tabs[0].id, {active: true});
          });
        } else {
          chrome.tabs.sendMessage(tabs[0].id, {action: "clipCoupons"});
          chrome.tabs.update(tabs[0].id, {active: true});
        }
      });
    } else {
      // Open a new tab with the coupon page
      chrome.tabs.create({url: "https://www.kroger.com/savings/cl/coupons/"}, function(tab) {
        // Wait for page to load before sending the clip message
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Give the page a moment to fully initialize
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, {action: "clipCoupons"});
            }, 2000);
          }
        });
      });
    }
  });
}