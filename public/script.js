// ====================
// Global Variables & Session ID Storage
// ====================
let currentMode = "select";
let imageDataURL = null;      // For custom image import
let panMode = false;          // Track pan mode
let isDragging = false;
let lastPosX, lastPosY;
let renderPending = false;
let eraserMode = false;       // tracks eraser toggle state
let isErasing = false;
// Brush settings (for our custom segmented drawing)
let brushSize = 5;
let brushColor = "#000";
// For segmented drawing, we track the last pointer position:
let isDrawing = false;
let lastDrawPoint = null;
let rulerPoints = []; // to store the two click coordinates
// Global variable to hold the current session ID once loaded/created
let currentSessionId = null;

// Global flag for auto-save (enabled only for moderators)
let autoSaveEnabled = true;

// ====================
// User Permission Configuration
// ====================
// Assume permissionVal is stored in localStorage after login
let userPermissionVal = localStorage.getItem("permissionVal");
if (userPermissionVal !== null) {
  userPermissionVal = Number(userPermissionVal);
} else {
  // Default to moderator if not found
  userPermissionVal = 0;
}

// If userPermissionVal is not 0, assume guest permissions.
// Adjust the condition if your scheme is reversed.
if (userPermissionVal !== 0) {
  // Hide save button, layer input, and checkboxes for same-layer controls
  const saveBtn = document.getElementById("saveSession");
  if (saveBtn) saveBtn.style.display = "none";

  const layerInput = document.getElementById("layerValue");
  if (layerInput) layerInput.style.display = "none";

  const selectSameLayer = document.getElementById("selectSameLayer");
  if (selectSameLayer) {
    selectSameLayer.style.display = "none";
    // Force it to be active (checked)
    selectSameLayer.checked = true;
  }

  const eraseSameLayer = document.getElementById("eraseSameLayer");
  if (eraseSameLayer) {
    eraseSameLayer.style.display = "none";
    // Force it to be active (checked)
    eraseSameLayer.checked = true;
  }

  // Disable auto-save for guests
  autoSaveEnabled = false;
  console.log("Guest permissions detected; hiding certain controls and disabling auto-save.");
} else {
  autoSaveEnabled = true;
  console.log("Moderator permissions detected; all controls are available and auto-save is enabled.");
}

// ====================
// Canvas Initialization
// ====================
window.addEventListener("load", function() {
  document.getElementById("brushColor").value = "#000";
  document.getElementById("brushSizeRange").value = "5";
  if (document.getElementById("layerValue")) {
    document.getElementById("layerValue").value = "0"; // reset layer value to 0 on page load
  }
  
  // Extract sessionId from the URL (e.g., /game_sessions/2)
  const pathParts = window.location.pathname.split("/");
  const sessionId = pathParts[pathParts.length - 1];
  if (sessionId && sessionId !== "new") {
    loadCanvasSession(sessionId);
  }
});

// Initialize Fabric.js canvas with performance tweaks:
const canvas = new fabric.Canvas("canvas", {
  enableRetinaScaling: false,
  renderOnAddRemove: false
});
canvas.renderAll();

// Shift the coordinate system so that the drawable area is from (-3000, -3000) to (0,0)
canvas.setViewportTransform([1, 0, 0, 1, 1200, 2000]);
console.log("Canvas initialized. Dimensions:", canvas.width, canvas.height);
console.log("Viewport transform set to:", canvas.viewportTransform);

// ====================
// Helper Functions
// ====================
function filterSelectionByLayer() {
  if (!document.getElementById("selectSameLayer").checked) return;
  const currentLayer = Number(document.getElementById("layerValue").value) || 0;
  const activeObjs = canvas.getActiveObjects();
  const filtered = activeObjs.filter(obj => Number(obj.layer || 0) === currentLayer);
  const overlapping = canvas.getObjects().filter(obj => {
    if (Number(obj.layer || 0) !== currentLayer) return false;
    return canvas.getObjects().some(other => 
      Number(other.layer || 0) !== currentLayer && isOverlapping(obj, other)
    );
  });
  const finalSelection = [...new Set([...filtered, ...overlapping])];
  if (finalSelection.length === activeObjs.length) return;
  canvas.discardActiveObject();
  if (finalSelection.length === 1) {
    canvas.setActiveObject(finalSelection[0]);
  } else if (finalSelection.length > 1) {
    const sel = new fabric.ActiveSelection(finalSelection, { canvas: canvas });
    canvas.setActiveObject(sel);
  }
  canvas.requestRenderAll();
}

