// src/shared/version.js - Automatic version detection
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Git details only come from Antler's own source checkout. An installed
// build has no .git folder, and running git in whatever folder the app was
// started from could report some other repository's history.
const REPO_ROOT = path.join(__dirname, '..', '..');
const HAS_REPO = fs.existsSync(path.join(REPO_ROOT, '.git'));
// An installed copy has no .git folder; the build stamps its commit here
// instead (scripts/build.js). Not in git.
const BUILD_INFO_PATH = path.join(__dirname, 'build-info.json');

function readBuildInfo() {
  if (HAS_REPO) return null;
  try {
    return JSON.parse(fs.readFileSync(BUILD_INFO_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function git(command) {
  if (!HAS_REPO) throw new Error('not a source checkout');
  return execSync(command, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
}

class VersionInfo {
  constructor() {
    this.packageVersion = this.getPackageVersion();
    const stamped = readBuildInfo();
    this.installed = !HAS_REPO;
    if (stamped) {
      this.gitCommit = stamped.commit || 'unknown';
      this.gitBranch = stamped.branch || 'unknown';
      this.gitTag = stamped.tag || null;
      this.isDirty = Boolean(stamped.dirty);
      this.buildDate = stamped.date || new Date().toISOString();
    } else {
      this.gitCommit = this.getGitCommit();
      this.gitBranch = this.getGitBranch();
      this.gitTag = this.getGitTag();
      this.isDirty = this.isGitDirty();
      this.buildDate = new Date().toISOString();
    }
  }

  /**
   * Get version from package.json
   */
  getPackageVersion() {
    try {
      const packagePath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return packageJson.version || '0.0.0';
    } catch (error) {
      console.warn('⚠️ Could not read package.json version:', error.message);
      return '0.0.0';
    }
  }

  /**
   * Get current Git commit hash (short)
   */
  getGitCommit() {
    try {
      const commit = git('git rev-parse --short HEAD').trim();
      return commit;
    } catch (error) {
      console.warn('⚠️ Could not get Git commit:', error.message);
      return 'unknown';
    }
  }

  /**
   * Get current Git branch
   */
  getGitBranch() {
    try {
      const branch = git('git rev-parse --abbrev-ref HEAD').trim();
      return branch;
    } catch (error) {
      console.warn('⚠️ Could not get Git branch:', error.message);
      return 'unknown';
    }
  }

  /**
   * Get latest Git tag if available
   */
  getGitTag() {
    try {
      const tag = git('git describe --tags --abbrev=0').trim();
      return tag;
    } catch (error) {
      // No tags exist, this is normal
      return null;
    }
  }

  /**
   * Check if working directory has uncommitted changes
   */
  isGitDirty() {
    try {
      const status = git('git status --porcelain').trim();
      return status.length > 0;
    } catch (error) {
      console.warn('⚠️ Could not check Git status:', error.message);
      return false;
    }
  }

  /**
   * Get full version string
   * Format: v1.0.0-abc123 (main) or v1.0.0-abc123-dirty (main)
   */
  getFullVersion() {
    let version = `v${this.packageVersion}`;
    
    if (this.gitCommit !== 'unknown') {
      version += `-${this.gitCommit}`;
    }
    
    if (this.isDirty) {
      version += '-dirty';
    }
    
    if (this.gitBranch !== 'unknown' && this.gitBranch !== 'main' && this.gitBranch !== 'master') {
      version += ` (${this.gitBranch})`;
    }
    
    return version;
  }

  /**
   * Get short version string
   * Format: v1.0.0-abc123
   */
  getShortVersion() {
    let version = `v${this.packageVersion}`;
    
    if (this.gitCommit !== 'unknown') {
      version += `-${this.gitCommit}`;
    }
    
    return version;
  }

  /**
   * Get display version for UI
   * Format: abc123 or abc123*
   */
  getDisplayVersion() {
    // An installed copy: its version, and the commit it was built from when known.
    if (this.installed) {
      return `v${this.packageVersion}${this.gitCommit !== 'unknown' ? ` (${this.gitCommit})` : ''}`;
    }
    let version = this.gitCommit !== 'unknown' ? this.gitCommit : 'unknown';
    
    if (this.isDirty) {
      version += '*';
    }
    
    return version;
  }

  /**
   * Get build info string
   * Format: main@abc123 or win32-x64
   */
  getBuildInfo() {
    if (this.gitBranch !== 'unknown' && this.gitCommit !== 'unknown') {
      return `${this.gitBranch}@${this.gitCommit}`;
    }
    return `${process.platform}-${process.arch}`;
  }

  /**
   * Get recent Git commit history
   * @param {number} limit - Number of commits to retrieve
   */
  getCommitHistory(limit = 10) {
    try {
      const logFormat = '%H|%h|%an|%ad|%s';
      const commits = git(`git log -${limit} --pretty=format:"${logFormat}" --date=short`).trim().split('\n');

      return commits.map(line => {
        const [hash, shortHash, author, date, message] = line.split('|');
        return {
          hash,
          shortHash,
          author,
          date,
          message,
          isCurrent: shortHash === this.gitCommit
        };
      });
    } catch (error) {
      console.warn('⚠️ Could not get commit history:', error.message);
      return [];
    }
  }

  /**
   * Get all version info as object
   */
  toObject() {
    return {
      version: this.packageVersion,
      commit: this.gitCommit,
      branch: this.gitBranch,
      tag: this.gitTag,
      dirty: this.isDirty,
      buildDate: this.buildDate,
      fullVersion: this.getFullVersion(),
      shortVersion: this.getShortVersion(),
      displayVersion: this.getDisplayVersion(),
      buildInfo: this.getBuildInfo()
    };
  }

  /**
   * Log version info to console
   */
  log() {
    console.log('[INFO] Version Information:');
    console.log(`   Version: ${this.packageVersion}`);
    console.log(`   Commit:  ${this.gitCommit}`);
    console.log(`   Branch:  ${this.gitBranch}`);
    if (this.gitTag) {
      console.log(`   Tag:     ${this.gitTag}`);
    }
    if (this.isDirty) {
      console.log(`   Status:  Modified (uncommitted changes)`);
    }
    console.log(`   Display: ${this.getFullVersion()}`);
  }
}

// Create singleton instance
const versionInfo = new VersionInfo();

module.exports = versionInfo;
