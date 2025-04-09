/**
 * Configuration Manager
 * Loads configuration from server and provides it to all components
 */

class ConfigManager {
  constructor() {
    this.config = null;
    this.configLoaded = false;
    this.onConfigLoadedCallbacks = [];
  }

  /**
   * Load configuration from server
   */
  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }
      
      this.config = await response.json();
      this.configLoaded = true;
      
      // Apply configuration to UI
      this.applyConfig();
      
      // Store config globally
      window.appConfig = this.config;
      
      // Notify listeners that config is loaded
      this.notifyConfigLoaded();
      
      return this.config;
    } catch (error) {
      console.error('Error loading configuration:', error);
      // Load default configuration as fallback
      this.loadDefaultConfig();
    }
  }
  
  /**
   * Apply configuration values to UI elements
   */
  applyConfig() {
    // Set document title
    document.title = this.config.ui.display_name || this.config.ui.app_name;
    
    // Update h1 title
    const titleElement = document.querySelector('h1');
    if (titleElement) titleElement.textContent = this.config.ui.display_name || this.config.ui.app_name;
    
    // Footer text is now static: "LLMs can make mistake"
    // No longer update it with Ollama URL
    
    // Update input placeholder
    const userInput = document.getElementById('user-input');
    if (userInput && this.config.ui.chat.placeholders.input) {
      userInput.placeholder = this.config.ui.chat.placeholders.input;
    }
    
    // Update model badge
    this.updateModelBadge();
    
    // Apply CSS variables for theming
    this.applyTheme();
  }
  
  /**
   * Apply theme colors from config to CSS variables
   */
  applyTheme() {
    const theme = this.config.ui.theme;
    const root = document.documentElement;
    
    // Apply each theme color to CSS variables
    for (const [key, value] of Object.entries(theme)) {
      // Convert camelCase to kebab-case for CSS variables
      const cssVar = '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
      root.style.setProperty(cssVar, value);
    }
    
    // Apply transition speed to root element for theme transitions
    if (theme.transition_speed) {
      root.style.setProperty('--transition-speed', theme.transition_speed);
    }
  }
  
  /**
   * Update the model badge with the current model name
   */
  updateModelBadge() {
    const modelBadge = document.getElementById('model-badge');
    if (!modelBadge) return;
    
    // Display either the display_name or the model name itself
    modelBadge.textContent = this.config.ollama.display_name || this.config.ollama.model || 'unknown';
  }
  
  /**
   * Load default configuration if server config fails to load
   */
  loadDefaultConfig() {
    console.warn('Loading default configuration');
    
    this.config = {
      ollama: {
        base_url: 'http://localhost:11434',
        model: 'Ollama Model',
        display_name: 'LLM'
      },
      ui: {
        app_name: 'Ollama Neural Interface',
        display_name: 'Local Ollama Interface',
        theme: {
          primaryColor: '#4a00e0',
          secondaryColor: '#8e2de2',
          backgroundDark: '#121212',
          backgroundLight: '#1a1a1a',
          textColor: '#e0e0e0',
          accentColor: '#00d9ff',
          successColor: '#00e676',
          errorColor: '#ff1744',
          panelBg: 'rgba(26, 26, 26, 0.85)',
          panelBorder: 'rgba(255, 255, 255, 0.1)',
          panelShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        },
        chat: {
          typing_speed: 15,
          typing_delay: 500,
          welcome_message: 'Hello! I am running locally via Ollama. How can I help you today?',
          placeholders: {
            input: 'Ask anything......'
          },
          status_check_interval: 10000
        }
      },
      neural_visualization: {
        neuron_count: 80,
        neuron_min_size: 2,
        neuron_max_size: 6,
        connection_distance: 120,
        connection_opacity: 0.2,
        active_neuron_color: '#00d9ff',
        default_neuron_color: '#4a00e0',
        background_color: '#121212',
        particle_count: 50,
        max_signal_particles: 15,
        random_activation_chance: 0.05
      }
    };
    
    this.configLoaded = true;
    this.applyConfig();
    window.appConfig = this.config;
    this.notifyConfigLoaded();
  }
  
  /**
   * Register a callback for when config is loaded
   */
  onConfigLoaded(callback) {
    if (this.configLoaded) {
      // Config already loaded, call immediately
      callback(this.config);
    } else {
      // Store callback for later
      this.onConfigLoadedCallbacks.push(callback);
    }
  }
  
  /**
   * Notify all registered callbacks that config is loaded
   */
  notifyConfigLoaded() {
    this.onConfigLoadedCallbacks.forEach(callback => {
      try {
        callback(this.config);
      } catch (error) {
        console.error('Error in config loaded callback:', error);
      }
    });
    // Clear callbacks
    this.onConfigLoadedCallbacks = [];
  }
  
  /**
   * Get a configuration value by path
   */
  get(path, defaultValue = null) {
    if (!this.configLoaded) {
      console.warn('Attempting to access config before it is loaded');
      return defaultValue;
    }
    
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value === undefined || value === null) return defaultValue;
      value = value[key];
    }
    
    return value !== undefined ? value : defaultValue;
  }
}

// Initialize config manager and load config
const configManager = new ConfigManager();
window.configManager = configManager;

// Load config when the document is ready
document.addEventListener('DOMContentLoaded', () => {
  configManager.loadConfig();
}); 