function isOverlapping(objA, objB) {
  const a = objA.getBoundingRect();
  const b = objB.getBoundingRect();
  return !(a.left > b.left + b.width || 
           a.left + a.width < b.left || 
           a.top > b.top + b.height || 
           a.top + a.height < b.top);
}

canvas.on("selection:created", () => setTimeout(filterSelectionByLayer, 0));

function updateToggleButtons(activeMode) {
  const modes = ["draw", "select", "pan", "eraser"];
  modes.forEach(mode => {
    const btn = document.getElementById(mode);
    if (btn) {
      if (mode === activeMode) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  });
  console.log("Toggle buttons updated. Active mode:", activeMode);
}

function eraseAtPointer(e) {
  const pointer = canvas.getPointer(e.e);
  const target = canvas.findTarget(e.e, true);
  if (target) {
    const eraseSameLayer = document.getElementById("eraseSameLayer").checked;
    if (eraseSameLayer) {
      const currentLayer = Number(document.getElementById("layerValue").value) || 0;
      const targetLayer = Number(target.layer || 0);
      if (targetLayer === currentLayer) {
        canvas.remove(target);
        canvas.requestRenderAll();
        console.log("Erased object at:", pointer.x, pointer.y, "with layer:", targetLayer);
      } else {
        console.log("Skipped erasing object at:", pointer.x, pointer.y, "because target layer", targetLayer, "≠ current layer", currentLayer);
      }
    } else {
      canvas.remove(target);
      canvas.requestRenderAll();
      console.log("Erased object at:", pointer.x, pointer.y, "without layer check");
    }
  }
}

// ====================
// Mode Buttons & Canvas Tools
// ====================
document.getElementById("ruler").addEventListener("click", function() {
  currentMode = "ruler";
  rulerPoints = []; // clear any previous clicks
  let rulerStatus = document.getElementById("rulerStatus");
  if (!rulerStatus) {
    rulerStatus = document.createElement("div");
    rulerStatus.id = "rulerStatus";
    rulerStatus.style.position = "fixed";
    rulerStatus.style.top = "0";
    rulerStatus.style.left = "50%";
    rulerStatus.style.transform = "translateX(-50%)";
    rulerStatus.style.backgroundColor = "yellow";
    rulerStatus.style.padding = "5px";
    rulerStatus.style.zIndex = "9999";
    document.body.appendChild(rulerStatus);
  }
  rulerStatus.innerText = "RULER: ACTIVE";
  rulerStatus.style.display = "block";
  console.log("Ruler mode activated.");
});

document.getElementById("draw").addEventListener("click", () => {
  panMode = false;
  eraserMode = false; 
  updateToggleButtons("draw");
  currentMode = "draw";
  canvas.isDrawingMode = false; 
  canvas.defaultCursor = "crosshair";
  canvas.skipTargetFind = true;
  canvas.selection = false;
  console.log("Switched to DRAW mode.");
});
document.getElementById("select").addEventListener("click", () => {
  panMode = false;
  eraserMode = false;
  updateToggleButtons("select");
  currentMode = "select";
  canvas.isDrawingMode = false;
  canvas.defaultCursor = "default";
  canvas.skipTargetFind = false;
  canvas.selection = true;
  canvas.getObjects().forEach(obj => { if (obj) obj.selectable = true; });
  console.log("Switched to SELECT mode.");
});
document.getElementById("eraser").addEventListener("click", () => {
  eraserMode = !eraserMode;
  panMode = false;
  if (eraserMode) {
    updateToggleButtons("eraser");
    currentMode = "eraser";
    canvas.isDrawingMode = false;
    canvas.defaultCursor = "crosshair";
    canvas.skipTargetFind = false;
    canvas.selection = false;
    console.log("Switched to ERASER mode.");
  } else {
    updateToggleButtons("select");
    currentMode = "select";
    canvas.isDrawingMode = false;
    canvas.defaultCursor = "default";
    canvas.skipTargetFind = false;
    canvas.selection = true;
    console.log("Eraser mode turned off. Switched to SELECT mode.");
  }
});
document.getElementById("pan").addEventListener("click", () => {
  panMode = !panMode;
  eraserMode = false;
  if (panMode) {
    updateToggleButtons("pan");
    canvas.isDrawingMode = false;
    canvas.defaultCursor = "grab";
    canvas.skipTargetFind = true;
    canvas.selection = false;
    console.log("Switched to PAN mode.");
  } else {
    updateToggleButtons("select");
    canvas.defaultCursor = "default";
    canvas.skipTargetFind = false;
    canvas.selection = true;
    console.log("Pan mode turned off. Switched to SELECT mode.");
  }
});

document.getElementById("recenter").addEventListener("click", () => {
  canvas.setViewportTransform([1, 0, 0, 1, 1200, 2000]);
  canvas.requestRenderAll();
  console.log("Recentered viewport to:", canvas.viewportTransform);
});

document.getElementById("clear").addEventListener("click", () => {
  canvas.clear();
  canvas.renderAll();
  console.log("Canvas cleared and boundary restored.");
});

// ====================
// Standardized Image Import & Custom Image Import (Unchanged)
// ====================
function getVisibleCenter() {
  const zoom = canvas.getZoom();
  const vpt = canvas.viewportTransform || fabric.iMatrix;
  const centerX = (canvas.width / 4.2 - vpt[4]) / zoom;
  const centerY = (canvas.height / 2 - vpt[5]) / zoom;
  return { x: centerX, y: centerY };
}

document.getElementById("importStandardImage").addEventListener("click", () => {
  document.getElementById("standardImageUpload").click();
});
document.getElementById("standardImageUpload").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(event) {
      fabric.Image.fromURL(event.target.result, function(img) {
        let targetSize = 125;
        let scale = Math.max(targetSize / img.width, targetSize / img.height);
        let centerVisible = getVisibleCenter();
        console.log("Corrected Visible Center:", centerVisible);
        img.set({
          left: centerVisible.x,
          top: centerVisible.y,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale
        });
        let clipCircle = new fabric.Circle({
          radius: targetSize / 2,
          originX: "center",
          originY: "center"
        });
        clipCircle.scaleX = 1 / scale;
        clipCircle.scaleY = 1 / scale;
        img.clipPath = clipCircle;
        img.layer = parseInt(document.getElementById("layerValue").value, 10) || 0;
        canvas.add(img);
        updateLayerOrder();
        canvas.requestRenderAll();
        console.log("Standard image added at:", img.left, img.top);
      });
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById("importCustomImage").addEventListener("click", function() {
  document.getElementById("customImageUpload").click();
});
document.getElementById("customImageUpload").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(event) {
      imageDataURL = event.target.result;
      document.getElementById("imageSettingsModal").style.display = "block";
      console.log("Custom image loaded; showing modal.");
    };
    reader.readAsDataURL(file);
  }
});
  
