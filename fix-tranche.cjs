const db = require('better-sqlite3')('data/project-mind.db');
const rows = db.prepare("SELECT id, name, path FROM projects").all();
console.log('All projects:', JSON.stringify(rows, null, 2));
const result = db.prepare("UPDATE projects SET id = 'tranche' WHERE name = 'tranche'").run();
console.log('Updated rows:', result.changes);
const fixed = db.prepare("SELECT id, name, path FROM projects WHERE id = 'tranche'").get();
console.log('Fixed:', JSON.stringify(fixed));
db.close();
