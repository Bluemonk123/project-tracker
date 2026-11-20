// Checks the Node.js version first, so an old version gives a clear message instead of a crash.
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`\n  Project Tracker needs Node.js 22.13 or newer (this is ${process.version}). Install a newer Node.js and start again.\n`);
  process.exit(1);
}
const { startServer } = await import('./index.js');
startServer();