document.getElementById("confirmImageSize").addEventListener("click", function() {
  const width = parseInt(document.getElementById("imageWidth").value);
  const height = parseInt(document.getElementById("imageHeight").value);
  if (!width || !height || width <= 0 || height <= 0) {
    alert("Please enter valid dimensions.");
    return;
  }
  fabric.Image.fromURL(imageDataURL, function(img) {
    const scaleX = width / img.width;
    const scaleY = height / img.height;
    const scale = Math.min(scaleX, scaleY);
    console.log("Custom scale computed:", scale);
    let centerVisible = getVisibleCenter();
    console.log("Custom image center computed:", centerVisible);
    img.set({
      left: centerVisible.x,
      top: centerVisible.y,
      originX: "center",
      originY: "center",
      scaleX: scale,
      scaleY: scale
    });
    img.layer = parseInt(document.getElementById("layerValue").value, 10) || 0;
    canvas.add(img);
    updateLayerOrder();
    canvas.requestRenderAll();
    console.log("Custom image added at:", img.left, img.top);
  });
  document.getElementById("imageSettingsModal").style.display = "none";
});
  
document.getElementById("importOriginal").addEventListener("click", function() {
  fabric.Image.fromURL(imageDataURL, function(img) {
    let centerVisible = getVisibleCenter();
    img.set({
      left: centerVisible.x,
      top: centerVisible.y,
      originX: "center",
      originY: "center"
    });
    img.layer = parseInt(document.getElementById("layerValue").value, 10) || 0;
    canvas.add(img);
    updateLayerOrder();
    canvas.requestRenderAll();
    console.log("Original custom image added at:", img.left, img.top);
  });
  document.getElementById("imageSettingsModal").style.display = "none";
});
  
