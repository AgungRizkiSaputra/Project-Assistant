const fs = require('fs');
const content = fs.readFileSync('src/telegram/bot.ts', 'utf8');

const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes("data === '") || line.includes("data.startsWith('")) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
});

