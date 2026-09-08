import { migrate, db } from './index.ts';

migrate();
console.log('[chat-pilot] migrations applied.');
db.close();
