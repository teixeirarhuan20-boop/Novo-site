
const normalizeText = (str) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function testFilter(search, item) {
    const normalizedSearch = normalizeText(search);
    if (!normalizedSearch) return true;
    
    const tokens = normalizedSearch.split(/\s+/).filter(t => t.length > 0);
    const itemContent = normalizeText(`${item.name} ${item.category}`);
    
    return tokens.every(token => itemContent.includes(token));
}

const inventory = [
    { name: "Monitor Dell 24 Polegadas", category: "Eletrônicos" },
    { name: "Teclado Mecânico RGB", category: "Periféricos" },
    { name: "Cadeira Gamer Ergonômica", category: "Móveis" }
];

const testCases = [
    "Dell Monitor", // Out of order
    "24 Dell",      // Out of order
    "RGB Teclado",  // Out of order
    "Gamer Cadeira", // Out of order
    "Eletronico Dell" // Cross-field (name + category)
];

console.log("=== Testing Token-based Filter ===");
testCases.forEach(query => {
    const results = inventory.filter(item => testFilter(query, item));
    console.log(`Query: "${query}" -> Found: ${results.length > 0 ? results.map(r => r.name).join(', ') : 'Nothing'}`);
});

// --- Test Mapping from Raw Text (Label extraction simulation) ---
function simulateLabelExtractionMatch(extractedName, inventory) {
    const searchName = normalizeText(extractedName);
    const searchTokens = searchName.split(/\s+/).filter(t => t.length > 1);
    let bestMatch = null;
    let highestScore = 0;

    inventory.forEach(item => {
        const itemName = normalizeText(item.name);
        let score = 0;

        searchTokens.forEach(token => {
            if (itemName.includes(token)) score++;
        });

        if (score > highestScore) {
            highestScore = score;
            bestMatch = item;
        }
    });
    return bestMatch;
}

const messyLabels = [
    "ITEM: MONITOR DELL 24 - QTD 1",
    "DELL MONITOR 24 INCH",
    "COMPRA DE 1 CADEIRA ERGONOMICA GAMER",
    "PERIFERICO TECLADO RGB"
];

console.log("\n=== Testing Messy Label Matching ===");
messyLabels.forEach(label => {
    const match = simulateLabelExtractionMatch(label, inventory);
    console.log(`Label: "${label}" -> Matched: ${match ? match.name : 'Unknown'}`);
});
