(function() {
    'use strict';
    
    // Feature detection and fallbacks
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = function(callback) {
            return setTimeout(callback, 16); // ~60fps fallback
        };
    }
    
    const text = document.getElementById('bouncingText');
    if (!text) return; // Exit if element not found
    
    // Matter.js modules
    const Engine = Matter.Engine,
          World = Matter.World,
          Bodies = Matter.Bodies,
          Body = Matter.Body,
          Events = Matter.Events;
    
    // Create engine and world
    const engine = Engine.create();
    const world = engine.world;
    
    // Disable gravity for DVD-style bouncing
    engine.world.gravity.y = 0;
    engine.world.gravity.x = 0;
    
    // Configure engine for immediate collision response (no sliding)
    engine.constraintIterations = 4;  // More iterations for stable collisions
    engine.velocityIterations = 6;    // More velocity iterations
    engine.positionIterations = 8;    // More position iterations
    
    // Set collision tolerance to zero for immediate response
    world.bodies.forEach(body => {
        if (body.slop !== undefined) body.slop = 0;
    });
    
    // Constant velocity for DVD-style bouncing
    const CONSTANT_SPEED = 3;
    
    // Size scaling for new elements - CHANGE THIS VALUE TO ADJUST SCALING:
    // 0.9 = 10% smaller each time
    // 0.8 = 20% smaller each time  
    // 0.95 = 5% smaller each time
    const SCALE_FACTOR = 0.97;
    
    // Corner detection sensitivity - CHANGE THIS VALUE TO ADJUST CORNER DETECTION:
    // 30 = very strict (classic DVD behavior - rare corner hits)
    // 50 = strict (occasional corner hits)
    // 70 = moderate (more frequent corner hits)
    // 100 = frequent corner hits
    const CORNER_THRESHOLD = 100;
    
    // Text collision height ratio - CHANGE THIS TO ADJUST VERTICAL COLLISION BOUNDARIES:
    // 0.7 = collision boundary is 70% of font height (tight to actual text pixels)
    // 0.8 = slightly more generous vertical collision
    // 1.0 = use full font height (includes extra spacing above/below)
    const TEXT_HEIGHT_RATIO = 0.7;
    
    // Debug logging - CHANGE TO true TO SEE DETECTION DETAILS:
    const DEBUG_CORNER_DETECTION = false;
    
    // Wall collision cooldown - CHANGE THIS TO ADJUST DOUBLE BOUNCE PREVENTION:
    // 100ms = default (prevents most double bounces)
    // 50ms = more sensitive (allows faster re-bounces)
    // 200ms = very conservative (longer cooldown)
    const WALL_COOLDOWN_MS = 100;
    
    // Global collision processing flag to prevent ghost bounces
    let isProcessingCollisions = false;
    
    // Maximum elements before reset - CHANGE THIS TO ADJUST RESET POINT:
    // 100 = current (resets when 100 elements reached)
    // 20 = previous default
    // 10 = more frequent resets
    // 50 = less frequent resets
    const MAX_ELEMENTS = 100;
    
    // Manual trigger clicks/taps - CHANGE THIS TO ADJUST MANUAL TRIGGER:
    // 2 = current (2 clicks/taps to trigger manually)
    // 3 = previous (3 clicks/taps to trigger manually)
    // 5 = original (5 clicks/taps to trigger)
    // 1 = single click/tap triggers
    const MANUAL_TRIGGER_COUNT = 2;
    
    // Window dimensions
    let windowWidth = window.innerWidth;
    let windowHeight = window.innerHeight;
    
    // Array to store bouncing elements with their Matter.js bodies
    let bouncingElements = [];
    
    // Track stuck pattern detection
    function detectStuckPattern(element) {
        const body = element.body;
        const currentPos = { x: body.position.x, y: body.position.y };
        const currentTime = Date.now();
        
        // Initialize position history if not exists
        if (!element.positionHistory) {
            element.positionHistory = [];
        }
        
        // Add current position
        element.positionHistory.push({
            pos: currentPos,
            time: currentTime
        });
        
        // Keep only last 20 frames (~0.33 seconds at 60fps)
        if (element.positionHistory.length > 20) {
            element.positionHistory.shift();
        }
        
        // Check for stuck pattern (start checking after just 10 frames)
        if (element.positionHistory.length >= 10) {
            const recent = element.positionHistory.slice(-5);  // Last 5 frames
            const older = element.positionHistory.slice(-10, -5); // 5 frames before that
            
            // Calculate average positions for both periods
            const recentAvg = {
                x: recent.reduce((sum, p) => sum + p.pos.x, 0) / recent.length,
                y: recent.reduce((sum, p) => sum + p.pos.y, 0) / recent.length
            };
            
            const olderAvg = {
                x: older.reduce((sum, p) => sum + p.pos.x, 0) / older.length,
                y: older.reduce((sum, p) => sum + p.pos.y, 0) / older.length
            };
            
            // Check if element is stuck in small area
            const distance = Math.sqrt(
                Math.pow(recentAvg.x - olderAvg.x, 2) + 
                Math.pow(recentAvg.y - olderAvg.y, 2)
            );
            
            // More sensitive detection: if moving less than 25 pixels on average, probably stuck
            if (distance < 25) {
                // Additional check: look at velocity direction consistency (pure vertical/horizontal)
                const velocity = body.velocity;
                const velAngle = Math.atan2(velocity.y, velocity.x);
                const normalizedAngle = ((velAngle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
                
                // Check if too close to pure vertical movement (stuck bouncing up/down)
                const isNearVertical = Math.abs(normalizedAngle - Math.PI/2) < 0.2 || 
                                     Math.abs(normalizedAngle - 3*Math.PI/2) < 0.2;
                
                if (isNearVertical || distance < 15) {
                    if (DEBUG_CORNER_DETECTION) {
                        console.log('Detected stuck element quickly, applying random nudge');
                    }
                    const randomAngle = Math.random() * Math.PI * 2;
                    Body.setVelocity(body, {
                        x: Math.cos(randomAngle) * CONSTANT_SPEED,
                        y: Math.sin(randomAngle) * CONSTANT_SPEED
                    });
                    element.positionHistory = []; // Reset history
                    return true;
                }
            }
        }
        return false;
    }
    
    // Corner hit tracking
    let cornerHits = 0;
    let isFlashing = false;
    
    // Manual trigger tracking
    let clickCount = 0;
    let clickTimer = null;
    
    function preventWallSliding(textBody, wallBody) {
        // Ensure element doesn't slide along walls - force immediate bounce
        const pos = textBody.position;
        const velocity = textBody.velocity;
        
        // Get element dimensions
        const element = bouncingElements.find(el => el.body === textBody);
        if (!element) return;
        
        // Use collision dimensions for wall bouncing calculations
        const halfWidth = element.collisionWidth / 2;
        const halfHeight = element.collisionHeight / 2;
        
        // Correct position to prevent wall penetration and sliding
        let correctedX = pos.x;
        let correctedY = pos.y;
        
        if (wallBody.label === 'wall-left') {
            correctedX = Math.max(halfWidth, pos.x);
            if (velocity.x < 0) Body.setVelocity(textBody, { x: -velocity.x, y: velocity.y });
        } else if (wallBody.label === 'wall-right') {
            correctedX = Math.min(windowWidth - halfWidth, pos.x);
            if (velocity.x > 0) Body.setVelocity(textBody, { x: -velocity.x, y: velocity.y });
        } else if (wallBody.label === 'wall-top') {
            correctedY = Math.max(halfHeight, pos.y);
            if (velocity.y < 0) Body.setVelocity(textBody, { x: velocity.x, y: -velocity.y });
        } else if (wallBody.label === 'wall-bottom') {
            correctedY = Math.min(windowHeight - halfHeight, pos.y);
            if (velocity.y > 0) Body.setVelocity(textBody, { x: velocity.x, y: -velocity.y });
        }
        
        // Apply position correction if needed
        if (correctedX !== pos.x || correctedY !== pos.y) {
            Body.setPosition(textBody, { x: correctedX, y: correctedY });
        }
    }
    
    function normalizeVelocity(body, addAngleVariation = false) {
        // Get current velocity
        const velocity = body.velocity;
        const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        
        // If velocity is zero or very small, give it a random direction
        if (currentSpeed < 0.1) {
            const angle = Math.random() * Math.PI * 2;
            Body.setVelocity(body, {
                x: Math.cos(angle) * CONSTANT_SPEED,
                y: Math.sin(angle) * CONSTANT_SPEED
            });
        } else {
            // Get current angle
            let angle = Math.atan2(velocity.y, velocity.x);
            
            // Add slight random variation to prevent stuck patterns
            if (addAngleVariation) {
                const variation = (Math.random() - 0.5) * 0.3; // ±0.15 radians (~±8.6 degrees)
                angle += variation;
            }
            
            // Prevent perfectly vertical or horizontal movement
            const minAngleFromAxes = 0.1; // ~5.7 degrees
            const normalizedAngle = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
            
            if (Math.abs(normalizedAngle) < minAngleFromAxes || 
                Math.abs(normalizedAngle - Math.PI) < minAngleFromAxes) {
                // Too close to horizontal, adjust
                angle += (Math.random() > 0.5 ? 1 : -1) * minAngleFromAxes;
            } else if (Math.abs(normalizedAngle - Math.PI/2) < minAngleFromAxes || 
                       Math.abs(normalizedAngle - 3*Math.PI/2) < minAngleFromAxes) {
                // Too close to vertical, adjust
                angle += (Math.random() > 0.5 ? 1 : -1) * minAngleFromAxes;
            }
            
            // Set velocity with constant speed and adjusted angle
            Body.setVelocity(body, {
                x: Math.cos(angle) * CONSTANT_SPEED,
                y: Math.sin(angle) * CONSTANT_SPEED
            });
        }
    }
    
    function updateDimensions() {
        const oldWidth = windowWidth;
        const oldHeight = windowHeight;
        windowWidth = window.innerWidth;
        windowHeight = window.innerHeight;
        
        // Update world boundaries if dimensions changed
        if (oldWidth !== windowWidth || oldHeight !== windowHeight) {
            updateWorldBoundaries();
        }
    }
    
    function updateWorldBoundaries() {
        // Remove old boundaries
        const bodiesToRemove = world.bodies.filter(body => body.isStatic && body.label.includes('wall'));
        World.remove(world, bodiesToRemove);
        
        // Create new boundaries - positioned exactly at screen edges with thick walls
        const wallThickness = 100; // Thicker walls to prevent sliding
        const walls = [
            // Top wall - positioned so its bottom edge is at y=0
            Bodies.rectangle(windowWidth / 2, -wallThickness / 2, windowWidth + wallThickness * 2, wallThickness, { 
                isStatic: true, 
                label: 'wall-top',
                restitution: 1, // Perfect bounce
                friction: 0,    // No sliding friction
                frictionStatic: 0
            }),
            // Bottom wall - positioned so its top edge is at y=windowHeight
            Bodies.rectangle(windowWidth / 2, windowHeight + wallThickness / 2, windowWidth + wallThickness * 2, wallThickness, { 
                isStatic: true, 
                label: 'wall-bottom',
                restitution: 1,
                friction: 0,
                frictionStatic: 0
            }),
            // Left wall - positioned so its right edge is at x=0
            Bodies.rectangle(-wallThickness / 2, windowHeight / 2, wallThickness, windowHeight + wallThickness * 2, { 
                isStatic: true, 
                label: 'wall-left',
                restitution: 1,
                friction: 0,
                frictionStatic: 0
            }),
            // Right wall - positioned so its left edge is at x=windowWidth
            Bodies.rectangle(windowWidth + wallThickness / 2, windowHeight / 2, wallThickness, windowHeight + wallThickness * 2, { 
                isStatic: true, 
                label: 'wall-right',
                restitution: 1,
                friction: 0,
                frictionStatic: 0
            })
        ];
        
        World.add(world, walls);
    }
    
    function createElement(x = null, y = null, spawnFromTop = false, enableFadeIn = false) {
        // Calculate scale for new element (each one gets progressively smaller)
        const elementScale = Math.pow(SCALE_FACTOR, bouncingElements.length);
        
        // Create new DOM element
        const newElement = document.createElement('div');
        newElement.className = 'bouncing-text';
        newElement.textContent = 'adlai.net';
        
        // Apply scaling to font size
        // First get the base font size that would apply to this element
        document.body.appendChild(newElement); // Temporarily add to get computed style
        const computedStyle = window.getComputedStyle(newElement);
        const baseFontSizeNum = parseFloat(computedStyle.fontSize);
        document.body.removeChild(newElement); // Remove temporarily
        
        // Apply scaling
        const scaledFontSize = baseFontSizeNum * elementScale;
        newElement.style.fontSize = scaledFontSize + 'px';
        
        document.body.appendChild(newElement);
        
        // Apply fade-in animation if enabled
        if (spawnFromTop || enableFadeIn) {
            // Start invisible and fade in
            newElement.style.opacity = '0';
            newElement.style.transition = 'opacity 1s ease-in';
            
            // Trigger fade-in after a brief delay
            setTimeout(() => {
                newElement.style.opacity = '1';
            }, 10);
            
            // Clean up transition after animation
            setTimeout(() => {
                newElement.style.transition = 'none';
            }, 1100);
        }
        
        // Get dimensions after adding to DOM and applying scale
        const rect = newElement.getBoundingClientRect();
        
        // Calculate tighter collision bounds for text
        // Font has extra space above/below that we don't want in collision detection
        const actualTextHeight = rect.height * TEXT_HEIGHT_RATIO;
        const textWidth = rect.width;
        
        // Set initial position with safe bounds
        let initX = x !== null ? x : windowWidth / 2;
        let initY = y !== null ? y : windowHeight / 2;
        
        // Ensure spawn position is not too close to edges (using actual collision size)
        const marginX = textWidth / 2 + 10;
        const marginY = actualTextHeight / 2 + 10;
        initX = Math.max(marginX, Math.min(initX, windowWidth - marginX));
        initY = Math.max(marginY, Math.min(initY, windowHeight - marginY));
        
        // Create Matter.js body with tighter height
        const body = Bodies.rectangle(initX, initY, textWidth, actualTextHeight, {
            frictionAir: 0,      // No air resistance
            friction: 0,         // No surface friction with other elements
            frictionStatic: 0,   // No static friction
            restitution: 1,      // Perfect bounce (no energy loss)
            density: 1,
            label: 'text-element',
            inertia: Infinity,   // Prevent rotation
            slop: 0             // No collision tolerance - immediate response
        });
        
        // Set initial velocity with constant speed
        let angle;
        if (spawnFromTop) {
            // For elements spawning from top, give them a downward trajectory
            // Angle between 45° and 135° (π/4 to 3π/4) for downward motion
            angle = Math.PI/4 + Math.random() * Math.PI/2;
        } else {
            // Random direction for initial element
            angle = Math.random() * Math.PI * 2;
        }
        Body.setVelocity(body, {
            x: Math.cos(angle) * CONSTANT_SPEED,
            y: Math.sin(angle) * CONSTANT_SPEED
        });
        
        // Create element object
        const elementObj = {
            element: newElement,
            body: body,
            width: textWidth,           // Visual width (same as collision width)
            height: rect.height,        // Visual height (full font height)
            collisionWidth: textWidth,  // Collision width
            collisionHeight: actualTextHeight, // Collision height (tighter)
            scale: elementScale, // Track the scale of this element
            lastWallCollision: null, // Track for corner detection
            wallCooldown: {}, // Prevent multiple bounces from same wall
            lastCollisionTime: 0 // Track last collision time
        };
        
        // Add body to world
        World.add(world, body);
        
        // Add to array
        bouncingElements.push(elementObj);
        
        if (DEBUG_CORNER_DETECTION) {
            console.log('Created new element. Total elements:', bouncingElements.length, 'Scale:', elementScale.toFixed(2));
        }
        return elementObj;
    }
    
    // Set up collision detection for corner hits and velocity normalization
    Events.on(engine, 'collisionStart', function(event) {
        const pairs = event.pairs;
        
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            const { bodyA, bodyB } = pair;
            
            // Find text elements in the collision
            const textBodyA = bodyA.label === 'text-element' ? bodyA : null;
            const textBodyB = bodyB.label === 'text-element' ? bodyB : null;
            const wallBody = bodyA.label.includes('wall') ? bodyA : 
                           bodyB.label.includes('wall') ? bodyB : null;
            
            // Normalize velocity for any text element involved in collision
            // Add angle variation for wall collisions to prevent stuck patterns
            if (textBodyA) {
                const elementA = bouncingElements.find(el => el.body === textBodyA);
                const isWallCollision = wallBody !== null;
                
                if (isWallCollision && elementA) {
                    // Check cooldown to prevent double bounces
                    const currentTime = Date.now();
                    const wallLabel = wallBody.label;
                    
                    if (!elementA.wallCooldown[wallLabel] || 
                        currentTime - elementA.wallCooldown[wallLabel] > WALL_COOLDOWN_MS) {
                        
                        if (DEBUG_CORNER_DETECTION) {
                            console.log('Wall bounce:', wallLabel, 'element A');
                        }
                        elementA.wallCooldown[wallLabel] = currentTime;
                        // Add small delay to prevent conflict with Matter.js collision response
                        setTimeout(() => {
                            preventWallSliding(textBodyA, wallBody);
                            normalizeVelocity(textBodyA, isWallCollision);
                        }, 8);
                    } else if (DEBUG_CORNER_DETECTION) {
                        console.log('Blocked double bounce:', wallLabel, 'element A');
                    }
                } else if (!isWallCollision) {
                    // Longer delay for element-to-element collisions to prevent ghost bounces
                    setTimeout(() => normalizeVelocity(textBodyA, isWallCollision), 20);
                }
            }
            if (textBodyB) {
                const elementB = bouncingElements.find(el => el.body === textBodyB);
                const isWallCollision = wallBody !== null;
                
                if (isWallCollision && elementB) {
                    // Check cooldown to prevent double bounces
                    const currentTime = Date.now();
                    const wallLabel = wallBody.label;
                    
                    if (!elementB.wallCooldown[wallLabel] || 
                        currentTime - elementB.wallCooldown[wallLabel] > WALL_COOLDOWN_MS) {
                        
                        if (DEBUG_CORNER_DETECTION) {
                            console.log('Wall bounce:', wallLabel, 'element B');
                        }
                        elementB.wallCooldown[wallLabel] = currentTime;
                        // Add small delay to prevent conflict with Matter.js collision response
                        setTimeout(() => {
                            preventWallSliding(textBodyB, wallBody);
                            normalizeVelocity(textBodyB, isWallCollision);
                        }, 8);
                    } else if (DEBUG_CORNER_DETECTION) {
                        console.log('Blocked double bounce:', wallLabel, 'element B');
                    }
                } else if (!isWallCollision) {
                    // Longer delay for element-to-element collisions to prevent ghost bounces
                    setTimeout(() => normalizeVelocity(textBodyB, isWallCollision), 20);
                }
            }
            
            // Check for corner hits (text element hitting wall)
            const textBody = textBodyA || textBodyB;
            if (textBody && wallBody) {
                const element = bouncingElements.find(el => el.body === textBody);
                if (element) {
                    checkCornerHit(element, wallBody.label);
                }
            }
        }
    });
    
    function checkCornerHit(element, wallLabel) {
        const currentTime = Date.now();
        const body = element.body;
        const pos = body.position;
        
        // Check if element is actually near a corner based on position
        const isNearTopLeft = pos.x < CORNER_THRESHOLD && pos.y < CORNER_THRESHOLD;
        const isNearTopRight = pos.x > windowWidth - CORNER_THRESHOLD && pos.y < CORNER_THRESHOLD;
        const isNearBottomLeft = pos.x < CORNER_THRESHOLD && pos.y > windowHeight - CORNER_THRESHOLD;
        const isNearBottomRight = pos.x > windowWidth - CORNER_THRESHOLD && pos.y > windowHeight - CORNER_THRESHOLD;
        
        const isNearAnyCorner = isNearTopLeft || isNearTopRight || isNearBottomLeft || isNearBottomRight;
        
        // Debug: Log all wall hits for testing
        if (DEBUG_CORNER_DETECTION) {
            console.log('Wall hit:', wallLabel, 'at position', pos.x.toFixed(0), pos.y.toFixed(0), 'near corner:', isNearAnyCorner);
        }
        
        // STRICT corner detection: Must be BOTH near corner AND hit two different walls quickly
        if (isNearAnyCorner && 
            element.lastWallCollision && 
            element.lastWallCollision.label !== wallLabel &&
            currentTime - element.lastWallCollision.time < 100 && // Shorter window
            !isFlashing) {
            
            console.log('🎯 RARE CORNER HIT!', element.lastWallCollision.label, '+', wallLabel, 'at', pos.x.toFixed(0), pos.y.toFixed(0));
            cornerHitEffect(false, element);
        }
        
        // Update last wall collision
        element.lastWallCollision = {
            label: wallLabel,
            time: currentTime,
            position: { x: pos.x, y: pos.y }
        };
    }
    
    function resetAllElements() {
        console.log('🌟 Starting fade-out animation...');
        
        // Apply fade-out transition to all elements
        bouncingElements.forEach(element => {
            if (element.element) {
                element.element.style.transition = 'opacity 1s ease-out';
                element.element.style.opacity = '0';
            }
        });
        
        // After fade-out completes, remove elements and create new one
        setTimeout(() => {
            // Remove all existing elements from DOM and physics world
            bouncingElements.forEach(element => {
                if (element.element && element.element.parentNode) {
                    element.element.parentNode.removeChild(element.element);
                }
                if (element.body) {
                    World.remove(world, element.body);
                }
            });
            
            // Clear the array
            bouncingElements = [];
            
            // Reset corner hits counter
            cornerHits = 0;
            
            console.log('🎯 Creating new element with fade-in...');
            // Create first element in center with fade-in
            createElement(windowWidth / 2, windowHeight / 2, false, true); // false = not from top, true = enable fade-in
        }, 1000); // Wait for fade-out to complete
    }
    
    function cornerHitEffect(isManual = false, hitElement = null) {
        cornerHits++;
        const hitType = isManual ? 'MANUAL TRIGGER' : 'CORNER HIT';
        console.log('🎉 ' + hitType + '! #' + cornerHits);
        
        // Check if we've reached the limit
        if (bouncingElements.length >= MAX_ELEMENTS) {
            console.log(`🔄 Reached ${MAX_ELEMENTS} elements - resetting!`);
            resetAllElements();
            return;
        }
        
        // Create new element dropping from the top
        let spawnX, spawnY;
        if (hitElement && !isManual) {
            // For corner hits, spawn at top and drop down
            spawnX = windowWidth / 2;
            spawnY = 50; // Near top of screen
            
            // Add random horizontal offset to avoid exact overlap
            spawnX += (Math.random() - 0.5) * (windowWidth * 0.6); // Spread across 60% of screen width
        } else {
            // Manual triggers also spawn at top
            spawnX = windowWidth / 2 + (Math.random() - 0.5) * (windowWidth * 0.4);
            spawnY = 50;
        }
        
        createElement(spawnX, spawnY, true); // true = spawn from top
        
        // Flash effect only on the element that hit the corner
        if (hitElement && !isManual) {
            isFlashing = true;
            // Apply pink flash instantly
            hitElement.element.style.textShadow = '0 0 30px #ff0080, 0 0 60px #ff0080, 0 0 90px #ff0080';
            hitElement.element.style.color = '#ff0080';
            
            // After a brief moment, start the fade-out transition
            setTimeout(() => {
                // Enable transition for smooth fade-out
                hitElement.element.style.transition = 'color 1s ease-out, text-shadow 1s ease-out';
                
                // Fade back to white
                hitElement.element.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.3)';
                hitElement.element.style.color = 'white';
                
                // Clean up transition and reset flashing state after fade completes
                setTimeout(() => {
                    hitElement.element.style.transition = 'none';
                    isFlashing = false;
                }, 1000);
            }, 200);
        }
    }
    
    function handleClickOrTap() {
        clickCount++;
        console.log('Click/tap ' + clickCount + '/' + MANUAL_TRIGGER_COUNT);
        
        // Reset timer
        clearTimeout(clickTimer);
        
        if (clickCount >= MANUAL_TRIGGER_COUNT) {
            // Trigger the effect!
            cornerHitEffect(true);
            clickCount = 0;
        } else {
            // Reset counter after 2 seconds if not completed
            clickTimer = setTimeout(() => {
                clickCount = 0;
            }, 2000);
        }
    }
    
    // Performance optimization for large monitors
    let frameCount = 0;
    let lastTime = performance.now();
    
    // Detect large monitor for performance scaling
    const isLargeMonitor = window.innerWidth > 2000 || window.innerHeight > 1200;
    const stuckCheckInterval = isLargeMonitor ? 6 : 3; // Check stuck patterns less frequently on large monitors
    const cleanupInterval = isLargeMonitor ? 120 : 60; // Clean up less frequently on large monitors
    
    function animate(currentTime) {
        // Calculate delta time for smooth animation regardless of refresh rate
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        frameCount++;
        
        // Cap delta time to prevent large jumps
        const cappedDelta = Math.min(deltaTime, 33.333); // Max 30fps equivalent
        
        // Update Matter.js engine with delta time
        Engine.update(engine, cappedDelta);
        
        // Sync DOM elements with Matter.js bodies and ensure constant velocity
        for (let i = 0; i < bouncingElements.length; i++) {
            const element = bouncingElements[i];
            const body = element.body;
            
            // Check for stuck patterns less frequently on large monitors
            if (frameCount % stuckCheckInterval === 0) {
                detectStuckPattern(element);
            }
            
            // Instant detection for obvious stuck patterns
            const velocity = body.velocity;
            const velAngle = Math.atan2(velocity.y, velocity.x);
            const normalizedAngle = ((velAngle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
            
            // If moving nearly perfectly vertical for instant correction
            const isVeryVertical = Math.abs(normalizedAngle - Math.PI/2) < 0.05 || 
                                 Math.abs(normalizedAngle - 3*Math.PI/2) < 0.05;
            const isVeryHorizontal = Math.abs(normalizedAngle) < 0.05 || 
                                   Math.abs(normalizedAngle - Math.PI) < 0.05;
            
            if (isVeryVertical || isVeryHorizontal) {
                // Add small random nudge immediately
                const nudgeAngle = velAngle + (Math.random() - 0.5) * 0.4; // ±0.2 radians
                Body.setVelocity(body, {
                    x: Math.cos(nudgeAngle) * CONSTANT_SPEED,
                    y: Math.sin(nudgeAngle) * CONSTANT_SPEED
                });
            }
            
            // Ensure constant velocity (safety check) - only check every 10 frames to reduce conflicts
            if (frameCount % 10 === 0) {
                const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
                if (Math.abs(currentSpeed - CONSTANT_SPEED) > 0.5) { // Increased tolerance
                    normalizeVelocity(body);
                }
            }
            
            // Clean up old wall cooldowns less frequently on large monitors
            if (frameCount % cleanupInterval === 0) {
                const currentTime = Date.now();
                Object.keys(element.wallCooldown).forEach(wallLabel => {
                    if (currentTime - element.wallCooldown[wallLabel] > 500) {
                        delete element.wallCooldown[wallLabel];
                    }
                });
            }
            
            // Update DOM element position based on Matter.js body
            // Account for the difference between collision height and visual height
            const x = body.position.x - element.width / 2;
            
            // Center the visual text within the collision body
            const visualHeightOffset = (element.height - element.collisionHeight) / 2;
            const y = body.position.y - element.height / 2 + visualHeightOffset;
            
            element.element.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
        }
        
        requestAnimationFrame(animate);
    }
    
    // Initialize after font loads
    function initialize() {
        // Hide the original text element
        text.style.display = 'none';
        
        // Set up world boundaries
        updateWorldBoundaries();
        
        // Create the first bouncing element
        createElement();
        
        updateDimensions();
        
        // Start animation with initial timestamp
        lastTime = performance.now();
        animate(lastTime);
    }
    
    // Wait for fonts to load before starting
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(initialize);
    } else {
        // Fallback for browsers without Font Loading API
        setTimeout(initialize, 100);
    }
    
    // Handle window resize with debouncing
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            updateDimensions();
            
            // Constrain all bodies to new bounds
            bouncingElements.forEach(element => {
                const body = element.body;
                const x = Math.max(element.width / 2, Math.min(body.position.x, windowWidth - element.width / 2));
                const y = Math.max(element.height / 2, Math.min(body.position.y, windowHeight - element.height / 2));
                Body.setPosition(body, { x: x, y: y });
            });
        }, 100);
    });
    
    // Prevent scrolling on mobile
    document.addEventListener('touchmove', function(e) {
        e.preventDefault();
    }, { passive: false });
    
    // Add click/tap listeners for manual trigger
    document.addEventListener('click', handleClickOrTap);
    document.addEventListener('touchend', function(e) {
        e.preventDefault();
        handleClickOrTap();
    }, { passive: false });
    
})();
