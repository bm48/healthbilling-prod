/**
 * Intentionally not the app entrypoint — avoids "Cannot find module … server.js"
 * when someone runs `node server.js` from this folder.
 */
console.error(
  'This API is TypeScript. From the server/ directory run:\n' +
    '  npm install        — once, to install dependencies\n' +
    '  npm start          — dev (tsx watch)\n' +
    '  npm run start:prod — production (run npm run build first)',
)
process.exit(1)
