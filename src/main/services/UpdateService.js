
const { app } = require('electron');
const versionInfo = require('../../shared/version');

class UpdateService {
  constructor(settingsService) {
    this.settingsService = settingsService;
    this.repoOwner = 'Piper260';
    this.repoName = 'Antler';
    this.checkInterval = 60 * 60 * 1000; // 1 hour
    this.lastCheck = null;
    this.updateAvailable = null;
  }

  /**
   * Check for updates (commits and releases)
   */
  async checkForUpdates() {
    // Rate limit checks
    if (this.lastCheck && Date.now() - this.lastCheck < 5 * 60 * 1000) {
      console.log('⏱️ Skipping update check (too frequent)');
      return this.updateAvailable || { available: false };
    }

    this.lastCheck = Date.now();

    try {
      const [commitUpdate, releaseUpdate] = await Promise.all([
        this.checkLatestCommit(),
        this.checkLatestRelease()
      ]);

      // Prioritize release updates over commit updates
      if (releaseUpdate.available) {
        this.updateAvailable = { type: 'release', ...releaseUpdate };
      } else if (commitUpdate.available) {
        this.updateAvailable = { type: 'commit', ...commitUpdate };
      } else {
        this.updateAvailable = { available: false };
      }

      if (this.updateAvailable.available) {
        console.log(`✨ Update available: ${this.updateAvailable.type} - ${this.updateAvailable.version || this.updateAvailable.shortHash}`);
      }

      return this.updateAvailable;
    } catch (error) {
      console.error('❌ Error checking for updates:', error);
      return { available: false, error: error.message };
    }
  }

  /**
   * Check for latest commit on main branch
   */
  async checkLatestCommit() {
    try {
      const currentCommit = versionInfo.gitCommit;
      if (currentCommit === 'unknown') {
        return { available: false, reason: 'Current commit unknown' };
      }

            const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits/main`, {
        headers: { 'User-Agent': 'Antler-App' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
          return { available: false, reason: 'Repository not accessible' };
        }
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      const latestHash = data.sha;
      const shortHash = latestHash.substring(0, 7);

      if (shortHash !== currentCommit) {
        return {
          available: true,
          hash: latestHash,
          shortHash: shortHash,
          message: data.commit.message,
          date: data.commit.author.date,
          author: data.commit.author.name,
          url: data.html_url
        };
      }

      return { available: false };
    } catch (error) {
      // Only log actual errors, not access issues
      if (!error.message.includes('not accessible')) {
        console.error('❌ Error checking commits:', error);
      }
      return { available: false, error: error.message };
    }
  }

  /**
   * Check for latest release
   */
  async checkLatestRelease() {
    try {
      const currentVersion = versionInfo.packageVersion;
      
            const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`, {
        headers: { 'User-Agent': 'Antler-App' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        if (response.status === 404) return { available: false }; // No releases
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      const latestVersion = data.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present

      if (this.compareVersions(latestVersion, currentVersion) > 0) {
        return {
          available: true,
          version: latestVersion,
          name: data.name,
          body: data.body,
          date: data.published_at,
          url: data.html_url,
          assets: data.assets
        };
      }

      return { available: false };
    } catch (error) {
      // Only log actual errors, not access issues
      if (error.message && !error.message.includes('404')) {
        console.error('❌ Error checking releases:', error);
      }
      return { available: false, error: error.message };
    }
  }

  /**
   * Compare semver versions
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  compareVersions(v1, v2) {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }
}

module.exports = UpdateService;
