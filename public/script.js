document.addEventListener("DOMContentLoaded", function() {
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
  // Brush settings
  let brushSize = 5;
  let brushColor = "#000";
  // For segmented drawing, track last pointer position:
  let isDrawing = false;
  let lastDrawPoint = null;
  let rulerPoints = []; // to store two click coordinates
  // Global variable for current session ID
  let currentSessionId = null;
  
  // Global flag for auto-save (enabled only for moderators)
  let autoSaveEnabled = true;
  
  // ====================
  // User Permission Configuration
  // ====================
  let userPermissionVal = localStorage.getItem("permissionVal");
  console.log("User permission value from localStorage:", userPermissionVal);
  if (userPermissionVal === "0") {
    userPermissionVal = 0;
  } else {
    userPermissionVal = 1;
  }
  
  if (userPermissionVal === 1) {
    // Guest permissions: hide controls and disable auto-save
    function hideElement(id, setChecked = null) {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "none";
      if (setChecked !== null) el.checked = setChecked;
    }
  }   

    // Hide elements
  ["saveSession", "layerValue", "layerLabel", "selectLabel", "eraseLabel"].forEach(hideElement);

    // Hide and check checkboxes
    hideElement("selectSameLayer", true);
    hideElement("eraseSameLayer", true);
    autoSaveEnabled = false;
    console.log("Auto-save disabled for guest.");
  } else {
    autoSaveEnabled = true;
    console.log("Moderator permissions: all controls enabled.");
  }
  
  // ====================
  // Canvas Initialization
  // ====================
  document.getElementById("brushColor").value = "#000";
  document.getElementById("brushSizeRange").value = "5";
  if (document.getElementById("layerValue")) {
    document.getElementById("layerValue").value = "0";
  }
  
  // Extract sessionId from URL (e.g., /game_sessions/2)
  const pathParts = window.location.pathname.split("/");
  const sessionId = pathParts[pathParts.length - 1];
  console.log("Session ID from URL:", sessionId);
  if (sessionId && sessionId !== "new") {
    loadCanvasSession(sessionId);
  }
  
  // Initialize Fabric.js canvas
  const canvas = new fabric.Canvas("canvas", {
    enableRetinaScaling: false,
    renderOnAddRemove: false
  });
  canvas.renderAll();
  canvas.setViewportTransform([1, 0, 0, 1, 1200, 2000]);
  
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
      return canvas.getObjects().some(other => Number(other.layer || 0) !== currentLayer && isOverlapping(obj, other));
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
    return !(a.left > b.left + b.width || a.left + a.width < b.left || a.top > b.top + b.height || a.top + a.height < b.top);
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
      const currentLayer = Number(document.getElementById("layerValue").value) || 0;
      const targetLayer = Number(target.layer || 0);
      if (eraseSameLayer && targetLayer === currentLayer) {
        canvas.remove(target);
        canvas.requestRenderAll();
        console.log("Erased object at:", pointer.x, pointer.y, "with layer:", targetLayer);
      } else if (!eraseSameLayer) {
        canvas.remove(target);
        canvas.requestRenderAll();
        console.log("Erased object at:", pointer.x, pointer.y, "without layer check");
      } else {
        console.log("Skipped erasing: target layer", targetLayer, "≠ current layer", currentLayer);
      }
    }
  }
  
  // ====================
  // Mode Buttons & Tools
  // ====================
  document.getElementById("ruler").addEventListener("click", function() {
    currentMode = "ruler";
    rulerPoints = [];
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
    console.log("RULER mode activated.");
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
      console.log("ERASER mode turned off. Switched to SELECT mode.");
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
      console.log("PAN mode turned off. Switched to SELECT mode.");
    }
  });
  
  document.getElementById("recenter").addEventListener("click", () => {
    canvas.setViewportTransform([1, 0, 0, 1, 1200, 2000]);
    canvas.requestRenderAll();
  });
  
  document.getElementById("clear").addEventListener("click", () => {
    canvas.clear();
    canvas.renderAll();
    console.log("Canvas cleared.");
  });
  
  // ====================
  // Image Import Functions
  // ====================
  function getVisibleCenter() {
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform || fabric.iMatrix;
    return { x: (canvas.width / 4.2 - vpt[4]) / zoom, y: (canvas.height / 2 - vpt[5]) / zoom };
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
          console.log("Standard image added.");
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
      const scale = Math.min(width / img.width, height / img.height);
      let centerVisible = getVisibleCenter();
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
      console.log("Custom image added.");
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
      console.log("Original image added.");
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
      if (distance >= brushSize) {
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
    if (e.key === "Delete" || e.key === "Backspace" || e.keyCode === 46 || e.keyCode === 8) {
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
    let objs = canvas.getObjects();
    objs.sort((a, b) => ((a.layer || 0) - (b.layer || 0)));
    objs.forEach((obj, index) => {
      canvas.moveTo(obj, index + 1);
    });
    canvas.requestRenderAll();
    console.log("Updated layer order.");
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
  // Session Save/Load Functions
  // ====================
  function loadCanvasSession(sessionId) {
    const origin = window.location.origin;
    const url = origin + '/api/game_sessions/' + sessionId;
    fetch(url)
      .then(response => response.json())
      .then(data => {
        if (data.success && data.session) {
          console.log("Loaded session data:", data.session);
          // Load the full canvas state once on initial load
          canvas.loadFromJSON(data.session.data, function() {
            canvas.renderAll();
            currentSessionId = sessionId;
            console.log("Session loaded. currentSessionId:", currentSessionId);
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
  
  function saveCanvasSession() {
    const canvasState = canvas.toJSON(['layer']);
    const origin = window.location.origin;
    if (currentSessionId) {
      fetch(origin + '/game_sessions/' + currentSessionId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: canvasState }),
        keepalive: false
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
  
  const saveSessionBtn = document.getElementById("saveSession");
  if (saveSessionBtn) {
    saveSessionBtn.addEventListener("click", saveCanvasSession);
  }
  
  if (autoSaveEnabled) {
    window.addEventListener("beforeunload", function(e) {
      const canvasState = canvas.toJSON(['layer']);
      const origin = window.location.origin;
      if (currentSessionId) {
        fetch(origin + '/game_sessions/' + currentSessionId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: canvasState }),
          keepalive: false
        }).catch(error => console.error("Error auto-saving session:", error));
      } else {
        fetch(origin + '/game_sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: canvasState }),
          keepalive: false
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
  
  // Join the room for the current session
  socket.emit('joinRoom', sessionId);
  
  // Emit delta events (object-level updates)
  canvas.on("object:added", function(e) {
    if (!e.target._fromSocket) {
      if (!e.target.id) {
        e.target.id = "obj-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      }
      const objData = e.target.toObject(['id', 'layer']);
      socket.emit("object:added", { sessionId, object: objData });
    }
  });
  
  canvas.on("object:modified", function(e) {
    if (!e.target._fromSocket) {
      const objData = e.target.toObject(['id', 'layer']);
      socket.emit("object:modified", { sessionId, object: objData });
    }
  });
  
  canvas.on("object:removed", function(e) {
    if (!e.target._fromSocket) {
      socket.emit("object:removed", { sessionId, objectId: e.target.id });
    }
  });
  
  // Listen for delta updates from other clients:
  socket.on('object:added', function(data) {
    if (data.sessionId !== sessionId) return;
    let exists = canvas.getObjects().find(o => o.id === data.object.id);
    if (!exists) {
      fabric.util.enlivenObjects([data.object], function(objects) {
        objects.forEach(obj => {
          obj._fromSocket = true;
          canvas.add(obj);
        });
        canvas.renderAll();
        canvas.getObjects().forEach(obj => delete obj._fromSocket);
      });
    }
  });
  
  socket.on('object:modified', function(data) {
    if (data.sessionId !== sessionId) return;
    let obj = canvas.getObjects().find(o => o.id === data.object.id);
    if (obj) {
      obj._fromSocket = true;
      canvas.remove(obj);
      fabric.util.enlivenObjects([data.object], function(objects) {
        objects.forEach(newObj => {
          newObj._fromSocket = true;
          canvas.add(newObj);
        });
        canvas.renderAll();
        canvas.getObjects().forEach(o => delete o._fromSocket);
      });
    }
  });
  
  socket.on('object:removed', function(data) {
    if (data.sessionId !== sessionId) return;
    let obj = canvas.getObjects().find(o => o.id === data.objectId);
    if (obj) {
      canvas.remove(obj);
      canvas.renderAll();
    }
  });
  
  window.socket = socket;
});
