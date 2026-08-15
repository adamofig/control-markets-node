const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not found in environment.');
  process.exit(1);
}

const POLILAN_ORG_ID = '6923e6b904f03ae5952d5fb7';

async function migrate() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('agent_cards');

    console.log('Connected to DB:', db.databaseName);

    const query = {
      $or: [
        { orgId: null },
        { orgId: { $exists: false } }
      ]
    };

    const countToMigrate = await collection.countDocuments(query);
    console.log(`Found ${countToMigrate} cards without orgId to migrate to Polilan (${POLILAN_ORG_ID})...`);

    if (countToMigrate === 0) {
      console.log('No cards require migration.');
      return;
    }

    const result = await collection.updateMany(
      query,
      {
        $set: {
          orgId: POLILAN_ORG_ID,
          'manageable.isPublic': true,
          'manageable.status': 'published',
        }
      }
    );

    console.log(`Migration completed successfully!`);
    console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);

    // Verify
    const remainingOrphan = await collection.countDocuments(query);
    const polilanCount = await collection.countDocuments({ orgId: POLILAN_ORG_ID });
    const publicCount = await collection.countDocuments({ 'manageable.isPublic': true });

    console.log('Post-migration stats:', {
      remainingOrphanCards: remainingOrphan,
      totalPolilanCards: polilanCount,
      totalPublicCards: publicCount
    });

  } finally {
    await client.close();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
