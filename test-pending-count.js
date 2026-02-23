/**
 * Test script to verify pending count calculation
 * Fetches stats from the API and displays the pending count
 */

// Get admin credentials from environment or use defaults
const ADMIN_USER = process.env.ADMIN_USER || 'Port2026';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Port@2026';

// Create Basic Auth header
function createBasicAuth(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function testPendingCount() {
  try {
    console.log('🧪 Testing Pending Count Calculation\n');
    console.log('=' .repeat(60));
    
    // Test data for multiple collections
    const collections = [
      'hackproofingregistrations',
      'prompttoproductregistrations',
      'fullstackfusionregistrations',
      'learnhowtothinkregistrations',
      'portpassregistrations',
    ];
    
    for (const col of collections) {
      try {
        console.log(`\n📊 Testing collection: ${col}`);
        console.log('-'.repeat(60));
        
        const url = `http://localhost:3000/api/databases/test/collections/${col}/stats`;
        console.log(`🔗 URL: ${url}\n`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': createBasicAuth(ADMIN_USER, ADMIN_PASS),
          },
        });
        
        if (!response.ok) {
          console.log(`❌ Error: ${response.statusText} (${response.status})`);
          const error = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.log(`   Message: ${error.error || 'No additional info'}\n`);
          continue;
        }
        
        const stats = await response.json();
        
        console.log('✅ Stats retrieved successfully:\n');
        console.log(`   Total:      ${stats.total}`);
        console.log(`   Pending:    ${stats.pending}   ⏳`);
        console.log(`   Approved:   ${stats.approved}  ✓`);
        console.log(`   Rejected:   ${stats.rejected}  ✗`);
        console.log(`   Checked In: ${stats.checkedIn} ✓✓`);
        
        // Calculate percentages
        if (stats.total > 0) {
          const pendingPct = ((stats.pending / stats.total) * 100).toFixed(1);
          const approvedPct = ((stats.approved / stats.total) * 100).toFixed(1);
          const rejectedPct = ((stats.rejected / stats.total) * 100).toFixed(1);
          const checkedInPct = ((stats.checkedIn / stats.total) * 100).toFixed(1);
          
          console.log('\n📈 Percentages:');
          console.log(`   Pending:    ${pendingPct}%`);
          console.log(`   Approved:   ${approvedPct}%`);
          console.log(`   Rejected:   ${rejectedPct}%`);
          console.log(`   Checked In: ${checkedInPct}%`);
        }
        
      } catch (collErr) {
        console.log(`❌ Error testing ${col}: ${collErr.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed!\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testPendingCount();
