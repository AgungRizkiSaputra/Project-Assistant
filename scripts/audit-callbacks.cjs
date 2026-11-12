const fs = require('fs');

function auditFiles() {
  const files = ['src/telegram/bot.ts', 'src/telegram/views/keyboards.ts'];
  const uuid = '784b3819-6526-4914-addb-a20941b0ca04'; // 36 chars
  
  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      // Find strings used in callback_data: .text('...', '...')
      const matches = line.match(/\.text\([^,]+,\s*[`'"]([^`'"]+)[`'"]/g);
      if (matches) {
        matches.forEach(m => {
          const innerMatch = m.match(/\.text\([^,]+,\s*[`'"]([^`'"]+)[`'"]/);
          if (innerMatch) {
            const raw = innerMatch[1];
            // Simulate UUID substitution
            const simulated = raw
              .replace(/\$\{projectId\}/g, uuid)
              .replace(/\$\{project\.id\}/g, uuid)
              .replace(/\$\{idea\.id\}/g, uuid)
              .replace(/\$\{ideaId\}/g, uuid)
              .replace(/\$\{v\.id\}/g, uuid)
              .replace(/\$\{versionId\}/g, uuid)
              .replace(/\$\{version\.id\}/g, uuid)
              .replace(/\$\{targetPhase\}/g, 'PHASE_2_PRODUCT')
              .replace(/\$\{meta\.nextPhase\}/g, 'PHASE_2_PRODUCT')
              .replace(/\$\{meta\.prevPhase\}/g, 'PHASE_1_IDEA');
            
            const byteLen = Buffer.byteLength(simulated);
            if (byteLen > 64) {
              console.log(`[OVERFLOW ${byteLen} bytes] ${file}:${idx + 1} -> ${raw} (simulated: "${simulated}")`);
            } else if (raw.includes('${')) {
              console.log(`[OK ${byteLen} bytes] ${file}:${idx + 1} -> ${raw} (simulated: "${simulated}")`);
            }
          }
        });
      }
    });
  });
}

auditFiles();