document.getElementById("cancelImageSize").addEventListener("click", function() {
  document.getElementById("imageSettingsModal").style.display = "none";
  console.log("Image import canceled.");
});

// ====================
// Brush Settings UI Listeners
// ====================
document.getElementById("brushColor").addEventListener("change", function(e) {
  brushColor = e.target.value;
  console.log("Brush color set to:", brushColor);
});
document.getElementById("brushSizeRange").addEventListener("input", function(e) {
  brushSize = parseInt(e.target.value, 10);
  console.log("Brush size set to:", brushSize);
});

// ====================
// Drawing on Canvas (Custom Segmented Drawing)
// ====================
canvas.on("mouse:down", function(e) {
  if (panMode) return;
  if (currentMode === "draw") {
    isDrawing = true;
    lastDrawPoint = canvas.getPointer(e.e);
  } else if (currentMode === "eraser") {
    isErasing = true;
    eraseAtPointer(e);
    e.e.stopPropagation();
  } else if (currentMode === "ruler") {
    let pt = canvas.getPointer(e.e);
    rulerPoints.push(pt);
    console.log("Ruler click recorded:", pt);
    if (rulerPoints.length === 2) {
      let dx = rulerPoints[1].x - rulerPoints[0].x;
      let dy = rulerPoints[1].y - rulerPoints[0].y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      let rulerStatus = document.getElementById("rulerStatus");
      if (!rulerStatus) {
        rulerStatus = document.createElement("div");
        rulerStatus.id = "rulerStatus";
        rulerStatus.style.position = "fixed";
        rulerStatus.style.top = "0";
        rulerStatus.style.left = "50%";
        rulerStatus.style.transform = "translateX(-50%)";
        rulerStatus.style.backgroundColor = "yellow";
        rulerStatus.style.padding = "5px";
        rulerStatus.style.zIndex = "9999";
        document.body.appendChild(rulerStatus);
      }
      rulerStatus.innerText = "Distance: " + Math.round(distance) + " px";
      rulerStatus.style.display = "block";
      setTimeout(() => {
        currentMode = "select";
        rulerStatus.style.display = "none";
        console.log("Ruler measurement complete; reverting to SELECT mode.");
      }, 2000);
      rulerPoints = [];
    }
    e.e.stopPropagation();
  }
});

canvas.on("mouse:move", function(e) {
  if (isDrawing && !panMode && currentMode === "draw") {
    let pointer = canvas.getPointer(e.e);
    let dx = pointer.x - lastDrawPoint.x;
    let dy = pointer.y - lastDrawPoint.y;
    let distance = Math.sqrt(dx * dx + dy * dy);
    let threshold = brushSize;
    if (distance >= threshold) {
      let line = new fabric.Line(
        [lastDrawPoint.x, lastDrawPoint.y, pointer.x, pointer.y],
        {
          stroke: brushColor,
          strokeWidth: brushSize,
          selectable: false,
          evented: true
        }
      );
      line.layer = parseInt(document.getElementById("layerValue").value, 10) || 0;
      canvas.add(line);
      lastDrawPoint = pointer;
      canvas.requestRenderAll();
    }
  } else if (isErasing && !panMode && currentMode === "eraser") {
    eraseAtPointer(e);
  }
});

