const fs = require('fs');
const path = 'E:/ambitious projects/OmniRouteAI2/src/services/providerService. js';
let c = fs.readFileSync(path, 'utf8');
c = c.replace(/\r\n/g, '\n');
fs.writeFileSync(path, c, 'utf8');
console.log('done');