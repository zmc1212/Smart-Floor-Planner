/* eslint-disable @typescript-eslint/no-require-imports -- Isolated vendor container bootstrap. */
// Matches v4.17.4's reset-root-password-utils.ts. Only replace the vendor's
// initial default; a different existing password is never overwritten.
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
async function main() {
  if (!/^[a-f0-9]{64}$/.test(process.env.DEFAULT_ROOT_PSW || '')) throw Error('Missing protected pilot password');
  const entry = fs.readdirSync('/app/node_modules/.pnpm').find(name => name.startsWith('mongoose@'));
  const mongoose = require(`/app/node_modules/.pnpm/${entry}/node_modules/mongoose`);
  const connection = await mongoose.createConnection(process.env.MONGODB_URI).asPromise();
  try {
    const users = connection.db.collection('users');
    const secured = hash(hash(process.env.DEFAULT_ROOT_PSW));
    await users.updateOne({username:'root', password:hash(hash('123456')), passwordUpdateTime:{$exists:false}}, {$set:{password:secured, passwordUpdateTime:new Date()}});
    const root = await users.findOne({username:'root'});
    if (root?.password === secured) console.log('Pilot installation credential secured; values omitted.');
    else if (root?.passwordUpdateTime) console.log('Existing activated root password retained; values omitted.');
    else throw Error('Pilot root credential differs; refusing to overwrite it');
  } finally { await connection.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