canvas.on("mouse:up", function() {
  isDrawing = false;
  isErasing = false;
  lastDrawPoint = null;
  console.log("Stopped drawing/erasing.");
});

// ====================
// Object Selection & Constraints
// ====================
canvas.on("object:selected", function(e) {
  let selectedObject = e.target;
  const selectSameLayerOnly = document.getElementById("selectSameLayer").checked;
  if (selectSameLayerOnly) {
    let currentLayer = Number(document.getElementById("layerValue").value);
    let objectLayer = Number(selectedObject.layer !== undefined ? selectedObject.layer : 0);
    if (objectLayer !== currentLayer) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      console.log("Selection discarded: object layer (" + objectLayer + ") does not match current layer (" + currentLayer + ").");
      return;
    }
  }
  selectedObject.set({
    hasControls: true,
    lockScalingFlip: true,
    lockMovementX: false,
    lockMovementY: false
  });
  console.log("Object selected:", selectedObject);
});

canvas.on("selection:created", function(e) {
  const selectSameLayerOnly = document.getElementById("selectSameLayer").checked;
  if (selectSameLayerOnly) {
    let currentLayer = Number(document.getElementById("layerValue").value);
    let activeObjects = canvas.getActiveObjects();
    for (let obj of activeObjects) {
      let objectLayer = Number(obj.layer !== undefined ? obj.layer : 0);
      if (objectLayer !== currentLayer) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        console.log("Selection created discarded due to layer mismatch.");
        return;
      }
    }
  }
});

canvas.on("selection:updated", function(e) {
  const selectSameLayerOnly = document.getElementById("selectSameLayer").checked;
  if (selectSameLayerOnly) {
    let currentLayer = Number(document.getElementById("layerValue").value);
    let activeObjects = canvas.getActiveObjects();
    for (let obj of activeObjects) {
      let objectLayer = Number(obj.layer !== undefined ? obj.layer : 0);
      if (objectLayer !== currentLayer) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        console.log("Selection updated discarded due to layer mismatch.");
        return;
      }
    }
  }
});

// ====================
// Panning (Dragging) Tool
// ====================
canvas.on("mouse:down", function(e) {
  if (panMode) {
    isDragging = true;
    lastPosX = e.e.clientX;
    lastPosY = e.e.clientY;
    console.log("Started panning at:", lastPosX, lastPosY);
  }
});
canvas.on("mouse:move", function(e) {
  if (isDragging && panMode) {
    const deltaX = e.e.clientX - lastPosX;
    const deltaY = e.e.clientY - lastPosY;
    const vpt = canvas.viewportTransform;
    vpt[4] += deltaX;
    vpt[5] += deltaY;
    lastPosX = e.e.clientX;
    lastPosY = e.e.clientY;
    if (!renderPending) {
      renderPending = true;
      setTimeout(() => {
        canvas.requestRenderAll();
        renderPending = false;
      }, 30);
    }
    console.log("Panning... delta:", deltaX, deltaY, "New transform:", vpt);
  }
});
canvas.on("mouse:up", function() {
  if (panMode) {
    isDragging = false;
    console.log("Stopped panning.");
  }
});
  
// ====================
// Zooming
// ====================
canvas.on("mouse:wheel", function(event) {
  const delta = event.e.deltaY;
  let zoom = canvas.getZoom();
  zoom *= 0.999 ** delta;
  zoom = Math.min(Math.max(zoom, 0.1), 3);
  canvas.zoomToPoint({ x: event.e.offsetX, y: event.e.offsetY }, zoom);
  canvas.requestRenderAll();
  console.log("Zooming. New zoom level:", zoom);
  event.e.preventDefault();
  event.e.stopPropagation();
});

document.addEventListener("keydown", function(e) {
  if (
    e.key === "Delete" ||
    e.key === "Backspace" ||
    e.keyCode === 46 ||
    e.keyCode === 8
  ) {
    e.preventDefault();
    let activeObjects = canvas.getActiveObjects();
    if (activeObjects && activeObjects.length > 0) {
      activeObjects.forEach(function(obj) {
        if (obj) {
          canvas.remove(obj);
        }
      });
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      console.log("Deleted selected object(s).");
    }
  }
});

