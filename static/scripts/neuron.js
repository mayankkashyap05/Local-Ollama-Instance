/**
 * Neural Network Visualization
 * Creates an animated neural network visualization on canvas
 */

class NeuralVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isAnimating = false;
        this.neurons = [];
        this.connections = [];
        this.particles = [];
        this.signalParticles = [];
        this.thinkingMode = false;
        this.thinkingIntensity = 0;
        this.uiBoxes = []; // Store UI boxes to avoid rendering neurons underneath
        this.maxIntensity = 0.8; // Limit maximum intensity to 80%
        this.baseWidth = 1920; // Base width for scaling calculations
        this.baseHeight = 1080; // Base height for scaling calculations
        
        // Default configuration (will be overridden by config from server)
        this.config = {
            neuronDensity: 0.00012, // Neurons per pixel (scaled by canvas area)
            neuronMinSize: 1.5,        
            neuronMaxSize: 6,
            connectionDistanceFactor: 0.20, // 20% of canvas width for super dense connections
            connectionOpacity: 0.15,   // Reduced opacity for better visibility with dense connections
            activeNeuronColor: '#00ffff',
            defaultNeuronColor: '#8a2be2',
            backgroundColor: '#0c0c14',
            particleDensity: 0.00006, // Particles per pixel
            maxSignalParticles: 35,    
            randomActivationChance: 0.06, 
            activationTime: 1.5,
            fastNeuronPercentage: 0.6,
            slowActivationFactor: 0.4,
            // Thinking mode settings
            thinkingActivationMultiplier: 3.0,
            thinkingSignalMultiplier: 2.0,
            thinkingFadeSpeed: 0.02,          
            thinkingMaxParticles: 80,         
            maxActiveNeurons: 30
        };
        
        // Apply configuration when it's loaded
        if (window.configManager) {
            window.configManager.onConfigLoaded(config => {
                this.applyConfig(config);
            });
        }
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.init();
    }
    
    applyConfig(config) {
        if (!config || !config.neural_visualization) return;
        
        const vizConfig = config.neural_visualization;
        
        // Apply all configuration properties
        this.config.neuronDensity = vizConfig.neuron_density || this.config.neuronDensity;
        this.config.neuronMinSize = vizConfig.neuron_min_size || this.config.neuronMinSize;
        this.config.neuronMaxSize = vizConfig.neuron_max_size || this.config.neuronMaxSize;
        this.config.connectionDistanceFactor = vizConfig.connection_distance_factor || this.config.connectionDistanceFactor;
        this.config.connectionOpacity = vizConfig.connection_opacity || this.config.connectionOpacity;
        this.config.activeNeuronColor = vizConfig.active_neuron_color || this.config.activeNeuronColor;
        this.config.defaultNeuronColor = vizConfig.default_neuron_color || this.config.defaultNeuronColor;
        this.config.backgroundColor = vizConfig.background_color || this.config.backgroundColor;
        this.config.particleDensity = vizConfig.particle_density || this.config.particleDensity;
        this.config.maxSignalParticles = vizConfig.max_signal_particles || this.config.maxSignalParticles;
        this.config.randomActivationChance = vizConfig.random_activation_chance || this.config.randomActivationChance;
        this.config.activationTime = vizConfig.activation_time || this.config.activationTime;
        this.config.fastNeuronPercentage = vizConfig.fast_neuron_percentage || this.config.fastNeuronPercentage;
        this.config.slowActivationFactor = vizConfig.slow_activation_factor || this.config.slowActivationFactor;
        this.config.thinkingActivationMultiplier = vizConfig.thinking_activation_multiplier || this.config.thinkingActivationMultiplier;
        this.config.thinkingSignalMultiplier = vizConfig.thinking_signal_multiplier || this.config.thinkingSignalMultiplier;
        this.config.thinkingFadeSpeed = vizConfig.thinking_fade_speed || this.config.thinkingFadeSpeed;
        this.config.thinkingMaxParticles = vizConfig.thinking_max_particles || this.config.thinkingMaxParticles;
        this.config.maxActiveNeurons = vizConfig.max_active_neurons || this.config.maxActiveNeurons;
        
        // Reinitialize with new configuration
        this.init();
    }
    
    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        
        // Detect UI boxes after resize
        this.detectUIBoxes();
        
        // Scale parameters based on screen size
        this.scaleParameters();
        
        // Reinitialize when screen size changes significantly
        if (this.neurons.length > 0) {
            this.init();
        }
    }
    
    scaleParameters() {
        // Calculate canvas area and scale factor
        const canvasArea = this.canvas.width * this.canvas.height;
        const baseArea = this.baseWidth * this.baseHeight;
        const areaRatio = canvasArea / baseArea;
        
        // Scale neuron count based on canvas area to maintain density
        this.scaledNeuronCount = Math.max(30, Math.floor(canvasArea * this.config.neuronDensity));
        
        // Scale particle count to maintain density
        this.scaledParticleCount = Math.max(20, Math.floor(canvasArea * this.config.particleDensity));
        
        // Scale connection distance based on canvas dimensions
        this.scaledConnectionDistance = Math.min(
            this.canvas.width, 
            this.canvas.height
        ) * this.config.connectionDistanceFactor;
        
        // Scale neuron sizes based on canvas dimensions
        const dimensionScaleFactor = Math.min(
            this.canvas.width / this.baseWidth,
            this.canvas.height / this.baseHeight
        );
        
        this.scaledNeuronMinSize = this.config.neuronMinSize * dimensionScaleFactor;
        this.scaledNeuronMaxSize = this.config.neuronMaxSize * dimensionScaleFactor;
        
        // Scale max active neurons based on total neuron count
        this.scaledMaxActiveNeurons = Math.max(5, Math.floor(this.scaledNeuronCount * 0.2));
        
        // Scale max signal particles based on connection count
        this.scaledMaxSignalParticles = Math.max(15, Math.floor(Math.sqrt(this.scaledNeuronCount) * 3));
        
        console.log(`Canvas size: ${this.canvas.width}x${this.canvas.height}, Neuron count: ${this.scaledNeuronCount}, Connection distance: ${this.scaledConnectionDistance.toFixed(2)}`);
    }
    
    detectUIBoxes() {
        this.uiBoxes = [];
        
        // Get chat container and input area
        const chatContainer = document.querySelector('.chat-container');
        const chatInputArea = document.querySelector('.chat-input-area');
        
        if (chatContainer) {
            const rect = chatContainer.getBoundingClientRect();
            this.uiBoxes.push({
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
            });
        }
        
        if (chatInputArea) {
            const rect = chatInputArea.getBoundingClientRect();
            this.uiBoxes.push({
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
            });
        }
    }
    
    isUnderUIBox(x, y) {
        for (const box of this.uiBoxes) {
            if (x >= box.x && x <= box.x + box.width &&
                y >= box.y && y <= box.y + box.height) {
                return true;
            }
        }
        return false;
    }
    
    init() {
        // Create neurons with scaled parameters
        this.neurons = [];
        for (let i = 0; i < this.scaledNeuronCount; i++) {
            // Determine if this is a fast or slow neuron
            const isFastNeuron = Math.random() < this.config.fastNeuronPercentage;
            
            // Create density clusters by making some areas more populated
            let x, y;
            const useCluster = Math.random() < 0.7; // 70% chance to be in a cluster
            
            if (useCluster) {
                // Create a cluster center
                const clusterX = Math.random() * this.canvas.width;
                const clusterY = Math.random() * this.canvas.height;
                // Position within cluster - scale cluster size based on canvas
                const radius = Math.random() * (this.canvas.width / 5);
                const angle = Math.random() * Math.PI * 2;
                x = clusterX + Math.cos(angle) * radius;
                y = clusterY + Math.sin(angle) * radius;
                
                // Ensure within bounds
                x = Math.max(0, Math.min(this.canvas.width, x));
                y = Math.max(0, Math.min(this.canvas.height, y));
            } else {
                // Random position
                x = Math.random() * this.canvas.width;
                y = Math.random() * this.canvas.height;
            }
            
            // Check if under UI box
            const underUIBox = this.isUnderUIBox(x, y);
            
            this.neurons.push({
                x: x,
                y: y,
                size: this.scaledNeuronMinSize + Math.random() * (this.scaledNeuronMaxSize - this.scaledNeuronMinSize),
                color: this.config.defaultNeuronColor,
                speed: {
                    x: (Math.random() - 0.5) * 0.3 * (this.canvas.width / this.baseWidth), // Scale speed with canvas width
                    y: (Math.random() - 0.5) * 0.3 * (this.canvas.height / this.baseHeight) // Scale speed with canvas height
                },
                active: false,
                activationTime: 0,
                isFastNeuron: isFastNeuron,
                activationSpeed: isFastNeuron ? 0.03 : 0.01 * this.config.slowActivationFactor,
                underUIBox: underUIBox, // Flag if neuron is under a UI box
                activationProbabilityModifier: underUIBox ? 0.2 : 1.0 // Reduce activation probability
            });
        }
        
        // Create background particles
        this.particles = [];
        for (let i = 0; i < this.scaledParticleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: Math.random() * 2 * Math.min(
                    this.canvas.width / this.baseWidth,
                    this.canvas.height / this.baseHeight
                ),
                opacity: 0.1 + Math.random() * 0.3,
                speed: {
                    x: (Math.random() - 0.5) * 0.2 * (this.canvas.width / this.baseWidth),
                    y: (Math.random() - 0.5) * 0.2 * (this.canvas.height / this.baseHeight)
                }
            });
        }
        
        // Precompute connections between neurons
        this.updateConnections();
    }
    
    updateConnections() {
        this.connections = [];
        
        // Find connections based on scaled distance
        for (let i = 0; i < this.neurons.length; i++) {
            for (let j = i + 1; j < this.neurons.length; j++) {
                const n1 = this.neurons[i];
                const n2 = this.neurons[j];
                
                const distance = Math.sqrt(
                    Math.pow(n2.x - n1.x, 2) + Math.pow(n2.y - n1.y, 2)
                );
                
                if (distance < this.scaledConnectionDistance) {
                    this.connections.push({
                        from: i,
                        to: j,
                        distance,
                        opacity: this.mapRange(
                            distance, 
                            0, 
                            this.scaledConnectionDistance, 
                            this.config.connectionOpacity, 
                            0
                        )
                    });
                }
            }
        }
    }
    
    activateRandom(count = 1) {
        // Calculate active count based on screen size
        const activeCount = count || Math.floor(this.scaledNeuronCount * 0.05);
        
        // Prioritize activating neurons that aren't under UI boxes
        const visibleNeurons = this.neurons.filter(n => !n.underUIBox);
        const allNeurons = this.neurons;
        
        for (let i = 0; i < activeCount; i++) {
            // Prefer visible neurons, but fall back to all neurons if needed
            const neuronsToUse = visibleNeurons.length > activeCount ? visibleNeurons : allNeurons;
            const index = Math.floor(Math.random() * neuronsToUse.length);
            const neuronIndex = this.neurons.indexOf(neuronsToUse[index]);
            
            // Only activate if random chance passes based on UI modifier
            if (Math.random() < this.neurons[neuronIndex].activationProbabilityModifier) {
                this.neurons[neuronIndex].active = true;
                this.neurons[neuronIndex].activationTime = 0;
                this.neurons[neuronIndex].color = this.config.activeNeuronColor;
                
                // Create more signals from fast neurons
                if (this.neurons[neuronIndex].isFastNeuron) {
                    this.createSignalsFromNeuron(neuronIndex);
                }
            }
        }
        
        // Create signal particles
        this.createRandomSignals();
    }
    
    createSignalsFromNeuron(neuronIndex) {
        // Determine max signals based on thinking mode, with a reasonable cap
        const maxSignals = this.thinkingMode ? 
            Math.min(
                this.scaledMaxSignalParticles * 1.5,
                Math.floor(this.scaledMaxSignalParticles * (1 + this.thinkingIntensity))
            ) : 
            this.scaledMaxSignalParticles;
        
        // Find all connections from this neuron and create signals
        if (this.signalParticles.length < maxSignals) {
            const connections = this.connections.filter(conn => 
                conn.from === neuronIndex || conn.to === neuronIndex
            );
            
            if (connections.length > 0) {
                // Get random connection
                const conn = connections[Math.floor(Math.random() * connections.length)];
                const fromIndex = conn.from === neuronIndex ? conn.from : conn.to;
                const toIndex = conn.from === neuronIndex ? conn.to : conn.from;
                const n1 = this.neurons[fromIndex];
                const n2 = this.neurons[toIndex];
                
                // Fast neurons create faster signals
                const speedMultiplier = n1.isFastNeuron ? 1.5 : 1;
                
                // Thinking mode increases signal speed
                const thinkingSpeedMultiplier = this.thinkingMode ? 
                    1 + (this.thinkingIntensity * 0.8) : 
                    1;
                
                // Create a signal particle
                this.signalParticles.push({
                    x: n1.x,
                    y: n1.y,
                    targetX: n2.x,
                    targetY: n2.y,
                    progress: 0,
                    speed: (0.02 + Math.random() * 0.03) * speedMultiplier * thinkingSpeedMultiplier,
                    size: 3,
                    fromIndex: fromIndex,
                    toIndex: toIndex
                });
                
                // In thinking mode, sometimes create chain reactions
                if (this.thinkingMode && Math.random() < this.thinkingIntensity * 0.3) {
                    this.neurons[toIndex].active = true;
                    this.neurons[toIndex].activationTime = 0;
                    this.neurons[toIndex].color = this.config.activeNeuronColor;
                }
            }
        }
    }
    
    createRandomSignals() {
        if (this.signalParticles.length < this.config.maxSignalParticles) {
            // Get random connection
            const connIndex = Math.floor(Math.random() * this.connections.length);
            if (connIndex >= 0 && connIndex < this.connections.length) {
                const conn = this.connections[connIndex];
                const n1 = this.neurons[conn.from];
                const n2 = this.neurons[conn.to];
                
                // Fast neurons create faster signals
                const speedMultiplier = n1.isFastNeuron ? 1.5 : 1;
                
                this.signalParticles.push({
                    x: n1.x,
                    y: n1.y,
                    targetX: n2.x,
                    targetY: n2.y,
                    progress: 0,
                    speed: (0.02 + Math.random() * 0.03) * speedMultiplier,
                    size: 3,
                    fromIndex: conn.from,
                    toIndex: conn.to
                });
            }
        }
    }
    
    update() {
        if (!this.isAnimating) return;
        
        // Count currently active neurons
        const activeNeuronCount = this.neurons.filter(n => n.active).length;
        
        // Update thinking mode intensity
        if (this.thinkingMode) {
            // Full intensity for a moment
            if (this.thinkingIntensity > 0.95 * this.maxIntensity) {
                // Stay at max intensity briefly
                setTimeout(() => {
                    this.thinkingIntensity -= this.config.thinkingFadeSpeed / 2;
                }, 500);
            } else {
                // Gradually reduce intensity
                this.thinkingIntensity -= this.config.thinkingFadeSpeed;
                
                // When intensity gets low enough, turn off thinking mode
                if (this.thinkingIntensity <= 0) {
                    this.thinkingIntensity = 0;
                    this.stopThinking();
                }
            }
        }
        
        // Update neurons
        this.updateNeurons();
        
        // Update connections when neurons move (not every frame)
        if (Math.random() < 0.05) {
            this.updateConnections();
        }
        
        // Update background particles
        this.updateParticles();
        
        // Update signal particles
        this.updateSignalParticles();
        
        // Calculate dynamic activation chance based on thinking mode
        let activationChance = this.thinkingMode ? 
            this.config.randomActivationChance * (1 + (this.config.thinkingActivationMultiplier * this.thinkingIntensity)) : 
            this.config.randomActivationChance;
        
        // Reduce activation chance if too many neurons are already active
        if (activeNeuronCount > this.scaledMaxActiveNeurons / 2) {
            // Gradually reduce chance as we approach max
            const reductionFactor = 1 - (activeNeuronCount / this.scaledMaxActiveNeurons);
            activationChance *= Math.max(0.1, reductionFactor);
        }
        
        // Randomly activate neurons with dynamic chance
        if (Math.random() < activationChance && activeNeuronCount < this.scaledMaxActiveNeurons) {
            // More neurons activate during thinking mode, but with a limit
            const activationCount = this.thinkingMode ? 
                Math.min(3, Math.ceil(1 + (2 * this.thinkingIntensity))) : 
                1;
            this.activateRandom(activationCount);
        }
        
        // Request next frame
        requestAnimationFrame(() => this.update());
    }
    
    updateNeurons() {
        for (let i = 0; i < this.neurons.length; i++) {
            const neuron = this.neurons[i];
            
            // Move neurons slightly
            neuron.x += neuron.speed.x;
            neuron.y += neuron.speed.y;
            
            // Bounce off walls
            if (neuron.x < 0 || neuron.x > this.canvas.width) {
                neuron.speed.x *= -1;
            }
            if (neuron.y < 0 || neuron.y > this.canvas.height) {
                neuron.speed.y *= -1;
            }
            
            // Update underUIBox status after movement
            neuron.underUIBox = this.isUnderUIBox(neuron.x, neuron.y);
            neuron.activationProbabilityModifier = neuron.underUIBox ? 0.2 : 1.0;
            
            // Update activation state using variable speed
            if (neuron.active) {
                neuron.activationTime += neuron.activationSpeed;
                if (neuron.activationTime > this.config.activationTime) {
                    neuron.active = false;
                    neuron.color = this.config.defaultNeuronColor;
                }
                }
            }
        }
        
    updateParticles() {
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            
            particle.x += particle.speed.x;
            particle.y += particle.speed.y;
            
            // Wrap around screen
            if (particle.x < 0) particle.x = this.canvas.width;
            if (particle.x > this.canvas.width) particle.x = 0;
            if (particle.y < 0) particle.y = this.canvas.height;
            if (particle.y > this.canvas.height) particle.y = 0;
        }
        }
        
    updateSignalParticles() {
        for (let i = this.signalParticles.length - 1; i >= 0; i--) {
            const signal = this.signalParticles[i];
            
            signal.progress += signal.speed;
            
            // Interpolate position along the path
            signal.x = this.lerp(
                this.neurons[signal.fromIndex].x,
                this.neurons[signal.toIndex].x,
                signal.progress
            );
            signal.y = this.lerp(
                this.neurons[signal.fromIndex].y,
                this.neurons[signal.toIndex].y,
                signal.progress
            );
            
            // Remove completed signals
            if (signal.progress >= 1) {
                // Activate target neuron
                this.neurons[signal.toIndex].active = true;
                this.neurons[signal.toIndex].activationTime = 0;
                this.neurons[signal.toIndex].color = this.config.activeNeuronColor;
                
                this.signalParticles.splice(i, 1);
            }
        }
    }
    
    draw() {
        // Use requestAnimationFrame timing for smoother animation
        this.animFrameId = requestAnimationFrame(() => this.draw());
        
        // Clear canvas
        this.ctx.fillStyle = this.config.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Only draw what's necessary for performance
        this.drawParticles();
        this.drawConnections();
        this.drawNeurons();
        this.drawSignalParticles();
    }
    
    drawParticles() {
        // Draw background particles
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(180, 180, 255, ${particle.opacity})`;
            this.ctx.fill();
        }
        }
        
    drawConnections() {
        // Draw connections
        for (let i = 0; i < this.connections.length; i++) {
            const conn = this.connections[i];
            const n1 = this.neurons[conn.from];
            const n2 = this.neurons[conn.to];
            
            // Increase opacity if either neuron is active
            let opacity = conn.opacity;
            if (n1.active || n2.active) {
                opacity = Math.min(1, opacity * 5);
            }
            
            // Use gradient for connections
            const gradient = this.ctx.createLinearGradient(n1.x, n1.y, n2.x, n2.y);
            
            if (n1.active && n2.active) {
                // If both neurons are active, make connection more vibrant
                gradient.addColorStop(0, 'rgba(0, 255, 255, ' + opacity + ')');
                gradient.addColorStop(1, 'rgba(255, 0, 255, ' + opacity + ')');
            } else if (n1.active) {
                gradient.addColorStop(0, 'rgba(0, 255, 255, ' + opacity + ')');
                gradient.addColorStop(1, 'rgba(255, 255, 255, ' + (opacity * 0.5) + ')');
            } else if (n2.active) {
                gradient.addColorStop(0, 'rgba(255, 255, 255, ' + (opacity * 0.5) + ')');
                gradient.addColorStop(1, 'rgba(0, 255, 255, ' + opacity + ')');
            } else {
                gradient.addColorStop(0, 'rgba(255, 255, 255, ' + opacity + ')');
                gradient.addColorStop(1, 'rgba(255, 255, 255, ' + opacity + ')');
            }
            
            this.ctx.beginPath();
            this.ctx.moveTo(n1.x, n1.y);
            this.ctx.lineTo(n2.x, n2.y);
            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = n1.active || n2.active ? 1.5 : 0.8;
            this.ctx.stroke();
            this.ctx.lineWidth = 1;
        }
        }
        
    drawNeurons() {
        // Draw neurons
        for (let i = 0; i < this.neurons.length; i++) {
            const neuron = this.neurons[i];
            
            // Skip neurons under UI boxes
            if (neuron.underUIBox) {
                continue;
            }
            
            // Skip very small, inactive neurons that are far from active ones for performance
            if (!neuron.active && neuron.size < 2) {
                let skipDraw = true;
                // Check if any nearby neuron is active
                for (let j = 0; j < this.neurons.length; j++) {
                    if (this.neurons[j].active) {
                        const dist = Math.sqrt(
                            Math.pow(neuron.x - this.neurons[j].x, 2) + 
                            Math.pow(neuron.y - this.neurons[j].y, 2)
                        );
                        if (dist < 100) {
                            skipDraw = false;
                            break;
                        }
                    }
                }
                if (skipDraw) continue;
            }
            
            // Draw glow for active neurons
            if (neuron.active) {
                // Adjust glow size based on whether it's a fast or slow neuron
                let glowSize = neuron.isFastNeuron ? 4.5 : 3;
                
                // Enhance glow in thinking mode, with a limit
                if (this.thinkingMode) {
                    glowSize *= (1 + (this.thinkingIntensity * 0.3));
                    glowSize = Math.min(glowSize, 7);
                }
                
                this.ctx.beginPath();
                this.ctx.arc(neuron.x, neuron.y, neuron.size * glowSize, 0, Math.PI * 2);
                const gradient = this.ctx.createRadialGradient(
                    neuron.x, neuron.y, neuron.size,
                    neuron.x, neuron.y, neuron.size * glowSize
                );
                
                // Different glow colors for fast vs slow neurons
                if (neuron.isFastNeuron) {
                    const intensity = this.thinkingMode ? 0.6 + (0.2 * this.thinkingIntensity) : 0.6;
                    gradient.addColorStop(0, `rgba(30, 210, 255, ${intensity})`);
                    gradient.addColorStop(0.5, 'rgba(138, 43, 226, 0.3)');
                    gradient.addColorStop(1, 'rgba(30, 210, 255, 0)');
                } else {
                    const intensity = this.thinkingMode ? 0.5 + (0.2 * this.thinkingIntensity) : 0.5;
                    gradient.addColorStop(0, `rgba(200, 100, 255, ${intensity})`);
                    gradient.addColorStop(0.5, 'rgba(138, 43, 226, 0.2)');
                    gradient.addColorStop(1, 'rgba(200, 100, 255, 0)');
                }
                
                this.ctx.fillStyle = gradient;
                this.ctx.fill();
                
                // Add second smaller, brighter glow
                this.ctx.beginPath();
                this.ctx.arc(neuron.x, neuron.y, neuron.size * 2, 0, Math.PI * 2);
                const innerGlow = this.ctx.createRadialGradient(
                    neuron.x, neuron.y, neuron.size,
                    neuron.x, neuron.y, neuron.size * 2
                );
                const innerIntensity = this.thinkingMode ? 0.8 + (0.2 * this.thinkingIntensity) : 0.8;
                innerGlow.addColorStop(0, `rgba(255, 255, 255, ${innerIntensity})`);
                innerGlow.addColorStop(1, neuron.isFastNeuron ? 'rgba(30, 210, 255, 0)' : 'rgba(200, 100, 255, 0)');
                this.ctx.fillStyle = innerGlow;
                this.ctx.fill();
            }
            
            // Draw neuron
            let sizeMultiplier = neuron.active ? 1.3 : 1;
            if (this.thinkingMode && neuron.active) {
                sizeMultiplier += this.thinkingIntensity * 0.4;
            }
            
            this.ctx.beginPath();
            this.ctx.arc(neuron.x, neuron.y, neuron.size * sizeMultiplier, 0, Math.PI * 2);
            
            // Create a gradient fill for neurons
            const gradient = this.ctx.createRadialGradient(
                neuron.x, neuron.y, 0,
                neuron.x, neuron.y, neuron.size * sizeMultiplier
            );
            
            if (neuron.active) {
                gradient.addColorStop(0, '#ffffff');
                
                if (this.thinkingMode) {
                    if (neuron.isFastNeuron) {
                        gradient.addColorStop(0.6, this.thinkingIntensity > 0.5 ? '#30d2ff' : '#20c0ff');
                        gradient.addColorStop(1, this.thinkingIntensity > 0.5 ? '#0080ff' : '#0040ff');
                    } else {
                        gradient.addColorStop(0.6, this.thinkingIntensity > 0.5 ? '#c864ff' : '#b040ff');
                        gradient.addColorStop(1, this.thinkingIntensity > 0.5 ? '#b000ff' : '#8000ff');
                    }
                } else {
                    gradient.addColorStop(0.6, neuron.isFastNeuron ? '#30d2ff' : '#c864ff');
                    gradient.addColorStop(1, neuron.isFastNeuron ? '#0040ff' : '#8000ff');
                }
            } else {
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(1, neuron.isFastNeuron ? '#6a1be2' : '#8a2be2');
            }
            
            this.ctx.fillStyle = gradient;
            this.ctx.fill();
            
            // Add highlight
            this.ctx.beginPath();
            this.ctx.arc(
                neuron.x - neuron.size * 0.3,
                neuron.y - neuron.size * 0.3,
                neuron.size * 0.3,
                0, Math.PI * 2
            );
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            this.ctx.fill();
        }
        }
        
    drawSignalParticles() {
        // Draw signal particles
        for (let i = 0; i < this.signalParticles.length; i++) {
            const signal = this.signalParticles[i];
            const sourceNeuron = this.neurons[signal.fromIndex];
            const isFastSignal = sourceNeuron.isFastNeuron;
            
            // Draw trailing effect
            this.ctx.beginPath();
            this.ctx.arc(signal.x, signal.y, signal.size * (isFastSignal ? 3.5 : 2.5), 0, Math.PI * 2);
            const trailGradient = this.ctx.createRadialGradient(
                signal.x, signal.y, signal.size,
                signal.x, signal.y, signal.size * (isFastSignal ? 3.5 : 2.5)
            );
            
            if (isFastSignal) {
                // Fast signal colors
                trailGradient.addColorStop(0, 'rgba(30, 210, 255, 0.8)');
                trailGradient.addColorStop(0.5, 'rgba(138, 43, 226, 0.3)');
                trailGradient.addColorStop(1, 'rgba(30, 210, 255, 0)');
            } else {
                // Slow signal colors
                trailGradient.addColorStop(0, 'rgba(200, 100, 255, 0.7)');
                trailGradient.addColorStop(0.5, 'rgba(138, 43, 226, 0.2)');
                trailGradient.addColorStop(1, 'rgba(200, 100, 255, 0)');
            }
            
            this.ctx.fillStyle = trailGradient;
            this.ctx.fill();
            
            // Draw particle with gradient
            this.ctx.beginPath();
            this.ctx.arc(signal.x, signal.y, signal.size * (isFastSignal ? 1.5 : 1.2), 0, Math.PI * 2);
            const particleGradient = this.ctx.createRadialGradient(
                signal.x, signal.y, 0,
                signal.x, signal.y, signal.size * (isFastSignal ? 1.5 : 1.2)
            );
            
            if (isFastSignal) {
                particleGradient.addColorStop(0, '#ffffff');
                particleGradient.addColorStop(0.5, '#30d2ff');
                particleGradient.addColorStop(1, '#0080ff');
            } else {
                particleGradient.addColorStop(0, '#ffffff');
                particleGradient.addColorStop(0.5, '#c864ff');
                particleGradient.addColorStop(1, '#8000ff');
            }
            
            this.ctx.fillStyle = particleGradient;
            this.ctx.fill();
        }
    }
    
    start() {
        if (!this.isAnimating) {
            this.isAnimating = true;
            this.detectUIBoxes(); // Detect UI boxes before starting animation
        this.update();
            this.draw();
        }
    }
    
    stop() {
        this.isAnimating = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
        }
    }
    
    /**
     * Activate thinking mode - increase neural activity
     */
    startThinking() {
        this.thinkingMode = true;
        this.thinkingIntensity = this.maxIntensity; // Use max intensity value
        
        // Burst of initial activations - limited to a reasonable amount
        const extraActivations = Math.min(15, Math.floor(this.neurons.length * 0.08));
        for (let i = 0; i < extraActivations; i++) {
            this.activateRandom(2); // Reduced from 3 to 2 for less initial intensity
        }
        
        // Create extra connections temporarily
        this.tempConnectionDistance = this.scaledConnectionDistance;
        this.scaledConnectionDistance *= 1.1; // Reduced from 1.2
        this.updateConnections();
        
        console.log("Neural visualization: Thinking mode activated");
    }
    
    stopThinking() {
        this.thinkingMode = false;
        
        // Restore normal connection distance
        if (this.tempConnectionDistance) {
            this.scaledConnectionDistance = this.tempConnectionDistance;
            this.updateConnections();
        }
        
        console.log("Neural visualization: Thinking mode deactivated");
    }
    
    // Helper methods
    mapRange(value, inMin, inMax, outMin, outMax) {
        return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
    }
    
    lerp(start, end, t) {
        return start * (1 - t) + end * t;
    }
}

// Initialize when the page loads
window.addEventListener('DOMContentLoaded', () => {
    const visualizer = new NeuralVisualizer('neural-canvas');
    visualizer.start();
    
    // Export for other scripts to use
    window.neuralVisualizer = visualizer;
}); 