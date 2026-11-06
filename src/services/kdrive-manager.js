const { KDriveApiClient } = require('./kdrive-api');
const { KDriveWebDavClient } = require('./kdrive-webdav');

function createKDriveClient(config) {
  const mode = String(config.KDRIVE_CONNECTION_MODE || 'api').toLowerCase();

  if (mode === 'webdav') {
    return new KDriveWebDavClient({
      driveId: config.KDRIVE_ID,
      email: config.KDRIVE_EMAIL,
      appPassword: config.KDRIVE_APP_PASSWORD
    });
  }

  return new KDriveApiClient({
    driveId: config.KDRIVE_ID,
    apiToken: config.KDRIVE_API_TOKEN
  });
}

function getRootFolderId(config) {
  const mode = String(config.KDRIVE_CONNECTION_MODE || 'api').toLowerCase();
  return mode === 'webdav' ? '/' : '1';
}

function isConfigured(config) {
  if (!config || !config.KDRIVE_ID) return false;
  const mode = String(config.KDRIVE_CONNECTION_MODE || 'api').toLowerCase();
  if (mode === 'webdav') {
    return Boolean(config.KDRIVE_EMAIL && config.KDRIVE_APP_PASSWORD);
  }
  return Boolean(config.KDRIVE_API_TOKEN);
}

module.exports = {
  createKDriveClient,
  getRootFolderId,
  isConfigured
};
