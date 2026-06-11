const fs = require('fs');
const path = require('path');
const https = require('https');
const baseUrl = 'https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/';
const targetDir = 'C:\\Users\\MLTZ\\.codex\\skills\\impeccable';

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      if (resp.statusCode !== 200) { reject(new Error('HTTP ' + resp.statusCode)); return; }
      const chunks = [];
      resp.on('data', chunk => chunks.push(chunk));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function mkdirp(p) {
  const parts = p.split('\\');
  let current = parts[0];
  for (let i = 1; i < parts.length; i++) {
    current += '\\' + parts[i];
    if (!fs.existsSync(current)) fs.mkdirSync(current);
  }
}

async function listFiles(dir) {
  return new Promise((resolve, reject) => {
    https.get('https://api.github.com/repos/pbakaus/impeccable/contents/skill/' + dir, { headers: { 'User-Agent': 'node' } }, (resp) => {
      let data = '';
      resp.on('data', d => data += d);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  try {
    mkdirp(targetDir);
    
    console.log('Downloading SKILL.md...');
    let content = await downloadFile(baseUrl + 'SKILL.src.md');
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content);
    console.log('  OK (' + content.length + ' bytes)');
    
    for (const sub of ['reference', 'scripts', 'agents']) {
      const subDir = path.join(targetDir, sub);
      mkdirp(subDir);
      console.log('Downloading ' + sub + '/...');
      const files = await listFiles(sub);
      for (const f of files) {
        if (f.type === 'file') {
          console.log('  ' + f.name + '...');
          const fc = await downloadFile(baseUrl + sub + '/' + f.name);
          fs.writeFileSync(path.join(subDir, f.name), fc);
          console.log('    OK (' + fc.length + ' bytes)');
        }
      }
    }
    
    console.log('\n=== Installed! Restart Codex to use. ===');
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