function updateLayerOrder() {
  objs.sort((a, b) => ((a.layer || 0) - (b.layer || 0)));
  objs.forEach((obj, index) => {
    canvas.moveTo(obj, index + 1);
  });
  canvas.requestRenderAll();
  console.log("Updated layer order based on custom layer values.");
}

function checkSelectionLayer() {
  const selectSameLayerOnly = document.getElementById("selectSameLayer").checked;
  if (!selectSameLayerOnly) return;
  const currentLayer = parseInt(document.getElementById("layerValue").value, 10) || 0;
  const activeObjects = canvas.getActiveObjects();
  for (let obj of activeObjects) {
    if ((obj.layer || 0) !== currentLayer) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      console.log("Discarded selection due to layer mismatch.");
      return;
    }
  }
}

canvas.on("object:selected", function(e) { checkSelectionLayer(); });
canvas.on("selection:created", function(e) { checkSelectionLayer(); });
canvas.on("selection:updated", function(e) { checkSelectionLayer(); });

// ====================
// Session Save/Load Functions (Integration with Express endpoints)
// ====================

// New API endpoint for loading session data uses /api/game_sessions/:sessionId
function loadCanvasSession(sessionId) {
  const origin = window.location.origin;
  const url = origin + '/api/game_sessions/' + sessionId;
  fetch(url)
    .then(response => response.json())
    .then(data => {
      if (data.success && data.session) {
        console.log("Loaded session data:", data.session);
        canvas.loadFromJSON(data.session.data, () => {
          canvas.renderAll();
          currentSessionId = sessionId;
          console.log("Session loaded. currentSessionId is set to:", currentSessionId);
        });
      } else {
        alert("Session not found.");
      }
    })
    .catch(error => { 
      console.error("Error loading session:", error); 
      alert("Error loading session. Check console for details.");
    });
}

// Save or update the current session.
function saveCanvasSession() {
  const canvasState = canvas.toJSON(['layer']);
  const origin = window.location.origin;
  
  if (currentSessionId) {
    // Update existing session with PUT
    fetch(origin + '/game_sessions/' + currentSessionId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: canvasState }),
      keepalive: true
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        console.log("Session updated successfully!");
        alert("Session updated!");
      } else {
        alert("Failed to update session.");
      }
    })
    .catch(error => {
      console.error("Error updating session:", error);
      alert("Error updating session. See console for details.");
    });
  } else {
    // Create new session with POST
    fetch(origin + '/game_sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: canvasState })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        currentSessionId = data.sessionId;
        alert("Session saved! Session ID: " + data.sessionId);
      } else {
        alert("Failed to save session.");
      }
    })
    .catch(error => {
      console.error("Error saving session:", error);
      alert("Error saving session. See console for details.");
    });
  }
}

// Bind Session Functions to UI Elements
document.getElementById("saveSession").addEventListener("click", saveCanvasSession);

// ====================
// Auto-Save on Connection Lost (Before Unload)
// ====================
if (autoSaveEnabled) {
  window.addEventListener("beforeunload", function(e) {
    const canvasState = canvas.toJSON(['layer']);
    const origin = window.location.origin;
    
    if (currentSessionId) {
      // Update existing session with PUT
      fetch(origin + '/game_sessions/' + currentSessionId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: canvasState }),
        keepalive: true
      }).catch(error => console.error("Error auto-saving session:", error));
    } else {
      // Create new session with POST
      fetch(origin + '/game_sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: canvasState }),
        keepalive: true
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          currentSessionId = data.sessionId;
        }
      })
      .catch(error => console.error("Error auto-saving session:", error));
    }
  });
} else {
  console.log("Auto-save is disabled for guest users.");
}

// ====================
// Socket.IO for Real-Time Collaboration
// ====================
const socket = io();
socket.on('canvas-update', function(data) {
  console.log("Canvas update received:", data);
});
socket.on('connect', function() {
  console.log("Connected to socket server.");
});
socket.on('disconnect', function() {
  console.log("Disconnected from socket server.");
});
