// Markup for the built-in pages: Welcome, Settings and About.
// Mixed into AntlerApp (see utils/mixMethods.js).
class AppPageTemplates {
  /**
   * Get welcome page content
   */
  getWelcomePage() {
    return `
      <div class="welcome-dashboard">
        <div class="welcome-hero">
          <div class="hero-content">
            <h1>Antler</h1>
            <p class="hero-subtitle">LoRA dataset workbench for e621</p>
            <div class="version-badge">
              <span id="app-version-badge">—</span>
              <span class="version-separator">·</span>
              <span id="app-build-info">—</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get settings page content
   */
  getSettingsPage() {
    return `
      <div class="page-content">
        <!-- Appearance -->
        <div class="settings-section">
          <h3><i class="fas fa-palette"></i> Appearance</h3>
          <div class="form-group">
            <label class="form-label" for="app-theme">Theme</label>
            <select class="form-input" id="app-theme"></select>
            <small class="form-help">Applies straight away. Themes are defined in styles/themes.css.</small>
          </div>
        </div>

        <!-- E621 API Configuration -->
        <div class="settings-section">
          <h3><i class="fas fa-key"></i> E621 API Configuration</h3>
          <p class="text-muted mb-3">Configure your E621 API credentials for accessing post data.</p>
          
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="e621-username" placeholder="Your E621 username">
            <small class="form-help">Your E621 username (case-sensitive)</small>
          </div>
          
          <div class="form-group">
            <label class="form-label">API Key</label>
            <div class="input-with-button secret-field">
              <input type="password" class="form-input" id="e621-api-key" placeholder="Your E621 API key">
              <button type="button" class="btn btn-sm btn-secondary secret-clear-btn" data-secret="e621.apiKey" style="display: none;" title="Remove the saved API key. Leaving the field blank keeps it.">Clear</button>
            </div>
            <small class="form-help">Get this from Account Settings → API Access on e621.net</small>
          </div>
          
          <div class="form-actions">
            <button class="btn btn-primary" id="test-credentials-btn">
              <i class="fas fa-flask"></i>
              Test Credentials
            </button>
          </div>
          
          <div class="credentials-status" id="credentials-status" style="display: none;">
            <!-- Status will be shown here -->
          </div>
        </div>

        <!-- Inkbunny Login -->
        <div class="settings-section">
          <h3><i class="fas fa-key"></i> Inkbunny Login</h3>
          <p class="text-muted mb-3">Optional. Without a login, Inkbunny search runs as a guest and only shows General-rated work. With one, it shows what your account's rating settings allow.</p>

          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="inkbunny-username" placeholder="Your Inkbunny username" autocomplete="off">
          </div>

          <div class="form-group">
            <label class="form-label">Password</label>
            <div class="input-with-button secret-field">
              <input type="password" class="form-input" id="inkbunny-password" placeholder="Your Inkbunny password" autocomplete="off">
              <button type="button" class="btn btn-sm btn-secondary secret-clear-btn" data-secret="inkbunny.password" style="display: none;" title="Remove the saved password. Leaving the field blank keeps it.">Clear</button>
            </div>
            <small class="form-help">Turn on "Enable API access" in your Inkbunny account settings first. The password is stored encrypted on this computer.</small>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary" id="test-inkbunny-btn">
              <i class="fas fa-flask"></i>
              Test Login
            </button>
          </div>

          <div class="credentials-status" id="inkbunny-status" style="display: none;"></div>
        </div>

        <!-- X (Twitter) Sign-in -->
        <div class="settings-section">
          <h3><i class="fab fa-x-twitter"></i> X (Twitter)</h3>
          <p class="text-muted mb-3">Needed to search X in Artist Search. You sign in on x.com's own page in an Antler window; Antler keeps that sign-in on this computer and never sees your password. Searching opens the artist's profile in a hidden window and scrolls their posts, keeping the ones with images or video, so it is slower than the other sites.</p>
          <p class="text-warning mb-3">Reading X this way is against X's terms of service. X may limit or suspend the account you sign in with, so consider a separate account.</p>

          <div class="form-actions">
            <button class="btn btn-primary" id="x-sign-in-btn">Sign in to X</button>
            <button class="btn btn-secondary" id="x-sign-out-btn" style="display: none;">Sign out</button>
          </div>

          <div class="credentials-status" id="x-status" style="display: none;"></div>
        </div>

        <!-- Hugging Face AI Configuration -->
        <div class="settings-section">
          <h3><i class="fas fa-robot"></i> Hugging Face AI Configuration</h3>
          <p class="text-muted mb-3">
            Enable AI-powered prompt optimization using Hugging Face's free Inference API.
            <a href="#" id="hf-learn-more" class="settings-link">Learn more</a>
          </p>
          
          <div class="form-group">
            <label class="form-checkbox">
              <input type="checkbox" id="ai-enable-checkbox">
              Enable AI-Powered Features
            </label>
            <small class="form-help">Use AI for intelligent prompt optimization and analysis</small>
          </div>

          <div class="form-group" id="ai-token-group" style="display: none;">
            <label class="form-label">Hugging Face API Token</label>
            <div class="input-with-button secret-field">
              <input type="password" class="form-input" id="hf-api-token" placeholder="hf_xxxxxxxxxxxxxxxxxxxxx">
              <button type="button" class="btn btn-sm btn-secondary secret-clear-btn" data-secret="huggingface.apiToken" style="display: none;" title="Remove the saved token. Leaving the field blank keeps it.">Clear</button>
            </div>
            <small class="form-help">
              Get a free token from <a href="https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained" target="_blank" class="settings-link">huggingface.co/settings/tokens</a>.
              Choose the "Fine-grained" token type and enable the permission "Make calls to Inference Providers".
            </small>
          </div>

          <div class="form-group" id="ai-model-group" style="display: none;">
            <label class="form-label">Preferred Model</label>
            <select class="form-input" id="hf-model-select"></select>
            <small class="form-help">Run through Hugging Face's inference router; free-tier credits cover light use.</small>
          </div>

          <div class="form-group" id="ai-custom-model-group" style="display: none;">
            <label class="form-label">Custom Models</label>
            <div class="settings-search">
              <div class="settings-search-row">
                <input type="text" class="form-input" id="hf-custom-model-input"
                       placeholder="Begin typing to find a model..."
                       autocomplete="off">
                <button class="btn btn-secondary" id="hf-add-custom-model-btn">Add</button>
              </div>
              <!-- Live search dropdown -->
              <div class="settings-dropdown" id="hf-model-search-dropdown" style="display:none;"></div>
            </div>
            <small class="form-help">
              Search the Hugging Face model hub. Only models with an active Inference API will work here;
              abliterated models typically require <strong>Ollama</strong> instead.
            </small>
            <div class="settings-model-list" id="hf-custom-models-list"></div>
          </div>

          <div class="form-group" id="ai-temperature-group" style="display: none;">
            <label class="form-label">AI Creativity (Temperature: <span id="temp-value">0.7</span>)</label>
            <input type="range" class="form-input" id="ai-temperature-slider" min="0.1" max="1.0" step="0.1" value="0.7">
            <small class="form-help">Lower = More consistent, Higher = More creative variations</small>
          </div>
          
          <div class="form-actions" id="ai-actions-group" style="display: none;">
            <button class="btn btn-primary" id="test-ai-btn">
              <i class="fas fa-flask"></i>
              Test AI Connection
            </button>
          </div>
          
          <div class="credentials-status" id="ai-status" style="display: none;">
            <!-- AI status will be shown here -->
          </div>
        </div>

        <!-- Dataset libraries -->
        <div class="settings-section" id="libraries-settings">
          <h3><i class="fas fa-folder-open"></i> Storage</h3>
          <p class="text-muted mb-3">Folders your datasets live in. Every tool lists the datasets in all of them. A download goes to the library that already has that artist or character, otherwise to the default one. Changes save straight away.</p>
          <div data-libraries-list></div>
          <div class="form-actions">
            <button class="btn btn-secondary" data-libraries-add><i class="fas fa-plus"></i> Add library</button>
          </div>
        </div>

        <!-- Models -->
        <div class="settings-section" id="models-settings">
          <h3><i class="fas fa-cube"></i> Models</h3>
          <p class="text-muted mb-3">Taggers, detectors and upscalers that run on this machine. Downloads resume if interrupted.</p>
          <div data-models-list></div>
          <div class="form-actions">
            <button class="btn btn-primary" data-models-download>Download</button>
            <button class="btn btn-secondary" data-models-import title="Copy models you already have from a folder"><i class="fas fa-file-import"></i> I already have these</button>
            <button class="btn btn-secondary" data-models-open-folder><i class="fas fa-folder-open"></i> Open models folder</button>
          </div>
        </div>

        <!-- Master Save Button -->
        <div class="settings-section settings-save-section">
          <div class="form-actions form-actions-center">
            <button class="btn btn-primary" id="save-all-settings-btn">Save All Settings</button>
          </div>

          <div class="credentials-status" id="settings-save-status" style="display: none;">
            <!-- Save status will be shown here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get about page content
   */
  // Replace your existing getAboutPage method with this enhanced version:

  getAboutPage() {
  return `
    <div class="page-content">
      <!-- Hero Section -->
      <div class="about-hero">
        <div class="about-hero-content">
          <h1>Antler</h1>
          <p class="hero-subtitle">LoRA dataset workbench for e621</p>
          <div class="version-badge">
            <span>Version</span>
            <span class="version-number" id="about-version">1.0.0</span>
          </div>
        </div>
      </div>

      <!-- System Information -->
      <div class="settings-section">
        <h3><i class="fas fa-desktop"></i> System Information</h3>        <div class="info-grid">
          <div class="info-card">
            <h4><i class="fas fa-tag"></i> Version Details</h4>
            <div class="info-content">
              <div class="info-row">
                <span class="info-label">Version</span>
                <span class="info-value" id="app-version-detail">1.0.0</span>
              </div>
              <div class="info-row">
                <span class="info-label">Build</span>
                <span class="info-value">Release</span>
              </div>
              <div class="info-row">
                <span class="info-label">Release Date</span>
                <span class="info-value">2024</span>
              </div>
            </div>
          </div>

          <div class="info-card">
            <h4><i class="fas fa-desktop"></i> Platform Information</h4>
            <div class="info-content">
              <div class="info-row">
                <span class="info-label">Platform</span>
                <span class="info-value" id="platform-info">Loading...</span>
              </div>
              <div class="info-row">
                <span class="info-label">Architecture</span>
                <span class="info-value" id="arch-info">Loading...</span>
              </div>
              <div class="info-row">
                <span class="info-label">Node.js</span>
                <span class="info-value" id="node-version">Loading...</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Actions Section -->
      <div class="settings-section">
        <h3><i class="fas fa-tools"></i> Actions</h3>
        
        <div class="support-actions">
          <button class="btn btn-primary" id="check-updates-btn">
            <i class="fas fa-sync-alt"></i>
            Check for Updates
          </button>

          <button class="btn btn-secondary" id="system-info-btn">
            <i class="fas fa-info"></i>
            System Info
          </button>
        </div>
      </div>

      <!-- Footer Info -->
      <div class="about-footer">
        <div class="footer-content">
          <p>
            <i class="fas fa-code"></i>
            Built with Electron. &copy; 2026 Piper260
          </p>
        </div>
      </div>
    </div>
  `;
}
}
