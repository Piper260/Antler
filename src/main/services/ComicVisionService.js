const path = require('path');
const UtilityWorkerService = require('./UtilityWorkerService');

let shared = null;

/** The comic panel worker: run('detect' | 'export', payload). */
class ComicVisionService extends UtilityWorkerService {
  constructor() {
    super(path.join(__dirname, '..', 'workers', 'comicVisionWorker.js'), 'Antler Comic Panels');
  }

  /** One worker for Comic Panels and the Tag Editor, so the e621 tagger is loaded once. */
  static shared() {
    if (!shared) shared = new ComicVisionService();
    return shared;
  }
}

module.exports = ComicVisionService;
