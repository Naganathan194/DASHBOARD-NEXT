/**
 * Validation test: Compare pending count from stats API with actual documents
 * This verifies that the pending count aggregation is working correctly
 */

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

function createBasicAuth(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function validatePendingCount() {
  try {
    console.log('🔍 Validation Test: Pending Count Accuracy\n');
    console.log('='.repeat(70));
    
    const collections = [
      'hackproofingregistrations',
      'prompttoproductregistrations',
      'fullstackfusionregistrations',
      'learnhowtothinkregistrations',
      'portpassregistrations',
    ];
    
    let allValid = true;
    
    for (const col of collections) {
      try {
        console.log(`\n📋 Collection: ${col}`);
        console.log('-'.repeat(70));
        
        // Fetch documents
        const docsUrl = `http://localhost:3000/api/databases/test/collections/${col}/documents`;
        const docsResponse = await fetch(docsUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': createBasicAuth(ADMIN_USER, ADMIN_PASS),
          },
        });
        
        if (!docsResponse.ok) {
          console.log(`❌ Failed to fetch documents: ${docsResponse.statusText}`);
          allValid = false;
          continue;
        }
        
        const docs = await docsResponse.json();
        
        // Fetch stats
        const statsUrl = `http://localhost:3000/api/databases/test/collections/${col}/stats`;
        const statsResponse = await fetch(statsUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': createBasicAuth(ADMIN_USER, ADMIN_PASS),
          },
        });
        
        if (!statsResponse.ok) {
          console.log(`❌ Failed to fetch stats: ${statsResponse.statusText}`);
          allValid = false;
          continue;
        }
        
        const stats = await statsResponse.json();
        
        // Calculate pending from documents
        let calculatedPending = 0;
        let statusBreakdown = {
          pending: 0,
          'null/undefined': 0,
          approved: 0,
          rejected: 0,
          others: 0,
        };
        
        docs.forEach(doc => {
          const docStatus = doc.status ? String(doc.status).toLowerCase() : null;
          
          if (docStatus === 'pending') {
            calculatedPending++;
            statusBreakdown.pending++;
          } else if (docStatus === null || docStatus === undefined) {
            calculatedPending++;
            statusBreakdown['null/undefined']++;
          } else if (docStatus === 'approved') {
            statusBreakdown.approved++;
          } else if (docStatus === 'rejected') {
            statusBreakdown.rejected++;
          } else {
            statusBreakdown.others++;
          }
        });
        
        console.log(`\n📊 Document Summary:`);
        console.log(`   Total documents fetched: ${docs.length}`);
        console.log(`\n   Status Breakdown:`);
        console.log(`   • Pending (status='pending'):        ${statusBreakdown.pending}`);
        console.log(`   • Null/Undefined status:            ${statusBreakdown['null/undefined']}`);
        console.log(`   • Approved:                         ${statusBreakdown.approved}`);
        console.log(`   • Rejected:                         ${statusBreakdown.rejected}`);
        console.log(`   • Other status values:              ${statusBreakdown.others}`);
        
        console.log(`\n📈 Comparison:`);
        console.log(`   Calculated Pending: ${calculatedPending}`);
        console.log(`   Stats API Pending:  ${stats.pending}`);
        
        if (calculatedPending === stats.pending) {
          console.log(`   ✅ MATCH! Pending count is correct`);
        } else {
          console.log(`   ❌ MISMATCH! Expected ${calculatedPending}, got ${stats.pending}`);
          allValid = false;
        }
        
        // Verify total matches
        if (docs.length === stats.total) {
          console.log(`   ✅ Total count matches: ${docs.length}`);
        } else {
          console.log(`   ❌ Total count mismatch! Documents: ${docs.length}, Stats: ${stats.total}`);
          allValid = false;
        }
        
      } catch (collErr) {
        console.log(`❌ Error testing ${col}: ${collErr.message}`);
        allValid = false;
      }
    }
    
    console.log('\n' + '='.repeat(70));
    if (allValid) {
      console.log('✅ All validations passed! Pending count is being calculated correctly.\n');
    } else {
      console.log('❌ Some validations failed. Please check the pending count calculation.\n');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

validatePendingCount();
