const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/adamo.figueroa/Documents/GitHub/control-markets/control-markets-node/.env' });
(async () => {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const d = await c.db().collection('agentic_conversations').findOne({ _id: '6a727c1e027fe16e6b8858c5' });
  const ic = d.injectedContext || {};
  console.log('injectedContext keys:', Object.keys(ic));
  console.log(JSON.stringify({ ...ic, content: ic.content ? `<${ic.content.length} chars>` : undefined, markdown: ic.markdown ? `<${ic.markdown.length} chars>` : undefined }, null, 1).slice(0, 900));
  console.log('\nprofileId:', d.profileId, 'orgId:', d.orgId);
  for (const [i,m] of d.messages.entries()) console.log(`[${i}] ${m.role} contentLen=${(m.content||'').length} createdAt=${m.createdAt?.toISOString?.()??m.createdAt}`);
  await c.close();
})().catch(e=>console.error(e.message));
