/**
 * Clear Database Script
 * Removes all data from vyapar-vaani-data and marketplace-products tables
 */

const { DynamoDBClient, ScanCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });

async function clearTable(tableName) {
  console.log(`\n🗑️  Clearing table: ${tableName}`);
  
  let itemsDeleted = 0;
  let lastEvaluatedKey = undefined;
  
  do {
    const scanParams = {
      TableName: tableName,
      Limit: 25,
      ExclusiveStartKey: lastEvaluatedKey
    };
    
    const scanResult = await client.send(new ScanCommand(scanParams));
    
    if (scanResult.Items && scanResult.Items.length > 0) {
      const deleteRequests = scanResult.Items.map(item => {
        // marketplace-products uses productId as key, vyapar-vaani-data uses PK/SK
        if (tableName === 'marketplace-products') {
          return {
            DeleteRequest: {
              Key: {
                productId: item.productId
              }
            }
          };
        } else {
          return {
            DeleteRequest: {
              Key: {
                PK: item.PK,
                SK: item.SK
              }
            }
          };
        }
      });
      
      await client.send(new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: deleteRequests
        }
      }));
      
      itemsDeleted += deleteRequests.length;
      console.log(`   Deleted ${itemsDeleted} items...`);
    }
    
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  
  console.log(`   ✅ Total items deleted: ${itemsDeleted}`);
}

async function main() {
  console.log('🚀 Starting database cleanup...\n');
  
  await clearTable('vyapar-vaani-data');
  await clearTable('marketplace-products');
  
  console.log('\n✅ All tables cleared! Ready for fresh start.\n');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
