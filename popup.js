document.addEventListener('DOMContentLoaded', function() {
  const clipNowBtn = document.getElementById('clipNowBtn');
  const stopClippingBtn = document.getElementById('stopClippingBtn');
  const saveScheduleBtn = document.getElementById('saveScheduleBtn');
  const clearScheduleBtn = document.getElementById('clearScheduleBtn');
  const scheduleTime = document.getElementById('scheduleTime');
  const dayCheckboxes = document.querySelectorAll('.days-grid input[type="checkbox"]');
  const statusMessage = document.getElementById('statusMessage');
  const nextRunTime = document.getElementById('nextRunTime');
  const clippingStatus = document.querySelector('.clipping-status');
  const couponCount = document.getElementById('couponCount');
  const progressMessage = document.getElementById('progressMessage');
  
  // Load saved schedule
  loadSchedule();
  
  // Check if clipping is already in progress when popup opens
  checkClippingStatus();
  
  // Manual clip button
  clipNowBtn.addEventListener('click', function() {
    statusMessage.textContent = "Starting coupon clipping process...";
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentUrl = tabs[0].url;
      
      if (currentUrl.includes('kroger.com/savings/cl/coupons')) {
        // We're already on the coupons page, check if content script is loaded
        chrome.tabs.sendMessage(tabs[0].id, {action: "ping"}, function(response) {
          if (chrome.runtime.lastError) {
            // Content script not loaded, inject it
            injectContentScriptAndClip(tabs[0].id);
          } else {
            // Content script is loaded, send clip command
            chrome.tabs.sendMessage(tabs[0].id, {action: "clipCoupons"});
            showClippingUI();
          }
        });
      } else {
        // Navigate to the coupons page first
        statusMessage.textContent = "Navigating to Kroger coupons page...";
        chrome.tabs.update({url: 'https://www.kroger.com/savings/cl/coupons/'}, function(tab) {
          // Wait for page to load before sending the clip message
          chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, updatedTab) {
            if (tabId === tab.id && changeInfo.status === 'complete' && 
                updatedTab.url && updatedTab.url.includes('kroger.com/savings/cl/coupons')) {
              chrome.tabs.onUpdated.removeListener(listener);
              // Give the page a moment to fully initialize
              setTimeout(() => {
                injectContentScriptAndClip(tab.id);
              }, 2000);
            }
          });
        });
      }
    });
  });
  
  // Stop clipping button
  stopClippingBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "stopClipping"}, function(response) {
        if (!chrome.runtime.lastError && response && response.status === "stopping") {
          progressMessage.textContent = "Stopping clipping process...";
        }
      });
    });
  });
  
  // Function to inject content script and then clip coupons
  function injectContentScriptAndClip(tabId) {
    chrome.scripting.executeScript({
      target: {tabId: tabId},
      files: ['content.js']
    }, function() {
      if (chrome.runtime.lastError) {
        statusMessage.textContent = "Error: " + chrome.runtime.lastError.message;
        return;
      }
      
      // Now that content script is injected, send the clip command
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {action: "clipCoupons"});
        showClippingUI();
      }, 500);
    });
  }
  
  // Function to check if clipping is already in progress
  function checkClippingStatus() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0].url && tabs[0].url.includes('kroger.com/savings/cl/coupons')) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "getStatus"}, function(response) {
          if (!chrome.runtime.lastError && response && response.isClipping) {
            showClippingUI();
          }
        });
      }
    });
  }
  
  // Function to show clipping UI
  function showClippingUI() {
    clipNowBtn.style.display = 'none';
    stopClippingBtn.style.display = 'block';
    clippingStatus.style.display = 'block';
    couponCount.textContent = '0';
    progressMessage.textContent = 'Clipping coupons...';
  }
  
  // Function to hide clipping UI
  function hideClippingUI() {
    clipNowBtn.style.display = 'block';
    stopClippingBtn.style.display = 'none';
    clippingStatus.style.display = 'none';
  }
  
  // Listen for status updates from content script
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "updateClippingStatus") {
      const data = request.data;
      
      // Update coupon count
      couponCount.textContent = data.count;
      
      // Update message
      if (data.message) {
        progressMessage.textContent = data.message;
      }
      
      // Handle completion or stopping
      if (data.status === 'completed' || data.status === 'stopped' || data.status === 'error') {
        setTimeout(hideClippingUI, 3000); // Hide clipping UI after 3 seconds
      }
    }
  });
  
  // Save schedule button
  saveScheduleBtn.addEventListener('click', function() {
    const time = scheduleTime.value;
    if (!time) {
      statusMessage.textContent = "Please select a time for scheduling.";
      return;
    }
    
    const selectedDays = [];
    dayCheckboxes.forEach(checkbox => {
      if (checkbox.checked) {
        selectedDays.push(parseInt(checkbox.value));
      }
    });
    
    if (selectedDays.length === 0) {
      statusMessage.textContent = "Please select at least one day for scheduling.";
      return;
    }
    
    const schedule = {
      time: time,
      days: selectedDays
    };
    
    chrome.storage.sync.set({schedule: schedule}, function() {
      statusMessage.textContent = "Schedule saved successfully!";
      chrome.runtime.sendMessage({action: "updateAlarm", schedule: schedule});
      updateNextRunDisplay(schedule);
    });
  });
  
  // Clear schedule button
  clearScheduleBtn.addEventListener('click', function() {
    chrome.storage.sync.remove('schedule', function() {
      scheduleTime.value = ''
      dayCheckboxes.forEach(checkbox => {
        checkbox.checked = false
      })
      statusMessage.textContent = "Schedule cleared."
      nextRunTime.textContent = ""
      chrome.runtime.sendMessage({action: "clearAlarm"})
    })
  })
  
  // Load saved schedule
  function loadSchedule() {
    chrome.storage.sync.get('schedule', function(data) {
      if (data.schedule) {
        scheduleTime.value = data.schedule.time
        
        dayCheckboxes.forEach(checkbox => {
          if (data.schedule.days.includes(parseInt(checkbox.value))) {
            checkbox.checked = true
          }
        })
        
        updateNextRunDisplay(data.schedule)
      }
    })
  }
  
  // Update next run time display
  function updateNextRunDisplay(schedule) {
    const [hours, minutes] = schedule.time.split(':')
    const now = new Date()
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    
    // Find the next scheduled day
    let nextDay = null
    let daysUntilNext = 7; // Maximum days in a week
    
    for (const day of schedule.days) {
      const dayDiff = (day - now.getDay() + 7) % 7
      if (dayDiff < daysUntilNext) {
        daysUntilNext = dayDiff
        nextDay = day
      }
    }
    
    if (nextDay !== null) {
      const nextRunDate = new Date()
      nextRunDate.setDate(now.getDate() + daysUntilNext)
      nextRunDate.setHours(parseInt(hours))
      nextRunDate.setMinutes(parseInt(minutes))
      nextRunDate.setSeconds(0)
      
      // If the time today has already passed and today is in the schedule, move to next week
      if (daysUntilNext === 0 && now > nextRunDate) {
        nextRunDate.setDate(nextRunDate.getDate() + 7)
      }
      
      nextRunTime.textContent = `Next run: ${daysOfWeek[nextDay]} at ${formatTime(schedule.time)}`
    }
  }
  
  // Format time for display
  function formatTime(timeString) {
    const [hours, minutes] = timeString.split(':')
    const hour = parseInt(hours)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `${hour12}:${minutes} ${ampm}`
  }
})