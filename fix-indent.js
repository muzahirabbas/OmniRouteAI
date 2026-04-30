import { readFileSync, writeFileSync } from 'node:fs';
const path = 'E:/ambitious projects/OmniRouteAI2/src/services/providerService. js';
let c = readFileSync(path, 'utf8');
c = c.replace(/\r\n/g, '\n');
writeFileSync(path, c, 'utf8');
console.log('done');