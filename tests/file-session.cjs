// Shared public file operations for browser regression tests.
const fs = require('node:fs');
exports.startNew = async page => {
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  await page.locator('#start-new').click();
};
exports.saveUser = async (page, button = 'export-manuscript') => {
  const pending = page.waitForEvent('download');
  await page.locator('#' + button).click();
  const data = JSON.parse(fs.readFileSync(await (await pending).path(), 'utf8'));
  await page.locator('#download-saved').click();
  await page.waitForFunction(() => !document.getElementById('download-confirm-dialog').open);
  return data;
};
exports.loadUser = async (page, data) => {
  await page.locator('#user-file').setInputFiles({ name: 'user.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.waitForFunction(() => !document.getElementById('startup-dialog').open && !document.getElementById('import-user').disabled);
};
exports.installMemoryPicker = async page => page.evaluate(() => {
  window.showSaveFilePicker = async () => ({ name: 'test-user.json', createWritable: async () => ({ write: async json => { window.testUserJSON = json; }, close: async () => {} }) });
});
exports.snapshotUser = page => page.evaluate(async () => {
  await document.getElementById('save-user-status').onclick();
  return JSON.parse(window.testUserJSON);
});
